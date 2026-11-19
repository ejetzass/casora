// ── Tracked flights: the shared source boundary (tile "Manage flights", Studio source choice) ─────────────────────
// For the FlightRadar24 integration (HACS). Casora needs nothing else: no calendars, helpers, scripts or template sensors.
// Detection is by parts, never by version: a source sensor is a `sensor` entry of platform 'flightradar24' with the
// translation key 'additional_tracked' that carries a `flights` list. The name and entity ID depend on language and device
// name, so they are never looked at. Orphans (state unavailable with attribute restored: true) are skipped. Related entities
// (controls, the scanning switch) belong to the source by its device_id: hass.entities has no config-entry id.
// The source is one setting for every flight surface: the hero card variable casora_flights_source (Dashboard settings
// scope, Save/Discard in the Studio). Empty = Automatic, allowed only while exactly one source exists.
// Reads, plus two writes: F.submit (adding a flight, Add button or Enter in its field) and F.stop (stopping a row, its
// Stop tracking button). Neither runs from rendering.
//   window._casoraFlights.present(hass)              → FlightRadar24 entries in the registry?
//   window._casoraFlights.sources(hass)              → [{id, device, name, ok}] usable source sensors
//   window._casoraFlights.resolve(hass, pin)         → {state: none|auto|choose|pinned|missing|loading, id, source, sources, missing}
//   window._casoraFlights.ready()                    → false while a phone waits for its desktop twin's settings (state loading)
//   window._casoraFlights.entries(hass, id)          → [{key, label, detail}] every tracked entry (key: FR24 ID, '' if none), or null
//   window._casoraFlights.stop(hass, id, row)        → the removal attempt for a row (FR24 ID); null in Studio
//   window._casoraFlights.stopView(hass, id)         → the removal attempt shown for this source, or null
//   window._casoraFlights.controls(hass, id)         → {source, add, remove, scanning, missing: [role, …]} by device_id
//   window._casoraFlights.choices(hass, pin)         → Studio select: {options, labels, empty, note}
//   window._casoraFlights.pinned(cfg)                → the setting from a dashboard config
//   window._casoraFlights.tile(hass, pin) / .popup(states, hass, vars) / .sec(part, c, states, hass)
(function () {
  if (window._casoraFlights) return;
  var F = window._casoraFlights = {};
  var KEY = 'casora_flights_source';
  F.KEY = KEY;

  var tr = function (s) { return window.casoraTr ? window.casoraTr(s) : s; };

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

  // The related entities of a source: same device, by translation key. A role that is not found is listed in missing
  // (a disabled entity is not in hass.entities, so it reads as missing too).
  var ROLES = [['add', 'text', 'add_track'], ['remove', 'text', 'remove_track'], ['scanning', 'switch', 'scanning']];
  F.controls = function (hass, id) {
    var R = (hass && hass.entities) || {}, dev = R[id] && R[id].device_id, mine = (dev && index(hass).byDevice[dev]) || [];
    var out = { source: R[id] ? id : null, add: null, remove: null, scanning: null, missing: [], ambiguous: [] };
    ROLES.forEach(function (r) {
      var hits = mine.filter(function (x) { return x.indexOf(r[1] + '.') === 0 && R[x].translation_key === r[2]; });
      if (hits.length === 1) out[r[0]] = hits[0];
      else if (hits.length > 1) out.ambiguous.push(r[0]); // two controls of one role: none is picked
      else out.missing.push(r[0]);
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
      var state = str(f.tracked_type) === 'schedule' ? tr('Geplant') : (f.on_ground === 1 || f.on_ground === '1' || f.on_ground === true) ? tr('Am Boden') : '';
      var parts = [str(f.airline_short) || str(f.airline), from && to ? from + ' → ' + to : '', state].filter(Boolean);
      return { key: str(f.id), label: label, detail: parts.join(' · ') };
    });
  };

  // ── Adding a flight: the one tracking write, from the Add button only ─────────────────────────────────────────
  // The integration's add control can return normally while it logs a failure. So success is the flight showing up in
  // the list: a FR24 flight ID that is new since the call and matches the identifier (flight number, callsign or
  // registration). No such flight within ADD_WAIT gives "not confirmed"; a later list update still confirms it. One
  // attempt at a time, no retry. A change of source drops the attempt; the list stays as the integration reports it.
  var ADD_WAIT = 30000;
  var add = null; // {source, key, state, base: flight keys before the call, timer}
  F.draft = '';
  var MSG = { empty: 'Bitte eine Flugkennung eingeben.', pending: 'Wird hinzugefügt …', confirmed: 'Flug wird verfolgt',
    tracked: 'Flug wird bereits verfolgt', unconfirmed: 'Hinzufügen nicht bestätigt. Prüfe die Verfolgung, bevor du es erneut versuchst.',
    failed: 'Hinzufügen fehlgeschlagen. Prüfe die Flugkennung und die Verbindung zu FlightRadar24, dann versuche es erneut.',
    denied: 'Keine Berechtigung, den Flug hinzuzufügen. Bitte einen Administrator, dir die Berechtigung zu geben.',
    missing: 'Kein Eingabefeld zum Hinzufügen gefunden.', scanning: 'Die Datenabfrage in FlightRadar24 ist ausgeschaltet. Schalte sie ein, dann füge den Flug erneut hinzu.',
    ambiguous: 'Mehrere Eingabefelder zum Hinzufügen gefunden.', unavailable: 'Das Eingabefeld zum Hinzufügen ist nicht verfügbar.' };
  var tr = function (s) { return window.casoraTr ? window.casoraTr(s) : s; };
  var esc = window.casoraEsc || function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); };
  // German puts a narrow no-break space before the sign, English none (wortliste.md, V1). tr() is the one place that
  // knows both; the DOM pass only rewrites text for other languages, not for German.
  var pctText = function (n) { return tr(n + ' %'); };
  var msgOf = function (a) { return a && MSG[a.state] ? tr(MSG[a.state]) : ''; };
  // A call HA refuses (the user may not use the control) is named apart from a failed call: the fix is a permission.
  var refused = function (e) { return !!e && (e.code === 'unauthorized' || /unauthori[sz]ed/i.test(String(e.message || ''))); };
  var inStudio = function () { return !!(window.casoraInStudio && window.casoraInStudio()); };
  var flightsOf = function (hass, id) { var st = ((hass && hass.states) || {})[id]; return st && isList((st.attributes || {}).flights) ? st.attributes.flights : []; };
  var keyOf = function (f, i) { return str(f && f.id) || '#' + i; };
  var sameAs = function (f, key) { return !!f && typeof f === 'object' && [f.flight_number, f.callsign, f.aircraft_registration].some(function (v) { return str(v).toUpperCase() === key; }); };
  var newMatch = function (hass, a) { return flightsOf(hass, a.source).some(function (f, i) { return sameAs(f, a.key) && a.base.indexOf(keyOf(f, i)) < 0; }); };
  var settle = function (a, state) { if (add !== a) return; a.state = state; if (a.timer) { clearTimeout(a.timer); a.timer = null; } F.paint(); };
  var drop = function () { if (add && add.timer) clearTimeout(add.timer); add = null; };
  // Every element with the attribute, through shadow roots (the popup sits in several).
  var deepAll = function (sel, root, out) {
    out = out || []; root = root || document;
    if (!root || !root.querySelectorAll) return out;
    [].forEach.call(root.querySelectorAll(sel), function (x) { out.push(x); });
    [].forEach.call(root.querySelectorAll('*'), function (el) { if (el.shadowRoot) deepAll(sel, el.shadowRoot, out); });
    return out;
  };
  // The attempt for this source, read at render time. A list that now shows the flight confirms it, also after the wait.
  F.addView = function (hass, id) {
    if (add && add.source !== id) drop();
    if (add && (add.state === 'pending' || add.state === 'unconfirmed') && newMatch(hass, add)) settle(add, 'confirmed');
    return add;
  };
  // Returns the attempt; null in Studio or without a source. An attempt in flight is returned, not sent again.
  F.submit = function (hass, id, text) {
    F.draft = text == null ? '' : String(text); // what was typed, kept as it is for a retry
    if (inStudio() || !hass || !id) return null;
    if (add && add.source === id && add.state === 'pending') return add;
    var key = str(text).toUpperCase(), ctl = F.controls(hass, id), st = null;
    drop(); dropRm(); // an add is the next action: the stop line goes
    if (!key) st = 'empty';
    else if (ctl.ambiguous.indexOf('add') >= 0) st = 'ambiguous';
    else if (!ctl.add) st = 'missing';
    else if (bad((hass.states || {})[ctl.add])) st = 'unavailable';
    else if (flightsOf(hass, id).some(function (f) { return sameAs(f, key); })) st = 'tracked';
    // The switch is off: the integration would ignore the add, so say so now instead of waiting for a confirmation.
    else if (ctl.scanning && (hass.states || {})[ctl.scanning] && hass.states[ctl.scanning].state === 'off') st = 'scanning';
    if (st) { add = { source: id, key: key, state: st, base: [], timer: null }; F.paint(); return add; }
    var a = add = { source: id, key: key, state: 'pending', base: flightsOf(hass, id).map(keyOf), timer: null };
    a.timer = setTimeout(function () { if (a.state === 'pending') settle(a, 'unconfirmed'); }, ADD_WAIT);
    F.paint();
    var sent;
    try { sent = Promise.resolve(hass.callService('text', 'set_value', { value: key }, { entity_id: ctl.add })); }
    catch (e) { sent = Promise.reject(e); }
    sent.then(null, function (e) { if (a.state === 'pending') settle(a, refused(e) ? 'denied' : 'failed'); });
    return a;
  };
  // Moves the open popup's feedback and button to the current attempt, without re-rendering the field (focus stays).
  F.paint = function () {
    var busy = !!add && add.state === 'pending';
    deepAll('[data-flights-msg]').forEach(function (m) { m.textContent = msgOf(add); });
    deepAll('[data-flights-add-btn]').forEach(function (b) { b.disabled = busy || inStudio(); });
    if (add && (add.state === 'confirmed' || add.state === 'tracked')) {
      F.draft = '';
      deepAll('[data-flights-in]').forEach(function (i) { i.value = ''; });
    }
    deepAll('[data-flights-rm-msg]').forEach(function (m) { m.textContent = rmMsgOf(rm); });
    deepAll('[data-flights-stop]').forEach(function (b) { b.disabled = rmBusy() || inStudio(); });
    refocusSoon();
  };

  // ── Stopping a flight: the one removal, from a row's Stop tracking button only ─────────────────────────────────────
  // The integration removes by identifier (flight number, callsign or registration), not by FR24 ID, and its remove
  // control can also return normally on failure. So before the command: the row must still be listed under its FR24
  // ID, its identifier must match exactly one entry (else nothing is sent), and the control must be unambiguous and
  // available. Confirmed only when the row is gone and no entry is left with that identifier. Same bounded wait and no
  // retry as adding; a list update that re-lists the flight drops a confirmed result.
  var REMOVE_WAIT = 30000;
  var rm = null; // {source, row, key, state, timer}
  var RMMSG = { pending: 'Verfolgung wird beendet …', confirmed: 'Verfolgung beendet',
    unconfirmed: 'Beenden nicht bestätigt. Prüfe die Verfolgung, bevor du es erneut versuchst.',
    failed: 'Beenden fehlgeschlagen.', stale: 'Dieser Eintrag ist nicht mehr in der Liste.',
    noident: 'Für diesen Eintrag gibt es keine Kennung zum Beenden.',
    ambiguous: 'Mehrere Einträge haben diese Kennung. Es wurde nichts beendet.',
    missing_ctl: 'Kein Steuerelement zum Beenden gefunden.', ambiguous_ctl: 'Mehrere Steuerelemente zum Beenden gefunden.',
    unavailable_ctl: 'Das Steuerelement zum Beenden ist nicht verfügbar.', source: 'Quelle nicht verfügbar',
    denied: 'Keine Berechtigung, die Verfolgung zu beenden. Bitte einen Administrator, dir die Berechtigung zu geben.' };
  var rmBusy = function () { return !!rm && rm.state === 'pending'; };
  var rmMsgOf = function (a) { return a && RMMSG[a.state] ? tr(RMMSG[a.state]) : ''; };
  var settleRm = function (a, state) { if (rm !== a) return; a.state = state; if (a.timer) { clearTimeout(a.timer); a.timer = null; } F.paint(); };
  var dropRm = function () { if (rm && rm.timer) clearTimeout(rm.timer); rm = null; };
  var idOf = function (f) { return f && typeof f === 'object' ? str(f.id) : ''; };
  var listed = function (flights, row) { return flights.some(function (f) { return idOf(f) === row; }); };
  var sameIdent = function (flights, key) { return flights.filter(function (f) { return sameAs(f, key); }); };
  var identOf = function (f) { return [f.flight_number, f.callsign, f.aircraft_registration].map(str).filter(Boolean)[0] || ''; };
  // Returns the attempt; null in Studio or without a source. The attempt is only sent when every check passes.
  F.stop = function (hass, id, row) {
    if (inStudio() || !hass || !id) return null;
    if (rmBusy() && rm.source === id) return rm; // one removal per source at a time: a press while pending is never sent
    dropRm(); drop(); // a stop is the next action: the add line goes
    var st = (hass.states || {})[id], flights = flightsOf(hass, id), row0 = String(row == null ? '' : row);
    var found = row0 ? flights.filter(function (f) { return idOf(f) === row0; }) : [];
    var ctl = F.controls(hass, id), key = '', state = null;
    if (!st || bad(st)) state = 'source';
    else if (found.length !== 1) state = 'stale';
    else {
      key = identOf(found[0]).toUpperCase();
      if (!key) state = 'noident';
      else if (ctl.ambiguous.indexOf('remove') >= 0) state = 'ambiguous_ctl';
      else if (!ctl.remove) state = 'missing_ctl';
      else if (bad((hass.states || {})[ctl.remove])) state = 'unavailable_ctl';
      else if (sameIdent(flights, key).length !== 1) state = 'ambiguous';
    }
    if (state) { rm = { source: id, row: row0, key: key, state: state, timer: null }; F.paint(); return rm; }
    var a = rm = { source: id, row: row0, key: key, state: 'pending', timer: null, refocus: false, at: 0 };
    // A Stop button with the keyboard focus is disabled below: its place is remembered for the focus to come back to.
    deepAll('[data-flights-stop]').forEach(function (b, i) { if (b.getRootNode && b.getRootNode().activeElement === b) { a.refocus = true; a.at = i; } });
    a.timer = setTimeout(function () { if (a.state === 'pending') settleRm(a, 'unconfirmed'); }, REMOVE_WAIT);
    F.paint();
    var sent;
    try { sent = Promise.resolve(hass.callService('text', 'set_value', { value: key }, { entity_id: ctl.remove })); }
    catch (e) { sent = Promise.reject(e); }
    // The command's end is recorded: a row gone while the command still runs is not "stopped" yet. If the list already
    // shows the removal, it is settled now; no list draw comes after the command in that case.
    sent.then(function () {
      a.done = true;
      var ha = document.querySelector('home-assistant');
      if (ha && ha.hass && rm === a) F.stopView(ha.hass, a.source);
    }, function (e) { if (a.state === 'pending') settleRm(a, refused(e) ? 'denied' : 'failed'); });
    return a;
  };
  // After a stop from the keyboard the focus goes to the Stop button at the same position once the list is drawn again
  // (the row's button is gone), else to the Add field, else to the feedback line. Deferred: the new page is not in place yet.
  // The element with the keyboard focus, through shadow roots (the popup sits in several).
  var activeEl = function () {
    var el = document.activeElement || null;
    while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
    return el;
  };
  // Focus is lost when nothing holds it, or when the removed row's own Stop button still holds it (disabled, stale).
  var focusLost = function (el) {
    if (!el || el === document.body || el === document.documentElement) return true;
    return !!rm && !!el.hasAttribute && el.hasAttribute('data-flights-stop') && el.getAttribute('data-flights-row') === rm.row;
  };
  var refocus = function () {
    if (!rm || !rm.refocus) return;
    if (!focusLost(activeEl())) { rm.refocus = false; return; } // the user moved the focus: it stays where it is
    var stops = deepAll('[data-flights-stop]');
    var t = stops.length ? stops[Math.min(rm.at, stops.length - 1)] : (deepAll('[data-flights-in]')[0] || deepAll('[data-flights-rm-msg]')[0]);
    if (!t || t.disabled || !t.focus) return; // still disabled while the command runs: a later draw or paint tries again
    rm.refocus = false;
    t.focus();
  };
  var refocusSoon = function () { if (rm && rm.refocus) setTimeout(refocus, 0); };
  // The attempt for this source, read at render time. A list that no longer shows the row, and no entry with its
  // identifier, confirms it (also after the wait). A list that shows the flight again ends the message.
  F.stopView = function (hass, id) {
    if (rm && rm.source !== id) dropRm();
    if (rm && rm.state === 'confirmed' && listed(flightsOf(hass, id), rm.row)) dropRm();
    if (rm && (rm.state === 'pending' || rm.state === 'unconfirmed') && rm.done) {
      var fl = flightsOf(hass, id);
      if (!listed(fl, rm.row) && !sameIdent(fl, rm.key).length) settleRm(rm, 'confirmed');
    }
    return rm;
  };
  var hit = function (ev, attr) {
    var p = (ev.composedPath && ev.composedPath()) || [];
    for (var i = 0; i < p.length; i++) if (p[i] && p[i].hasAttribute && p[i].hasAttribute(attr)) return p[i];
    return null;
  };
  var sendFrom = function (el) {
    var inp = deepAll('[data-flights-in]')[0], ha = document.querySelector('home-assistant');
    F.submit(ha && ha.hass, el.getAttribute('data-flights-src'), inp ? inp.value : F.draft);
  };
  var stopFrom = function (el) {
    var ha = document.querySelector('home-assistant');
    F.stop(ha && ha.hass, el.getAttribute('data-flights-src'), el.getAttribute('data-flights-row'));
  };
  var pressed = function (el) { if (el.hasAttribute('data-flights-stop')) stopFrom(el); else sendFrom(el); };
  var button = function (ev) { return hit(ev, 'data-flights-add-btn') || hit(ev, 'data-flights-stop'); };
  // Own capture, like the other popup buttons: a touch is taken before a click follows, and it is not sent twice.
  if (typeof window.addEventListener === 'function') {
    var touched = 0;
    // Typing starts the next action: an old outcome line is cleared (a pending attempt keeps its line).
    window.addEventListener('input', function (ev) {
      var el = hit(ev, 'data-flights-in'); if (!el) return;
      F.draft = el.value;
      if (add && add.state !== 'pending') { drop(); F.paint(); }
    }, true);
    window.addEventListener('keydown', function (ev) { var el = hit(ev, 'data-flights-in'); if (el && ev.key === 'Enter') { ev.preventDefault(); sendFrom(el); } }, true);
    // The user moved the focus after a stop: the pending refocus is dropped, so a later settle does not take it back.
    window.addEventListener('focusin', function () { if (rm && rm.refocus && !focusLost(activeEl())) rm.refocus = false; });
    // A finger that moved more than 10 px is a scroll, not a tap (as in 05, 06 and 07): no button is pressed by it.
    var start = null;
    window.addEventListener('touchstart', function (ev) { var t = ev.touches && ev.touches[0]; start = t ? { x: t.clientX, y: t.clientY } : null; }, { capture: true, passive: true });
    window.addEventListener('touchend', function (ev) {
      var el = button(ev); if (!el) return;
      var t = ev.changedTouches && ev.changedTouches[0];
      if (start && t && (Math.abs(t.clientX - start.x) > 10 || Math.abs(t.clientY - start.y) > 10)) return;
      touched = Date.now(); if (ev.cancelable) ev.preventDefault(); pressed(el);
    }, true);
    window.addEventListener('click', function (ev) { var el = button(ev); if (el && Date.now() - touched > 700) pressed(el); }, true);
  }

  // ── The setting ───────────────────────────────────────────────────────────
  // The first value of the setting over a list of variables objects (one per view's hero card): its String, or '' when none
  // holds one. Shared by the dashboard config (F.pinned) and the Studio save guard.
  F.firstValue = function (list) {
    for (var i = 0; i < (list || []).length; i++) {
      var v = (list[i] || {})[KEY];
      if (v !== undefined && v !== null && v !== '') return String(v);
    }
    return '';
  };
  F.pinned = function (cfg) {
    var views = (cfg && cfg.views) || [];
    var heroes = Array.prototype.map.call(views, function (view) { return ((view || {}).cards || [])[0] || {}; });
    return F.firstValue(heroes.map(function (hero) { return hero.variables || {}; }));
  };
  // The open dashboard's own value; '' when it has none.
  var ownOf = function () {
    try { return F.pinned(window._casoraLovelaceCfg && window._casoraLovelaceCfg()); } catch (e) { return ''; }
  };
  // Own value first; a phone takes the rest from its desktop twin (below). '' = Automatic, or not known yet (F.ready).
  F.setting = function () {
    var own = ownOf();
    if (own) return own;
    var t = twinOf();
    return t && (t.state === 'ok' || t.state === 'none') ? (t.flights[KEY] || '') : '';
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
  // Casora's own setting: Studio → Settings → Tapping & tablet → Tracked flights.
  var SOURCE_HINT = 'Die Quelle wählst du im Studio unter Einstellungen → Bedienen → Verfolgte Flüge.';
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
    if (part === 'add') {
      var r = F.resolve(h, c && c.pin);
      if (!r.source || (r.state !== 'pinned' && r.state !== 'auto')) return '';
      var a = F.addView(h, r.id);
      // The label names the input (axe: label). The focus ring is a rule here: the popup's own styles remove outlines.
      return '<style>[data-flights-in]:focus-visible,[data-flights-add-btn]:focus-visible{outline:2px solid var(--casora-popup-ui-action,var(--casora-accent,#276B64));outline-offset:2px}</style>'
        + '<label for="flights-add-in" style="display:block;margin:0 0 8px;font-size:13px;font-weight:600;white-space:normal">' + esc(tr('Flugkennung')) + '</label>'
        + '<div style="display:flex;gap:12px;align-items:center">'
        + '<input type="text" id="flights-add-in" data-flights-in data-flights-src="' + esc(r.id) + '" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-describedby="flights-add-help" value="' + esc(F.draft) + '"' + (inStudio() ? ' disabled' : '')
        + ' style="flex:1 1 auto;min-width:0;font:inherit;font-size:16px;min-height:44px;box-sizing:border-box;padding:8px 12px;border-radius:12px;border:1px solid currentColor;background:transparent;color:inherit">'
        + '<button type="button" data-flights-add-btn data-flights-src="' + esc(r.id) + '"' + (inStudio() || (a && a.state === 'pending') ? ' disabled' : '') + ' style="font:inherit;font-size:16px;min-height:44px;box-sizing:border-box;padding:0 20px;border:0;border-radius:999px;font-weight:600;cursor:pointer;background:var(--casora-popup-ui-action,var(--casora-accent,#276B64));color:var(--casora-popup-ui-on-action,#fff)">' + esc(tr('Hinzufügen')) + '</button></div>'
        + '<p id="flights-add-help" style="margin:8px 0 0;font-size:13px;color:var(--secondary-text-color,currentColor);white-space:normal;overflow-wrap:anywhere">' + esc(tr('Flugnummer, Rufzeichen oder Registrierung')) + '</p>'
        + '<p data-flights-msg role="status" aria-live="polite" style="margin:8px 0 0;font-size:14px;font-weight:600;min-height:1em;white-space:normal;overflow-wrap:anywhere">' + esc(msgOf(a)) + '</p>';
    }
    if (part === 'stage') return UI.stage('status', { tone: m.tone, icon: 'mdi:airplane', text: m.text });
    if (part === 'list') {
      if (!m.rows) {
        var st0 = F.resolve(h, c && c.pin).state;
        if (st0 !== 'choose' && st0 !== 'missing') return '';
        return UI.note(tr(SOURCE_HINT));
      }
      // The complete list (airborne or not): a row's Stop tracking button needs only the source and the row's FR24 ID.
      var rs = F.resolve(h, c && c.pin), live = !!rs.source && (rs.state === 'pinned' || rs.state === 'auto');
      var sa = live ? F.stopView(h, rs.id) : null, busy = rmBusy() || inStudio();
      refocusSoon(); // a stop from the keyboard: the focus comes back after this draw
      var msgHtml = '<p data-flights-rm-msg role="status" tabindex="-1" aria-live="polite" style="margin:8px 0 0;font-size:14px;font-weight:600;min-height:1em;white-space:normal;overflow-wrap:anywhere">' + esc(rmMsgOf(sa)) + '</p>';
      if (!m.rows.length) return UI.empty({ icon: 'mdi:airplane-off', text: T_EMPTY }) + msgHtml; // the feedback outlives the last row
      var rowsHtml = m.rows.map(function (e, i) {
        return (i ? '<div style="height:1px;margin:0 16px;background:currentColor;opacity:.15"></div>' : '')
          + '<div style="display:flex;align-items:center;gap:12px;min-height:52px;box-sizing:border-box;padding:8px 16px">'
          + '<div style="flex:1;min-width:0">'
          + '<div style="font-size:17px;white-space:normal;overflow-wrap:anywhere">' + esc(e.label) + '</div>'
          + (e.detail ? '<div style="font-size:13px;color:var(--secondary-text-color,currentColor);white-space:normal;overflow-wrap:anywhere">' + esc(e.detail) + '</div>' : '')
          + '</div>'
          + (live && e.key
            ? '<button type="button" data-flights-stop data-flights-src="' + esc(rs.id) + '" data-flights-row="' + esc(e.key) + '"'
            + ' aria-describedby="flights-stop-help" aria-label="' + esc(tr('Verfolgung beenden')) + ': ' + esc(e.label) + '"'
            + (busy ? ' disabled' : '')
            + ' style="flex:none;font:inherit;font-size:15px;min-height:44px;box-sizing:border-box;padding:0 16px;border-radius:999px;font-weight:600;cursor:pointer;border:1px solid currentColor;background:transparent;color:inherit">'
            + esc(tr('Verfolgung beenden')) + '</button>'
            : '')
          + '</div>';
      }).join('');
      return '<style>[data-flights-stop]:focus-visible{outline:2px solid var(--casora-popup-ui-action,var(--casora-accent,#276B64));outline-offset:2px}</style>'
        + (live ? '<p id="flights-stop-help" style="margin:0 0 8px;font-size:13px;color:var(--secondary-text-color,currentColor);white-space:normal;overflow-wrap:anywhere">' + esc(tr('Beendet die Verfolgung in FlightRadar24 und kann zugehörige Benachrichtigungen stoppen. Automationen können den Flug erneut hinzufügen.')) + '</p>' : '')
        + '<div style="background:var(--casora-popup-row-fill, rgba(255,255,255,0.10));border-radius:var(--casora-popup-row-radius, 20px);overflow:hidden">' + rowsHtml + '</div>'
        + msgHtml;
    }
    return '';
  };
  F.popup = function (states, hass, vars) {
    var KIT = window._casoraSoftKit, UI = window._casoraUI, S = states || {};
    if (!KIT || !UI || !UI.stage || !hass) return { type: 'vertical-stack', cards: [] };
    var pin = F.setting(), watch = F.watch(hass);
    var cj = JSON.stringify({ pin: pin });
    var card = function (part) { return { card: KIT.secCard(watch, 'return window._casoraFlights ? window._casoraFlights.sec(' + JSON.stringify(part) + ', ' + cj + ', states, hass) : "";', S) }; };
    // The Add field sits above the list, only where a source is chosen (the list then has something to add to).
    var rr = F.resolve(hass, pin), canAdd = !!rr.source && (rr.state === 'pinned' || rr.state === 'auto');
    var fields = { stage: card('stage'), list: card('list') };
    if (canAdd) fields.add = card('add');
    return KIT.layout({ fields: fields, top: canAdd ? ['add'] : [], stage: 'stage', left: [], right: ['list'] });
  };
})();
