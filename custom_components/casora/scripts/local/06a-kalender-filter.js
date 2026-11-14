// Calendar filter: the title rule for Home, the greeting, the screensavers and the Agenda tile.
// Loaded before 06-kalender.js on the dashboard. The Studio's Agenda tile preview loads only this file,
// so the Studio gets no calendar module (event cache, popup) from it.
(function () {
  if (window.casoraCalendarAllows) return;
  // The calendar popup keeps every event. settings: the object to read the words from (the Studio passes
  // its settings draft); omitted, the saved settings. states, entity, uid: the HA calendar states and the
  // event; an exported decision (casora_filter_match) decides for that event when it is still the same title.
  window.casoraCalendarAllows = function (title, settings, states, entity, uid) {
    var words = settings || (window.casoraSettings ? window.casoraSettings() : (window.CASORA_SETTINGS || {}));
    var text = String(title || '').toLowerCase();
    var attrs = states && entity && states[entity] && states[entity].attributes;
    var meta = attrs && attrs.casora_filter_match;
    var decision = meta && (uid === undefined ? meta.message : uid && meta.events && meta.events[uid]);
    if (decision && decision.title !== title) decision = null;
    return !String(words.calendar_filter || '').split(',').some(function (entry) {
      entry = entry.trim().toLowerCase();
      if (!entry) return false;
      if (decision && Array.isArray(meta.entries) && meta.entries.some(function (e) { return String(e).toLowerCase() === entry; })) {
        return Array.isArray(decision.matches) && decision.matches.some(function (e) { return String(e).toLowerCase() === entry; });
      }
      return text.indexOf(entry) !== -1;
    });
  };
})();
