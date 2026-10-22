/* thinking-orbs 0.3.2 — Copyright (c) 2026 Jakub Antalik, MIT.
 * Composing-only subset of the official npm engine for Chrome content scripts.
 * Source: https://github.com/Jakubantalik/Libraries.dev/tree/main/packages/thinking-orbs
 * See LICENSE and README.md in this directory.
 */
const AIThinkingOrbEngine = (() => {
function fibDir(i, n) {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const y = 1 - 2 * (i + 0.5) / n;
  const rad = Math.sqrt(1 - y * y);
  const a = i * golden;
  return [rad * Math.cos(a), y, rad * Math.sin(a)];
}
function makeProj(yaw, tilt, cx, cy, scale) {
  const st = Math.sin(tilt);
  const ct = Math.cos(tilt);
  const sy = Math.sin(yaw);
  const cyw = Math.cos(yaw);
  return (x, y, z) => {
    const x1 = x * cyw + z * sy;
    const z1 = -x * sy + z * cyw;
    const y1 = y * ct - z1 * st;
    const z2 = y * st + z1 * ct;
    return [cx + x1 * scale, cy - y1 * scale, z2];
  };
}
function inkColor(w, alpha, dark, tint) {
  if (!tint) {
    const g = Math.round((dark ? 1 - w : w) * 255);
    return `rgba(${g},${g},${g},${alpha})`;
  }
  const ramp = (c) => Math.round(dark ? c * (1 - w) : c + (255 - c) * w);
  return `rgba(${ramp(tint.r)},${ramp(tint.g)},${ramp(tint.b)},${alpha})`;
}
function paint(ctx, dots, dark, tint) {
  for (const d of dots) {
    const alpha = d.a ?? 1;
    const w = Math.min(1, Math.max(0, d.white));
    ctx.fillStyle = inkColor(w, alpha, dark, tint);
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
    ctx.fill();
  }
}
function finalizeFrame(dots, rMin = 0.3) {
  const visible = [];
  for (const d of dots) {
    if ((d.a ?? 1) < 0.02) continue;
    d.r = Math.max(rMin, d.r);
    visible.push(d);
  }
  visible.sort((a, b) => a.z - b.z);
  return { dots: visible, lines: [] };
}
function paintFrame(ctx, frame, dark, tint) {
  paint(ctx, frame.dots, dark, tint);
}
function radiusScale(size, pow) {
  return (size / 300) ** pow;
}
const frameRibbon = (size, t, o) => {
  const cx = size / 2;
  const cy = size / 2;
  const R = size / 2 * 0.78;
  const spin = o.spin ?? 1;
  const camTilt = 0.3;
  const pt = makeProj(t * 0.1 * spin, camTilt, cx, cy, 1);
  const rs = radiusScale(size, o.rsPow ?? 0.6);
  const dots = [];
  const ghostN = o.ghostN ?? 150;
  for (let i = 0; i < ghostN; i++) {
    const d = fibDir(i, ghostN);
    const [px, py, z] = pt(d[0] * R, d[1] * R, d[2] * R);
    const depth = (z / R + 1) / 2;
    dots.push({ x: px, y: py, z, r: 0.8 * rs, white: 0.78, a: 0.1 + 0.22 * depth });
  }
  const ya = t * 0.24 * spin;
  const ta = o.faceOn ? -camTilt : 0.55 + 0.3 * Math.sin(t * 0.18) * spin;
  const ux = Math.cos(ya);
  const uy = 0;
  const uz = Math.sin(ya);
  const vx = -uz * Math.sin(ta);
  const vy = Math.cos(ta);
  const vz = ux * Math.sin(ta);
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const wobAmp = 0.23 * (o.wobMul ?? 1);
  const baseR = o.faceOn ? R / (1 + 0.85 * wobAmp) : R;
  const baseLanes = o.lanes ?? 5;
  const segs = o.segs ?? 88;
  const lanes = Math.max(1, Math.round(baseLanes * (o.bandMul ?? 1)));
  for (let w = 0; w < lanes; w++) {
    const laneOff = (w - (lanes - 1) / 2) * 0.075;
    const edge = Math.abs(w - (lanes - 1) / 2) / Math.max(1, (lanes - 1) / 2);
    for (let k = 0; k < segs; k++) {
      const a = k / segs * 2 * Math.PI;
      const wob = (0.16 * Math.sin(a * 3 - t * 1.7 + w * 0.22) + 0.07 * Math.sin(a * 5 + t * 1.1)) * (o.wobMul ?? 1);
      const radial = o.faceOn ? 1 + wob : 1;
      const off = o.faceOn ? laneOff : laneOff + wob;
      const x = ux * Math.cos(a) + vx * Math.sin(a) + nx * off;
      const y = uy * Math.cos(a) + vy * Math.sin(a) + ny * off;
      const z = uz * Math.cos(a) + vz * Math.sin(a) + nz * off;
      const l = Math.sqrt(x * x + y * y + z * z);
      const rr = baseR * radial;
      const [px, py, zr] = pt(x / l * rr, y / l * rr, z / l * rr);
      const depth = (zr / R + 1) / 2;
      dots.push({
        x: px,
        y: py,
        z: zr,
        r: ((o.rBase ?? 1.1) + (o.rDepth ?? 1.7) * depth) * (1 - 0.25 * edge) * rs,
        white: 0.52 - 0.44 * depth + 0.18 * edge,
        a: 0.4 + 0.6 * depth
      });
    }
  }
  return finalizeFrame(dots, o.rMin);
};
const BASE_PROFILE = {
  lanes: 5,
  segs: 88,
  ghostN: 150,
  rBase: 1.1,
  rDepth: 1.7,
  rsPow: 0.6,
  rMin: 0.3
};
const PRESETS = {
  64: { speed: 2.34, count: 0.25, size: 0.85, extra: { spin: 0, bandMul: 3.9, wobMul: 1 } },
  32: { speed: 2.7776, count: 0.0969, size: 0.9766, extra: { spin: 0, bandMul: 4.49, wobMul: 1 } },
  20: { speed: 3.12, count: 0.051, size: 1.073, extra: { spin: 0, bandMul: 4.94, wobMul: 1 } }
};
const cache = new Map();
function resolvePreset(state, size) {
  if (state !== 'composing' || !PRESETS[size]) {
    throw new Error(`Unsupported thinking orb preset: ${state}-${size}`);
  }
  if (cache.has(size)) return cache.get(size);
  const preset = PRESETS[size];
  const opts = { ...BASE_PROFILE, ...preset.extra };
  const density = Math.sqrt(preset.count);
  opts.lanes = Math.max(2, Math.round(opts.lanes * density));
  opts.segs = Math.max(2, Math.round(opts.segs * density));
  opts.ghostN = Math.max(1, Math.round(opts.ghostN * preset.count));
  opts.rBase *= preset.size;
  opts.rDepth *= preset.size;
  const resolved = { mode: 'ribbon', speed: preset.speed, opts };
  cache.set(size, resolved);
  return resolved;
}

return Object.freeze({
  MODE_FRAMES: { ribbon: frameRibbon },
  resolvePreset,
  paintFrame,
});
})();
