// Shared lifecycle for automatic camera popup openings; the trigger policy belongs to the callers.
// The limits live here, in one place: a young enough occurrence and one trigger at most once per minute.
// The popup has no close of its own: Idle close closes it, like every other window.
(function () {
  if (window._casoraRingPopup) return;
  var P = window._casoraRingPopup = {};
  var TWO_MINUTES = 120000;     // a ring this young may open the popup
  var COOLDOWN_MS = 60000;      // one trigger opens a popup at most once per minute
  var CLOCK_SKEW_MS = 60000;    // server and screen clock may differ: a ring up to this far "in the future" counts as now
  var shown = {}, pending = {}, deferred = {};
  var active = null;
  // Young enough to open: less than two minutes old, not more than the clock skew ahead.
  // The one definition of "young enough"; the watcher (26-camera-triggers.js) reads it from here.
  P.fresh = function (at) {
    var age = Date.now() - at;
    return Number.isFinite(at) && age < TWO_MINUTES && age >= -CLOCK_SKEW_MS;
  };
  var fresh = function (ring) { return P.fresh(ring.at); };
  // The pending ‹ destination of one attempt: a successful open consumed it, a failed or suppressed one
  // must not leave it for the next, unrelated popup.
  var clearBack = function (back) {
    if (back && window._casoraBackNext === back) window._casoraBackNext = null;
  };
  var remember = function (key, ring) {
    shown[key] = { id: ring.id, at: ring.at };
    try { window.localStorage.setItem(key, JSON.stringify(shown[key])); } catch (e) { /* Memory still deduplicates. */ }
  };
  // Return through the same path as ‹, or dismiss a top-level popup (the popup element keeps ‹ in _backFn).
  P.back = function (popup) {
    var el = popup.element;
    if (!el || !el.hasAttribute('open')) return;
    var fn = el._backFn;
    el._navBackAt = Date.now();
    if (typeof fn === 'function') fn();
    else popup.close();
  };
  // The automatic popup that is open stays until someone closes it; it has no close of its own.
  var start = function (occurrence) {
    var popup = window.casoraPopup;
    active = { cfg: popup.current, role: occurrence.role,
      camera: occurrence.camera, el: popup.element };
  };
  // Only a real Lovelace dashboard owns a dashboard config (26-camera-triggers.js reads it). /config, /history
  // and the Studio are not dashboards.
  var allowed = function (url) {
    var ha = window.document.querySelector('home-assistant');
    var hass = ha && ha.hass;
    var panel = hass && hass.panels && hass.panels[url];
    return !window.document.hidden && window.casoraPopup && window.casoraPopup.enabled
      && !!url && url !== 'casora-studio' && url === window._casoraRing.route()
      && !!panel && panel.component_name === 'lovelace';
  };
  // Call open(occurrence, cfg) after policy/arbitration. occurrence: {entity, at (ms),
  // id, role (doorbell/detection), camera (entity id), name (HA display name)};
  // cfg is the canonical camera card config consumed by the existing popup opener.
  // Hidden occurrences are retried on visibility return, provided they are still fresh.
  // handled(occurrence) lets the caller discard arbitration losers without queueing them.
  P.handled = function (occurrence) {
    if (!occurrence || !occurrence.entity || !occurrence.id || !Number.isFinite(occurrence.at)) return;
    var key = 'casora-camera-popup:' + window._casoraRing.route() + ':' + occurrence.entity;
    remember(key, occurrence);
  };
  P.open = function (occurrence, cfg) {
    if (!occurrence || !cfg || !occurrence.entity || !occurrence.camera || !occurrence.id || !Number.isFinite(occurrence.at) || !fresh(occurrence)) return false;
    var url = window._casoraRing.route();
    if (window.document.hidden) { deferred[url] = { occurrence: occurrence, cfg: cfg }; return false; }
    if (!allowed(url) || !window._casoraOpenViaCard) return false;
    var key = 'casora-camera-popup:' + url + ':' + occurrence.entity;
    if (pending[key]) return false;
    if (!shown[key]) {
      try { shown[key] = JSON.parse(window.localStorage.getItem(key)); } catch (e) { /* Memory fallback. */ }
    }
    // The same occurrence and one within the cooldown open no second popup.
    if (shown[key] && (shown[key].id === occurrence.id || occurrence.at - shown[key].at < COOLDOWN_MS)) return true;
    var popup = window.casoraPopup, el = popup.element, previous, previousEntity = null, previousActive = null, replace = false;
    var popupOpen = !!(popup.current && (!el || el.isConnected !== false)
      && !(el && el.hasAttribute && el.hasAttribute('closing')));
    if (active) {
      if (popupOpen && active.el && active.el.isConnected !== false && popup.current === active.cfg) {
        if (occurrence.camera === active.camera || (occurrence.role === 'detection' && active.role !== 'detection')) {
          remember(key, occurrence); return true;
        }
        previous = popup.current;
        previousEntity = popup.entity;
        previousActive = active;
        replace = true;
      } else active = null;
    }
    if (!replace) {
      if (popupOpen && occurrence.role === 'detection') { remember(key, occurrence); return true; }
      if (popupOpen && popup.entity === occurrence.camera) { remember(key, occurrence); return true; }
      previous = popupOpen ? popup.current : null;
      previousEntity = popupOpen ? popup.entity : null;
    }
    pending[key] = true;
    if (window._casoraKlingel) window._casoraKlingel._want = null;
    var back = previous ? { fn: function () {
      popup.open(previousEntity ? Object.assign({ _entity: previousEntity }, previous) : previous);
      active = previousActive ? Object.assign({}, previousActive, { cfg: popup.current, el: popup.element }) : null;
    }, at: Date.now() } : null;
    if (back) window._casoraBackNext = back;
    var stillWanted = function () { return allowed(url) && fresh(occurrence); };
    return new Promise(function (resolve) { try {
      window._casoraOpenViaCard(occurrence.camera, function (ok) {
        delete pending[key];
        clearBack(back);
        if (!ok) {
          if (window.document.hidden && fresh(occurrence)) deferred[url] = { occurrence: occurrence, cfg: cfg };
          resolve(false);
          return;
        }
        start(occurrence);
        remember(key, occurrence);
        resolve(true);
      }, { cfg: cfg, noTile: true, checked: false, canOpen: stillWanted });
    } catch (e) {
      delete pending[key];
      clearBack(back);
      resolve(false);
    } });
  };
  if (window.document) window.document.addEventListener('visibilitychange', function () {
    if (window.document.hidden || !window._casoraRing) return;
    var url = window._casoraRing.route(), item = deferred[url];
    delete deferred[url];
    if (item) P.open(item.occurrence, item.cfg);
  });
})();
