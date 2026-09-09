// NAC AI HVAC DESIGNER — unit handling.
// Internal unit of length is ALWAYS millimetres. Everything else converts at the edge.

export const MM_PER_M = 1000;

export function toMm(value, unit) {
  const v = Number(value);
  if (!isFinite(v)) return null;
  switch ((unit || 'mm').toLowerCase()) {
    case 'm': return v * MM_PER_M;
    case 'cm': return v * 10;
    case 'mm': return v;
    default: return null;
  }
}

export function fromMm(mm, unit) {
  const v = Number(mm);
  if (!isFinite(v)) return null;
  switch ((unit || 'mm').toLowerCase()) {
    case 'm': return v / MM_PER_M;
    case 'cm': return v / 10;
    case 'mm': return v;
    default: return null;
  }
}

export const mmToM = (mm) => Number(mm) / MM_PER_M;
export const mToMm = (m) => Number(m) * MM_PER_M;

/** Floor area in m² from two millimetre dimensions. */
export function areaM2(widthMm, lengthMm) {
  return (Number(widthMm) / MM_PER_M) * (Number(lengthMm) / MM_PER_M);
}

/** Room volume in m³. */
export function volumeM3(areaSqM, ceilingHeightMm) {
  return Number(areaSqM) * (Number(ceilingHeightMm) / MM_PER_M);
}

export function round(n, dp = 0) {
  const f = Math.pow(10, dp);
  return Math.round((Number(n) + Number.EPSILON) * f) / f;
}

/** Round to a fixed step, e.g. roundTo(1234, 50) -> 1250. */
export function roundTo(n, step, mode = 'nearest') {
  const s = Number(step);
  if (!s) return Number(n);
  const q = Number(n) / s;
  const r = mode === 'up' ? Math.ceil(q) : mode === 'down' ? Math.floor(q) : Math.round(q);
  return round(r * s, 6);
}

export const fmtM = (mm, dp = 2) => round(mmToM(mm), dp).toFixed(dp) + ' m';
export const fmtArea = (m2, dp = 2) => round(m2, dp).toFixed(dp) + ' m²';
export const fmtMoney = (n) =>
  '$' + Number(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** Deterministic short id — accepts an optional seeded rng so tests are reproducible. */
export function uid(prefix = 'id', rng = Math.random) {
  return prefix + '_' + rng().toString(36).slice(2, 9);
}
