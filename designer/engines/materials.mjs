// NAC AI HVAC DESIGNER — material catalogue used by the Bill of Materials.
//
// Rates below are STARTING PLACEHOLDERS so a design can be costed on day one.
// Every line records where its price came from:
//   'nac'                 — a rate NAC has entered in HVAC Design Settings
//   'default_placeholder' — the shipped starting value, NOT a NAC price
// The BOM raises a CHECK warning listing every line still on a placeholder, so
// a quote is never sent out on numbers nobody at NAC has confirmed.

export const PRICE_SOURCE = { NAC: 'nac', PLACEHOLDER: 'default_placeholder' };

export const MATERIAL_CATALOGUE = {
  // Flexible duct, priced per metre by diameter.
  flex_duct: {
    label: 'Insulated flexible duct',
    unit: 'm',
    byDiameter: {
      100: 11.50, 125: 13.00, 150: 15.50, 175: 18.00, 200: 21.00, 225: 24.50,
      250: 28.00, 300: 36.00, 350: 46.00, 400: 58.00, 450: 72.00, 500: 88.00
    }
  },
  supply_plenum:   { label: 'Supply air plenum box',            unit: 'each', cost: 185.00 },
  return_plenum:   { label: 'Return air plenum box',            unit: 'each', cost: 165.00 },
  y_piece:         { label: 'Y-piece / branch splitter',        unit: 'each', cost: 34.00 },
  reducer:         { label: 'Duct reducer',                     unit: 'each', cost: 18.00 },
  takeoff:         { label: 'Plenum take-off / spigot',         unit: 'each', cost: 16.50 },
  joiner:          { label: 'Duct joiner',                      unit: 'each', cost: 9.50 },
  damper_manual:   { label: 'Manual balancing damper',          unit: 'each', cost: 42.00 },
  zone_motor:      { label: 'Zone motor / motorised damper',    unit: 'each', cost: 165.00 },
  diffuser_round:  { label: 'Round ceiling diffuser',           unit: 'each', cost: 46.00 },
  diffuser_4way:   { label: '4-way ceiling diffuser',           unit: 'each', cost: 68.00 },
  diffuser_slot:   { label: 'Slot diffuser',                    unit: 'each', cost: 96.00 },
  grille_linear:   { label: 'Linear bar grille',                unit: 'each', cost: 128.00 },
  grille_sidewall: { label: 'Sidewall supply grille',           unit: 'each', cost: 58.00 },
  return_grille:   { label: 'Return air grille',                unit: 'each', cost: 210.00 },
  return_filter:   { label: 'Return air filter',                unit: 'each', cost: 85.00 },
  drain_kit:       { label: 'Condensate drain kit + safety tray', unit: 'each', cost: 120.00 },
  drain_pipe:      { label: 'Condensate drain pipe',            unit: 'm',    cost: 6.50 },
  refrigerant_pipe:{ label: 'Insulated refrigerant pipe pair',  unit: 'm',    cost: 38.00 },
  interconnect_cable:{ label: 'Interconnecting cable',          unit: 'm',    cost: 7.20 },
  power_cable:     { label: 'Power supply cable',               unit: 'm',    cost: 9.40 },
  isolator:        { label: 'Weatherproof isolator',            unit: 'each', cost: 68.00 },
  hanging_kit:     { label: 'Duct hanging strap / support',     unit: 'each', cost: 4.80 },
  consumables:     { label: 'Tape, sealant, screws, cable ties', unit: 'job', cost: 145.00 },
  outdoor_feet:    { label: 'Outdoor unit mounting feet / slab', unit: 'set', cost: 95.00 }
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
    const nacByDia = nac && typeof nac === 'object' ? nac[String(diameterMm)] : undefined;
    if (nacByDia !== undefined && nacByDia !== null && nacByDia !== '') {
      return { cost: Number(nacByDia), source: PRICE_SOURCE.NAC, label: def.label + ' ' + diameterMm + ' mm', unit: def.unit };
    }
    const d = def.byDiameter[diameterMm];
    return { cost: d ?? null, source: d ? PRICE_SOURCE.PLACEHOLDER : null,
             label: def.label + ' ' + diameterMm + ' mm', unit: def.unit, missing: d === undefined };
  }

  if (nac !== undefined && nac !== null && nac !== '' && typeof nac !== 'object') {
    return { cost: Number(nac), source: PRICE_SOURCE.NAC, label: def.label, unit: def.unit };
  }
  return { cost: def.cost ?? null, source: def.cost ? PRICE_SOURCE.PLACEHOLDER : null,
           label: def.label, unit: def.unit, missing: def.cost === undefined };
}

export const OUTLET_MATERIAL_KEY = {
  round_diffuser: 'diffuser_round',
  four_way: 'diffuser_4way',
  slot: 'diffuser_slot',
  linear_bar: 'grille_linear',
  sidewall: 'grille_sidewall'
};
