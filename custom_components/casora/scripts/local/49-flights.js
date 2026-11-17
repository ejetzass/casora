// ── Tracked flights: the shared source boundary (tile "Manage flights", Studio source choice) ─────────────────────
// For the FlightRadar24 integration (HACS). Casora needs nothing else: no calendars, helpers, scripts or template sensors.
// Detection is by parts, never by version: a source sensor is a `sensor` entry of platform 'flightradar24' with the
// translation key 'additional_tracked' that carries a `flights` list. The name and entity ID depend on language and device
// name, so they are never looked at. Orphans (state unavailable with attribute restored: true) are skipped. Related entities
// (controls, the scanning switch) belong to the source by its device_id: hass.entities has no config-entry id.
// The source is one setting for every flight surface: the hero card variable casora_flights_source (Dashboard settings
// scope, Save/Discard in the Studio). Empty = Automatic, allowed only while exactly one source exists.
// This module only reads. Nothing here calls a service; tracking writes belong to explicit user actions elsewhere.
//   window._casoraFlights.present(hass)              → FlightRadar24 entries in the registry?
//   window._casoraFlights.sources(hass)              → [{id, device, name, ok}] usable source sensors
//   window._casoraFlights.resolve(hass, pin)         → {state: none|auto|choose|pinned|missing|loading, id, source, sources, missing}
//   window._casoraFlights.ready()                    → false while a phone waits for its desktop twin's settings (state loading)
//   window._casoraFlights.entries(hass, id)          → [{key, label, detail}] every tracked entry, or null (list unknown)
//   window._casoraFlights.controls(hass, id)         → {source, add, remove, scanning, missing: [role, …]} by device_id
//   window._casoraFlights.choices(hass, pin)         → Studio select: {options, labels, empty, note}
//   window._casoraFlights.pinned(cfg)                → the setting from a dashboard config
//   window._casoraFlights.tile(hass, pin) / .hidden(hass) / .popup(states, hass, vars) / .sec(part, c, states, hass)
(function () {
  if (window._casoraFlights) return;
  var F = window._casoraFlights = {};
  var KEY = 'casora_flights_source';
  F.KEY = KEY;

  var bad = function (s) { return !s || s.state === 'unavailable' || s.state === 'unknown'; };
  var isList = function (v) { return Array.isArray(v); };

  // ── Finding the source ────────────────────────────────────────────────────
  // hass.entities is replaced by a new object on every registry change: found once per registry state.
  var cache = { R: null, idx: null };
  var index = function (hass) {
    var R = (hass && hass.entities) || {};
    if (cache.R === R && cache.idx) return cache.idx;
    var idx = { all: [], byDevice: {} };
    Object.keys(R).sort().forEach(function (id) {
      var e = R[id];
      if (!e || e.platform !== 'flightradar24') return;
      idx.all.push(id);
      if (e.device_id) (idx.byDevice[e.device_id] || (idx.byDevice[e.device_id] = [])).push(id);
    });
    cache = { R: R, idx: idx };
    return idx;
  };
  F.present = function (hass) { return index(hass).all.length > 0; };

  var nameOf = function (hass, id) {
    var R = hass.entities || {}, S = hass.states || {}, d = R[id] && R[id].device_id && (hass.devices || {})[R[id].device_id];
    return (d && (d.name_by_user || d.name)) || ((S[id] || {}).attributes || {}).friendly_name || id;
  };
  // The state is read on every call (it changes with each poll); only the registry part is cached.
  F.sources = function (hass) {
    var S = (hass && hass.states) || {}, R = (hass && hass.entities) || {}, out = [];
    index(hass).all.forEach(function (id) {
      var e = R[id], st = S[id];
      if (id.indexOf('sensor.') !== 0 || e.translation_key !== 'additional_tracked' || !st) return;
      var a = st.attributes || {};
      if (st.state === 'unavailable' && a.restored === true) return;
      var ok = isList(a.flights);
      if (!ok && !bad(st)) return;
      out.push({ id: id, device: e.device_id || null, name: nameOf(hass, id), ok: ok });
    });
    return out;
  };

  // ── Resolving the choice ──────────────────────────────────────────────────
  // A pinned source is never replaced by another one; a missing pin stays in the setting.
  F.resolve = function (hass, pin) {
    var list = F.sources(hass), p = pin ? String(pin) : '';
    var out = { state: 'none', id: null, source: null, sources: list, missing: [] };
    if (!F.ready()) { out.state = 'loading'; return out; } // a phone whose desktop twin has not answered yet
    if (p) {
      var hit = list.filter(function (s) { return s.id === p; })[0] || null;
      out.id = p; out.source = hit; out.state = hit ? 'pinned' : 'missing';
      return out;
    }
    if (list.length === 1) { out.state = 'auto'; out.id = list[0].id; out.source = list[0]; }
    else if (list.length > 1) out.state = 'choose';
    else if (F.present(hass)) out.missing = ['source'];
    return out;
  };
  F.hidden = function (hass) { return !F.present(hass); };

  // The related entities of a source: same device, by translation key. A role that is not found is listed in missing
  // (a disabled entity is not in hass.entities, so it reads as missing too).
  var ROLES = [['add', 'text', 'add_track'], ['remove', 'text', 'remove_track'], ['scanning', 'switch', 'scanning']];
  F.controls = function (hass, id) {
    var R = (hass && hass.entities) || {}, dev = R[id] && R[id].device_id, mine = (dev && index(hass).byDevice[dev]) || [];
    var out = { source: R[id] ? id : null, add: null, remove: null, scanning: null, missing: [] };
    ROLES.forEach(function (r) {
      var hit = mine.filter(function (x) { return x.indexOf(r[1] + '.') === 0 && R[x].translation_key === r[2]; })[0];
      if (hit) out[r[0]] = hit; else out.missing.push(r[0]);
    });
    return out;
  };

  // ── The tracked list ──────────────────────────────────────────────────────
  var str = function (v) { return v == null ? '' : String(v).trim(); };
  var airport = function (f, side) {
    var o = f['airport_' + side];
    var code = str(f['airport_' + side + '_code_iata']) || str(o && o.code_iata) || str(f['airport_' + side + '_code_icao']) || str(o && o.code_icao);
    return code;
  };
  // Identity and what is there. No freshness is claimed: an airborne flag (on_ground 0) can be left over from before a
  // restart, so only "scheduled" and "on the ground" are worded; everything else says nothing.
  F.entries = function (hass, id) {
    var st = ((hass && hass.states) || {})[id];
    if (!st || !isList((st.attributes || {}).flights)) return null;
    return st.attributes.flights.map(function (f, i) {
      f = f && typeof f === 'object' ? f : {};
      var label = str(f.flight_number) || str(f.callsign) || str(f.aircraft_registration) || str(f.id) || String(i + 1);
      var from = airport(f, 'origin'), to = airport(f, 'destination');
      var state = str(f.tracked_type) === 'schedule' ? (window.casoraTr ? window.casoraTr('Geplant') : 'Geplant') : (f.on_ground === 1 || f.on_ground === '1' || f.on_ground === true) ? (window.casoraTr ? window.casoraTr('Am Boden') : 'Am Boden') : '';
      var parts = [str(f.airline_short) || str(f.airline), from && to ? from + ' → ' + to : '', state].filter(Boolean);
      return { key: str(f.id) || String(i), label: label, detail: parts.join(' · ') };
    });
  };

  // ── The setting ───────────────────────────────────────────────────────────
  F.pinned = function (cfg) {
    var views = (cfg && cfg.views) || [];
    for (var i = 0; i < views.length; i++) {
      var hero = ((views[i] || {}).cards || [])[0];
      var v = hero && hero.variables && hero.variables[KEY];
      if (v !== undefined && v !== null && v !== '') return String(v);
    }
    return '';
  };
  // The open dashboard's own value; '' when it has none.
  var ownOf = function (key) {
    try { return F.pinned(window._casoraLovelaceCfg && window._casoraLovelaceCfg(), key); } catch (e) { return ''; }
  };
  // Own value first; a phone takes the rest from its desktop twin (below). '' = Automatic, or not known yet (F.ready).
  F.setting = function (key) {
    var own = ownOf(key);
    if (own) return own;
    var t = twinOf();
    return t && (t.state === 'ok' || t.state === 'none') ? (t.flights[key || KEY] || '') : '';
  };
  // ── The phone twin: a phone dashboard (<name>-mobile) takes the Flights settings it has no value for from its desktop twin
  // (<name>), read with casora/partner_info. The read is async, so until it has answered the phone resolves nothing (no tile,
  // no rows, no guess). When it comes, the flight cards draw again. A failed read is retried after TWIN_RETRY ms, not on every
  // render. No desktop dashboard ('none'): the phone's own config rules.
  var TWIN_RETRY = 30000;
  var twin = { url: null, state: 'idle', at: 0, flights: {} };
  var twinOf = function () {
    var seg = String(((window.location || {}).pathname) || '').split('/')[1] || '';
    if (!/[-_]mobile$/i.test(seg)) return null;
    var desk = seg.replace(/[-_]mobile$/i, '');
    if (twin.url !== desk) twin = { url: desk, state: 'idle', at: 0, flights: {} };
    if (twin.state === 'idle' || (twin.state === 'error' && Date.now() - twin.at > TWIN_RETRY)) fetchTwin(twin);
    return twin;
  };
  var fetchTwin = function (t) {
    var ha = document.querySelector('home-assistant'), hass = ha && ha.hass;
    if (!hass || !window._casoraPartnerInfo) return; // not yet: the next render asks again
    t.state = 'loading'; t.at = Date.now();
    var fail = function () { if (twin === t) { t.state = 'error'; t.at = Date.now(); } };
    try {
      window._casoraPartnerInfo(hass, t.url).then(function (r) {
        if (twin !== t) return; // the page has moved to another dashboard meanwhile
        if (r && (!r.flights || typeof r.flights !== 'object')) return fail(); // an older integration: no Flights part
        t.state = r ? 'ok' : 'none';
        t.flights = r ? r.flights : {};
        kickFlights();
      }, fail);
    } catch (e) { fail(); }
  };
  // The flight cards (tile, Manage flights) draw again when the twin's settings arrive.
  // Own walk through the shadow roots (the same as casora-local.js redraws): no dependency on other parts of this module.
  var kickFlights = function () {
    if (!window.casoraKick) return;
    (function walk(root, d) {
      if (!root || d > 30 || !root.querySelectorAll) return;
      [].forEach.call(root.querySelectorAll('*'), function (el) {
        var c = el._config;
        if (el.localName === 'button-card' && c && typeof c.state_display === 'string' && c.state_display.indexOf('_casoraFlights') !== -1) window.casoraKick(el);
        if (el.shadowRoot) walk(el.shadowRoot, d + 1);
      });
    })(document, 0);
  };
  // Whether the open dashboard's source is known: its own value, a desktop, or a phone whose twin has answered.
  F.ready = function () {
    if (ownOf() || !twinOf()) return true;
    return twin.state === 'ok' || twin.state === 'none';
  };

  // Studio select: values are '' (Automatic, or the prompt when several exist) and the source IDs; a stored pin stays
  // selectable. Words come from the Studio (labels hold only data names; null = the Studio words it).
  F.choices = function (hass, pin) {
    var r = F.resolve(hass, pin), options = [''], labels = {};
    r.sources.forEach(function (s) { options.push(s.id); labels[s.id] = s.name; });
    if (r.state === 'missing') { options.push(r.id); labels[r.id] = null; }
    var note = r.state === 'missing' ? 'missing' : r.state === 'choose' ? 'choose' : r.missing.length ? 'parts' : null;
    return { options: options, labels: labels, empty: r.state === 'choose' ? 'choose' : 'auto', note: note, missing: r.missing,
      unavailable: !!(r.source && !r.source.ok) };
  };

  // ── Tile and popup ────────────────────────────────────────────────────────
  var T_MISSING = 'Quelle nicht verfügbar', T_CHOOSE = 'Quelle für verfolgte Flüge auswählen', T_EMPTY = 'Keine verfolgten Flüge';
  // Casora's own setting: the Studio names the place where it is chosen (General, Tracked flights).
  var SOURCE_HINT = 'Die Quelle wählst du im Studio unter Allgemein → Verfolgte Flüge.';
  var countWord = function (n) { return n === 1 ? '1 verfolgter Flug' : n + ' verfolgte Flüge'; };
  var model = function (hass, pin) {
    var r = F.resolve(hass, pin);
    if (r.state === 'loading') return { text: '', tone: 'off', rows: null };
    if (r.state === 'choose') return { text: T_CHOOSE, tone: 'warn', rows: null };
    if (r.state === 'none' || r.state === 'missing' || !r.source) return { text: T_MISSING, tone: 'bad', rows: null };
    var rows = F.entries(hass, r.id);
    if (rows == null) return { text: T_MISSING, tone: 'bad', rows: null };
    return { text: rows.length ? countWord(rows.length) : T_EMPTY, tone: rows.length ? 'good' : 'off', rows: rows };
  };
  // The sources' IDs (and the pin): what a tile or popup reads so it follows their states.
  F.watch = function (hass) {
    var pin = F.setting(), ids = F.sources(hass).map(function (s) { return s.id; });
    if (pin && ids.indexOf(pin) < 0) ids.push(pin);
    return ids;
  };
  // Highlighted while the selected list has entries.
  F.active = function (hass) { var m = model(hass, F.setting()); return !!(m.rows && m.rows.length); };
  F.tile = function (hass, pin) { return F.present(hass) || pin ? model(hass, pin).text : ''; };

  F.sec = function (part, c, states, hass) {
    var UI = window._casoraUI;
    if (!UI || !hass) return '';
    var h = states && states !== hass.states ? Object.assign({}, hass, { states: states }) : hass;
    var m = model(h, c && c.pin);
    if (part === 'stage') return UI.stage('status', { tone: m.tone, icon: 'mdi:airplane', text: m.text });
    if (part === 'list') {
      if (!m.rows) {
        var st0 = F.resolve(h, c && c.pin).state;
        if (st0 !== 'choose' && st0 !== 'missing') return '';
        return '<p style="margin:0;font-size:14px;color:var(--secondary-text-color,currentColor);white-space:normal;overflow-wrap:anywhere">' + esc(tr(SOURCE_HINT)) + '</p>';
      }
      if (!m.rows.length) return UI.empty({ icon: 'mdi:airplane-off', text: T_EMPTY });
      return UI.group(m.rows.map(function (e) { return { icon: 'mdi:airplane', label: e.label, sub: e.detail || null, noChev: true }; }), null, null, { keepNames: true });
    }
    return '';
  };
  F.popup = function (states, hass, vars) {
    var KIT = window._casoraSoftKit, UI = window._casoraUI, S = states || {};
    if (!KIT || !UI || !UI.stage || !hass) return { type: 'vertical-stack', cards: [] };
    var pin = F.setting(), watch = F.watch(hass);
    var cj = JSON.stringify({ pin: pin });
    var card = function (part) { return { card: KIT.secCard(watch, 'return window._casoraFlights ? window._casoraFlights.sec(' + JSON.stringify(part) + ', ' + cj + ', states, hass) : "";', S) }; };
    return KIT.layout({ fields: { stage: card('stage'), list: card('list') }, top: [], stage: 'stage', left: [], right: ['list'] });
  };
})();
