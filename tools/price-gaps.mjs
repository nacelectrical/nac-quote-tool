// The prices NAC still has to confirm — and ONLY those.
//
//   node tools/price-gaps.mjs
//
// A line needs a price when it has none at all, or when it is still on a
// shipped placeholder rate. A line is only worth listing when it can actually
// be SELECTED: a diameter that is not on the duct ladder can never appear on a
// quote, so asking for its price wastes NAC's time.
//
// Nothing here is invented. Every price that exists comes from the MMEM quote
// or from what NAC has typed in; this reports the holes, it does not fill them.

const R = new URL('../designer/engines/', import.meta.url).href;
const { MATERIAL_CATALOGUE, resolveCost } = await import(R + 'materials.mjs');
const { DEFAULT_SETTINGS } = await import(R + 'settings.mjs');
const { MMEM_ACCESSORIES_META } = await import(R + 'supplier-pricing.mjs');
const { ZONE_CONTROLLERS } = await import(R + 'catalogue.mjs');

const LADDER = DEFAULT_SETTINGS.duct.availableDiametersMm;
const OUTLET_SIZES = [...new Set(Object.values(DEFAULT_SETTINGS.outlets.types || {})
  .flatMap(t => t.sizesMm || []))];

const rows = [];
for (const [key, def] of Object.entries(MATERIAL_CATALOGUE)) {
  // Every diameter the line COULD be asked for, not just the ones the table
  // happens to hold. A size missing from the table altogether is the worst
  // case — it has no price at all and it blocks a quote — and iterating the
  // table's own keys is exactly how it stays invisible.
  const diameters = def.byDiameter
    ? [...new Set([...Object.keys(def.byDiameter).map(Number), ...LADDER])].sort((a, b) => a - b)
    : [null];
  for (const d of diameters) {
    const r = resolveCost(key, d ? { diameterMm: d } : {});
    const needs = r.cost === null || r.source === 'default_placeholder';
    if (!needs) continue;
    // Can this line ever be chosen?
    const reachable = d === null ? true
      : LADDER.includes(d) || OUTLET_SIZES.includes(d);
    rows.push({ key, label: r.label, unit: r.unit, diameterMm: d,
                current: r.cost, missing: r.cost === null, reachable });
  }
}

const live = rows.filter(r => r.reachable);
const dead = rows.filter(r => !r.reachable);
const pad = (s, n) => String(s).padEnd(n);

console.log('PRICES NAC STILL HAS TO CONFIRM');
console.log('Verified source already loaded: ' + MMEM_ACCESSORIES_META.source +
            ' quote ' + MMEM_ACCESSORIES_META.quoteNo + ' (' + MMEM_ACCESSORIES_META.date + ')');
console.log('');
console.log(pad('ITEM', 46), pad('UNIT', 16), pad('SHIPPED RATE', 14), 'WHY IT IS LISTED');
console.log('-'.repeat(110));
for (const r of live.sort((a, b) => a.label.localeCompare(b.label))) {
  console.log(pad(r.label, 46), pad(r.unit, 16),
    pad(r.missing ? '—' : '$' + Number(r.current).toFixed(2), 14),
    r.missing ? 'NO PRICE AT ALL — a quote is short by whatever this is worth'
              : 'shipped placeholder, not a NAC or supplier price');
}
// Zone controllers are not materials, but one with no cost blocks a quote in
// exactly the same way, so it belongs on the same list.
const controllers = ZONE_CONTROLLERS.filter(c => c.cost === null || c.cost === undefined);
for (const c of controllers) {
  console.log(pad(c.name + ' (zone controller)', 46), pad('each', 16), pad('—', 14),
    'NO PRICE AT ALL — a quote is short by whatever this is worth');
}
console.log('-'.repeat(110));
console.log((live.length + controllers.length) + ' price(s) to confirm — ' +
  (live.filter(r => r.missing).length + controllers.length) + ' with no price at all, ' +
  live.filter(r => !r.missing).length + ' on placeholder rates.');
if (dead.length) {
  console.log('');
  console.log('NOT LISTED — these cannot be selected, so they need no price:');
  for (const r of dead) console.log('   ' + r.label);
}
