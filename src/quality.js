// Graphics quality tiers. Gameplay never reads these: only rendering does,
// so a better headset can raise quality without touching rules, AI or saves.
export const TIERS = {
  low: {
    id: 'low', label: 'Low · Quest 1',
    fbScale: 1.0, foveation: 1.0, maxDpr: 1, msaa: true,
    shadows: false, shadowSize: 0,
    grass: 0, trees: 0.7, rocks: 0.8,
    particles: 260, fogMul: 1.0, farClip: 900,
    water: 'simple', duckMat: 'lambert', hrtf: false,
    cloudLayer: false, propSway: false,
  },
  medium: {
    id: 'medium', label: 'Medium · Quest 2',
    fbScale: 1.0, foveation: 0.75, maxDpr: 1.25, msaa: true,
    shadows: false, shadowSize: 0,
    grass: 0.45, trees: 0.9, rocks: 1,
    particles: 420, fogMul: 1.2, farClip: 1100,
    water: 'detailed', duckMat: 'lambert', hrtf: false,
    cloudLayer: true, propSway: true,
  },
  high: {
    id: 'high', label: 'High · Quest 3 / Pro',
    fbScale: 1.15, foveation: 0.5, maxDpr: 1.5, msaa: true,
    shadows: true, shadowSize: 1024,
    grass: 1.0, trees: 1.0, rocks: 1,
    particles: 640, fogMul: 1.4, farClip: 1300,
    water: 'detailed', duckMat: 'standard', hrtf: true,
    cloudLayer: true, propSway: true,
  },
  ultra: {
    id: 'ultra', label: 'Ultra · PC',
    fbScale: 1.3, foveation: 0.0, maxDpr: 2, msaa: true,
    shadows: true, shadowSize: 2048,
    grass: 1.6, trees: 1.2, rocks: 1.2,
    particles: 900, fogMul: 1.7, farClip: 1500,
    water: 'detailed', duckMat: 'standard', hrtf: true,
    cloudLayer: true, propSway: true,
  },
};
export const TIER_ORDER = ['low', 'medium', 'high', 'ultra'];

function gpuString() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const s = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return String(s || '');
  } catch (e) { return ''; }
}

// Returns { device, tier } — device is a human label for the settings screen.
export function detectDevice() {
  const ua = navigator.userAgent || '';
  const gpu = gpuString();
  const isQuestBrowser = /OculusBrowser|Quest/i.test(ua);
  if (isQuestBrowser) {
    if (/Quest 3/i.test(ua) || /Adreno \(TM\) 7[0-9]0/i.test(gpu)) return { device: 'Meta Quest 3', tier: 'high', gpu };
    if (/Quest Pro/i.test(ua)) return { device: 'Meta Quest Pro', tier: 'high', gpu };
    if (/Quest 2/i.test(ua) || /Adreno \(TM\) 650/i.test(gpu)) return { device: 'Meta Quest 2', tier: 'medium', gpu };
    return { device: 'Meta Quest', tier: 'low', gpu };
  }
  if (/Android|iPhone|iPad|Mobile/i.test(ua)) return { device: 'Phone or tablet', tier: 'low', gpu };
  if (/SwiftShader|llvmpipe|Software/i.test(gpu)) return { device: 'Computer (software graphics)', tier: 'low', gpu };
  if (/NVIDIA|GeForce|RTX|Radeon|AMD|Apple M|Apple GPU/i.test(gpu)) return { device: 'Computer', tier: 'high', gpu };
  return { device: 'Computer', tier: 'medium', gpu };
}

export function resolveTier(setting, detected) {
  if (setting && setting !== 'auto' && TIERS[setting]) return TIERS[setting];
  return TIERS[detected.tier] || TIERS.low;
}
