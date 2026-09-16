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

/**
 * Per-diameter rates from an MMEM group, with placeholders filling the gaps.
 *
 * `soldInLengthsOfM` is how the item reaches NAC. Flex duct comes in 6 m
 * lengths, so every diameter carries that pack shape — including the sizes
 * MMEM have not quoted. Without it, a rate NAC types for a 150 would be costed
 * per metre while a 300 was costed by the length, and the same job would be
 * priced two different ways depending on which size a run happened to need.
 */
function diameterRates(group, placeholders, soldInLengthsOfM = null) {
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
    if (byDiameter[d] !== undefined) continue;
    if (soldInLengthsOfM) {
      // The placeholder is quoted here as the price of one length, because that
      // is the only number NAC can check against an invoice. It is still a
      // placeholder and is still reported as one.
      byDiameter[d] = Math.round((cost / soldInLengthsOfM) * 100) / 100;
      packs[d] = { lengthM: soldInLengthsOfM, cost, code: null };
    } else {
      byDiameter[d] = cost;
    }
  }
  return { byDiameter, packs, codes, soldInLengthsOfM,
           quotedDiameters: Object.keys(quoted).map(Number) };
}

// Flex duct is sold to NAC in 6 m LENGTHS, so every price below — quoted,
// placeholder or typed into Settings — is the price of one length. A 7 m run
// costs two lengths.
//
// MMEM quoted 200 to 400. The three below they have not, so these are still
// placeholders and are still reported as such; they are stated per 6 m length
// so the number NAC checks is the number on the invoice.
//
// 450 and 500 are deliberately absent: NAC never run them — two 350/400s
// instead, and 400 only on a return. They are not on the duct ladder in
// settings.mjs either, so a priced row here could never be selected and only
// inflated the count of prices still to be confirmed.
const FLEX_LENGTH_M = 6;
const FLEX = diameterRates('flex', {
  100: 11.50 * FLEX_LENGTH_M, 125: 13.00 * FLEX_LENGTH_M, 150: 15.50 * FLEX_LENGTH_M
}, FLEX_LENGTH_M);
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
  'reducer', 'joiner', 'damper_manual',
  'drain_kit', 'interconnect_cable', 'power_cable', 'isolator',
  'hanging_kit', 'outdoor_feet'
];

/**
 * Outlets NAC quote as a separate line, not out of this price book.
 *
 * A linear bar grille goes on a job now and then, and when it does NAC price
 * it on its own. Carrying a shipped rate for it meant a number nobody had
 * agreed could walk into a customer's quote. It is listed on the bill of
 * materials with no cost and said to be quoted separately, which is the truth
 * and is not the same as a line somebody forgot to price.
 */
export const QUOTED_SEPARATELY = ['grille_linear'];

export const MATERIAL_CATALOGUE = {
  // ── Quoted by MMEM (447-321514-000) ───────────────────────────────────────
  flex_duct: {
    label: 'Insulated flexible duct R1.0',
    // The unit NAC BUY in. A rate typed into Settings is the price of one
    // length, not a price per metre.
    unit: FLEX_LENGTH_M + ' m length',
    soldInLengthsOfM: FLEX_LENGTH_M,
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
  // THE PHYSICAL BTO MANIFOLD. A fabricated multi-spigot body, not a saddle
  // collar: it is what the mains actually terminate at. Priced off the double
  // take-off until NAC gives the real fabrication rate, and flagged so the
  // rate audit can see it is a placeholder rather than a supplier price.
  bto_fitting:      { ...fromAccessory('MMADB6', 'BTO branch take-off manifold'),
                      unit: 'each', placeholderRate: true,
                      rateNote: 'Placeholder \u2014 confirm NAC\u2019s fabricated BTO rate.' },
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
  // Quoted separately on the jobs it appears on, so it carries NO rate here.
  grille_linear:    { label: 'Linear bar grille',                unit: 'each', cost: null,
                      quotedSeparately: true },
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
      const entered = Number(nacByDia);
      // On a line sold by the length, what NAC typed is the price of ONE
      // LENGTH. Returning it as a per-metre rate would under-price every run by
      // the length of the pack, which on a 20 m job is most of the ductwork.
      if (def.soldInLengthsOfM) {
        return { cost: Math.round((entered / def.soldInLengthsOfM) * 100) / 100,
                 source: PRICE_SOURCE.NAC, label, unit: def.unit,
                 pack: { lengthM: def.soldInLengthsOfM, cost: entered, code: null },
                 supplierCode: null };
      }
      return { cost: entered, source: PRICE_SOURCE.NAC, label, unit: def.unit,
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

// NAC fit round insulated diffusers. Linear bar grilles go on occasionally and
// are quoted separately (see QUOTED_SEPARATELY). The 4-way, slot and sidewall
// outlets NAC do not fit at all, and carrying shipped rates for them only
// lengthened the list of prices still to confirm.
export const OUTLET_MATERIAL_KEY = {
  round_diffuser: 'diffuser_round',
  linear_bar: 'grille_linear'
};
