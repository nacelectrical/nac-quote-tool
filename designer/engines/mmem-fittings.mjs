// ─────────────────────────────────────────────────────────────────────────────
// MMEM'S BRANCH TAKE-OFFS AND Y-PIECES, AS PARTS
//
// Nick: "the btos are on mmem pricelist ... only use these in design also."
//
// A BTO had been treated as something NAC has fabricated to suit the job: any
// inlet, any set of outlets, priced per configuration by a sheet-metal shop.
// MMEM sell them as CATALOGUE PARTS with fixed inlets and fixed outlets, and a
// design that asks for a combination they do not make is a design somebody has
// to sort out in the van.
//
// Each row below is a part number, its price, and — where Nick has given it —
// exactly what goes in and what comes out. The ones still marked unknown are
// unknown: they are listed so the gap is visible, and they can never be
// selected for a design, because selecting a fitting whose outlets nobody
// knows is how a 250 branch ends up on a 300 collar.
//
// Sizes are recorded in millimetres, with the imperial size MMEM name them by
// kept beside it. The trade calls a 400 a sixteen.
// ─────────────────────────────────────────────────────────────────────────────

/** Where the configurations came from. Prices are MMEM's own list. */
export const MMEM_FITTINGS_SOURCE = Object.freeze({
  prices: 'MMEM price list',
  configurations: 'Nick, 23 September 2026',
  note: 'Inlet and outlet sizes marked unknown are still outstanding from MMEM ' +
        'items 65–105.'
});

const mm = (inches) => ({ inches, mm: Math.round(inches * 25.4 / 50) * 50 });

export const MMEM_BTO_FITTINGS = Object.freeze([
  { code: 'MMADB8',  name: 'DB8 double BTO', sizeCode: 'DB8', kind: 'bto',
    inletMm: 400, inletInches: 16, outletsMm: [300, 300, 300], cost: 75.00 },
  { code: 'MMADB6',  name: 'DB6 double BTO', sizeCode: 'DB6', kind: 'bto',
    inletMm: null, inletInches: null, outletsMm: null, cost: 55.00 },
  { code: 'MMAB11',  name: 'B11 BTO', sizeCode: 'B11', kind: 'bto',
    inletMm: 400, inletInches: 16, outletsMm: [350, 250], cost: 65.00 },
  { code: 'MMAB9',   name: 'B9 BTO', sizeCode: 'B9', kind: 'bto',
    inletMm: null, inletInches: null, outletsMm: null, cost: 50.00 },
  { code: 'MMAB8',   name: 'B8 BTO', sizeCode: 'B8', kind: 'bto',
    inletMm: null, inletInches: null, outletsMm: null, cost: 40.00 },
  { code: 'MMADY18', name: 'Y6 Y-piece (DY18)', sizeCode: 'Y6', kind: 'y_piece',
    inletMm: 450, inletInches: 18, outletsMm: null, cost: 55.00 },
  { code: 'MMADY16', name: 'Y5 Y-piece (DY16)', sizeCode: 'Y5', kind: 'y_piece',
    inletMm: 400, inletInches: 16, outletsMm: [300, 300], cost: 50.00 },
  // Two outlet options on one part number, so both are matchable.
  { code: 'MMADY14', name: 'Y4 Y-piece (DY14)', sizeCode: 'Y4', kind: 'y_piece',
    inletMm: 350, inletInches: 14, outletsMm: [250, 250],
    alternativeOutletsMm: [[300, 300]], cost: 40.00 },
  { code: 'MMADY12', name: 'Y3 Y-piece (DY12)', sizeCode: 'Y3', kind: 'y_piece',
    inletMm: 300, inletInches: 12, outletsMm: null, cost: 35.00 }
]);

/** A fitting NAC can actually choose: its inlet AND its outlets are known. */
export function isSelectable(f) {
  return !!f && Number(f.inletMm) > 0 && Array.isArray(f.outletsMm) && f.outletsMm.length > 0;
}

export const SELECTABLE_FITTINGS = MMEM_BTO_FITTINGS.filter(isSelectable);
export const INCOMPLETE_FITTINGS = MMEM_BTO_FITTINGS.filter(f => !isSelectable(f));

const sorted = (list) => [...(list || [])].map(Number).sort((a, b) => b - a);
const same = (a, b) => a.length === b.length && sorted(a).every((v, i) => v === sorted(b)[i]);

/** Every outlet set one part number covers. */
function outletSetsOf(f) {
  return [f.outletsMm, ...(f.alternativeOutletsMm || [])].filter(Boolean);
}

/**
 * `bto_400_250_250_250` → { inletMm: 400, outletsMm: [250,250,250] }.
 * Returns null for anything that is not a configuration key.
 */
export function parseConfigKey(configKey) {
  const m = /^bto_(\d+)((?:_\d+)+)$/.exec(String(configKey || ''));
  if (!m) return null;
  const outlets = m[2].split('_').filter(Boolean).map(Number);
  return { inletMm: Number(m[1]), outletsMm: outlets };
}

/**
 * The MMEM part that IS this configuration, or null.
 *
 * Exact only. A ø400 with three ø250 outlets is not a DB8 — the DB8 has three
 * ø300 outlets, and fitting a 250 flex to a 300 collar is a job somebody does
 * with tape at four in the afternoon.
 */
export function findFitting(configKey) {
  const want = parseConfigKey(configKey);
  if (!want) return null;
  for (const f of SELECTABLE_FITTINGS) {
    if (Number(f.inletMm) !== want.inletMm) continue;
    for (const set of outletSetsOf(f)) {
      if (same(set, want.outletsMm)) return f;
    }
  }
  return null;
}

/** How a fitting reads on an order or a schedule. */
export function describeFitting(f) {
  if (!f) return null;
  const outs = outletSetsOf(f).map(set => {
    const counts = new Map();
    for (const d of sorted(set)) counts.set(d, (counts.get(d) || 0) + 1);
    return [...counts.entries()]
      .map(([d, n]) => (n > 1 ? n + ' × ø' + d : 'ø' + d)).join(' + ');
  }).join(' or ');
  return f.name + ' — ø' + f.inletMm + ' inlet / ' + outs;
}

/**
 * Which of a design's BTO configurations MMEM do not make.
 *
 * This is the answer to "only use these in design also": until the router is
 * constrained to the catalogue, it will keep asking for fittings that have to
 * be fabricated, and this names them.
 */
export function unstockedConfigurations(configKeys = []) {
  const out = [];
  for (const key of [...new Set(configKeys)]) {
    if (findFitting(key)) continue;
    const want = parseConfigKey(key);
    out.push({
      configKey: key,
      inletMm: want?.inletMm ?? null,
      outletsMm: want?.outletsMm ?? [],
      /** The nearest parts by inlet, so somebody can see what IS available. */
      sameInlet: SELECTABLE_FITTINGS
        .filter(f => want && Number(f.inletMm) === want.inletMm)
        .map(describeFitting)
    });
  }
  return out;
}

export default {
  MMEM_BTO_FITTINGS, SELECTABLE_FITTINGS, INCOMPLETE_FITTINGS, MMEM_FITTINGS_SOURCE,
  isSelectable, parseConfigKey, findFitting, describeFitting, unstockedConfigurations
};
