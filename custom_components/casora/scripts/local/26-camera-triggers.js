// One watcher for camera rings and triggers: the doorbell tile's press rule (brand-discovered sources) and the
// listed camera triggers (popups) share one 1 s poller and one rule for occurrence identity and freshness.
// The watcher runs only on a real dashboard that has a doorbell tile or any listed trigger; the Studio and other pages cost nothing.
// window._casoraRing: scan(hass) -> [{cam, sensor, event, lastRing: {id, at} | null}], lastRing(config, states, history?)
// for the doorbell tile, route/dashboard/forget/check/start/polling. window._casoraCameraTriggers: listed triggers.
// A brand doorbell that is not listed never opens a popup; only the tile shows it.
// Session storage preserves a live press after release/reload; Recorder recovers unseen presses.
(function () {
  if (window._casoraCameraTriggers) return;
  var TICK_MS = 1000;
  var DAY_MS = 86400000;
  var HISTORY_DAYS = 3;              // the tile's history window (DAYS in 24-klingel.js); older presses are not fed back
  var RECENT_MS = 12000;             // a change this fresh may not be in the Recorder yet
  var RECORDER_LAG_MS = 7000;        // wait for the Recorder before reading a release's history
  var RETRY_MS = 30000;              // first retry; doubles on every further attempt
  var MAX_ATTEMPTS = 4;
  var CFG_BACKOFF_MS = 30000;        // a rejected dashboard config is not asked again before this
  var REDISCOVER_MS = 30000;
  var MINUTE_MS = 60000;
  var HISTORY_WAIT_MS = 1500;        // a broken Recorder must not block a live press longer
  var HISTORY_WINDOW_MS = 180000;    // listed-trigger recovery looks this far back
  var RECOVER_IDLE_MS = 2 * MINUTE_MS;  // pause after all attempts found nothing
  // The one rule for an occurrence: its identity is the UTC millisecond timestamp as ISO text,
  // for a live HA string and a Recorder number alike.
  var identity = function (at) { return new Date(Math.trunc(at)).toISOString(); };
  // The trigger ids of a camera record come from the core (casoraTriggerIds); on a slow phone the core can
  // arrive after this module, so the watcher waits for it instead of failing.
  var triggerIds = function (camera) {
    return window.casoraTriggerIds ? window.casoraTriggerIds(camera) : [];
  };
  // The limit (two minutes, clock skew) is decided by the lifecycle, 45-ring-popup.js: one definition for both.
  var fresh = function (at) {
    var lifecycle = window._casoraRingPopup;
    return !!lifecycle && lifecycle.fresh(at);
  };
  var remembered = {};
  var registry = null, sources = [], discoveredAt = 0;
  var recovery = {};
  var owners = {};
  var owner = function (e) {
    return e && !e.disabled_by && !e.hidden && !e.hidden_by
      ? JSON.stringify([e.device_id, e.platform, e.unique_id, e.translation_key]) : null;
  };
  var R = window._casoraRing = {};
  var route = function () { return (window.location.pathname || '').split('/').filter(Boolean)[0] || ''; };
  R.route = route;
  var hassOf = function () {
    var ha = window.document && window.document.querySelector && window.document.querySelector('home-assistant');
    return ha && ha.hass;
  };
  // Doorbell tiles saved on the current dashboard. Only a real Lovelace dashboard has a config:
  // /config, /history and the Studio do not, and asking them rejects.
  var failed = {}, lastCfg = null, doorbellTiles = [];
  R.dashboard = async function (hass) {
    var url = route(), panel = hass.panels && hass.panels[url];
    if (!url || url === 'casora-studio' || !panel || panel.component_name !== 'lovelace' || !window._casoraCfgOnce) return null;
    if (failed[url] && Date.now() - failed[url] < CFG_BACKOFF_MS) return { url: url, tiles: [], error: true };
    var cfg;
    try { cfg = await window._casoraCfgOnce(hass, url); delete failed[url]; } catch (e) { failed[url] = Date.now(); return { url: url, tiles: [], error: true }; }
    if (url !== route()) return null;
    // _casoraCfgOnce invalidates on save; do not walk the dashboard again for the same config.
    if (cfg !== lastCfg) {
      lastCfg = cfg;
      doorbellTiles = [];
      (function walk(o) {
        if (!o || typeof o !== 'object') return;
        if (Array.isArray(o)) { o.forEach(walk); return; }
        if (o.type === 'custom:button-card' && [].concat(o.template || []).includes('casora_reolink_doorbell')) doorbellTiles.push(o);
        Object.keys(o).forEach(function (k) { walk(o[k]); });
      })(cfg && cfg.views);
    }
    return { url: url, tiles: doorbellTiles };
  };
  R.forget = function (sensor) {
    delete remembered[sensor];
    delete recovery[sensor];
    try { window.sessionStorage.removeItem('casora-ring:' + sensor); } catch (e) { /* Optional storage. */ }
  };
  // Recover only the press sensor, once at startup or after an unseen release. Popup detection
  // history stays lazy. Keep the latest press in remembered instead of reprocessing days every tick.
  var recoverPress = function (hass, c) {
    var st = hass.states && hass.states[c.sensor], KL = window._casoraKlingel;
    if (!st || !KL || !hass.callWS || (st.state !== 'on' && st.state !== 'off')) return;
    var key = st.state + st.last_changed, job = recovery[c.sensor], now = Date.now();
    if (!job || job.key !== key) {
      // An off sample may belong to a second press completed between polls, not
      // the on sample we saw. Every changed release gets one bounded recovery job.
      var observed = st.state === 'on';
      var recent = now - Date.parse(st.last_changed) < RECENT_MS;
      job = recovery[c.sensor] = { key: key, done: observed,
        due: now + (!observed && (job || recent) ? RECORDER_LAG_MS : 0), busy: false, attempts: 0 };
    }
    if (job.done || job.busy || now < job.due) return;
    job.busy = true;
    job.attempts++;
    var scheduleRetry = function (err) {
      // MAX_ATTEMPTS in total (30/60/120 second backoff), also for Recorder commit lag.
      // Only a new sensor state opens another budget; permanent errors stop immediately.
      job.done = job.attempts >= MAX_ATTEMPTS || ['unauthorized', 'unknown_command', 'invalid_format', 'not_found', 'not_supported'].indexOf(err && err.code) >= 0;
      job.due = Date.now() + RETRY_MS * Math.pow(2, job.attempts - 1);
    };
    var start = now - HISTORY_DAYS * DAY_MS;
    hass.callWS({ type: 'history/history_during_period', start_time: new Date(start).toISOString(),
      end_time: new Date(now).toISOString(), entity_ids: [c.sensor], minimal_response: true,
      no_attributes: true, significant_changes_only: false }).then(function (raw) {
      // A forgotten/replaced job must not write back when its old request resolves,
      // nor re-arm on every tick if its source identity changed.
      if (recovery[c.sensor] !== job || owner((hass.entities || {})[c.sensor]) !== owners[c.sensor]) {
        job.done = true;
        return;
      }
      var list = KL.parse(raw, { visitor: c.sensor, order: [] }, start);
      R.lastRing(c, {}, list.length ? [list[0]] : []);
      // Empty/older history is not evidence that Recorder committed this release.
      // Retain real older presses, but retry until a row reaches the observed state.
      job.done = (raw && raw[c.sensor] || []).some(function (row) {
        var at = row.lc != null ? row.lc * 1000 : row.lu != null ? row.lu * 1000 : Date.parse(row.last_changed || row.last_updated);
        return Math.trunc(at) >= Date.parse(st.last_changed);
      });
      if (!job.done) scheduleRetry();
    }).catch(scheduleRetry).then(function () { job.busy = false; });
  };
  R.lastRing = function (c, states, history) {
    var st = states[c.sensor || c.visitor], key = c.sensor || c.visitor;
    if (!key) return null;
    if (remembered[key] == null) {
      try {
        var saved = JSON.parse(window.sessionStorage.getItem('casora-ring:' + key));
        var from = Date.now() - HISTORY_DAYS * DAY_MS;   // a press older than the tile's history window is not shown again
        if (saved && Number.isFinite(saved.at) && saved.at >= from && typeof saved.id === 'string' && Date.parse(saved.id) === saved.at) remembered[key] = { id: new Date(saved.at).toISOString(), at: saved.at };
      } catch (e) { /* Storage can be unavailable in private browsers. */ }
    }
    var id = st && (c.event ? st.state : st.state === 'on' ? st.last_changed : null);
    var at = Date.parse(id);
    if (!Number.isFinite(at)) at = null;
    (history || []).forEach(function (e) {
      if (e.kind === 'ring' && Number.isFinite(e.at) && Math.trunc(e.at) > (at || 0)) {
        at = Math.trunc(e.at);
        id = identity(at);
      }
    });
    if (at != null && at > (remembered[key]?.at || 0)) {
      // Recorder's numeric timestamps and live HA strings share Date's millisecond precision.
      remembered[key] = { id: identity(at), at: at };
      try { window.sessionStorage.setItem('casora-ring:' + key, JSON.stringify(remembered[key])); } catch (e) { /* Memory still works. */ }
    }
    var hit = remembered[key];
    return hit ? { id: hit.id, at: hit.at } : null;
  };
  R.scan = function (hass) {
    var reg = hass.entities || {}, states = hass.states || {}, out = [], now = Date.now();
    // Discovery reads the whole registry: redo it when the registry changes, and now and then because
    // an event entity's state (device_class doorbell, casoraIsDoorbell) can arrive after its registry entry.
    if (registry !== reg || now - discoveredAt >= REDISCOVER_MS) {
      if (registry !== reg) {
        registry = reg;
        Object.keys(owners).forEach(function (id) {
          if (owners[id] !== owner(reg[id])) { R.forget(id); delete owners[id]; }
        });
      }
      discoveredAt = now;
      sources = window.casoraDoorbellSources(hass);
      sources.forEach(function (c) {
        if (c.sensor in owners) return;
        var ownerId = owner(reg[c.sensor]);
        try {
          var stored = window.sessionStorage.getItem('casora-ring-owner:' + c.sensor);
          if (stored && stored !== ownerId) R.forget(c.sensor);
          window.sessionStorage.setItem('casora-ring-owner:' + c.sensor, ownerId);
        } catch (e) { /* Memory still tracks ownership without storage. */ }
        owners[c.sensor] = ownerId;
      });
    }
    sources.forEach(function (source) {
      var c = { cam: source.cam, sensor: source.sensor, event: source.event };
      c.lastRing = R.lastRing(c, states);
      if (!c.event) recoverPress(hass, c);
      out.push(c);
    });
    return out;
  };
  var previous = {}, eventSeen = {};
  var expand = function (cameras, hits) {
    var out = [];
    cameras.forEach(function (camera) {
      if (!camera || !camera.entity_id) return;
      ['doorbell', 'detection'].forEach(function (role) {
        (camera[role + '_triggers'] || []).forEach(function (id) {
          if (hits[id]) out.push(Object.assign({}, hits[id], { camera: camera.entity_id, role: role }));
        });
      });
    });
    return out;
  };
  var scan = function (hass) {
    var cameras = (window.CASORA_SETTINGS || {}).cameras;
    if (!Array.isArray(cameras)) return [];
    var states = (hass && hass.states) || {}, hits = {};
    cameras.forEach(function (camera) {
      if (!camera) return;
      triggerIds(camera).forEach(function (id) {
        if (Object.prototype.hasOwnProperty.call(hits, id)) return;
        hits[id] = null;
        var st = states[id], value = st && st.state, at = null;
        if (id.indexOf('binary_sensor.') === 0) {
          if (value === 'on' && previous[id] === 'off') at = Date.parse(st.last_changed);
          previous[id] = value;
        } else if (id.indexOf('event.') === 0) {
          var parsed = Date.parse(value);
          if (Number.isFinite(parsed) && parsed !== eventSeen[id]) {
            eventSeen[id] = parsed;
            at = parsed;
          }
        }
        if (!fresh(at)) return;
        hits[id] = { entity: id, at: at, id: identity(at),
          name: (st.attributes && st.attributes.friendly_name) || id };
      });
    });
    var out = expand(cameras, hits);
    return out;
  };
  // The moment the shown camera's last listed trigger stopped (ms): now while one is still on; 0 = nothing to count.
  // Read from hass.states, so a tap-opened camera window counts the same as one the watcher opened.
  window.casoraCameraTriggerSince = function () {
    var id = window.casoraPopup && window.casoraPopup.entity, hass = hassOf();
    var cameras = (window.CASORA_SETTINGS || {}).cameras || [];
    var camera = cameras.filter(function (c) { return c && c.entity_id === id; })[0];
    if (!camera || !hass) return 0;
    var since = 0;
    triggerIds(camera).forEach(function (t) {
      var st = (hass.states || {})[t];
      if (!st) return;
      if (t.indexOf('binary_sensor.') === 0) {
        if (st.state === 'on') since = Date.now();
        else if (st.state === 'off') since = Math.max(since, Date.parse(st.last_changed));
      } else if (t.indexOf('event.') === 0) {
        var at = Date.parse(st.state);
        if (Number.isFinite(at)) since = Math.max(since, at);
      }
    });
    return since;
  };
  // Both the house switch and the camera's switch for this role must allow opening. The switches are the
  // only rule: no per-dashboard choice. A ring is on unless the camera's switch is off; a detection is off unless on.
  var mayOpen = function (occurrence, camera) {
    var house = (window.CASORA_SETTINGS || {}).camera_popup || {};
    if (house.open_by_itself !== true) return false;
    if (occurrence.role === 'doorbell') return camera.open_on_ring !== false;
    if (occurrence.role === 'detection') return camera.open_on_detection === true;
    return false;
  };
  var dispatch = async function (hass, occurrences) {
    var popup = window.casoraCameraPopup;
    if (!popup || !window._casoraRingPopup || !window._casoraCfgOnce) return false;
    var url = route(), dashboard = await R.dashboard(hass);
    if (!dashboard || dashboard.error || dashboard.url !== url || route() !== url) return false;
    var config;
    try { config = await window._casoraCfgOnce(hass, url); } catch (e) { return false; }
    if (route() !== url) return false;
    // The Wall tablet check is the only screen gate; a phone is never a Wall tablet.
    if (!window.casoraIsWallTablet || !window.casoraIsWallTablet()) return true;
    var cameras = (window.CASORA_SETTINGS || {}).cameras || [], candidates = [];
    cameras.forEach(function (camera) {
      if (!camera || !camera.entity_id) return;
      occurrences.forEach(function (o) {
        if (o.camera !== camera.entity_id || !fresh(o.at)) return;
        if (!mayOpen(o, camera)) return;
        candidates.push(o);
      });
    });
    if (!candidates.length) return true;
    candidates.sort(function (a, b) {
      return (a.role === 'doorbell' ? 0 : 1) - (b.role === 'doorbell' ? 0 : 1);
    });
    var opened = await window._casoraRingPopup.open(candidates[0], popup.config(candidates[0].camera, hass, config));
    if (!opened) return false;
    candidates.slice(1).forEach(function (o) {
      // The winner handles this identity itself; recording it here would cancel a deferred winner.
      if (o.entity !== candidates[0].entity || o.id !== candidates[0].id) window._casoraRingPopup.handled(o);
    });
    return true;
  };
  var triggerRecovery = {};
  var recover = async function (hass) {
    if (!hass || typeof hass.callWS !== 'function') return [];
    var cameras = (window.CASORA_SETTINGS || {}).cameras || [], ids = [];
    cameras.forEach(function (camera) {
      triggerIds(camera).forEach(function (id) {
        if (id.indexOf('binary_sensor.') !== 0 || ids.indexOf(id) >= 0) return;
        var state = (hass.states || {})[id];
        if (!state || (state.state !== 'on' && state.state !== 'off')) return;
        var key = state.state + ':' + state.last_changed;
        if (!triggerRecovery[id] || triggerRecovery[id].key !== key) triggerRecovery[id] = { key: key, attempts: 0, due: 0 };
        if (Date.now() >= triggerRecovery[id].due) ids.push(id);
      });
    });
    if (!ids.length) return [];
    var jobs = {};
    ids.forEach(function (id) { jobs[id] = triggerRecovery[id]; jobs[id].attempts++; jobs[id].due = Infinity; });
    var now = Date.now(), raw, timeout;
    try {
      var request = hass.callWS({ type: 'history/history_during_period',
        start_time: new Date(now - HISTORY_WINDOW_MS).toISOString(), end_time: new Date(now).toISOString(),
        entity_ids: ids, minimal_response: true, no_attributes: true, significant_changes_only: false });
      // A broken Recorder must not indefinitely block a live observed press.
      raw = await (window.setTimeout ? Promise.race([request, new Promise(function (resolve) {
        timeout = window.setTimeout(function () { resolve(null); }, HISTORY_WAIT_MS);
      })]) : request);
    } catch (e) { raw = null; }
    if (timeout != null && window.clearTimeout) window.clearTimeout(timeout);
    var hits = {};
    ids.forEach(function (id) {
      var job = jobs[id];
      if (triggerRecovery[id] !== job) return;
      var rows = raw && raw[id];
      var prev = null, latest = null;
      (Array.isArray(rows) ? rows : []).forEach(function (row) {
        var at = row.lc != null ? row.lc * 1000 : row.lu != null ? row.lu * 1000 : Date.parse(row.last_changed || row.last_updated);
        var state = row.s != null ? row.s : row.state;
        if (prev === 'off' && state === 'on' && fresh(at) && (latest === null || at > latest)) latest = at;
        prev = state;
      });
      if (latest !== null) {
        job.attempts = 0;
        job.due = now + RETRY_MS;
      } else if (job.attempts >= MAX_ATTEMPTS) {
        job.attempts = 0;
        job.due = now + RECOVER_IDLE_MS;
      } else {
        job.due = now + (job.attempts === 1 ? RECORDER_LAG_MS : RETRY_MS * Math.pow(2, job.attempts - 2));
      }
      if (latest === null) return;
      var state = (hass.states || {})[id] || {};
      hits[id] = { entity: id, at: latest, id: identity(latest),
        name: (state.attributes && state.attributes.friendly_name) || id };
    });
    var out = expand(cameras, hits);
    return out;
  };
  var queued = [], processing = false;
  var hasTriggers = function () {
    var cameras = (window.CASORA_SETTINGS || {}).cameras || [];
    return cameras.some(function (camera) {
      return triggerIds(camera).length > 0;
    });
  };
  var enqueue = function (items) {
    items.forEach(function (item) {
      if (!queued.some(function (old) { return old.entity === item.entity && old.id === item.id && old.camera === item.camera && old.role === item.role; })) queued.push(item);
    });
  };
  // The listed triggers: observe, add Recorder-recovered presses, then arbitrate one popup.
  var triggerTick = function (hass) {
    enqueue(scan(hass));
    if (processing) return;
    processing = true;
    recover(hass).then(function (items) {
      enqueue(items);
      queued = queued.filter(function (item) { return fresh(item.at); });
      var batch = queued.slice();
      return dispatch(hass, batch).then(function (done) {
        if (done) queued = queued.filter(function (item) { return batch.indexOf(item) < 0; });
      });
    }).finally(function () { processing = false; });
  };
  // The one poller. What it does follows the dashboard: tile sources only with a doorbell tile, listed triggers only when listed.
  var poll = null, retry = null, checking = 0, tileWatch = false;
  var tick = function () {
    var hass = hassOf();
    if (!hass) return;
    if (tileWatch) R.scan(hass);
    if (hasTriggers()) triggerTick(hass);
    else if (!tileWatch) check();
  };
  var stop = function () {
    if (poll != null && window.clearInterval) window.clearInterval(poll);
    poll = null;
    tileWatch = false;
  };
  R.polling = function () { return poll != null; };
  // Page, dashboard or settings changed: watch only a dashboard with a doorbell tile or a listed trigger.
  var check = async function () {
    var sequence = ++checking;
    if (retry != null && window.clearTimeout) window.clearTimeout(retry);
    retry = null;
    // The listed triggers need the core helper; until it arrives, look again in a second instead of failing.
    var listed = ((window.CASORA_SETTINGS || {}).cameras || []).some(function (c) {
      return c && ((c.doorbell_triggers || []).length || (c.detection_triggers || []).length);
    });
    if (listed && !window.casoraTriggerIds && window.setTimeout) {
      stop();
      retry = window.setTimeout(check, TICK_MS);
      return;
    }
    var hass = hassOf();
    if (!hass) {
      stop();
      if (window.setTimeout) retry = window.setTimeout(check, TICK_MS);
      return;
    }
    var dashboard = await R.dashboard(hass);
    if (sequence !== checking) return;
    if (dashboard && dashboard.error && window.setTimeout) {
      stop();
      retry = window.setTimeout(check, CFG_BACKOFF_MS);
      return;
    }
    var hasTile = !!(dashboard && dashboard.tiles && dashboard.tiles.length);
    if (!dashboard || dashboard.error || !(hasTile || hasTriggers())) { stop(); return; }
    tileWatch = hasTile;
    if (poll != null) return;
    tick();
    poll = window.setInterval(tick, TICK_MS);
  };
  R.check = check;
  var started = false;
  R.start = function () {
    if (started) return;
    started = true;
    window.addEventListener('location-changed', check);
    window.addEventListener('casora-settings-changed', check);
    window.document.addEventListener('visibilitychange', function () {
      check();
      if (poll != null) tick();
    });
    check();
  };
  window._casoraCameraTriggers = { scan: scan, dispatch: dispatch, recover: recover, check: check, triggerSince: window.casoraCameraTriggerSince };
  if (window.document && window.setInterval && window.addEventListener) R.start();
})();
