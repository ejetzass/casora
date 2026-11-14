// Shared lifecycle for automatic camera popup openings; trigger policy belongs to the callers.
(function () {
  if (window._casoraRingPopup) return;
  var P = window._casoraRingPopup = {};
  var TWO_MINUTES = 120000;     // a ring this young may open the popup, and an untouched popup lives this long (Q4)
  var CLOCK_SKEW_MS = 60000;    // server and screen clock may differ: a ring up to this far "in the future" counts as now
  var TOUCH_EVENTS = ['pointerdown', 'keydown', 'focusin', 'wheel'];   // any of these inside the popup ends the auto-close
  var shown = {}, pending = {}, deferred = {};
  var active = null;
  // Young enough to open: less than two minutes old, not more than the clock skew ahead.
  var fresh = function (ring) {
    var age = Date.now() - ring.at;
    return age < TWO_MINUTES && age >= -CLOCK_SKEW_MS;
  };
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
  var disarm = function () {
    if (!active) return;
    var opening = active;
    active = null;
    if (opening.timer) window.clearTimeout(opening.timer);
    if (opening.el) {
      TOUCH_EVENTS.forEach(function (type) { opening.el.removeEventListener(type, opening.onTouch); });
      opening.el.removeEventListener('casora-popup-closed', opening.onClosed);
    }
  };
  var arm = function (opening) {
    if (opening.timer) window.clearTimeout(opening.timer);
    opening.timer = window.setTimeout(function () {
      opening.timer = null;
      if (active !== opening) return;
      var popup = window.casoraPopup;
      if (popup.current !== opening.cfg || opening.el && opening.el.isConnected === false) return disarm();
      disarm();
      P.back(popup);
    }, TWO_MINUTES);
  };
  // One automatic opening: a touch ends the timer for good (a later ring must not restart it).
  var start = function (previous, occurrence) {
    disarm();
    var popup = window.casoraPopup;
    var opening = { cfg: popup.current, previous: previous, role: occurrence.role, camera: occurrence.camera, touched: false, timer: null, el: popup.element };
    opening.onTouch = function () {
      if (active !== opening) return;
      opening.touched = true;
      if (opening.timer) { window.clearTimeout(opening.timer); opening.timer = null; }
    };
    opening.onClosed = function () {
      if (active === opening) disarm();
    };
    active = opening;
    if (opening.el) {
      TOUCH_EVENTS.forEach(function (type) { opening.el.addEventListener(type, opening.onTouch, { passive: true }); });
      opening.el.addEventListener('casora-popup-closed', opening.onClosed);
    }
    arm(opening);
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
    if (shown[key] && (shown[key].id === occurrence.id || shown[key].at >= occurrence.at)) return true;
    var popup = window.casoraPopup, el = popup.element, previous, replace = false;
    var popupOpen = !!(popup.current && (!el || el.isConnected !== false)
      && !(el && el.hasAttribute && el.hasAttribute('closing')));
    if (active) {
      if (popupOpen && active.el && active.el.isConnected !== false && popup.current === active.cfg) {
        if (occurrence.role === 'detection') { remember(key, occurrence); return true; }
        if (active.touched && !(active.role === 'detection' && occurrence.role === 'doorbell')) { remember(key, occurrence); return true; }
        if (active.role === 'detection' && occurrence.role === 'doorbell') {
          previous = popup.current;
        } else {
          previous = active.previous || null;
        }
        replace = true;
      } else disarm();
    }
    if (!replace) {
      if (popupOpen && occurrence.role === 'detection') { remember(key, occurrence); return true; }
      if (popupOpen && popup.entity === occurrence.camera) { remember(key, occurrence); return true; }
      previous = popupOpen ? popup.current : null;
    }
    pending[key] = true;
    if (window._casoraKlingel) window._casoraKlingel._want = null;
    var back = previous ? { fn: function () { popup.open(previous); }, at: Date.now() } : null;
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
        start(previous, occurrence);
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
