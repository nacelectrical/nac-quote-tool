// Every indoor model NAC can select, and whether its available external static
// pressure is on file. Run from the repo root:
//
//   node tools/static-pressure-report.mjs
//
// Nothing here is invented. A model whose data sheet figure was never
// transcribed prints NO and STATIC PRESSURE CHECK NOT COMPLETED — MANUFACTURER
// DATA REQUIRED, because a design on that model has not passed its static
// pressure check and must not be read as though it had.

const R = new URL('../designer/engines/', import.meta.url).href;
const { buildCatalogue, allModels } = await import(R + 'catalogue.mjs');
const { UNIT_SPEC_META } = await import(R + 'unit-specs.mjs');
const { STATIC_NOT_COMPLETED } = await import(R + 'pressure.mjs');

const models = allModels(buildCatalogue({}));

const pad = (s, n) => String(s).padEnd(n);
const rp  = (s, n) => String(s).padStart(n);

console.log('NAC — STATIC PRESSURE DATA AUDIT');
console.log('Manufacturer source on file: ' + UNIT_SPEC_META.source +
            ' (' + UNIT_SPEC_META.loadedAt + '), ' + UNIT_SPEC_META.modelCount + ' rows');
console.log('');
console.log(pad('BRAND', 20), pad('INDOOR MODEL', 24), rp('CAPACITY', 9), ' ',
            pad('STATIC AVAILABLE', 18), pad('SOURCE', 40), 'ACTION REQUIRED');
console.log('-'.repeat(190));

let have = 0, missing = 0;
const byBrand = new Map();

for (const m of models.sort((a, b) =>
      a.brandName.localeCompare(b.brandName) || a.kw - b.kw || a.name.localeCompare(b.name))) {
  const pa = m.specs?.availableStaticPa;
  const ok = pa !== null && pa !== undefined && pa !== '';
  if (ok) have++; else missing++;
  const b = byBrand.get(m.brandName) || { have: 0, total: 0 };
  b.total++; if (ok) b.have++;
  byBrand.set(m.brandName, b);

  console.log(pad(m.brandName, 20), pad(m.name, 24), rp(m.kw + ' kW', 9), ' ',
    pad(ok ? 'YES — ' + pa + ' Pa' : 'NO', 18),
    pad(ok ? (m.specSource || 'NAC entered') : 'none on file', 40),
    ok ? 'none'
       : 'Enter available ESP from the ' + m.brandName + ' ' + m.name +
         ' data sheet in HVAC Design Settings → Equipment specifications');
}

console.log('-'.repeat(190));
console.log('TOTAL ' + models.length + ' selectable indoor models: ' +
            have + ' with static pressure on file, ' + missing + ' without.');
console.log('');
for (const [brand, b] of [...byBrand].sort((a, b) => a[0].localeCompare(b[0]))) {
  console.log('  ' + pad(brand, 22) + rp(b.have + ' / ' + b.total, 10) +
              (b.have === 0 ? '   no static pressure data at all for this brand' : ''));
}
console.log('');
console.log('WHAT HAPPENS ON A MODEL WITH NO FIGURE');
console.log('  The engine sets status = "not_completed" and raises a CRITICAL warning:');
console.log('  "' + STATIC_NOT_COMPLETED + '"');
console.log('  The design cannot be approved until a named estimator acknowledges it,');
console.log('  or the manufacturer figure is entered. It is never reported as a pass.');
