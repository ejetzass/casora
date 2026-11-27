// ── Tracked flights: the shared source boundary (tile "Manage flights", Studio source choice) ─────────────────────
// For the FlightRadar24 integration (HACS). Casora needs nothing else: no calendars, helpers, scripts or template sensors.
// Detection is by parts, never by version: a source sensor is a `sensor` entry of platform 'flightradar24' with the
// translation key 'additional_tracked' that carries a `flights` list. The name and entity ID depend on language and device
// name, so they are never looked at. Orphans (state unavailable with attribute restored: true) are skipped. Related entities
// (controls, the scanning switch) belong to the source by its device_id: hass.entities has no config-entry id.
// The source is one setting for every flight surface: the hero card variable casora_flights_source (Dashboard settings
// scope, Save/Discard in the Studio). Empty = Automatic, allowed only while exactly one source exists.
// Reads, plus two writes: F.submit (adding a flight, Add button or Enter in its field) and F.stop (stopping a row, its
// Stop tracking button). Neither runs from rendering. Both read the scanning switch of the source's device first: is it
// off, nothing is sent and the switch is named.
//   window._casoraFlights.present(hass)              → FlightRadar24 entries in the registry?
//   window._casoraFlights.sources(hass)              → [{id, device, name, ok}] usable source sensors
//   window._casoraFlights.resolve(hass, pin)         → {state: none|auto|choose|pinned|missing|loading, id, source, sources, missing}
//   window._casoraFlights.ready()                    → false while a phone waits for its desktop twin's settings (state loading)
//   window._casoraFlights.entries(hass, id)          → [{key, label, detail}] every tracked entry (key: FR24 ID, '' if none), or null
//   window._casoraFlights.stop(hass, id, row)        → the removal attempt for a row (FR24 ID); null in Studio
//   window._casoraFlights.stopView(hass, id)         → the removal attempt shown for this source, or null
//   window._casoraFlights.controls(hass, id)         → {source, add, remove, scanning, missing: [role, …]} by device_id
//   window._casoraFlights.choices(hass, pin)         → Studio select: {options, labels, empty, note}
//   window._casoraFlights.firstValue(list, key)       → first nonempty dashboard setting
//   window._casoraFlights.pinned(cfg)                → the setting from a dashboard config
//   window._casoraFlights.tile(hass, pin) / .tileShort(hass, pin) / .popup(states, hass, vars) / .sec(part, c, states, hass)
//   window._casoraFlights.airborne(hass, pin, now, units) → the qualifying flights now (the shared rule for every flight surface; units optional, a draft's)
//   window._casoraFlights.details(entry)             → {airline, model, registration, callsign, origin, destination} ('' when missing)
//   window._casoraFlights.timeRows(hass, entry, tzOn) → [[label, text]] departure and arrival timestamps (the popup's rows)
//   window._casoraFlights.liveHtml(hass, pin, now) / .liveHidden(hass)  → the Flights tile (one line, "N in the air") and its hidden state; `now` is optional
//   window._casoraFlights.phone() → the phone breakpoint (the tile CSS's media query); .tapTile(hass, name) / .openList(hass, src, name)
//   window._casoraFlights.listStage(hass, c) / .listRows(hass, c) / .listPopup(states, hass, v) → the list popup (phone and desktop; c = {pin, now}, now optional)
//   window._casoraFlights.flight(hass, src, id, now)  → one qualifying flight by FR24 ID (its row), or null
//   window._casoraFlights.open(hass, src, id)        → a row's popup (casora_popup_flight); null when it does not qualify
//   window._casoraFlights.flightPopup(states, hass, v) → the popup's content for v = {source, flight}; .title(hass, v) its title
//   window._casoraFlights.setting(key) → one Dashboard setting (own value, else the phone's desktop twin; in the Studio the draft)
//   window._casoraFlights.addView(hass, id) / .submit(hass, id, text) / .paint() / .draft → the Add field's attempt
//   window._casoraFlights.watch(hass) → the source IDs (and the pin) a card follows; .active(hass) → tile highlight
//   window._casoraFlights.KEY / .UNIT_KEYS → the setting keys (source, units)
//   window._casoraFlights.progress(o, c, d) / .progressOf(entry) → approximate progress in whole percent, or null
//   window._casoraFlights.distanceKm(a, b) / .trailOf(entry) → great-circle km and the valid trail points
//   window._casoraFlights.ROUTE_STYLE                → {width, casingWidth, casingOpacity, dash}: the Remaining route's look; the screensaver uses width and dash only
//   window._casoraFlights.greatCircle(a, b)           → the Remaining route: [lat, lon] points aircraft→destination ([] when none)
//   window._casoraFlights.unreportedOf(view)   → the Unreported part: [lat, lon] points, origin airport → oldest Flown trail point ([] when either is missing)
//   window._casoraFlights.mapView(hass, src, id, now) / .mapGeo(view) / .mapBounds(view) → the map's flight, layers and box
//   window._casoraFlights.glide(g, now, reduce) / .mapViewAt(view, pos, heading) / .track(state, view, ident, now, reduce) → the popup arrow's glide: drawn position and heading, the view drawn there, and the pure state step ({state, view, gliding})
//   window._casoraFlights.glideT(g, now) / .lonNear(ref, lon) → how far a glide has come (0 to 1), and a longitude shifted by whole turns to lie within 180 degrees of ref
//   window._casoraFlights.MAP → map timing: READY_MS, TICK_MS
//   window._casoraFlights.units() → saved units {altitude, speed, vspeed} ('' = source unit; in the Studio the draft)
//   window._casoraFlights.fmt.altitude(v, unit) / .speed(v, unit) / .vspeed(v, unit) / .heading(v) → shared formatting ('' when not finite)
//   window._casoraFlights.times(hass, entry, tzOn) → {dep, arr}: [{kind: scheduled|real|estimated, text}] (origin/destination + HA-local time)
//   window._casoraFlights.tz() → the saved "Show timezones" switch (off unless set; in the Studio the draft)
(function () {
  if (window._casoraFlights) return;
  var F = window._casoraFlights = {};
  var KEY = 'casora_flights_source';
  F.KEY = KEY;

  var tr = function (s) { return window.casoraTr ? window.casoraTr(s) : s; };
  // The name goes into the text after the translation: the table is a plain lookup, so {name} is part of the key.
  var fillName = function (s, name) { return String(s == null ? '' : s).replace(/\{name\}/g, name == null ? '' : String(name)); };
  // The parts of FlightRadar24 that Casora needs, by name (the missing-part text names the one that is missing).
  var PARTS = { add: 'das Eingabefeld zum Hinzufügen', remove: 'das Steuerelement zum Beenden', scanning: 'der Schalter für die Datenabfrage' };
  var T_MISSING_PART = 'In FlightRadar24 fehlt, was Casora braucht: {name}';
  // Both parts missing: one note names both (the same parts as PARTS, written out in full).
  var T_MISSING_BOTH = 'In FlightRadar24 fehlen zwei Teile, die Casora braucht: das Eingabefeld zum Hinzufügen und der Schalter für die Datenabfrage';
  // The text of a missing part, with the name of the part in it.
  var missingText = function (role) { return fillName(tr(T_MISSING_PART), tr(PARTS[role])); };

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
  // The name the user sees for an entity (its friendly name), the device name as the fallback.
  var friendlyOf = function (hass, id) {
    var st = ((hass && hass.states) || {})[id];
    return (st && (st.attributes || {}).friendly_name) || nameOf(hass, id);
  };
  // The scanning switch of the source's device: off means the integration ignores every command.
  var scanOff = function (hass, ctl) {
    var st = ctl && ctl.scanning && (hass.states || {})[ctl.scanning];
    return !!(st && st.state === 'off');
  };
  // Stop needs the switch to be readable: missing, unavailable or unknown means scanning cannot be confirmed, so nothing is sent.
  var scanUnknown = function (hass, ctl) {
    return !ctl.scanning || bad((hass.states || {})[ctl.scanning]);
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
    // Automatic and the prompt count only tracked-flights sensors (a flights list): an entry without one is not a source.
    var live = list.filter(function (s) { return s.ok; });
    if (live.length === 1) { out.state = 'auto'; out.id = live[0].id; out.source = live[0]; }
    else if (live.length > 1) out.state = 'choose';
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
  var labelOf = function (f) { return str(f.flight_number) || str(f.callsign) || str(f.aircraft_registration) || str(f.id); };
  var routeOf = function (f) { var a = airport(f, 'origin'), b = airport(f, 'destination'); return a && b ? a + ' → ' + b : ''; };
  // Identity and what is there. No freshness is claimed: an airborne flag (on_ground 0) can be left over from before a
  // restart, so only "scheduled" and "on the ground" are worded; everything else says nothing.
  F.entries = function (hass, id) {
    var st = ((hass && hass.states) || {})[id];
    if (!st || !isList((st.attributes || {}).flights)) return null;
    return st.attributes.flights.map(function (f, i) {
      f = f && typeof f === 'object' ? f : {};
      var label = labelOf(f) || String(i + 1);
      var state = str(f.tracked_type) === 'schedule' ? tr('Geplant') : (f.on_ground === 1 || f.on_ground === '1' || f.on_ground === true) ? tr('Am Boden') : '';
      var parts = [str(f.airline_short) || str(f.airline), routeOf(f), state].filter(Boolean);
      return { key: str(f.id), label: label, detail: parts.join(' · ') };
    });
  };

  // ── Adding a flight: the one tracking write, from the Add button only ─────────────────────────────────────────
  // The integration's add control can return normally while it logs a failure. So success is the flight showing up in
  // the list: a FR24 flight ID that is new since the call and matches the identifier (flight number, callsign or
  // registration). No such flight within ADD_WAIT gives "not confirmed"; a later list update still confirms it. One
  // attempt at a time, no retry. A change of source drops the attempt; the list stays as the integration reports it.
  var ADD_WAIT = 30000;
  var add = null; // {source, key, state, name, base: flight keys before the call, timer}
  F.draft = '';
  // One wording for both commands: the scanning switch is off, so the integration would ignore the command. The text names
  // the switch ({name} is filled in after the translation).
  var T_SCANNING = '{name} ist in FlightRadar24 ausgeschaltet';
  var MSG = { empty: 'Bitte eine Flugkennung eingeben.', pending: 'Wird hinzugefügt …', confirmed: 'Flug wird verfolgt',
    tracked: 'Flug wird bereits verfolgt', unconfirmed: 'Hinzufügen nicht bestätigt. Prüfe die Verfolgung, bevor du es erneut versuchst.',
    failed: 'Hinzufügen fehlgeschlagen. Prüfe die Flugkennung und die Verbindung zu FlightRadar24, dann versuche es erneut.',
    denied: 'Keine Berechtigung, den Flug hinzuzufügen. Bitte einen Administrator, dir die Berechtigung zu geben.',
    missing: 'Kein Eingabefeld zum Hinzufügen gefunden.', scanning: T_SCANNING, noscan: T_MISSING_PART,
    ambiguous: 'Mehrere Eingabefelder zum Hinzufügen gefunden.', unavailable: 'Das Eingabefeld zum Hinzufügen ist nicht verfügbar.' };
  var esc = window.casoraEsc || function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); };
  // German puts a narrow no-break space before the sign, English none (wortliste.md, V1). tr() is the one place that
  // knows both; the DOM pass only rewrites text for other languages, not for German.
  var pctText = function (n) { return tr(n + ' %'); };
  var msgOf = function (a) { return a && MSG[a.state] ? fillName(tr(MSG[a.state]), a.name) : ''; };
  // A call HA refuses (the user may not use the control) is named apart from a failed call: the fix is a permission.
  var refused = function (e) { return !!e && (e.code === 'unauthorized' || /unauthori[sz]ed/i.test(String(e.message || ''))); };
  // The Studio panel while it is on the page, else null. The panel itself says so: a Studio opened on its own has no
  // casora-core.js (no casoraInStudio), and its preview must still never send a call.
  var studioPanel = function () { var p = window._casoraStudioPanel; return p && p.isConnected !== false ? p : null; };
  var inStudio = function () { return !!(window.casoraInStudio && window.casoraInStudio()) || !!studioPanel(); };
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
    // The switch must be readable and on, as for Stop: missing, unavailable or unknown means nothing is sent.
    else if (scanUnknown(hass, ctl)) st = 'noscan';
    // The switch is off: the integration would ignore the add, so say so now instead of waiting for a confirmation.
    else if (scanOff(hass, ctl)) st = 'scanning';
    var nameOfState = st === 'scanning' ? friendlyOf(hass, ctl.scanning) : st === 'noscan' ? tr(PARTS.scanning) : '';
    if (st) { add = { source: id, key: key, state: st, name: nameOfState, base: [], timer: null }; F.paint(); return add; }
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
  // ID, no other entry may carry the identifier sent (else nothing is sent), the control must be unambiguous and
  // available, and the scanning switch must be readable and on. Confirmed only when the row is gone and no entry is left with that
  // identifier. Same bounded wait and no retry as adding; a list update that re-lists the flight drops a confirmed result.
  var REMOVE_WAIT = 30000;
  var rm = null; // {source, row, key, state, name, timer}
  var RMMSG = { pending: 'Verfolgung wird beendet …', confirmed: 'Verfolgung beendet',
    unconfirmed: 'Beenden nicht bestätigt. Prüfe die Verfolgung, bevor du es erneut versuchst.',
    failed: 'Beenden fehlgeschlagen.', stale: 'Dieser Eintrag ist nicht mehr in der Liste.',
    noident: 'Für diesen Eintrag gibt es keine Kennung zum Beenden.',
    ambiguous: 'Mehrere Einträge haben diese Kennung. Es wurde nichts beendet.',
    missing_ctl: 'Kein Steuerelement zum Beenden gefunden.', ambiguous_ctl: 'Mehrere Steuerelemente zum Beenden gefunden.',
    unavailable_ctl: 'Das Steuerelement zum Beenden ist nicht verfügbar.', source: 'Quelle nicht verfügbar',
    scanning: T_SCANNING, noscan: T_MISSING_PART,
    denied: 'Keine Berechtigung, die Verfolgung zu beenden. Bitte einen Administrator, dir die Berechtigung zu geben.' };
  var rmBusy = function () { return !!rm && rm.state === 'pending'; };
  var rmMsgOf = function (a) { return a && RMMSG[a.state] ? fillName(tr(RMMSG[a.state]), a.name) : ''; };
  var settleRm = function (a, state) { if (rm !== a) return; a.state = state; if (a.timer) { clearTimeout(a.timer); a.timer = null; } F.paint(); };
  var dropRm = function () { if (rm && rm.timer) clearTimeout(rm.timer); rm = null; };
  var idOf = function (f) { return f && typeof f === 'object' ? str(f.id) : ''; };
  var listed = function (flights, row) { return flights.some(function (f) { return idOf(f) === row; }); };
  var sameIdent = function (flights, key) { return flights.filter(function (f) { return sameAs(f, key); }); };
  var identOf = function (f) { return [f.flight_number, f.callsign, f.aircraft_registration].map(str).filter(Boolean)[0] || ''; };
  // The identifiers of an entry: flight number, callsign and registration (what the integration matches).
  var identsOf = function (f) {
    return [f && f.flight_number, f && f.callsign, f && f.aircraft_registration]
      .map(function (v) { return str(v).toUpperCase(); }).filter(Boolean);
  };
  // The integration removes the FIRST entry whose flight number, callsign or registration matches the identifier sent.
  // Casora sends the row's first identifier (identOf). So the row is blocked only when another entry carries that same
  // identifier: a unique flight number with a registration shared by an aircraft stub is still removed.
  var sharedIdent = function (flights, row) {
    var key = identOf(row).toUpperCase();
    return flights.some(function (f) { return f !== row && identsOf(f).indexOf(key) >= 0; });
  };
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
      else if (sharedIdent(flights, found[0])) state = 'ambiguous';
      // The switch is missing or cannot be read: scanning is not confirmed, so the command is not sent.
      else if (scanUnknown(hass, ctl)) state = 'noscan';
      // The switch is off: the integration would ignore the command, so say so now instead of waiting for a confirmation.
      else if (scanOff(hass, ctl)) state = 'scanning';
    }
    var name = state === 'scanning' ? friendlyOf(hass, ctl.scanning) : state === 'noscan' ? tr(PARTS.scanning) : '';
    if (state) { rm = { source: id, row: row0, key: key, state: state, name: name, timer: null }; F.paint(); return rm; }
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
  // The row whose flight popup is open. The list popup redraws its rows on every state change, so the row the popup saved can be
  // gone when it closes; then the focus is moved to the new row of the same flight (see the focusin handler below).
  var backRow = null;
  var rowFrom = function (el) {
    var ha = document.querySelector('home-assistant'), src = el.getAttribute('data-flights-src'), key = el.getAttribute('data-flights-key');
    if (F.open(ha && ha.hass, src, key)) backRow = { src: src, key: key };
  };
  // The tile's summary line (one flight or more, phone and desktop) is one button: its tap goes to F.tapTile.
  var tileTap = function () {
    var ha = document.querySelector('home-assistant');
    F.tapTile(ha && ha.hass);
  };
  var pressed = function (el) {
    if (el.hasAttribute('data-flights-stop')) stopFrom(el);
    else if (el.hasAttribute('data-flights-row')) rowFrom(el);
    else if (el.hasAttribute('data-flights-tile-card')) tileTap();
    else sendFrom(el);
  };
  var button = function (ev) {
    return hit(ev, 'data-flights-add-btn') || hit(ev, 'data-flights-stop') || hit(ev, 'data-flights-row') || hit(ev, 'data-flights-tile-card');
  };
  // Own capture, like the other popup buttons: a touch is taken before a click follows, and it is not sent twice.
  if (typeof window.addEventListener === 'function') {
    var touched = 0;
    // Typing starts the next action: an old outcome line is cleared (a pending attempt keeps its line).
    window.addEventListener('input', function (ev) {
      var el = hit(ev, 'data-flights-in'); if (!el) return;
      F.draft = el.value;
      if (add && add.state !== 'pending') { drop(); F.paint(); }
    }, true);
    window.addEventListener('keydown', function (ev) {
      var el = hit(ev, 'data-flights-in'); if (el && ev.key === 'Enter') { ev.preventDefault(); sendFrom(el); return; }
      // A focused row opens its popup with Enter or Space, as a tap does. The tile's own key handling (its tip) is not reached.
      var row = hit(ev, 'data-flights-row');
      if (row && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); ev.stopPropagation(); rowFrom(row); }
      var tile = hit(ev, 'data-flights-tile-card');
      if (tile && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); ev.stopPropagation(); tileTap(); }
    }, true);
    // The user moved the focus after a stop: the pending refocus is dropped, so a later settle does not take it back.
    window.addEventListener('focusin', function () { if (rm && rm.refocus && !focusLost(activeEl())) rm.refocus = false; });
    // The popup gives the focus back to the element it saved. If that row was redrawn, the core falls back to the tile
    // card; the focus then goes to the row of the same flight, so keyboard users stay in the list.
    window.addEventListener('focusin', function (ev) {
      var path = (ev.composedPath && ev.composedPath()) || [], t = path[0] || ev.target;
      if (path.some(function (n) { return n && n.tagName === 'CASORA-POPUP'; })) return; // the popup has the focus: keep the row
      var back = backRow; backRow = null;
      if (!back || !t) return;
      var row = deepAll('[data-flights-row]').filter(function (x) {
        return x.getAttribute('data-flights-src') === back.src && x.getAttribute('data-flights-key') === back.key && x.isConnected;
      })[0];
      // Only the card of the tile that holds the row (its #card) takes the redirect; another card keeps its focus.
      var rowRoot = row && row.getRootNode ? row.getRootNode() : null;
      var tile = rowRoot && rowRoot.querySelector ? rowRoot.querySelector('#card') : null;
      if (row && row.focus && tile && t === tile) row.focus();
    });
    // The popup is closed: a focus after this is no longer the popup's to hand back to a row.
    window.addEventListener('casora-popup-closed', function () {
      listOpen = false;
      if (!document.querySelector('casora-popup[open]')) backRow = null;
    });
    // Space opens on the key down; its release would click the button again, so the release is cancelled too.
    window.addEventListener('keyup', function (ev) { if (ev.key === ' ' && (hit(ev, 'data-flights-row') || hit(ev, 'data-flights-tile-card'))) ev.preventDefault(); }, true);
    // A row is the whole tap: it does not also reach the tile's own tap action (its popup or its more-info).
    // A finger that moved more than 10 px is a scroll, not a tap (as in 05, 06 and 07): no button is pressed by it.
    var start = null;
    window.addEventListener('touchstart', function (ev) { var t = ev.touches && ev.touches[0]; start = t ? { x: t.clientX, y: t.clientY } : null; }, { capture: true, passive: true });
    window.addEventListener('touchend', function (ev) {
      var el = button(ev); if (!el) return;
      var t = ev.changedTouches && ev.changedTouches[0];
      if (start && t && (Math.abs(t.clientX - start.x) > 10 || Math.abs(t.clientY - start.y) > 10)) return;
      touched = Date.now(); if (ev.cancelable) ev.preventDefault(); if (el.hasAttribute('data-flights-row')) ev.stopPropagation(); pressed(el);
    }, true);
    window.addEventListener('click', function (ev) { var el = button(ev); if (el && Date.now() - touched > 700) { if (el.hasAttribute('data-flights-row')) ev.stopPropagation(); pressed(el); } }, true);
  }

  // ── The setting ───────────────────────────────────────────────────────────
  // The first value of a dashboard setting, shared with the Studio save guard.
  F.firstValue = function (list, key) {
    for (var i = 0; i < (list || []).length; i++) {
      var v = (list[i] || {})[key || KEY];
      if (v !== undefined && v !== null && v !== '') return String(v);
    }
    return '';
  };
  F.pinned = function (cfg, key) {
    var views = (cfg && cfg.views) || [];
    var heroes = Array.prototype.map.call(views, function (view) { return ((view || {}).cards || [])[0] || {}; });
    return F.firstValue(heroes.map(function (hero) { return hero.variables || {}; }), key);
  };
  // The open dashboard's own value; '' when it has none.
  var ownOf = function (key) {
    try { return F.pinned(window._casoraLovelaceCfg && window._casoraLovelaceCfg(), key); } catch (e) { return ''; }
  };
  // The Studio's draft (its rooms, which Save writes and Discard drops) wins over the saved dashboard: the preview
  // follows a draft unit or switch at once. null = not in the Studio, no draft loaded yet, or the draft holds no value for the key.
  var draftOf = function (key) {
    var p = studioPanel();
    if (!p) return null;
    var rooms = ((p._state || {}).compact || {}).rooms;
    if (!Array.isArray(rooms)) return null;
    for (var i = 0; i < rooms.length; i++) {
      var v = (rooms[i] || {}).variables || {};
      if (v[key] !== undefined && v[key] !== null && v[key] !== '') return String(v[key]);
    }
    return null; // the draft holds no value for the key: the saved value and the phone twin answer, as on the live tile
  };
  // The Studio draft first, then the own value; a phone takes the rest from its desktop twin (below).
  F.setting = function (key) {
    var draft = draftOf(key || KEY);
    if (draft !== null) return draft;
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
  // Measurement units (Studio, Dashboard scope, drafts like the source). '' = the source unit (feet, knots, ft/min).
  F.UNIT_KEYS = { altitude: 'casora_flights_altitude_unit', speed: 'casora_flights_speed_unit', vspeed: 'casora_flights_vspeed_unit' };
  F.units = function () {
    var out = {};
    Object.keys(F.UNIT_KEYS).forEach(function (k) { out[k] = F.setting(F.UNIT_KEYS[k]); });
    return out;
  };

  // Studio select: values are '' (Automatic, or the prompt when several exist) and the source IDs; a stored pin stays
  // selectable. Words come from the Studio (labels hold only data names; null = the Studio words it).
  F.choices = function (hass, pin) {
    var r = F.resolve(hass, pin), options = [''], labels = {};
    // The options are the tracked-flights sensors, plus the pinned entry when it is there (even without a list).
    r.sources.forEach(function (s) { if (s.ok || s.id === r.id) { options.push(s.id); labels[s.id] = s.name; } });
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
  // The tile's short form for a narrow tile (casoraStateFit alt): the count without "tracked".
  var countShort = function (n) { return n === 1 ? '1 Flug' : n + ' Flüge'; };
  var model = function (hass, pin) {
    var r = F.resolve(hass, pin);
    if (r.state === 'loading') return { text: '', tone: 'off', rows: null };
    if (r.state === 'choose') return { text: T_CHOOSE, tone: 'warn', rows: null };
    if (r.state === 'none' || r.state === 'missing' || !r.source) return { text: T_MISSING, tone: 'bad', rows: null };
    var rows = F.entries(hass, r.id);
    if (rows == null) return { text: T_MISSING, tone: 'bad', rows: null };
    return { text: rows.length ? countWord(rows.length) : T_EMPTY, short: rows.length ? countShort(rows.length) : '', tone: rows.length ? 'good' : 'off', rows: rows };
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
  // The short form of F.tile for casoraStateFit: only the count has one, every other text is already short or a notice.
  F.tileShort = function (hass, pin) { return F.present(hass) || pin ? model(hass, pin).short || '' : ''; };

  F.sec = function (part, c, states, hass) {
    var UI = window._casoraUI;
    if (!UI || !hass) return '';
    var h = states && states !== hass.states ? Object.assign({}, hass, { states: states }) : hass;
    if (c && c.flight !== undefined) return flightSec(part, c, h); // the flight popup (F.flightPopup)
    var m = model(h, c && c.pin);
    if (part === 'add') {
      var r = F.resolve(h, c && c.pin);
      if (!r.source || (r.state !== 'pinned' && r.state !== 'auto')) return '';
      // A missing part (the add field or the scanning switch) hides only Add: the list and its rows stay.
      var ctlAdd = F.controls(h, r.id);
      var noAdd = ctlAdd.missing.indexOf('add') >= 0, noScan = ctlAdd.missing.indexOf('scanning') >= 0;
      var missTxt = noAdd && noScan ? tr(T_MISSING_BOTH) : noAdd ? missingText('add') : noScan ? missingText('scanning') : null;
      if (missTxt) return '<p data-flights-missing style="margin:0 0 8px;font-size:13px;color:var(--secondary-text-color,currentColor);white-space:normal;overflow-wrap:anywhere">' + esc(missTxt) + '</p>';
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
      // A missing remove control hides only the Stop buttons: the rows stay, the missing part is named. Two controls on
      // the device are not a missing part: the button stays and names the ambiguity when it is pressed.
      var ctlList = live ? F.controls(h, rs.id) : null, noStop = !!(ctlList && !ctlList.remove && ctlList.ambiguous.indexOf('remove') < 0);
      var missHtml = '<p data-flights-missing style="margin:0 0 8px;font-size:13px;color:var(--secondary-text-color,currentColor);white-space:normal;overflow-wrap:anywhere">' + esc(missingText('remove')) + '</p>';
      var noteHtml = live ? (noStop ? missHtml
        : '<p id="flights-stop-help" style="margin:0 0 8px;font-size:13px;color:var(--secondary-text-color,currentColor);white-space:normal;overflow-wrap:anywhere">' + esc(tr('Beendet die Verfolgung in FlightRadar24 und kann zugehörige Benachrichtigungen stoppen. Automationen können den Flug erneut hinzufügen.')) + '</p>') : '';
      refocusSoon(); // a stop from the keyboard: the focus comes back after this draw
      var msgHtml = '<p data-flights-rm-msg role="status" tabindex="-1" aria-live="polite" style="margin:8px 0 0;font-size:14px;font-weight:600;min-height:1em;white-space:normal;overflow-wrap:anywhere">' + esc(rmMsgOf(sa)) + '</p>';
      if (!m.rows.length) return UI.empty({ icon: 'mdi:airplane-off', text: T_EMPTY }) + noteHtml + msgHtml; // the feedback outlives the last row
      var rowsHtml = m.rows.map(function (e, i) {
        return (i ? '<div style="height:1px;margin:0 16px;background:currentColor;opacity:.15"></div>' : '')
          + '<div' + (e.key ? ' data-flights-row="' + esc(e.key) + '"' : '') + ' style="display:flex;align-items:center;gap:12px;min-height:52px;box-sizing:border-box;padding:8px 16px">'
          + '<div style="flex:1;min-width:0">'
          + '<div style="font-size:17px;white-space:normal;overflow-wrap:anywhere">' + esc(e.label) + '</div>'
          + (e.detail ? '<div style="font-size:13px;color:var(--secondary-text-color,currentColor);white-space:normal;overflow-wrap:anywhere">' + esc(e.detail) + '</div>' : '')
          + '</div>'
          + (live && e.key && !noStop
            ? '<button type="button" data-flights-stop data-flights-src="' + esc(rs.id) + '" data-flights-row="' + esc(e.key) + '"'
            + ' aria-describedby="flights-stop-help" aria-label="' + esc(tr('Verfolgung beenden')) + ': ' + esc(e.label) + '"'
            + (busy ? ' disabled' : '')
            + ' style="flex:none;font:inherit;font-size:15px;min-height:44px;box-sizing:border-box;padding:0 16px;border-radius:999px;font-weight:600;cursor:pointer;border:1px solid currentColor;background:transparent;color:inherit">'
            + esc(tr('Verfolgung beenden')) + '</button>'
            : '')
          + '</div>';
      }).join('');
      return '<style>[data-flights-stop]:focus-visible{outline:2px solid var(--casora-popup-ui-action,var(--casora-accent,#276B64));outline-offset:2px}</style>'
        + noteHtml
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
  // ── The list popup (casora_popup_flights_list): two or more airborne flights, one full row each ───────────────────
  // Opened from the tile's summary line (F.tapTile), on phone and desktop. A row opens its flight's popup with F.open. The list
  // is the shared rule's order (F.airborne); nothing is sorted or filtered here.
  F.listStage = function (hass, c) {
    var UI = window._casoraUI, n = hass ? F.airborne(hass, c && c.pin, Date.now()).length : 0;
    if (!UI || !n) return '';
    return UI.stage('status', { tone: 'good', icon: 'mdi:airplane', text: summaryText(n) });
  };
  // The list popup that F.openList opened, until the popup closes. Its rows close it once no flight is left.
  var listOpen = false;
  var closeListPopup = function () {
    if (!listOpen) return;
    listOpen = false;
    setTimeout(function () { if (window.casoraPopup) window.casoraPopup.close(); }, 0); // after this render, not inside it
  };
  F.listRows = function (hass, c) {
    var UI = window._casoraUI;
    if (!UI || !hass) return '';
    var rows = F.airborne(hass, c && c.pin, (c && c.now) || Date.now());
    // Nothing left in the air: the list does not stay open as an empty shell. One flight keeps its row.
    if (!rows.length) { closeListPopup(); return UI.empty({ icon: 'mdi:airplane-off', text: T_EMPTY }); }
    // Long text (a route) wraps inside the card: the row may not be wider than the card, and nothing is nowrap.
    var rowStyle = 'display:block;width:100%;max-width:100%;min-width:0;box-sizing:border-box;min-height:52px;padding:12px 16px;margin:0;border:0;background:none;'
      + 'font:inherit;color:inherit;text-align:left;cursor:pointer;white-space:normal;overflow-wrap:anywhere;';
    return '<style>[data-flights-row]:focus-visible{outline:2px solid var(--casora-popup-ui-focus,currentColor);outline-offset:2px}</style>'
      + '<div style="background:var(--casora-popup-row-fill, rgba(255,255,255,0.10));border-radius:var(--casora-popup-row-radius, 20px);overflow:hidden">'
      + rows.map(function (r, i) {
        return (i ? '<div style="height:1px;margin:0 16px;background:currentColor;opacity:.15"></div>' : '') + rowHtml(hass, r, rowStyle);
      }).join('') + '</div>';
  };
  F.listPopup = function (states, hass, vars) {
    var KIT = window._casoraSoftKit, UI = window._casoraUI, S = states || {};
    if (!KIT || !UI || !UI.stage || !hass) return { type: 'vertical-stack', cards: [] };
    var pin = F.setting(), watch = F.watch(hass);
    var cj = JSON.stringify({ pin: pin });
    var card = function (fn) { return { card: KIT.secCard(watch, 'return window._casoraFlights ? window._casoraFlights.' + fn + '(hass, ' + cj + ') : "";', S) }; };
    return KIT.layout({ fields: { stage: card('listStage'), list: card('listRows') }, top: [], stage: 'stage', left: [], right: ['list'] });
  };
  // The tile's tap (phone and desktop): one airborne flight opens its popup (F.open), two or more the list popup. Returns what opened.
  F.tapTile = function (hass) {
    var rows = F.airborne(hass, F.setting(), Date.now());
    if (rows.length === 1) return F.open(hass, rows[0].src, rows[0].key) ? 'flight' : null;
    if (rows.length > 1) return F.openList(hass, rows[0].src) ? 'list' : null;
    return null;
  };
  // The list popup, opened like F.open opens a flight. Ids only: the title is the template's own name (no text in the config).
  F.openList = function (hass, src) {
    if (inStudio() || !hass || !src) return null;
    if (typeof window._casoraNotifyOpenViaCard !== 'function') return null;
    listOpen = true;
    window._casoraNotifyOpenViaCard(src, function () {}, { type: 'custom:button-card', template: 'casora_popup_flights_list', entity: src }, true);
    return true;
  };

  // ── Airborne: what the Flights tile lists ─────────────────────────────────────────────────────────────────────────
  // The one rule for every flight surface (the Flights tile and the flight popup). A flight is listed when its
  // source entry is a live tracked flight with an explicit airborne flag and finite coordinates, and its position has
  // changed while Casora watched. Movement evidence is kept in memory per source and FR24 ID (a new ID is a new flight)
  // and kept across redraws. A new or dropped connection, and a reload, start unverified. Ten minutes without a further
  // observed change hides a flight. A ground flag, a missing entry or invalid data hides it at once and drops its evidence,
  // so a later return must show movement again. Nothing here reads details_updated_at, last_updated, polls or reloads.
  var MOVE_WINDOW = 600000;
  var live = { conn: null, src: {}, kick: null, kickAt: 0 };
  var resetLive = function () { live.src = {}; };
  var watchConn = function (hass) {
    var conn = hass && hass.connection;
    if (!conn || conn === live.conn || typeof conn.addEventListener !== 'function') return;
    live.conn = conn;
    resetLive();
    conn.addEventListener('disconnected', resetLive);
    conn.addEventListener('ready', resetLive);
  };
  var airborneFlag = function (v) { return v === 0 || v === '0' || v === false; };
  var inRange = function (v, max) { return typeof v === 'number' && isFinite(v) && Math.abs(v) <= max; };
  // Stubs (schedule, registration), missing or unknown flags and invalid positions do not qualify. Exactly (0, 0) is no
  // fix (the map leaves it out too), so it does not qualify either: a listed flight always has a point to draw.
  var qualifies = function (f) {
    return str(f.tracked_type) === 'live' && airborneFlag(f.on_ground) && inRange(f.latitude, 90) && inRange(f.longitude, 180)
      && !(f.latitude === 0 && f.longitude === 0);
  };
  // The movement evidence of one source: {FR24 ID: {lat, lon, movedAt}}. Each new state object is read once; the same object
  // again changes nothing. A new position is movement at the time it is seen; the first position is only a baseline.
  var observe = function (hass, id, now) {
    var st = (hass.states || {})[id], s = live.src[id] || (live.src[id] = { st: undefined, recs: {} });
    if (s.st === st) return s.recs;
    s.st = st;
    var flights = !bad(st) && isList((st.attributes || {}).flights) ? st.attributes.flights : [];
    var next = {}, count = {};
    flights.forEach(function (f) {
      var k = idOf(f);
      if (!k) return;
      count[k] = (count[k] || 0) + 1;
      if (!qualifies(f)) return;
      var old = s.recs[k], lat = f.latitude, lon = f.longitude;
      if (!old) next[k] = { lat: lat, lon: lon, movedAt: null };
      else if (old.lat === lat && old.lon === lon) next[k] = old;
      else next[k] = { lat: lat, lon: lon, movedAt: now };
    });
    Object.keys(next).forEach(function (k) { if (count[k] > 1) delete next[k]; }); // a duplicate ID is no flight
    s.recs = next;
    return next;
  };
  // One wake-up at the earliest hide time, so the Flights tile and an open flight popup redraw without a new state.
  // The popup's parts are cards whose code sits in custom_fields (secCard); the tile's code is its state_display.
  var LIVE_CODE = /liveHtml\(|_casoraFlights\.sec\("f(stage|map|prog|move|air|places|times)"|_casoraFlights\.list(Stage|Rows)\(/;
  var liveCard = function (c) {
    var codes = [c && c.state_display].concat(c && c.custom_fields ? Object.keys(c.custom_fields).map(function (k) { return c.custom_fields[k]; }) : []);
    return codes.some(function (x) { return typeof x === 'string' && LIVE_CODE.test(x); });
  };
  var redrawFlights = function () {
    if (!window.casoraKick) return;
    deepAll('button-card').forEach(function (el) {
      if (liveCard(el._config)) window.casoraKick(el);
    });
  };
  var arm = function (at, now) {
    if (live.kick && live.kickAt > now && live.kickAt <= at) return;
    if (live.kick) clearTimeout(live.kick);
    live.kickAt = at;
    live.kick = setTimeout(function () { live.kick = null; redrawFlights(); }, at - now);
  };
  // The flights to show now, in source order: [{src, key, label, route, altitude, speed, vspeed, heading, entry}].
  // Only the selected source counts. The values are formatted with the saved units; the entry keeps the source values.
  var airborneOf = function (hass, id, now, units) {
    watchConn(hass);
    var recs = observe(hass, id, now), out = [], next = null, u = units || F.units();
    flightsOf(hass, id).forEach(function (f) {
      var k = idOf(f), rec = k && recs[k];
      if (!rec || rec.movedAt == null) return;
      var until = rec.movedAt + MOVE_WINDOW;
      if (now >= until) return;
      if (next === null || until < next) next = until;
      out.push({ src: id, key: k, label: labelOf(f), route: routeOf(f), altitude: F.fmt.altitude(f.altitude, u.altitude),
        speed: F.fmt.speed(f.ground_speed, u.speed), vspeed: F.fmt.vspeed(f.vertical_speed, u.vspeed), heading: F.fmt.heading(f.heading), entry: f });
    });
    if (next !== null) arm(next, now);
    return out;
  };
  // units (optional) overrides the saved ones: the Studio's draft in a preview. Only the formatting changes, never the rule.
  F.airborne = function (hass, pin, now, units) {
    if (!hass) return [];
    now = now == null ? Date.now() : now;
    var r = F.resolve(hass, pin);
    if (r.state !== 'pinned' && r.state !== 'auto') return [];
    return airborneOf(hass, r.id, now, units);
  };
  // One flight of one source, by its FR24 ID, if it qualifies now (the popup's and a row's check). Same rule as the tile.
  F.flight = function (hass, src, key, now) {
    if (!hass || !src || !key) return null;
    var rows = airborneOf(hass, String(src), now == null ? Date.now() : now);
    return rows.filter(function (r) { return r.key === String(key); })[0] || null;
  };
  // Shared formatting. Zero is a value; a missing or non-finite reading is left out, never shown as 0. Each unit maps the
  // source value by a factor and rounds to a fixed number of decimals; '' is the source unit.
  var UNIT = {
    altitude: { '': [1, 0, 'ft'], m: [0.3048, 0, 'm'], km: [0.0003048, 1, 'km'] },
    speed: { '': [1, 0, 'kn'], kmh: [1.852, 0, 'km/h'], mph: [1.150779, 0, 'mph'] },
    vspeed: { '': [1, 0, 'ft/min'], ms: [0.00508, 1, 'm/s'] },
  };
  var num = function (v, t) {
    if (typeof v !== 'number' || !isFinite(v)) return '';
    var p = Math.pow(10, t[1]), r = Math.round(v * t[0] * p) / p;
    if (r === 0) r = 0; // no negative zero
    // The shared number format (01-basis.js casoraNum) applies the page locale; this module keeps a local
    // fallback so a unit test can load it alone (the Studio preview never loads these modules).
    var s = window.casoraNum ? window.casoraNum(r, t[1]) : (function () {
      var loc; try { loc = window.casoraLocale ? window.casoraLocale() : undefined; } catch (e) { loc = undefined; }
      return r.toLocaleString(loc, { minimumFractionDigits: t[1], maximumFractionDigits: t[1] });
    })();
    // No-break space: a number and its unit never split across two lines ("9.540 m").
    return s + '\u00a0' + t[2];
  };
  var fmtOf = function (kind, v, unit) { var set = UNIT[kind]; return num(v, set[unit] || set['']); };
  F.fmt = {
    altitude: function (v, unit) { return fmtOf('altitude', v, unit); },
    speed: function (v, unit) { return fmtOf('speed', v, unit); },
    vspeed: function (v, unit) { return fmtOf('vspeed', v, unit); },
    heading: function (v) {
      if (typeof v !== 'number' || !isFinite(v) || v < 0 || v > 360) return '';
      return (Math.round(v) % 360) + '°';
    },
  };
  // ── Timing: destination or origin time, and HA-local time ─────────────────────────────────────────────────────────────
  // FlightRadar24 gives Unix seconds per kind (scheduled, real, estimated) and each airport's offset in seconds (either
  // sign) and abbreviation. The airport clock is that offset applied to the instant (UTC reading, no zone database). The
  // local clock is hass.config.time_zone through Intl; without a usable HA zone no local time is shown, and the browser's
  // zone is never used. A presentation whose airport metadata is missing shows only the local time, labelled as such.
  // Dates appear when the two zone dates of one time differ, and on an arrival also when its day differs from the
  // departure's local day. The suffix (zone name) is optional; the labels never change.
  var TZ_KEY = 'casora_flights_timezones';
  var KIND_WORD = { scheduled: 'Geplant', real: 'Tatsächlich', estimated: 'Voraussichtlich' };
  var MAX_OFF = 50400;
  F.tz = function () { return F.setting(TZ_KEY) === 'true'; }; // a Studio switch: 'true' or unset (off)
  var locale = function () { try { return window.casoraLocale ? window.casoraLocale() : undefined; } catch (e) { return undefined; } };
  var epochMs = function (v) { return typeof v === 'number' && isFinite(v) && v > 0 ? v * 1000 : null; };
  var offsetOk = function (v) { return typeof v === 'number' && isFinite(v) && v % 60 === 0 && Math.abs(v) <= MAX_OFF; };
  var haZone = function (hass) {
    var z = hass && hass.config && hass.config.time_zone;
    if (!z) return null;
    try { new Intl.DateTimeFormat('en-US', { timeZone: String(z) }); return String(z); } catch (e) { return null; }
  };
  var zoneName = function (ms, zone, loc) {
    var p = new Intl.DateTimeFormat(loc, { timeZone: zone, timeZoneName: 'short' }).formatToParts(new Date(ms))
      .filter(function (x) { return x.type === 'timeZoneName'; })[0];
    return p ? p.value : '';
  };
  var utcSuffix = function (off) {
    var m = Math.abs(off) / 60, h = Math.floor(m / 60), mm = m % 60;
    return 'UTC' + (off < 0 ? '-' : '+') + h + (mm ? ':' + (mm < 10 ? '0' : '') + mm : '');
  };
  // One moment in one zone: the clock, the calendar day (for comparing), the short date and the zone name.
  var part = function (ms, z, loc) {
    var zone = z.zone ? { timeZone: z.zone } : { timeZone: 'UTC' }, d = new Date(z.zone ? ms : ms + z.off * 1000);
    var clock = d.toLocaleTimeString(loc, Object.assign({ hour: '2-digit', minute: '2-digit' }, zone));
    var day = new Intl.DateTimeFormat('en-CA', Object.assign({ year: 'numeric', month: '2-digit', day: '2-digit' }, zone)).format(d);
    var date = d.toLocaleDateString(loc, Object.assign({ day: '2-digit', month: '2-digit' }, zone));
    var name = z.zone ? zoneName(ms, z.zone, loc) : (z.abbr || utcSuffix(z.off));
    return { clock: clock, day: day, date: date, name: name };
  };
  // The UTC offset of an HA zone at one instant, in seconds: the zone's wall clock read as UTC, minus the instant.
  var zoneOffset = function (ms, zone) {
    var p = {};
    new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(new Date(ms))
      .forEach(function (x) { p[x.type] = +x.value; });
    return (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000) / 1000;
  };
  // One presentation for one moment: the airport time (label), then the local time. The same UTC offset at that instant
  // collapses to the local time alone. Zone names are never compared. An arrival (arrival = true) also shows its date when
  // one of its presented days differs from the departure's local day (ref).
  var pair = function (hass, ms, f, side, label, tzOn, loc, ref, arrival) {
    var abbr = str(f['airport_' + side + '_timezone_abbr']), off = f['airport_' + side + '_timezone_offset'];
    var air = offsetOk(off) ? part(ms, { off: off, abbr: abbr }, loc) : null;
    var zone = haZone(hass), home = zone ? part(ms, { zone: zone }, loc) : null;
    // With the airport time, the two dates are compared. A local-only time is compared with the other end's local day (ref).
    var dates = air && home ? air.day !== home.day : !!(home && ref && home.day !== ref);
    if (arrival && ref) dates = dates || !!((air && air.day !== ref) || (home && home.day !== ref));
    var line = function (p, word) { return p.clock + (dates ? ' ' + p.date : '') + (tzOn && p.name ? ' ' + p.name : '') + ' ' + tr(word); };
    if (air && home && zoneOffset(ms, zone) === off) return line(home, 'Ortszeit');
    if (air && home) return line(air, label) + ' · ' + line(home, 'Ortszeit');
    if (air) return line(air, label);
    if (home) return line(home, 'Ortszeit');
    return '';
  };
  // Every timestamp the flight has: {dep: [{kind, text}], arr: [{kind, text}]}, scheduled before real before estimated.
  // A missing timestamp is left out; the flight stays. The tile and the popup use this.
  F.times = function (hass, f, tzOn) {
    var out = { dep: [], arr: [] }, loc = locale();
    if (!f || typeof f !== 'object') return out;
    var zone = haZone(hass), KINDS = ['scheduled', 'real', 'estimated'];
    // The first timestamp of a side (the earliest kind the source has): its local day is the other side's reference.
    var first = function (side) {
      for (var i = 0; i < KINDS.length; i++) { var ms = epochMs(f['time_' + KINDS[i] + '_' + side]); if (ms != null) return ms; }
      return null;
    };
    var depMs = first('departure'), arrMs = first('arrival');
    var localDay = function (ms) { return zone && ms != null ? part(ms, { zone: zone }, loc).day : null; };
    [['dep', 'origin', 'Zeit am Abflugort', 'departure', arrMs, false], ['arr', 'destination', 'Zeit am Zielort', 'arrival', depMs, true]].forEach(function (s) {
      KINDS.forEach(function (kind) {
        var ms = epochMs(f['time_' + kind + '_' + s[3]]);
        if (ms == null) return;
        var text = pair(hass, ms, f, s[1], s[2], !!tzOn, loc, localDay(s[4]), s[5]);
        if (text) out[s[0]].push({ kind: kind, text: text });
      });
    });
    return out;
  };
  // The timestamps as rows [label, text] for the details (departure, then arrival); labels are the German words to translate.
  // One row per timestamp the source has: the word for the kind, then the times (origin or destination, and local).
  F.timeRows = function (hass, f, tzOn) {
    var tm = F.times(hass, f, tzOn), rows = [];
    tm.dep.forEach(function (x) { rows.push(['Abflug', tr(KIND_WORD[x.kind]) + ': ' + x.text]); });
    tm.arr.forEach(function (x) { rows.push(['Ankunft', tr(KIND_WORD[x.kind]) + ': ' + x.text]); });
    return rows;
  };
  var estimateOf = function (hass, f) {
    var hit = F.times(hass, f, F.tz()).arr.filter(function (x) { return x.kind === 'estimated'; })[0];
    return hit ? hit.text : '';
  };

  // The progress bar: a track of height h (px) with the fill at pct %, below a top margin of m (px). The fill is a span, so it
  // sits in a button as well. The bar is a picture: its callers hide it from screen readers.
  var progressBar = function (pct, h, m) {
    return '<span style="display:block;position:relative;height:' + h + 'px;margin-top:' + m + 'px;border-radius:' + (h / 2)
      + 'px;overflow:hidden;opacity:.9;background:rgba(127,127,127,0.3)"><span data-flights-bar style="position:absolute;left:0;top:0;bottom:0;width:'
      + esc(pct) + '%;background:currentColor"></span></span>';
  };
  // One flight as a button, the list popup's full row (a progress text line and a decorative bar). A browser drops a role
  // on anything inside a button, so no progressbar here.
  var rowHtml = function (hass, r, style) {
    var extra = [r.altitude, r.speed].filter(Boolean).join(' · ');
    var eta = estimateOf(hass, r.entry), pct = F.progressOf(r.entry);
    var subHtml = function (textHtml) { return '<br><span style="color:var(--secondary-text-color,currentColor);white-space:normal;overflow-wrap:anywhere">' + textHtml + '</span>'; };
    var barHtml = '';
    if (pct != null) {
      // The same value as a bar; decorative, the text line above is the one screen readers get.
      barHtml = subHtml(esc(tr('Ungefährer Fortschritt')) + ': ' + esc(pctText(pct))) + '<span aria-hidden="true">' + progressBar(pct, 4, 6) + '</span>';
    }
    return '<button type="button" data-flights-row data-flights-src="' + esc(r.src) + '" data-flights-key="' + esc(r.key)
      + '" data-flights-label="' + esc(r.label) + '" style="' + esc(style) + '">' + esc(r.label) + (r.route ? ' · ' + esc(r.route) : '')
      + (extra ? subHtml(esc(extra)) : '')
      + (eta ? subHtml(esc(tr('Voraussichtliche Ankunft')) + ': ' + esc(eta)) : '')
      + barHtml + '</button>';
  };
  // The summary line: "N in the air". The whole tile is one button then (F.tapTile opens the list popup).
  var summaryText = function (n) { return tr(n + ' in der Luft'); };
  F.liveHtml = function (hass, pin, now, name) {
    var flights = F.airborne(hass, pin, now);
    if (!flights.length) return '';
    // One flight or more, phone and desktop: one line, the state. The tile shows no flight details (the list popup and the
    // flight popup do), so the tile keeps casora_entity's own layout: icon, name, state.
    return '<casora-flight-list data-flights-sum data-name="' + esc(tr(name || '')) + '" style="display:block;height:100%;max-height:100%;overflow:hidden;white-space:normal;overflow-wrap:anywhere">'
      + esc(summaryText(flights.length)) + '</casora-flight-list>';
  };
  // Phone check: the tile CSS's own media query (PHONE_MQ), so this and the CSS switch at the same width.
  F.phone = function () { return !!(window.matchMedia && window.matchMedia(PHONE_MQ).matches); };
  F.liveHidden = function (hass, now) { return !F.airborne(hass, F.setting(), now).length; };

  // ── Map and approximate progress: one presentation for the popup and the tile line ───────────
  // F.mapView is the selected flight now, from the shared rule (F.flight): no marker, trail or progress for a flight that
  // does not qualify. Positions are [lat, lon]; a missing, non-finite, out-of-range or exactly (0, 0) point is left out,
  // never drawn at zero. Progress is great-circle distance only: origin→current over origin→current plus current→destination,
  // in whole percent, bounded. It is not elapsed time and not the flown path; it is omitted when a point is missing or the
  // two airports lie within a kilometre of each other.
  var R_KM = 6371, MIN_ROUTE_KM = 1;
  var pointOk = function (p) {
    if (!isList(p) || p.length < 2) return false;
    var la = p[0], lo = p[1];
    return typeof la === 'number' && typeof lo === 'number' && isFinite(la) && isFinite(lo)
      && Math.abs(la) <= 90 && Math.abs(lo) <= 180 && !(la === 0 && lo === 0);
  };
  var pointOf = function (lat, lon) { return pointOk([lat, lon]) ? [lat, lon] : null; };
  // Great-circle distance in km. The longitude difference enters through sines, so the dateline needs no special case.
  F.distanceKm = function (a, b) {
    var rad = Math.PI / 180, dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
  };
  // One point per ROUTE_STEP_KM of the route, at least ROUTE_MIN_POINTS (a short route still bends) and at most ROUTE_MAX_POINTS.
  var ROUTE_STEP_KM = 150, ROUTE_MIN_POINTS = 8, ROUTE_MAX_POINTS = 64;
  // The Remaining route: points [lat, lon] along the great circle from `a` (the aircraft) to `b` (the destination), shared by
  // the popup and the screensaver. First point a, last point b; longitudes are continuous (they may run past 180 or below
  // -180 instead of jumping back, so a flight over the date line stays one line). Empty for a missing or invalid point, the
  // same point, or under a kilometre. Near-opposite points have no single shortest path: any path is finite and ends right.
  F.greatCircle = function (a, b) {
    if (!pointOk(a) || !pointOk(b)) return [];
    var km = F.distanceKm(a, b);
    if (!(km >= MIN_ROUTE_KM)) return [];
    var rad = Math.PI / 180, deg = 180 / Math.PI;
    var vec = function (p) { var la = p[0] * rad, lo = p[1] * rad; return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)]; };
    var va = vec(a), vb = vec(b);
    var dot = Math.max(-1, Math.min(1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]));
    var ang = Math.acos(dot), sin = Math.sin(ang);
    var n = Math.min(ROUTE_MAX_POINTS, Math.max(ROUTE_MIN_POINTS, Math.ceil(km / ROUTE_STEP_KM)));
    // Within about a metre of the antipode the slerp weights blow up: the steps run straight in latitude and longitude.
    var flat = !(sin > 1e-7);
    var out = [[a[0], a[1]]], prev = a[1];
    for (var i = 1; i < n; i++) {
      var t = i / n, lat, lon;
      if (flat) { lat = a[0] + t * (b[0] - a[0]); lon = a[1] + t * (b[1] - a[1]); }
      else {
        var wa = Math.sin((1 - t) * ang) / sin, wb = Math.sin(t * ang) / sin;
        var x = wa * va[0] + wb * vb[0], y = wa * va[1] + wb * vb[1], z = wa * va[2] + wb * vb[2];
        lat = Math.atan2(z, Math.sqrt(x * x + y * y)) * deg; lon = Math.atan2(y, x) * deg;
      }
      while (lon - prev > 180) lon -= 360;
      while (lon - prev < -180) lon += 360;
      if (!isFinite(lat) || !isFinite(lon)) return [];
      out.push([lat, lon]); prev = lon;
    }
    var end = b[1];
    while (end - prev > 180) end -= 360;
    while (end - prev < -180) end += 360;
    out.push([b[0], end]);
    return out;
  };
  F.progress = function (o, c, d) {
    if (!o || !c || !d) return null;
    if (F.distanceKm(o, d) < MIN_ROUTE_KM) return null; // coincident airports: nothing to measure along
    var a = F.distanceKm(o, c), b = F.distanceKm(c, d), s = a + b;
    if (!(s > 0) || !isFinite(s)) return null;
    return Math.min(100, Math.max(0, Math.round(a / s * 100)));
  };
  F.progressOf = function (f) {
    if (!f || typeof f !== 'object') return null;
    return F.progress(pointOf(f.airport_origin_latitude, f.airport_origin_longitude), pointOf(f.latitude, f.longitude),
      pointOf(f.airport_destination_latitude, f.airport_destination_longitude));
  };
  // The available trail of one flight: its coordinates list (oldest first), valid points only, no repeats in a row.
  F.trailOf = function (f) {
    var out = [];
    (f && isList(f.coordinates) ? f.coordinates : []).forEach(function (p) {
      if (!pointOk(p)) return;
      var last = out[out.length - 1];
      if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push([p[0], p[1]]);
    });
    return out;
  };
  // The same place with its longitude shifted by whole turns to lie within 180 degrees of `ref`.
  var lonNear = function (ref, lon) {
    while (lon - ref > 180) lon -= 360;
    while (lon - ref < -180) lon += 360;
    return lon;
  };
  F.lonNear = lonNear; // for the globe's glide (46-screensaver.js)
  // The view's longitudes are continuous with the aircraft's (they may pass 180 or -180 over the date line), so one line or
  // one box never spans the world the long way. Trail: each point follows the next, from the aircraft back. Origin: follows
  // the trail's start. Route and destination: the great circle starts at the aircraft, and its end is the destination.
  var continuous = function (cur, trail, origin, destination) {
    var out = [], next = cur[1];
    for (var i = trail.length - 1; i >= 0; i--) { next = lonNear(next, trail[i][1]); out.unshift([trail[i][0], next]); }
    var route = destination ? F.greatCircle(cur, destination) : [];
    var end = route.length ? route[route.length - 1] : destination ? [destination[0], lonNear(cur[1], destination[1])] : null;
    return { trail: out, origin: origin ? [origin[0], lonNear(next, origin[1])] : null, route: route, destination: end };
  };
  // The Unreported part: the great circle (F.greatCircle, so the same continuous longitudes) from the departure airport to the
  // oldest point of the Flown trail, fainter than the trail on both flat maps. Empty without the origin or without any trail
  // point. The view keeps the arc it was built with (`unreported`), so it stays put while the arrow glides and the trail's end
  // is cut back: the arc ends at the trail's start, never at the drawn arrow.
  F.unreportedOf = function (v) {
    if (!v) return [];
    if (v.unreported) return v.unreported;
    if (!(v.origin && v.trail && v.trail.length)) return [];
    var a = v.origin, b = v.trail[0], direct = F.greatCircle(a, b);
    if (direct.length || !(F.distanceKm(a, b) >= MIN_ROUTE_KM)) return direct; // under a kilometre is no arc, not an invalid point
    // The view's longitudes may lie past 180 or -180 (continuous over the date line), which greatCircle takes for invalid:
    // draw the arc between the same places with plain longitudes, then shift it so that it ends at the trail's start as given.
    var arc = F.greatCircle([a[0], lonNear(0, a[1])], [b[0], lonNear(0, b[1])]);
    if (!arc.length) return [];
    var shift = b[1] - arc[arc.length - 1][1];
    return shift === 0 ? arc : arc.map(function (p) { return [p[0], p[1] + shift]; });
  };
  F.mapView = function (hass, src, key, now) {
    var row = F.flight(hass, src, key, now);
    if (!row) return null;
    var f = row.entry, cur = pointOf(f.latitude, f.longitude);
    if (!cur) return null;
    var o = pointOf(f.airport_origin_latitude, f.airport_origin_longitude);
    var d = pointOf(f.airport_destination_latitude, f.airport_destination_longitude);
    var c = continuous(cur, F.trailOf(f), o, d);
    return { key: row.key, label: row.label, cur: cur, heading: typeof f.heading === 'number' && f.heading >= 0 && f.heading <= 360 ? f.heading : null,
      origin: c.origin, destination: c.destination, trail: c.trail, route: c.route, originCode: airport(f, 'origin'), destinationCode: airport(f, 'destination'),
      unreported: F.unreportedOf({ origin: c.origin, trail: c.trail }), progress: F.progress(o, cur, d) };
  };
  // GeoJSON for the map layers ([lon, lat]): the trail as one line ending at the marker, the Remaining route as one line
  // from the marker to the destination, the airports, the aircraft.
  F.mapGeo = function (v) {
    var fc = function (features) { return { type: 'FeatureCollection', features: features }; };
    var pt = function (p, props) { return { type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: [p[1], p[0]] } }; };
    var lineOf = function (points) {
      return points.length >= 2 ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: points.map(function (p) { return [p[1], p[0]]; }) } }] : [];
    };
    if (!v) return { trail: fc([]), route: fc([]), unreported: fc([]), points: fc([]) };
    var pts = [];
    if (v.origin) pts.push(pt(v.origin, { role: 'airport', arrow: 0, code: v.originCode || '' }));
    if (v.destination) pts.push(pt(v.destination, { role: 'airport', arrow: 0, code: v.destinationCode || '' }));
    pts.push(pt(v.cur, { role: 'aircraft', arrow: v.heading == null ? 0 : 1, heading: v.heading == null ? 0 : v.heading }));
    var line = v.trail.slice();
    var last = line[line.length - 1];
    if (!last || last[0] !== v.cur[0] || last[1] !== v.cur[1]) line.push(v.cur);
    return { trail: fc(lineOf(line)), route: fc(lineOf(v.route)), unreported: fc(lineOf(F.unreportedOf(v))), points: fc(pts) };
  };
  // The box that holds every point of the view: [[west, south], [east, north]], or null.
  F.mapBounds = function (v) {
    if (!v) return null;
    // The route's points end at the destination, so the box holds the whole curve; the destination itself is added for a
    // view without a route (under a kilometre away).
    var pts = [v.cur].concat(v.trail, v.origin ? [v.origin] : [], v.destination ? [v.destination] : [], v.route, F.unreportedOf(v));
    var lat = pts.map(function (p) { return p[0]; }), lon = pts.map(function (p) { return p[1]; });
    return [[Math.min.apply(null, lon), Math.min.apply(null, lat)], [Math.max.apply(null, lon), Math.max.apply(null, lat)]];
  };
  // ── The glide: the popup's arrow moves from the old reported fix to the new one ────────────────────────────────────────
  // F.glide(g, now, reduce) → {cur, heading, done}: where the arrow is drawn at `now`. g = {from: {cur, heading}, to: {cur,
  // heading}, start, dur}: the fixes are [lat, lon] and a heading in degrees (or null), start the time Casora saw the new
  // fix and dur the measured time between the last two updates. Straight line in latitude and longitude between the fixes
  // (no prediction from speed or heading), so it is never beyond the newest fix: before the start it is the old fix, at and
  // after the end exactly the new one. Longitude runs continuous (the date line is no jump); the heading turns the short way.
  // Where a glide would show something untrue, the new fix comes at once: `cannotGlide` is the one place for the cases that depend on
  // the glide itself (reduced motion, no old fix, no usable duration); `badPollStep` (below, used by F.track) is the one place for the
  // cases that depend on the poll history (a long gap, a step no aircraft could fly). Without a new fix there is nothing to draw: null.
  var cannotGlide = function (g, reduce) { return !!reduce || !g.from || !(g.dur > 0) || !isFinite(g.dur); };
  // How far a glide has come at `now`: 0 before its start, 1 at and after its end.
  F.glideT = function (g, now) {
    var t = (now - g.start) / g.dur;
    return t > 0 ? Math.min(1, t) : 0;
  };
  F.glide = function (g, now, reduce) {
    var to = g && g.to;
    if (!to) return null;
    var atEnd = { cur: [to.cur[0], to.cur[1]], heading: to.heading, done: true };
    if (cannotGlide(g, reduce)) return atEnd;
    var t = F.glideT(g, now);
    if (t >= 1) return atEnd;
    var from = g.from, lon0 = lonNear(to.cur[1], from.cur[1]);
    var heading = to.heading;
    if (typeof to.heading === 'number' && typeof from.heading === 'number') {
      var turn = ((to.heading - from.heading + 540) % 360) - 180;
      heading = (from.heading + turn * t + 360) % 360;
    }
    return { cur: [from.cur[0] + (to.cur[0] - from.cur[0]) * t, lon0 + (to.cur[1] - lon0) * t], heading: heading, done: false };
  };
  // The view with the aircraft drawn at `pos` (a glide in progress): the Flown trail ends at the arrow (a reported fix at the
  // trail's end is not drawn ahead of it) and the Remaining route starts there. At the reported fix itself the view is as it was.
  // The route is cut again from `pos` every call (at most ROUTE_MAX_POINTS points of trigonometry, well under a millisecond), so
  // each frame of a glide costs the arrow, the trail end and that one route; the view itself is built once per poll.
  F.mapViewAt = function (v, pos, heading) {
    if (!v) return v;
    if (pos[0] === v.cur[0] && pos[1] === v.cur[1] && heading === v.heading) return v;
    var trail = v.trail.slice(), last = trail[trail.length - 1];
    if (last && last[0] === v.cur[0] && last[1] === v.cur[1]) trail.pop();
    var route = v.destination ? F.greatCircle(pos, v.destination) : [];
    var out = {}; for (var k in v) out[k] = v[k];
    out.cur = pos; out.heading = heading; out.trail = trail; out.route = route;
    return out;
  };
  // The pure state step of the glide. state is null or what the last call returned; view is F.mapView's view (or null);
  // ident names the flight (source and key). Returns {state, view, gliding}: the new state, the view to draw now (the arrow
  // at its drawn position while a glide runs) and whether a glide is running (the caller keeps asking for frames).
  // state = {ident, cur, heading, at, interval, gapped, glide}: the newest reported fix, the time of the last real update (null
  // until one was seen: the first fix after opening is no update), the measured time between the last two updates (the
  // normal poll; null until two were seen), whether the last update was a gap jump, and the glide in progress.
  // A poll with the same position and heading is not an update: the sensor state also changes for other reasons (altitude,
  // speed), and counting those would shorten the interval and the glide would end before the next fix.
  // The first update after opening has no earlier update to measure against, so it is drawn as reported; the second one is the
  // first that glides, over the time between the two. A change of flight starts again.
  // Two more cases jump (`badPollStep`): a gap over GAP_FACTOR x the normal poll (the old fix is stale), and a step longer than an
  // aircraft could fly in that time (bad data). A jump for a gap keeps the earlier interval as the normal poll; the gap is not
  // one, and taking it would make the next glide as long as the gap. But a second gap jump in a row (`gapped`) means the poll
  // got slower for good: the latest gap becomes the normal poll, and the third update at the new rate glides. A jump for a step
  // is a normal poll and sets the interval. The second update after opening has no interval yet, so no gap check is possible:
  // its glide runs over the measured time between the first two updates.
  var GAP_FACTOR = 3;
  // Fixed upper limit for the ground speed, well above any airliner (about 1100 km/h with a strong tailwind). It is not the
  // flight's reported speed: that needs no new HA data this way, and a bad speed value could not widen the limit.
  var MAX_SPEED_KMH = 1500;
  // Steps closer in time than this count as this long: poll jitter (two updates a second apart) is not bad data.
  var MIN_STEP_MS = 10000;
  // → {gap, step}: the new fix is too long after the last update for the old one to be current, and/or too far for the time.
  var badPollStep = function (here, to, gap, interval) {
    var km = F.distanceKm(here, to);
    return { gap: interval > 0 && gap > GAP_FACTOR * interval, step: km > MAX_SPEED_KMH * Math.max(gap, MIN_STEP_MS) / 3600000 };
  };
  F.track = function (state, view, ident, now, reduce) {
    if (!view) return { state: null, view: null, gliding: false };
    if (!state || state.ident !== ident) {
      return { state: { ident: ident, cur: view.cur, heading: view.heading, at: null, interval: null, gapped: false, glide: null }, view: view, gliding: false };
    }
    var st = { ident: ident, cur: state.cur, heading: state.heading, at: state.at, interval: state.interval, gapped: state.gapped, glide: state.glide };
    if (st.cur[0] !== view.cur[0] || st.cur[1] !== view.cur[1] || st.heading !== view.heading) {
      var here = st.glide ? F.glide(st.glide, now, reduce) : { cur: st.cur, heading: st.heading };
      if (st.at != null) {
        var gap = now - st.at, bad = badPollStep(here.cur, view.cur, gap, st.interval);
        if (!bad.gap || st.gapped) st.interval = gap;
        st.gapped = bad.gap && !st.gapped;
        st.glide = bad.gap || bad.step ? null : { from: { cur: here.cur, heading: here.heading }, to: { cur: view.cur, heading: view.heading }, start: now, dur: gap };
      } else st.glide = null;
      st.at = now; st.cur = view.cur; st.heading = view.heading;
    }
    var at = st.glide ? F.glide(st.glide, now, reduce) : null;
    if (!at || at.done) { st.glide = null; return { state: st, view: view, gliding: false }; }
    return { state: st, view: F.mapViewAt(view, at.cur, at.heading), gliding: true };
  };
  F.MAP = { READY_MS: 12000, TICK_MS: 1000 };
  // The Remaining route's look, for MapLibre and Leaflet alike: a light dashed line (thinner than the Flown trail) over a dark
  // dashed casing; dash and gap are DASH px each.
  var ROUTE_STYLE = { width: 2, casingWidth: 4, casingOpacity: 0.6, dash: 6 };
  var UNREPORTED_OPACITY = 0.45; // the Unreported part: the Flown trail's white, fainter
  F.ROUTE_STYLE = ROUTE_STYLE; // the screensaver draws its line in the same proportions
  var EMPTY = { type: 'FeatureCollection', features: [] };
  var hassNow = function () { var ha = document.querySelector('home-assistant'); return ha && ha.hass; };
  var MAP_CSS = '.maplibregl-ctrl-top-left,.maplibregl-ctrl-top-right,.maplibregl-ctrl-bottom-left,.maplibregl-ctrl-scale,.maplibregl-ctrl-attrib-button{display:none!important}'
    + '.maplibregl-ctrl-bottom-right{right:0;bottom:0}'
    // MapLibre and Leaflet (HA's ha-map when the browser has no WebGL2) attribution: one selector list per rule.
    + '.maplibregl-ctrl-attrib,.leaflet-control-attribution{font-size:12px!important;line-height:1.3!important;padding:2px 6px!important;margin:0!important;min-height:0!important;border-radius:6px!important;background:#fff!important;color:#212121!important;pointer-events:auto!important;z-index:2!important}'
    + '.maplibregl-ctrl-attrib a,.leaflet-control-attribution a{color:inherit!important;text-decoration:underline}'
    + '.maplibregl-ctrl-attrib a:focus-visible,.leaflet-control-attribution a:focus-visible{outline:2px solid currentColor;outline-offset:2px}'
    + '.maplibregl-ctrl-attrib .maplibregl-ctrl-attrib-inner{display:block!important}'
    // Leaflet zoom and scale hidden, as in 12-tanken.js.
    + '.leaflet-control-zoom,.leaflet-control-scale{display:none!important}';
  // The saver's map takes no pointer input at all, its attribution link included: a tap must reach the saver and wake the dashboard.
  var SAVER_CSS = '.maplibregl-ctrl-attrib,.maplibregl-ctrl-attrib a,.leaflet-control-attribution,.leaflet-control-attribution a{pointer-events:none!important}';
  // The arrow points north at heading 0; MapLibre turns it clockwise on the map. Drawn on a canvas: no file or URL loads.
  var arrowImage = function (ml) {
    try {
      var c = document.createElement('canvas'); c.width = c.height = 32;
      var g = c.getContext && c.getContext('2d');
      if (!g) return false;
      g.beginPath(); g.moveTo(16, 3); g.lineTo(27, 28); g.lineTo(16, 22); g.lineTo(5, 28); g.closePath();
      g.fillStyle = '#ffffff'; g.fill(); g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,0.8)'; g.stroke();
      ml.addImage('casora-flight-arrow', g.getImageData(0, 0, 32, 32));
      return true;
    } catch (e) { return false; /* no canvas: the aircraft stays a circle */ }
  };
  var addLayers = function (ml) {
    ml.addSource('casora-flight-trail', { type: 'geojson', data: EMPTY });
    ml.addSource('casora-flight-unreported', { type: 'geojson', data: EMPTY });
    ml.addSource('casora-flight-route', { type: 'geojson', data: EMPTY });
    ml.addSource('casora-flight-points', { type: 'geojson', data: EMPTY });
    var arrow = arrowImage(ml);
    // The Remaining route first, so it lies under the trail, the airports and the aircraft. MapLibre counts dash lengths in line
    // widths, so the line and its wider casing get the same dash in pixels.
    // The Unreported part below even that: the trail's white at 45 % opacity, solid, on a dark casing like the trail's (it reads on light tiles).
    ml.addLayer({ id: 'casora-flight-unreported-casing', type: 'line', source: 'casora-flight-unreported', layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#000000', 'line-opacity': 0.6, 'line-width': 5 } });
    ml.addLayer({ id: 'casora-flight-unreported', type: 'line', source: 'casora-flight-unreported', layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ffffff', 'line-opacity': UNREPORTED_OPACITY, 'line-width': 2.5 } });
    ml.addLayer({ id: 'casora-flight-route-casing', type: 'line', source: 'casora-flight-route', layout: { 'line-join': 'round' },
      paint: { 'line-color': '#000000', 'line-opacity': ROUTE_STYLE.casingOpacity, 'line-width': ROUTE_STYLE.casingWidth,
        'line-dasharray': [ROUTE_STYLE.dash / ROUTE_STYLE.casingWidth, ROUTE_STYLE.dash / ROUTE_STYLE.casingWidth] } });
    ml.addLayer({ id: 'casora-flight-route', type: 'line', source: 'casora-flight-route', layout: { 'line-join': 'round' },
      paint: { 'line-color': '#ffffff', 'line-width': ROUTE_STYLE.width,
        'line-dasharray': [ROUTE_STYLE.dash / ROUTE_STYLE.width, ROUTE_STYLE.dash / ROUTE_STYLE.width] } });
    // Dark casing under a light line: visible on light and dark map tiles alike.
    ml.addLayer({ id: 'casora-flight-trail-casing', type: 'line', source: 'casora-flight-trail', layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#000000', 'line-opacity': 0.6, 'line-width': 5 } });
    ml.addLayer({ id: 'casora-flight-trail', type: 'line', source: 'casora-flight-trail', layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ffffff', 'line-width': 2.5 } });
    ml.addLayer({ id: 'casora-flight-airports', type: 'circle', source: 'casora-flight-points', filter: ['==', ['get', 'role'], 'airport'],
      paint: { 'circle-radius': 4, 'circle-color': '#ffffff', 'circle-stroke-color': '#000000', 'circle-stroke-width': 1.5 } });
    ml.addLayer({ id: 'casora-flight-aircraft', type: 'circle', source: 'casora-flight-points', filter: ['==', ['get', 'role'], 'aircraft'],
      paint: { 'circle-radius': 7, 'circle-color': '#ffcc00', 'circle-stroke-color': '#000000', 'circle-stroke-width': 2 } });
    if (arrow) {
      ml.addLayer({ id: 'casora-flight-arrow', type: 'symbol', source: 'casora-flight-points', filter: ['==', ['get', 'arrow'], 1],
        layout: { 'icon-image': 'casora-flight-arrow', 'icon-rotate': ['get', 'heading'], 'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-size': 0.6 } });
    }
  };
  // The device asks for reduced motion (false when the browser cannot say).
  var reducedMotion = function () {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
  };
  var defineMap = function () {
    if (!window.customElements || customElements.get('casora-flight-map')) return;
    class FlightMap extends HTMLElement {
      connectedCallback() {
        // Only the properties the element needs: the popup's own box (its 4:3 aspect ratio) stays, so the box has a height.
        // The screensaver's map (data-saver, 46-screensaver.js) has its box from the saver's stylesheet and takes no pointer input.
        this._saver = !!(this.hasAttribute && this.hasAttribute('data-saver'));
        this.style.display = 'block'; this.style.overflow = 'hidden';
        if (this._saver) this.style.pointerEvents = 'none'; // the corners come from the saver's stylesheet (.cs-fl-live)
        else { this.style.borderRadius = 'inherit'; this.style.position = 'relative'; this.style.width = '100%'; }
        this._since = Date.now(); this._tiles = 0; this._ml = this._el = this._timer = null; this._layers = false; this._ok = false;
        this._sent = null; this._ident = null; this._track = this._base = null; this._raf = 0;
        var H = window._casoraHaMap, hass = hassNow();
        // HA's map service and ha-map are the only map there is; without them the text stays and this element hides.
        if (!H || !hass || !H.ok()) { this._fail(); return; }
        H.defined().then((ok) => {
          if (!this.isConnected) return;
          if (!ok) { this._fail(); return; }
          this._build(hass);
        });
      }
      disconnectedCallback() {
        this._stop(); this._stopFrames(); this._track = this._base = null;
        if (this._mo) { this._mo.disconnect(); this._mo = null; }
        if (this._el && this._el.remove) this._el.remove();
        if (this._svg && this._svg.remove) this._svg.remove();
        this._el = this._ml = this._lm = this._svg = null; this._layers = this._ok = false; this._sent = this._ident = null;
        this._svgHtml = null;
      }
      _build(hass) {
        var m = document.createElement('ha-map');
        m._connection = { connection: hass.connection, hassUrl: function (u) { return hass.hassUrl ? hass.hassUrl(u) : u; } };
        m.entities = []; m.themeMode = this._saver ? 'dark' : 'auto'; m.zoom = 8; // themeMode: the saver is always a dark scene; the popup follows the theme
        m.interactiveZones = false; m.autoFit = false; m.clusterMarkers = false;
        // The map fills the box. The fade is off for reduced motion. The map is not inert: inert would also take the attribution
        // link out of reach. Instead the map takes no pointer input (pointer-events none), and its attribution link is the one
        // part that does (MAP_CSS), so it can be clicked and reached by Tab. The host is role="group" (fmap), not "img",
        // so that link is not nested inside an img role (axe: nested-interactive).
        var reduce = reducedMotion();
        m.style.position = 'absolute'; m.style.top = '0'; m.style.left = '0'; m.style.width = '100%'; m.style.height = '100%';
        m.style.opacity = '0'; m.style.transition = reduce ? 'none' : 'opacity .35s ease';
        m.style.pointerEvents = 'none';
        // Hidden until ready: a hidden box takes its links and canvas out of the Tab order (the popup counts them by
        // their visibility, casora-core _focusables). The ready step below shows it again.
        m.style.visibility = 'hidden';
        this.appendChild(m); this._el = m;
        if (m.shadowRoot) this._css(m.shadowRoot);
        this._watch(m.shadowRoot);
        this._timer = setInterval(() => this._poll(), F.MAP.TICK_MS);
      }
      // The map's canvas and zoom controls keep tabindex 0. The popup's Tab handling counts them as stops (casora-core.js
      // _focusables), so Tab from Close would leave the popup: take them out of the tab order. The attribution link stays.
      // Both renderers are handled: MapLibre (its own map) and Leaflet (HA's ha-map when the browser has no WebGL2). The MapLibre class
      // alone does not match the Leaflet attribution, so both classes are listed.
      _unstop(root) {
        root.querySelectorAll('*').forEach((x) => {
          if (!this._saver && x.closest && x.closest('.maplibregl-ctrl-attrib, .leaflet-control-attribution')) { // the saver's map has no stop at all
            // Leaflet's "Leaflet" prefix link stays visible, but it is not a stop; the credit links are.
            if (x.matches('a[href]') && /leafletjs\.com/.test(x.getAttribute('href'))) x.setAttribute('tabindex', '-1');
            return;
          }
          if (x.matches('a[href],button,input,select,textarea,[tabindex]') && x.tabIndex >= 0) x.setAttribute('tabindex', '-1');
          if (x.shadowRoot) this._unstop(x.shadowRoot);
        });
      }
      _poll() {
        if (!this.isConnected) { this._stop(); return; }
        if (this._el && this._el.shadowRoot) this._unstop(this._el.shadowRoot);
        var H = window._casoraHaMap, ml = H && this._el ? H.ml(this._el) : null, hass = hassNow();
        // No MapLibre map: HA's ha-map may draw with Leaflet (browsers without WebGL2). Its own handle, drawn on its pixels.
        var lm = !ml && H && H.lf && this._el ? H.lf(this._el) : null;
        if (lm) { this._pollLeaflet(lm, hass); return; }
        if (!ml) { if (Date.now() - this._since > F.MAP.READY_MS) this._fail(); return; }
        if (!this._ml) {
          this._ml = ml;
          ['dragPan', 'scrollZoom', 'boxZoom', 'doubleClickZoom', 'touchZoomRotate', 'keyboard', 'dragRotate', 'touchPitch'].forEach(function (x) {
            if (ml[x] && ml[x].disable) ml[x].disable();
          });
          if (this._el.shadowRoot) this._css(this._el.shadowRoot);
          ml.on('data', (e) => { if (e && e.tile && (!e.tile.state || e.tile.state === 'loaded')) this._tiles++; });
        }
        if (!this._layers && ml.isStyleLoaded && ml.isStyleLoaded()) { addLayers(ml); this._layers = true; }
        if (this._layers && hass) this._sync(hass);
        if (!this._ok && this._layers && this._tiles > 0 && ml.loaded()) { this._ok = true; this._el.style.opacity = '1'; this._el.style.visibility = ''; }
        if (!this._ok && Date.now() - this._since > F.MAP.READY_MS) this._fail();
      }
      // Leaflet: the same steps as on MapLibre. The flight is drawn as an SVG overlay over the map, in the map's own pixels
      // (as the fuel prices map draws its pins), so no Leaflet layer is needed. Ready: tiles loaded (counted as there) and the overlay set.
      _pollLeaflet(lm, hass) {
        if (!this._lm) {
          this._lm = lm;
          ['dragging', 'touchZoom', 'doubleClickZoom', 'scrollWheelZoom', 'boxZoom', 'keyboard', 'tap'].forEach(function (x) {
            if (lm[x] && lm[x].disable) lm[x].disable();
          });
          // As on MapLibre: a shadow root that was missing at build is styled now.
          if (this._el.shadowRoot) { this._css(this._el.shadowRoot); this._watch(this._el.shadowRoot); }
        }
        // Every tile layer is counted, also one added after the first poll. A layer is hooked once.
        var self = this;
        if (!this._hooked) this._hooked = new WeakSet();
        lm.eachLayer(function (l) {
          if (!l.on || !l.getTileUrl || self._hooked.has(l)) return;
          self._hooked.add(l);
          l.on('tileload', function () { self._tiles++; });
        });
        if (!this._layers) {
          this._layers = true;
          var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          svg.setAttribute('aria-hidden', 'true');
          // Same box and fade as the map; no tabindex, so the overlay is no Tab stop.
          svg.style.position = 'absolute'; svg.style.top = '0'; svg.style.left = '0'; svg.style.width = '100%'; svg.style.height = '100%';
          svg.style.pointerEvents = 'none'; svg.style.overflow = 'hidden';
          // Below the attribution box (MAP_CSS z-index 2), so the overlay does not paint over it.
          svg.style.zIndex = '1';
          svg.style.opacity = '0'; svg.style.visibility = 'hidden'; svg.style.transition = this._el.style.transition;
          this.appendChild(svg); this._svg = svg;
        }
        if (hass) this._syncLeaflet(hass, lm);
        if (!this._ok && this._tiles > 0) { this._ok = true; this._showMap(); }
        if (!this._ok && Date.now() - this._since > F.MAP.READY_MS) this._fail();
      }
      // Stops that the map adds to its own content later are taken out when they appear, not only on the next poll.
      // Set up once per element: at build, or on the first Leaflet poll when the shadow root came later.
      _watch(root) {
        if (this._mo || !root || !window.MutationObserver) return;
        this._mo = new MutationObserver(() => this._unstop(root));
        this._mo.observe(root, { childList: true, subtree: true });
      }
      // The map and its overlay become visible together.
      _showMap() {
        this._el.style.opacity = '1'; this._el.style.visibility = '';
        this._svg.style.opacity = '1'; this._svg.style.visibility = '';
      }
      _syncLeaflet(hass, lm) {
        var key = this.getAttribute('data-key'), src = this.getAttribute('data-src');
        var v = F.mapView(hass, src, key, Date.now());
        var ident = v ? src + '|' + v.key : null;
        this._base = v ? { v: v, ident: ident } : null; // built once per poll; the frames of a glide reuse it
        v = this._advance(Date.now());
        // Fit once per flight. A map without a size gives a wrong zoom, so the fit waits for one.
        var size = lm.getSize ? lm.getSize() : null;
        var fit = !!ident && ident !== this._ident && !!size && size.x > 0 && size.y > 0;
        // F.mapBounds is [[lon, lat], [lon, lat]] (MapLibre); Leaflet wants [[lat, lng], [lat, lng]].
        if (fit) {
          var b = F.mapBounds(v);
          lm.invalidateSize({ animate: false });
          lm.fitBounds([[b[0][1], b[0][0]], [b[1][1], b[1][0]]], { padding: [36, 36], maxZoom: 9, animate: false });
        }
        if (!ident || fit) this._ident = ident;
        this._drawLeaflet(lm, F.mapGeo(v));
      }
      // Unreported part, Remaining route and trail (each a dark casing under a light line), airports, the aircraft and its arrow: the same look as
      // the MapLibre layers.
      _drawLeaflet(lm, geo) {
        var svg = this._svg;
        if (!svg) return;
        var size = lm.getSize ? lm.getSize() : { x: 0, y: 0 };
        var round = function (n) { return Math.round(n * 10) / 10; };
        var pt = function (c) { var q = lm.latLngToContainerPoint([c[1], c[0]]); return [round(q.x), round(q.y)]; };
        // SVG path data of one line from its [lon, lat] coordinates.
        var pathOf = function (coords) { return coords.map(function (c, i) { var p = pt(c); return (i ? 'L' : 'M') + p[0] + ' ' + p[1]; }).join(' '); };
        var firstLine = function (collection) { return collection.features.length ? collection.features[0].geometry.coordinates : []; };
        var out = '';
        // The Unreported part lowest: solid, the trail's white at a fainter opacity (UNREPORTED_OPACITY, as on MapLibre), on a dark casing.
        var unrep = firstLine(geo.unreported);
        if (unrep.length) {
          var unrepPath = pathOf(unrep);
          out += '<path d="' + unrepPath + '" fill="none" stroke="#000000" stroke-opacity="0.6" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>';
          out += '<path d="' + unrepPath + '" fill="none" stroke="#ffffff" stroke-opacity="' + UNREPORTED_OPACITY + '" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>';
        }
        // The Remaining route next: dashed, casing and line alike (ROUTE_STYLE, as on MapLibre).
        var route = firstLine(geo.route);
        if (route.length) {
          var routePath = pathOf(route), dash = ' stroke-dasharray="' + ROUTE_STYLE.dash + ' ' + ROUTE_STYLE.dash + '" stroke-linejoin="round"/>';
          out += '<path d="' + routePath + '" fill="none" stroke="#000000" stroke-opacity="' + ROUTE_STYLE.casingOpacity + '" stroke-width="' + ROUTE_STYLE.casingWidth + '"' + dash
            + '<path d="' + routePath + '" fill="none" stroke="#ffffff" stroke-width="' + ROUTE_STYLE.width + '"' + dash;
        }
        var trail = firstLine(geo.trail);
        if (trail.length) {
          var d = pathOf(trail);
          out += '<path d="' + d + '" fill="none" stroke="#000000" stroke-opacity="0.6" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>'
            + '<path d="' + d + '" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>';
        }
        geo.points.features.forEach(function (f) {
          var p = pt(f.geometry.coordinates);
          if (f.properties.role === 'airport') {
            out += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="4" fill="#ffffff" stroke="#000000" stroke-width="1.5"/>';
            return;
          }
          out += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="7" fill="#ffcc00" stroke="#000000" stroke-width="2"/>';
          if (f.properties.arrow) {
            out += '<polygon transform="translate(' + p[0] + ' ' + p[1] + ') rotate(' + f.properties.heading + ')" points="0,-8 7,7 0,4 -7,7"'
              + ' fill="#ffffff" stroke="rgba(0,0,0,0.8)" stroke-width="3" stroke-linejoin="round"/>';
          }
        });
        // Only a change is written: the overlay follows the map's view on every tick.
        var html = '0 0 ' + size.x + ' ' + size.y + '|' + out;
        if (html === this._svgHtml) return;
        this._svgHtml = html;
        svg.setAttribute('viewBox', '0 0 ' + size.x + ' ' + size.y);
        svg.innerHTML = out;
      }
      // The selected flight's layers; a change of flight clears the old ones first and fits the view once to the new flight.
      _sync(hass) {
        var key = this.getAttribute('data-key'), src = this.getAttribute('data-src');
        var v = F.mapView(hass, src, key, Date.now());
        var ident = v ? src + '|' + v.key : null;
        this._base = v ? { v: v, ident: ident } : null;
        v = this._advance(Date.now());
        var geo = v ? F.mapGeo(v) : null;
        var sig = JSON.stringify([ident, geo]);
        if (sig === this._sent) return;
        this._sent = sig;
        if (!this._putMl(geo)) return;
        if (ident && ident !== this._ident) {
          var b = F.mapBounds(v);
          if (b) this._ml.fitBounds(b, { padding: 36, maxZoom: 9, duration: 0 });
        }
        this._ident = ident;
      }
      // The attribution style goes into the map's shadow root once per root: at build, and again on the first poll if the
      // shadow root was not there yet.
      _css(root) {
        if (this._styled === root) return;
        this._styled = root;
        var st = document.createElement('style'); st.textContent = MAP_CSS + (this._saver ? SAVER_CSS : ''); root.appendChild(st);
      }
      _putMl(geo) {
        var ml = this._ml, pts = ml.getSource('casora-flight-points'), trail = ml.getSource('casora-flight-trail');
        var route = ml.getSource('casora-flight-route'), unrep = ml.getSource('casora-flight-unreported');
        if (!pts || !trail || !route || !unrep) return false;
        pts.setData(geo ? geo.points : EMPTY);
        unrep.setData(geo ? geo.unreported : EMPTY);
        route.setData(geo ? geo.route : EMPTY);
        trail.setData(geo ? geo.trail : EMPTY);
        return true;
      }
      // Advances the glide state to `now` (F.track) on the view of the last poll, and returns the view to draw. While a glide
      // runs it asks for the next animation frame; between glides nothing is requested.
      _advance(now) {
        var b = this._base, r = F.track(this._track, b && b.v, b && b.ident, now, reducedMotion());
        this._track = r.state;
        if (r.gliding) this._nextFrame();
        return r.view;
      }
      // One animation frame at a time, only while a glide is on. A frame redraws the arrow, the trail end and the route start
      // from the poll's view (no new F.mapView, no comparison of the whole geometry on MapLibre).
      _nextFrame() {
        var raf = window.requestAnimationFrame;
        if (this._raf || typeof raf !== 'function') return;
        this._raf = raf.call(window, () => {
          this._raf = 0;
          if (!this.isConnected) { this._stopFrames(); return; }
          var v = this._advance(Date.now());
          if (!v) return;
          if (this._lm) this._drawLeaflet(this._lm, F.mapGeo(v));
          else if (this._ml && this._layers) { this._sent = null; this._putMl(F.mapGeo(v)); }
        });
      }
      _stopFrames() {
        if (this._raf && typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(this._raf);
        this._raf = 0;
      }
      _stop() { if (this._timer) clearInterval(this._timer); this._timer = null; }
      _fail() { this._stop(); this.style.display = 'none'; }
    }
    customElements.define('casora-flight-map', FlightMap);
  };
  defineMap();
  // The Flights tile's state line sits in casora-flight-list. On connect it puts the tile's styles into its card (once per card)
  // and makes the card one button: its line is the name, its tap is F.tapTile, and Tab reaches it. The line is the same on every width.
  // The phone breakpoint: the tile CSS and F.phone read this one string.
  var PHONE_MQ = '(max-width:767px) and (orientation:portrait),(max-height:500px) and (orientation:portrait),(max-height:500px) and (orientation:landscape),(max-height:600px) and (orientation:landscape) and (hover:hover)';
  var TILE_CSS = '#container{height:100%;min-height:0}'
    + '#state{min-height:0;overflow:hidden!important}'
    + '@media ' + PHONE_MQ + '{#container{grid-template-rows:min-content minmax(0,1fr)!important}}';
  F._tileCss = TILE_CSS; // for the tests only (not part of the API)
  var setTileButton = function (card) {
    card.setAttribute('role', 'button'); card.removeAttribute('aria-label'); card.setAttribute('data-flights-tile-card', '');
    if (!card.hasAttribute('tabindex')) card.setAttribute('tabindex', '0');
  };
  var defineTileList = function () {
    if (!window.customElements || customElements.get('casora-flight-list')) return;
    class FlightList extends HTMLElement {
      connectedCallback() {
        var root = this.getRootNode && this.getRootNode();
        if (!root || !root.querySelector) return;
        if (!root.querySelector('style[data-flights-tile]')) {
          var st = document.createElement('style'); st.setAttribute('data-flights-tile', ''); st.textContent = TILE_CSS; root.appendChild(st);
        }
        var card = root.querySelector('#card');
        if (card) setTileButton(card);
      }
    }
    customElements.define('casora-flight-list', FlightList);
  };
  defineTileList();
  // The progress line: a track with the fill and the value as text (not by colour alone).
  var progressHtml = function (pct) {
    var label = tr('Ungefährer Fortschritt'), value = pctText(pct);
    return '<div role="progressbar" aria-label="' + esc(label) + '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + esc(pct)
      + '" aria-valuetext="' + esc(value) + '" style="padding:12px 16px;box-sizing:border-box;">'
      + '<div style="display:flex;justify-content:space-between;gap:12px;font-size:15px;white-space:normal;"><span style="color:var(--secondary-text-color,currentColor)">' + esc(label)
      + '</span><span style="font-weight:600">' + esc(value) + '</span></div>'
      + progressBar(pct, 6, 12) + '</div>';
  };

  // ── The flight popup (casora_popup_flight): one flight of one source, by its FR24 ID ──────────────────────────────────
  // A flight that no longer qualifies (or whose source is gone) shows the unavailable stage and no details, never another
  // flight with the same number. Building and redrawing the popup only reads the states; no tracking write from here.
  var place = function (f, side) {
    var o = f['airport_' + side] && typeof f['airport_' + side] === 'object' ? f['airport_' + side] : {};
    var term = str(f['airport_' + side + '_terminal']) || str(o.terminal);
    return [airport(f, side), str(f['airport_' + side + '_name']) || str(o.name), term ? tr('Terminal') + ' ' + term : '']
      .filter(Boolean).join(' · ');
  };
  // The identity and the airports of one entry, shared by the popup and the screensaver: '' for a missing value.
  // The model falls back to the type code, as the popup always did.
  F.details = function (f) {
    f = f || {};
    return { airline: str(f.airline_short) || str(f.airline), model: str(f.aircraft_model) || str(f.aircraft_code),
      registration: str(f.aircraft_registration), callsign: str(f.callsign), origin: place(f, 'origin'), destination: place(f, 'destination') };
  };
  // A plate of label and value rows; a row without a value is left out, and no rows means no plate (no blank section).
  // pairs() translates the labels (callers pass German keys), not the values.
  var pairs = function (rows) {
    var ok = rows.filter(function (x) { return x[1]; });
    if (!ok.length) return '';
    return '<div style="background:var(--casora-popup-row-fill, rgba(255,255,255,0.10));border-radius:var(--casora-popup-row-radius, 20px);overflow:hidden">'
      + ok.map(function (x, i) {
        return (i ? '<div style="height:1px;margin:0 16px;background:currentColor;opacity:.15"></div>' : '')
          + '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;min-height:52px;box-sizing:border-box;padding:8px 16px">'
          + '<div style="font-size:15px;color:var(--secondary-text-color,currentColor);white-space:normal;flex:none">' + esc(tr(x[0])) + '</div>'
          + '<div style="font-size:15px;font-weight:600;text-align:right;min-width:0;white-space:normal;overflow-wrap:anywhere">' + esc(x[1]) + '</div></div>';
      }).join('') + '</div>';
  };
  var flightSec = function (part, c, h) {
    var UI = window._casoraUI;
    if (!UI) return '';
    var r = F.flight(h, c.src, c.flight, Date.now());
    if (part === 'fstage') {
      if (!r) return UI.stage('status', { tone: 'off', icon: 'mdi:airplane-off', text: tr('Nicht verfügbar') });
      return r.route ? UI.stage('status', { tone: 'good', icon: 'mdi:airplane', text: r.route }) : '';
    }
    if (!r) return '';
    var f = r.entry;
    if (part === 'fmap') {
      // The map element reads its flight from these attributes; it draws nothing for a flight that stops qualifying.
      var mv = F.mapView(h, c.src, c.flight, Date.now());
      if (!mv) return '';
      // role="group", not "img": an img role makes its children presentational, so the attribution link inside would be a
      // nested-interactive case (axe) with no name for a screen reader. A named group keeps the label and the link.
      return UI.stage('image', { html: '<casora-flight-map role="group" aria-label="' + esc(mv.label) + '" data-src="' + esc(c.src)
        + '" data-key="' + esc(c.flight) + '" style="display:block;width:100%;aspect-ratio:4 / 3;border-radius:inherit;overflow:hidden;'
        + 'background:var(--casora-soft-row-fill, rgba(127,127,127,0.1));"></casora-flight-map>' });
    }
    if (part === 'fprog') {
      var pv = F.mapView(h, c.src, c.flight, Date.now());
      return pv && pv.progress != null ? progressHtml(pv.progress) : '';
    }
    if (part === 'fmove') return pairs([['Höhe', r.altitude], ['Geschwindigkeit über Grund', r.speed],
      ['Vertikalgeschwindigkeit', r.vspeed], ['Kurs', r.heading]]);
    if (part === 'fair') { var d = F.details(f); return pairs([['Fluggesellschaft', d.airline], ['Flugzeugmodell', d.model],
      ['Registrierung', d.registration], ['Rufzeichen', d.callsign]]); }
    if (part === 'fplaces') { var p = F.details(f); return pairs([['Abflug', p.origin], ['Ankunft', p.destination]]); }
    if (part === 'ftimes') return pairs(F.timeRows(h, f, F.tz()));
    return '';
  };
  // A list row opens its flight's popup through the card opener: the popup template gets the source and the FR24 ID.
  // Only a flight that qualifies now opens. Not in the Studio (there the rows are only drawn).
  F.open = function (hass, src, key) {
    if (inStudio() || !hass || !src || !key) return null;
    if (!F.flight(hass, src, key, Date.now())) return null;
    if (typeof window._casoraNotifyOpenViaCard !== 'function') return null;
    window._casoraNotifyOpenViaCard(src, function () {}, { type: 'custom:button-card', template: 'casora_popup_flight', entity: src,
      variables: { source: src, flight: key } }, true); // ids only: no text from the source goes into the card config
    return true;
  };
  // The popup's title: the flight's own label (its number, else callsign or registration) while the source lists it.
  F.title = function (hass, v) {
    var id = String((v && v.flight) || ''), f = flightsOf(hass, String((v && v.source) || '')).filter(function (x) { return idOf(x) === id; })[0];
    return (f && labelOf(f)) || tr('Flug');
  };
  // The popup's content (casora_popup_flight): a stage with the route, the movement, the aircraft and the airports.
  F.flightPopup = function (states, hass, vars) {
    var KIT = window._casoraSoftKit, UI = window._casoraUI, S = states || {}, v = vars || {};
    if (!KIT || !UI || !UI.stage || !hass) return { type: 'vertical-stack', cards: [] };
    var cj = JSON.stringify({ src: String(v.source || ''), flight: String(v.flight || '') });
    var watch = v.source ? [String(v.source)] : [];
    var card = function (part) { return { card: KIT.secCard(watch, 'return window._casoraFlights ? window._casoraFlights.sec(' + JSON.stringify(part) + ', ' + cj + ', states, hass) : "";', S) }; };
    // The route text on top, the map as the stage, the progress under it; the details in the two columns as before.
    return KIT.layout({ fields: { stage: card('fstage'), map: card('fmap'), prog: card('fprog'), move: card('fmove'), air: card('fair'),
      places: card('fplaces'), times: card('ftimes') },
      top: ['stage'], stage: 'map', stageWide: true, left: ['prog', 'move', 'times', 'places'], right: ['air'] });
  };
})();
