// Test helper (not a test): loads the shared detection rule, casoraSinceMs and the camera alert helper from casora-core.js onto window.
import fs from 'node:fs';

globalThis.window = globalThis;
const core = fs.readFileSync(new URL('../../custom_components/casora/scripts/casora-core.js', import.meta.url), 'utf8');
const cut = (open, from = 0) => {
  const start = core.indexOf(open, from);
  return core.slice(start, core.indexOf('\n})();', start) + 6);
};
new Function(cut('// The detection rule of the camera tile and the bell'))();
const sinceStart = core.indexOf('  var startC = ');
const sinceEnd = core.indexOf('    return t;\n  };', sinceStart) + '    return t;\n  };'.length;
new Function(core.slice(sinceStart, sinceEnd))();
// The camera alert helper; call again to get a fresh definition after a test deleted it.
export const loadCameraAlert = () => {
  delete window.casoraCameraAlert;
  new Function(cut('// The camera alert text of the camera tiles and badges'))();
};
loadCameraAlert();
