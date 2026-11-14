// Calendar filter: the title predicate for Home, the greeting, the screensavers and the Agenda tile.
// Loaded before 06-kalender.js on the dashboard. The Studio screensaver preview loads only this file,
// so the Studio gets no calendar tile helpers from it.
(function () {
  if (window.casoraCalendarAllows) return;
  // The calendar popup keeps every event; Home, the screensavers and the Agenda tile use this filter.
  // Omit uid for the state message; pass null for a REST event without an ID. The Studio preview passes its
  // settings draft as saved: its window.casoraSettings() returns {} on the settings page.
  window.casoraCalendarAllows = function (title, states, entity, uid, draft) {
    var settings = draft || (window.casoraSettings ? window.casoraSettings() : (window.CASORA_SETTINGS || {}));
    var text = String(title || '').toLowerCase();
    var attrs = states && states[entity] && states[entity].attributes;
    var meta = attrs && attrs.casora_filter_match;
    var decision = meta && (uid === undefined ? meta.message : uid && meta.events && meta.events[uid]);
    if (decision && decision.title !== title) decision = null;
    return !String(settings.calendar_filter || '').split(',').some(function (entry) {
      entry = entry.trim().toLowerCase();
      if (!entry) return false;
      if (decision && Array.isArray(meta.entries) && meta.entries.some(function (e) { return String(e).toLowerCase() === entry; })) {
        return Array.isArray(decision.matches) && decision.matches.some(function (e) { return String(e).toLowerCase() === entry; });
      }
      return text.indexOf(entry) !== -1;
    });
  };
})();
