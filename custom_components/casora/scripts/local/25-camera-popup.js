// One popup family per camera. The camera registry decides which existing renderer opens.
(function () {
  if (window.casoraCameraPopup) return;

  function kind(hass, id) {
    var doorbell = window._casoraKlingel;
    if (doorbell && typeof doorbell.is === 'function' && doorbell.is(hass, id)) return 'doorbell';
    var frigate = window._casoraFrigate;
    if (frigate && typeof frigate.is === 'function' && frigate.is(hass, id)) return 'frigate';
    return 'camera';
  }
  function fields(family) {
    if (family === 'frigate') return [['stream_popup', ''], ['stream_popup_phone', '']];
    if (family === 'doorbell') return [['talk', false], ['camera2', ''], ['big_on_audio', true]];
    return [['alert_window_minutes', 5], ['show_stream_variants', false]];
  }

  // casoraNoEval (casora-core.js) when loaded, else the same guard: a text starting with "[[[" gets a zero-width space.
  var noEval = function (v) { return window.casoraNoEval ? window.casoraNoEval(v) : (typeof v === 'string' && /^\s*\[\[\[/.test(v) ? '\u200b' + v : v); };

  function has(obj, key) {
    return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
  }

  function homeVariables(config) {
    var views = config && Array.isArray(config.views) ? config.views : [];
    var home = views.find(function (view) { return view && view.path === 'home'; }) || views[0];
    var found = null;
    function walk(value, depth) {
      if (found || !value || typeof value !== 'object' || depth > 16) return;
      if (Array.isArray(value)) { value.forEach(function (item) { walk(item, depth + 1); }); return; }
      var templates = [].concat(value.template || []);
      if (templates.indexOf('casora_room') >= 0 && value.variables && typeof value.variables === 'object') {
        found = value.variables;
        return;
      }
      ['cards', 'card', 'sections', 'elements'].forEach(function (key) { walk(value[key], depth + 1); });
    }
    walk(home && home.cards, 0);
    if (found && has(found, 'casora_camera_settings')) return found;
    var phone = window.casoraPhoneRoom;
    var phoneHome = phone && typeof phone.home === 'function' ? phone.home() : null;
    return phoneHome || found || {};
  }

  function isCameraTile(card) {
    if (!card || card.type !== 'custom:button-card') return false;
    var templates = [].concat(card.template || []);
    return templates.indexOf('casora_cameras') < 0
      && templates.some(function (name) {
        return name === 'casora_camera' || name === 'casora_frigate' || name === 'casora_reolink_doorbell';
      });
  }

  function firstTile(config, id, hass) {
    var entities = (hass && hass.entities) || {};
    var device = entities[id] && entities[id].device_id;
    var found = null;
    function walk(value, depth) {
      if (found || !value || typeof value !== 'object' || depth > 24) return;
      if (Array.isArray(value)) { value.forEach(function (item) { walk(item, depth + 1); }); return; }
      if (isCameraTile(value) && typeof value.entity === 'string' && value.entity.indexOf('camera.') === 0) {
        var tileDevice = entities[value.entity] && entities[value.entity].device_id;
        if (device ? tileDevice === device : value.entity === id) {
          found = value;
          return;
        }
      }
      ['cards', 'card', 'sections', 'elements', 'filter', 'include', 'options'].forEach(function (key) {
        walk(value[key], depth + 1);
      });
      if (value.custom_fields && typeof value.custom_fields === 'object') walk(Object.keys(value.custom_fields).map(function (key) {
        return value.custom_fields[key];
      }), depth + 1);
    }
    walk(config && config.views, 0);
    return found;
  }

  function resolve(id, hass, config, homeVars) {
    var h = hass;
    if (!h) {
      try { var ha = document.querySelector('home-assistant'); h = ha && ha.hass; } catch (e) { h = null; }
    }
    var cfg = config;
    if (!cfg) {
      try { cfg = window._casoraLovelaceCfg && window._casoraLovelaceCfg(); } catch (e) { cfg = null; }
    }
    var registry = (h && h.entities) || {};
    var meta = registry[id] || {};
    var key = meta.device_id || id;
    var vars = homeVars && typeof homeVars === 'object' ? homeVars : homeVariables(cfg);
    var map = vars && vars.casora_camera_settings;
    var record = map && typeof map === 'object' ? map[key] : null;
    var popup = record && record.popup && typeof record.popup === 'object' ? record.popup : {};
    var tile = firstTile(cfg, id, h);
    var legacy = tile && tile.variables && typeof tile.variables === 'object' ? tile.variables : {};
    var values = {};
    var family = kind(h, id);
    fields('camera').concat(family === 'camera' ? [] : fields(family)).forEach(function (entry) {
      values[entry[0]] = has(popup, entry[0]) ? popup[entry[0]]
        : has(legacy, entry[0]) ? legacy[entry[0]] : entry[1];
    });
    return {
      key: key,
      kind: family,
      popup: Object.assign({}, popup),
      open: Object.assign({}, record && record.open && typeof record.open === 'object' ? record.open : {}),
      legacy: {
        alert_window_minutes: has(legacy, 'alert_window_minutes') ? legacy.alert_window_minutes : undefined,
        show_stream_variants: has(legacy, 'show_stream_variants') ? legacy.show_stream_variants : undefined,
      },
      values: values,
    };
  }

  function variables(id, tileVars, hass, config) {
    var out = Object.assign({}, tileVars || {});
    var h = hass;
    if (!h) {
      try { var ha = document.querySelector('home-assistant'); h = ha && ha.hass; } catch (e) { h = null; }
    }
    var resolved = resolve(id, h, config);
    out.alert_window_minutes = resolved.values.alert_window_minutes;
    out.show_stream_variants = resolved.values.show_stream_variants;
    if (resolved.kind === 'frigate') {
      out.stream_popup = resolved.values.stream_popup;
      out.stream_popup_phone = resolved.values.stream_popup_phone;
    }
    if (resolved.kind === 'doorbell') {
      ['talk', 'camera2', 'big_on_audio'].forEach(function (field) { out[field] = resolved.values[field]; });
    }
    out.casora_single_camera = true;
    out.cameras = [id];
    if (typeof window.casoraCamStatusOf === 'function') {
      var status = window.casoraCamStatusOf(id, tileVars || {}, h);
      if (status && status !== id) out.status_entity = status;
      else delete out.status_entity;
    }
    return out;
  }

  function config(id, hass, dashboard) {
    return {
      type: 'custom:button-card',
      template: 'casora_camera',
      entity: id,
      // The config travels to button-card: its texts go through the guard.
      variables: noEval(variables(id, null, hass, dashboard)),
    };
  }

  function open(id, done) {
    var finish = typeof done === 'function' ? done : function () {};
    if (typeof id !== 'string' || id.indexOf('camera.') !== 0) { finish(false); return false; }
    var h = null;
    try { var ha = document.querySelector('home-assistant'); h = ha && ha.hass; } catch (e) { h = null; }
    var opener = window._casoraNotifyOpenViaCard;
    if (typeof opener !== 'function') { finish(false); return false; }
    return opener(id, finish, config(id, h), true);
  }

  function content(entity, states, hass, tileVars) {
    var id = entity && entity.entity_id;
    var family = kind(hass, id);
    var vars = variables(id, tileVars, hass);
    var body = null;
    if (family === 'doorbell' && window._casoraKlingel && typeof window._casoraKlingel.popup === 'function') {
      body = window._casoraKlingel.popup(entity, states, hass, vars);
    } else if (family === 'frigate' && window._casoraFrigate && typeof window._casoraFrigate.popup === 'function') {
      body = window._casoraFrigate.popup(entity, states, hass, vars);
    }
    return { kind: family, variables: vars, content: body };
  }

  window.casoraCameraPopup = { kind: kind, fields: fields, resolve: resolve, variables: variables, config: config, content: content, open: open };
})();
