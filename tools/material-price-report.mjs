// Every material line, its price, where that price came from, and whether it is
// a placeholder. Run from the repo root:  node tools/material-price-report.mjs
//
// Nothing here is invented: a line with no price prints PRICE REQUIRED.

const R='../designer/engines/';
const M=await import(new URL(R, import.meta.url).href+'materials.mjs');
const S=await import(new URL(R, import.meta.url).href+'supplier-pricing.mjs');
const rows=[];
const cat=M.MATERIAL_CATALOGUE;
for (const [key,def] of Object.entries(cat)) {
  if (def.byDiameter) {
    for (const d of Object.keys(def.byDiameter).map(Number).sort((a,b)=>a-b)) {
      const r=M.resolveCost(key,{diameterMm:d});
      rows.push({key, item:(def.label||key)+' '+d+' mm', code:r.supplierCode||'—',
        price:r.cost, source:r.source, ph:r.source==='default_placeholder'});
    }
  } else {
    const r=M.resolveCost(key,{});
    rows.push({key, item:def.label||key, code:r.supplierCode||'—',
      price:r.cost, source:r.source, ph:r.source==='default_placeholder'});
  }
}
const SRC={supplier_list:'MMEM quote 447-321514-000', nac:'NAC entered', default_placeholder:'PLACEHOLDER — not a NAC price', null:'none'};
const pad=(s,n)=>String(s).padEnd(n), rp=(s,n)=>String(s).padStart(n);
console.log(pad('ITEM',44), pad('PART CODE',20), rp('PRICE',9), ' ', pad('SOURCE',32), 'PLACEHOLDER  ACTION');
console.log('-'.repeat(140));
let ph=0, missing=0, real=0;
for (const r of rows) {
  if (r.price===null) missing++; else if (r.ph) ph++; else real++;
  console.log(pad('  '+r.item,44), pad(r.code,20),
    rp(r.price===null?'PRICE REQUIRED':'$'+r.price.toFixed(2),9), ' ',
    pad(SRC[r.source]||String(r.source),32),
    pad(r.ph?'YES':(r.price===null?'—':'no'),12),
    r.price===null?'GET A PRICE FROM THE SUPPLIER':(r.ph?'Confirm with MMEM / enter NAC rate':'none'));
}
console.log('-'.repeat(140));
console.log(`TOTAL ${rows.length} priced lines: ${real} real supplier/NAC prices, ${ph} placeholders, ${missing} with NO price`);
console.log('\nUNQUOTED list declared in materials.mjs:', M.UNQUOTED.join(', '));
