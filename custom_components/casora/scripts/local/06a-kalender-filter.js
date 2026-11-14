// Calendar rules shared by the Agenda tile, the greeting, the screensavers and the Studio's Agenda tile preview.
// Loaded before 06-kalender.js on the dashboard. The Studio's Agenda tile preview loads only this file,
// so the Studio gets no calendar module (event cache, popup) from it.
(function () {
  if (window.casoraCalendarAllows) return;
  // The calendar popup keeps every event. settings: the object to read the words from (the Studio passes
  // its settings draft); omitted, the saved settings. attrs: the calendar state's attributes. uid: undefined
  // for the state's own message, the API event's uid (null when it has none) for a screensaver or popup event.
  // A recorded decision (casora_filter_match, from the mock's replay) decides for an entry the export knew
  // (meta.entries), and only while the title is still the one recorded; any other entry uses the text match.
  window.casoraCalendarAllows = function (title, settings, attrs, uid) {
    var words = settings || (window.casoraSettings ? window.casoraSettings() : {});
    var meta = attrs && attrs.casora_filter_match;
    var decision = meta && (uid === undefined ? meta.message : uid && meta.events && meta.events[uid]);
    if (decision && decision.title !== title) decision = null;
    var known = decision && Array.isArray(meta.entries) ? meta.entries.map(function (e) { return String(e).trim().toLowerCase(); }) : null;
    var text = String(title || '').toLowerCase();
    return !String(words.calendar_filter || '').split(',').some(function (entry) {
      entry = entry.trim().toLowerCase();
      if (!entry) return false;
      if (known && known.indexOf(entry) !== -1) {
        return Array.isArray(decision.matches) && decision.matches.some(function (m) { return String(m).trim().toLowerCase() === entry; });
      }
      return text.indexOf(entry) !== -1;
    });
  };
  // The Agenda tile's pick (Upstream's rule): one event per calendar from the calendar states (message,
  // start_time, all_day). A running event wins, then the earliest start. cals: [{ entity, tile }] (tile false is
  // left out); allows(title) skips filtered titles, so a filtered state event leaves its calendar out.
  window.casoraCalendarNext = function (states, cals, now, allows) {
    var best = null;
    (cals || []).forEach(function (c) {
      if (c.tile === false) return;
      var s = states[c.entity], a = s && s.attributes;
      if (!a || !a.message || !a.start_time) return;
      if (allows && !allows(a.message, a)) return;
      var st = new Date(String(a.start_time).replace(' ', 'T')), en = new Date(String(a.end_time || a.start_time).replace(' ', 'T'));
      if (isNaN(st)) return;
      var ev = { name: a.message, start: st, end: en, allDay: !!a.all_day, on: s.state === 'on', cal: c };
      if (!ev.on && en < now) return;
      if (!best || (ev.on && !best.on) || (ev.on === best.on && st < best.start)) best = ev;
    });
    return best;
  };
})();
