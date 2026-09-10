// NAC AI HVAC DESIGNER — material catalogue used by the Bill of Materials.
//
// Every line records where its price came from:
//   'nac'                 — a rate NAC has entered in HVAC Design Settings
//   'supplier_list'       — straight off an MMEM price list or quotation
//   'default_placeholder' — a shipped starting value, NOT a NAC price
// The BOM raises a CHECK warning listing every line still on a placeholder, so
// a quote is never sent out on numbers nobody at NAC has confirmed.
//
// Anything MMEM have quoted is priced from supplier-pricing.mjs rather than
// typed here twice. Placeholders remain only where NAC has no quoted rate —
// see UNQUOTED below for that list.

import {
  paircoilRatePerM, DEFAULT_PAIRCOIL_CODE, MMEM_META,
  findAccessory, accessoriesByDiameter, MMEM_ACCESSORIES_META
} from './supplier-pricing.mjs';

export const PRICE_SOURCE = {
  NAC: 'nac',                          // a rate NAC has entered
  SUPPLIER: 'supplier_list',           // straight off the MMEM price list
  PLACEHOLDER: 'default_placeholder'   // the shipped starting value
};

const ACC_NOTE = MMEM_ACCESSORIES_META.source + ' quote ' + MMEM_ACCESSORIES_META.quoteNo +
  ', ' + MMEM_ACCESSORIES_META.date + ', ' + MMEM_ACCESSORIES_META.basis;

/** A catalogue entry priced from an MMEM accessory line. */
function fromAccessory(code, label) {
  const a = findAccessory(code);
  if (!a) return null;
  const entry = {
    label: label || a.desc,
    unit: a.packM ? 'm' : 'each',
    cost: a.packM ? Math.round((a.cost / a.packM) * 100) / 100 : a.cost,
    source: PRICE_SOURCE.SUPPLIER,
    supplierCode: a.code,
    note: ACC_NOTE
  };
  // Sold as a whole length or roll, so the BOM buys whole units.
  if (a.packM) entry.pack = { lengthM: a.packM, cost: a.cost, code: a.code };
  return entry;
}

/** Per-diameter rates from an MMEM group, with placeholders filling the gaps. */
function diameterRates(group, placeholders) {
  const quoted = accessoriesByDiameter(group);
  const byDiameter = {};
  const packs = {};
  const codes = {};
  for (const [d, a] of Object.entries(quoted)) {
    byDiameter[d] = a.packM ? Math.round((a.cost / a.packM) * 100) / 100 : a.cost;
    if (a.packM) packs[d] = { lengthM: a.packM, cost: a.cost, code: a.code };
    codes[d] = a.code;
  }
  for (const [d, cost] of Object.entries(placeholders || {})) {
    if (byDiameter[d] === undefined) byDiameter[d] = cost;
  }
  return { byDiameter, packs, codes, quotedDiameters: Object.keys(quoted).map(Number) };
}

const FLEX = diameterRates('flex', {
  // MMEM have not quoted these sizes — still placeholders.
  100: 11.50, 125: 13.00, 150: 15.50, 450: 72.00, 500: 88.00
});
const ZONE_MOTORS = diameterRates('zone_motor', {});
const DIFFUSERS = diameterRates('diffuser', {
  100: 18.00, 125: 19.00, 150: 20.00, 200: 22.00, 350: 30.00, 400: 34.00
});

/**
 * Lines MMEM have NOT quoted. These stay on shipped placeholder rates and the
 * BOM keeps naming them until NAC enters a real price. Listed explicitly so
 * the gap is visible rather than buried in the table below.
 */
export const UNQUOTED = [
  'reducer', 'joiner', 'damper_manual', 'diffuser_4way', 'diffuser_slot',
  'grille_linear', 'grille_sidewall', 'drain_kit', 'interconnect_cable',
  'power_cable', 'isolator', 'hanging_kit', 'outdoor_feet'
];

export const MATERIAL_CATALOGUE = {
  // ── Quoted by MMEM (447-321514-000) ───────────────────────────────────────
  flex_duct: {
    label: 'Insulated flexible duct R1.0',
    unit: 'm',
    byDiameter: FLEX.byDiameter,
    packByDiameter: FLEX.packs,
    codeByDiameter: FLEX.codes,
    quotedDiameters: FLEX.quotedDiameters,
    source: PRICE_SOURCE.SUPPLIER,
    note: ACC_NOTE
  },
  zone_motor: {
    label: 'Zone motor / motorised damper 24 V',
    unit: 'each',
    byDiameter: ZONE_MOTORS.byDiameter,
    codeByDiameter: ZONE_MOTORS.codes,
    quotedDiameters: ZONE_MOTORS.quotedDiameters,
    // Every quoted damper size, so an unsized line still costs something real.
    cost: ZONE_MOTORS.byDiameter[300] ?? null,
    source: PRICE_SOURCE.SUPPLIER,
    note: ACC_NOTE
  },
  diffuser_round: {
    label: 'Round insulated diffuser',
    unit: 'each',
    byDiameter: DIFFUSERS.byDiameter,
    codeByDiameter: DIFFUSERS.codes,
    quotedDiameters: DIFFUSERS.quotedDiameters,
    cost: DIFFUSERS.byDiameter[250] ?? null,
    source: PRICE_SOURCE.SUPPLIER,
    note: ACC_NOTE
  },
  supply_plenum:    fromAccessory('MMAP3SSP3', 'Supply air plenum (3 outlet)'),
  supply_plenum_2x: fromAccessory('MMAP3SSP2', 'Supply air plenum (2 outlet)'),
  return_plenum:    fromAccessory('MMAP3SRP',  'Return air plenum'),
  // MMEM quote the grille and filter as one item, so the BOM must not also
  // add a separate filter line.
  return_grille:    { ...fromAccessory('MMARAG800600', 'Return air grille and filter 800 x 600'),
                      includesFilter: true },
  return_filter:    { label: 'Return air filter', unit: 'each', cost: 0,
                      source: PRICE_SOURCE.SUPPLIER,
                      note: 'Included in the return air grille line (MMARAG800600).' },
  return_air_box:   fromAccessory('MMARAB8006002X400', 'Return air box 800 x 600 — 2 x 400'),
  // MMEM size take-offs and Y-pieces by their own code (B8/B9/B11, Y3–Y6) and
  // the quote does not map those to duct diameters, so the tool does not guess.
  // These defaults are the mid-range item; the estimator can swap the line.
  takeoff:          fromAccessory('MMAB9',   'Butterfly take-off (B9)'),
  takeoff_double:   fromAccessory('MMADB6',  'Double butterfly take-off (DB6)'),
  y_piece:          fromAccessory('MMADY14', 'Y-piece (Y4 / DY14)'),
  zone_cable:       { ...fromAccessory('MMADZ15', 'Zone cable lead (15 m)'), unit: 'each',
                      cost: findAccessory('MMADZ15').cost, pack: null },
  drain_pipe:       fromAccessory('MMAPP20',      'Condensate drain pipe 20 mm rigid'),
  drain_elbow:      fromAccessory('MMAPPELB9020', 'Condensate drain 20 mm 90° elbow'),
  drain_insulation: fromAccessory('MMAPI1',       'Condensate drain pipe insulation 1"'),
  duct_tape:        fromAccessory('MMABTN',       'Duct tape (Nitto 48 mm x 30 m)'),
  refrigerant_pipe: { label: 'Paircoil ' + DEFAULT_PAIRCOIL_CODE + ' (3/8 – 5/8)', unit: 'm',
                      cost: paircoilRatePerM(), source: PRICE_SOURCE.SUPPLIER,
                      pack: { lengthM: 20, cost: 342.00, code: DEFAULT_PAIRCOIL_CODE },
                      note: MMEM_META.source + ' ' + MMEM_META.edition + ', ' + MMEM_META.basis },

  // ── Not quoted — shipped placeholders until NAC enter a rate ───────────────
  reducer:          { label: 'Duct reducer',                     unit: 'each', cost: 18.00 },
  joiner:           { label: 'Duct joiner',                      unit: 'each', cost: 9.50 },
  damper_manual:    { label: 'Manual balancing damper',          unit: 'each', cost: 42.00 },
  diffuser_4way:    { label: '4-way ceiling diffuser',           unit: 'each', cost: 68.00 },
  diffuser_slot:    { label: 'Slot diffuser',                    unit: 'each', cost: 96.00 },
  grille_linear:    { label: 'Linear bar grille',                unit: 'each', cost: 128.00 },
  grille_sidewall:  { label: 'Sidewall supply grille',           unit: 'each', cost: 58.00 },
  drain_kit:        { label: 'Condensate safety tray / pump',    unit: 'each', cost: 120.00 },
  interconnect_cable:{ label: 'Interconnecting cable',           unit: 'm',    cost: 7.20 },
  power_cable:      { label: 'Power supply cable',               unit: 'm',    cost: 9.40 },
  isolator:         { label: 'Weatherproof isolator',            unit: 'each', cost: 68.00 },
  hanging_kit:      { label: 'Duct hanging strap / support',     unit: 'each', cost: 4.80 },
  consumables:      { label: 'Sealant, screws, cable ties, sundries', unit: 'job', cost: 145.00 },
  outdoor_feet:     { label: 'Outdoor unit mounting feet / slab', unit: 'set', cost: 95.00 }
};

/**
 * Resolve a unit cost. `nacRates` is the parsed `nac_hvac_materials` settings
 * record: { "<key>": cost } or { "flex_duct": { "150": 16.20 } }.
 */
export function resolveCost(key, { diameterMm = null, nacRates = null } = {}) {
  const nac = nacRates && nacRates[key];
  const def = MATERIAL_CATALOGUE[key];
  if (!def) return { cost: null, source: null, label: key, unit: 'each', missing: true };

  if (diameterMm !== null && def.byDiameter) {
    const label = def.label + ' ' + diameterMm + ' mm';
    const pack = def.packByDiameter?.[diameterMm] || null;
    const supplierCode = def.codeByDiameter?.[diameterMm] || null;
    // A NAC rate may be given per diameter, or as one flat rate for the line.
    // Either way it wins, and it is per unit of measure, so it also overrides
    // the pack price.
    const nacByDia = nac && typeof nac === 'object' ? nac[String(diameterMm)] : nac;
    if (nacByDia !== undefined && nacByDia !== null && nacByDia !== '') {
      return { cost: Number(nacByDia), source: PRICE_SOURCE.NAC, label, unit: def.unit,
               pack: null, supplierCode: null };
    }
    const d = def.byDiameter[diameterMm];
    if (d === undefined) return { cost: null, source: null, label, unit: def.unit, missing: true };
    // Only the diameters MMEM actually quoted are supplier-priced; the rest of
    // the table is still a placeholder.
    const quoted = (def.quotedDiameters || []).includes(Number(diameterMm));
    return { cost: d, source: quoted ? (def.source || PRICE_SOURCE.SUPPLIER) : PRICE_SOURCE.PLACEHOLDER,
             label, unit: def.unit, pack, supplierCode,
             note: quoted ? def.note || null : null };
  }

  if (nac !== undefined && nac !== null && nac !== '' && typeof nac !== 'object') {
    return { cost: Number(nac), source: PRICE_SOURCE.NAC, label: def.label, unit: def.unit,
             pack: null, supplierCode: null };
  }
  // A line whose shipped rate came off the supplier list is a real cost, not a
  // placeholder, so it does not raise the placeholder warning.
  return { cost: def.cost ?? null,
           source: def.cost === null || def.cost === undefined
             ? null : (def.source || PRICE_SOURCE.PLACEHOLDER),
           label: def.label, unit: def.unit, note: def.note || null,
           pack: def.pack || null, supplierCode: def.supplierCode || null,
           includesFilter: def.includesFilter || false,
           missing: def.cost === undefined };
}

export const OUTLET_MATERIAL_KEY = {
  round_diffuser: 'diffuser_round',
  four_way: 'diffuser_4way',
  slot: 'diffuser_slot',
  linear_bar: 'grille_linear',
  sidewall: 'grille_sidewall'
};
