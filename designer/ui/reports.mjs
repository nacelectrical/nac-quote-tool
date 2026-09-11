// NAC AI HVAC DESIGNER — PART 26: PDF output.
//
// Two documents, both produced as a print-ready HTML page opened in a new
// window (the browser's own Save as PDF). No PDF library is loaded — the rest
// of the NAC tool prints the same way.
//
//   INTERNAL HVAC DESIGN SHEET     — everything, costing included
//   CUSTOMER HVAC DESIGN SUMMARY   — no costs, no internal engineering detail

import { ENGINEERING_DISCLAIMER } from './tabs.mjs';
import { PRESSURE_DISCLAIMER } from '../engines/pressure.mjs';

const esc = (s) => String(s === null || s === undefined ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const money = (n) => n === null || n === undefined ? '—'
  : '$' + Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const nn = (n, dp = 1) => n === null || n === undefined || !isFinite(n) ? '—' : Number(n).toFixed(dp);

const CSS = `
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
         color: #14142c; margin: 0; font-size: 11px; line-height: 1.45; }
  .sheet { max-width: 190mm; margin: 0 auto; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 16px;
           background: linear-gradient(135deg,#3B2D8F,#2B6CB8); color: #fff; padding: 14px 18px;
           border-radius: 8px; }
  header img { height: 42px; background: #fff; border-radius: 6px; padding: 3px 7px; }
  header h1 { margin: 0; font-size: 15px; color: #F5C200; letter-spacing: .3px; }
  header .meta { text-align: right; font-size: 10px; color: rgba(255,255,255,.85); }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .6px; color: #2B6CB8;
       border-bottom: 2px solid #F5C200; padding-bottom: 4px; margin: 18px 0 8px; }
  h3 { font-size: 11px; margin: 12px 0 5px; color: #3B2D8F; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 10px; font-size: 10px; }
  th { background: #eef2fb; text-align: left; padding: 5px 7px; border: 1px solid #dbe2f2;
       font-size: 9px; text-transform: uppercase; letter-spacing: .4px; color: #4a5578; }
  td { padding: 5px 7px; border: 1px solid #e6e9f2; vertical-align: top; }
  td.r, th.r { text-align: right; }
  .kv { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 10px; }
  .kv div { border: 1px solid #e6e9f2; border-radius: 6px; padding: 7px 9px; background: #fafbff; }
  .kv .l { font-size: 8.5px; text-transform: uppercase; letter-spacing: .4px; color: #6b7396; }
  .kv .v { font-size: 13px; font-weight: 700; margin-top: 2px; }
  .kv .s { font-size: 9px; color: #6b7396; }
  .note { font-size: 9.5px; color: #555f80; margin: 4px 0 10px; }
  .warnbox { border-left: 3px solid #d08700; background: #fffaf0; padding: 8px 11px;
             border-radius: 0 6px 6px 0; margin-bottom: 10px; font-size: 10px; }
  .warnbox.crit { border-left-color: #c0392b; background: #fdf1f0; }
  .disclaimer { font-size: 9px; color: #6b7396; border-top: 1px solid #e6e9f2;
                padding-top: 8px; margin-top: 16px; }
  .planimg { width: 100%; border: 1px solid #dbe2f2; border-radius: 6px; margin-bottom: 10px; }
  .sev { display: inline-block; font-size: 8px; font-weight: 700; padding: 1px 5px;
         border-radius: 3px; letter-spacing: .4px; }
  .sev.CRITICAL { background:#c0392b; color:#fff } .sev.WARNING { background:#d08700; color:#fff }
  .sev.CHECK { background:#2B6CB8; color:#fff }   .sev.INFO { background:#dfe3ef; color:#3a4160 }
  footer { margin-top: 18px; font-size: 9px; color: #6b7396; border-top: 1px solid #e6e9f2; padding-top: 8px; }
  .pagebreak { page-break-before: always; }
  @media print { .noprint { display: none !important; } }
  .noprint { position: fixed; top: 10px; right: 10px; }
  .noprint button { font: inherit; padding: 8px 14px; border-radius: 6px; border: none;
                    background: #2B6CB8; color: #fff; font-weight: 700; cursor: pointer; }
`;

function tbl(cols, rows) {
  if (!rows || !rows.length) return '<p class="note">None.</p>';
  return '<table><thead><tr>' +
    cols.map(c => '<th' + (c.r ? ' class="r"' : '') + '>' + esc(c.label) + '</th>').join('') +
    '</tr></thead><tbody>' +
    rows.map(r => '<tr>' + cols.map(c => '<td' + (c.r ? ' class="r"' : '') + '>' +
      esc(c.get ? c.get(r) : r[c.key]) + '</td>').join('') + '</tr>').join('') +
    '</tbody></table>';
}

function kv(items) {
  return '<div class="kv">' + items.map(i =>
    '<div><div class="l">' + esc(i[0]) + '</div><div class="v">' + esc(i[1]) + '</div>' +
    (i[2] ? '<div class="s">' + esc(i[2]) + '</div>' : '') + '</div>').join('') + '</div>';
}

function shell(title, logo, design, bodyHtml) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>${CSS}</style></head><body><div class="sheet">
<header>
  ${logo ? `<img src="${logo}" alt="NAC">` : '<div><strong>NAC Electrical Air &amp; Refrigeration</strong></div>'}
  <div><h1>${esc(title)}</h1>
    <div style="font-size:10px;color:rgba(255,255,255,.8)">${esc(design.job?.description || '')}</div></div>
  <div class="meta">
    ${esc(design.id)}<br>${new Date().toLocaleDateString('en-AU')}<br>
    ABN: 97 636 392 982
  </div>
</header>
<h2>Customer</h2>
${kv([
  ['Customer', design.customer?.name || '—'],
  ['Site address', design.customer?.address || '—'],
  ['Phone', design.customer?.phone || '—'],
  ['Email', design.customer?.email || '—']
])}
${bodyHtml}
<footer>NAC Electrical Air &amp; Refrigeration &middot; ABN 97 636 392 982 &middot; nacelectrical.com.au</footer>
</div>
<div class="noprint"><button onclick="window.print()">Save as PDF</button></div>
</body></html>`;
}

/** PART 26 — INTERNAL HVAC DESIGN SHEET. */
export function internalReportHtml(design, { logo = null, planSnapshot = null } = {}) {
  const d = design;
  const load = d.systemLoad, u = d.selectedUnit;
  let b = '';

  b += '<h2>Design summary</h2>' + kv([
    ['Conditioned area', nn(load?.totalConditionedAreaSqM, 2) + ' m²', (load?.roomCount || 0) + ' rooms'],
    ['Design cooling', nn(load?.designCoolingKw, 2) + ' kW', nn(load?.averageWattsPerM2, 0) + ' W/m²'],
    ['Design heating', nn(load?.designHeatingKw, 2) + ' kW'],
    ['NAC 145 W/m² rule', nn(load?.legacy?.kw, 1) + ' kW',
      (load?.varianceVsLegacyPct > 0 ? '+' : '') + nn(load?.varianceVsLegacyPct, 1) + '% variance'],
    ['Selected system', u ? u.brandName + ' ' + u.model : '—', u ? u.capacityKw + ' kW ' + u.phase : ''],
    ['Total airflow', (d.airflow?.allocatedAirflowLs ?? '—') + ' L/s'],
    ['Outlets', d.outlets?.totals?.total ?? '—'],
    ['Zones', d.zones?.zoneCount ?? '—', d.controller?.name || ''],
    ['Total duct length', nn(d.network?.totalDuctLengthM, 1) + ' m'],
    ['Return', d.returnDesign ? d.returnDesign.returnCount + ' × ' + (d.returnDesign.returns[0]?.grilleSize || '') : '—',
      d.returnDesign ? d.returnDesign.perReturnLs + ' L/s each' : ''],
    ['Estimated static', nn(d.pressure?.estimatedRequirementPa, 0) + ' Pa',
      d.pressure && !d.pressure.checkCompleted ? d.pressure.statusLabel
        : d.pressure?.unitAvailableStaticPa ? 'of ' + d.pressure.unitAvailableStaticPa + ' Pa available'
        : 'unit ESP not on file'],
    ['Plan calibration', d.calibration ? nn(d.calibration.pixelsPerMm, 5) + ' px/mm' : 'NOT CALIBRATED']
  ]);

  if (planSnapshot) {
    b += '<h2>Floor plan overlay</h2><img class="planimg" src="' + planSnapshot + '">';
    b += '<p class="note">Rooms, duct routes and equipment positions as marked up in NAC AI HVAC Designer.</p>';
  }

  b += '<h2>Room schedule</h2>' + tbl([
    { label: 'Room', key: 'label' },
    { label: 'Width (m)', r: true, get: r => r.widthMm ? (r.widthMm / 1000).toFixed(2) : '—' },
    { label: 'Length (m)', r: true, get: r => r.lengthMm ? (r.lengthMm / 1000).toFixed(2) : '—' },
    { label: 'Area (m²)', r: true, get: r => nn(r.areaSqM, 2) },
    { label: 'Ceiling (m)', r: true, get: r => (r.ceilingHeightMm / 1000).toFixed(2) },
    { label: 'Conditioned', get: r => r.conditioned ? 'Yes' : 'No' },
    { label: 'Source', get: r => r.measurement?.sourceLabel || '—' },
    { label: 'Confidence', r: true, get: r => Math.round(r.confidence) + '% ' + r.confidenceBand },
    { label: 'Status', key: 'status' }
  ], d.rooms || []);

  if (load) {
    b += '<h2>Room loads</h2>' + tbl([
      { label: 'Room', key: 'label' },
      { label: 'Area (m²)', r: true, get: r => nn(r.areaSqM, 2) },
      { label: 'Cooling (W)', r: true, key: 'coolingW' },
      { label: 'Heating (W)', r: true, key: 'heatingW' },
      { label: 'W/m²', r: true, key: 'wattsPerM2' },
      { label: '% of total', r: true, get: r => r.shareOfTotal + '%' },
      { label: 'Override', get: r => r.overridden ? 'YES — ' + (r.overrideNote || '') : '' }
    ], load.rooms);
  }

  if (d.airflow) {
    b += '<h2 class="pagebreak">Airflow</h2>' + tbl([
      { label: 'Room', key: 'label' },
      { label: 'Load (W)', r: true, key: 'loadW' },
      { label: 'Recommended (L/s)', r: true, key: 'recommendedLs' },
      { label: 'Design (L/s)', r: true, key: 'adjustedLs' },
      { label: '% of system', r: true, get: r => r.systemSharePct + '%' },
      { label: 'Override', get: r => r.overridden ? 'YES' : '' }
    ], d.airflow.rows);
  }

  if (d.outlets) {
    b += '<h2>Outlets</h2>' + tbl([
      { label: 'Room', key: 'label' },
      { label: 'Type', key: 'typeLabel' },
      { label: 'Qty', r: true, key: 'quantity' },
      { label: 'Airflow (L/s)', r: true, key: 'airflowLs' },
      { label: 'Per outlet (L/s)', r: true, key: 'perOutletLs' }
    ], d.outlets.rows);
  }

  if (d.network) {
    b += '<h2>Ductwork</h2>' + tbl([
      { label: 'Branch', key: 'id' },
      { label: 'Destination', key: 'destination' },
      { label: 'Role', key: 'role' },
      { label: 'Airflow (L/s)', r: true, key: 'airflowLs' },
      { label: 'Diameter (mm)', r: true, key: 'diameterMm' },
      { label: 'Velocity (m/s)', r: true, key: 'velocityMs' },
      { label: 'Length (m)', r: true, get: r => r.lengthM || '—' },
      { label: 'Δp (Pa)', r: true, key: 'pressureDropPa' }
    ], d.network.sections);
  }

  if (d.returnDesign) {
    b += '<h2>Return air</h2>' + tbl([
      { label: '#', r: true, key: 'index' },
      { label: 'Airflow (L/s)', r: true, key: 'airflowLs' },
      { label: 'Grille', key: 'grilleSize' },
      { label: 'Free area (m²)', r: true, key: 'freeAreaM2' },
      { label: 'Face velocity (m/s)', r: true, key: 'faceVelocityMs' }
    ], d.returnDesign.returns) +
    '<p class="note">Filter ' + esc(d.returnDesign.filter.size) + ' at ' +
      esc(d.returnDesign.filter.faceVelocityMs) + ' m/s. Return duct ' +
      esc(d.returnDesign.duct.diameterMm) + ' mm at ' + esc(d.returnDesign.duct.velocityMs) + ' m/s.</p>';
  }

  if (d.zones) {
    b += '<h2>Zones</h2>' + tbl([
      { label: 'Zone', key: 'name' },
      { label: 'Rooms', get: r => r.rooms.join(', ') },
      { label: 'Type', key: 'kind' },
      { label: 'Airflow (L/s)', r: true, key: 'airflowLs' },
      { label: '% of system', r: true, get: r => r.systemSharePct + '%' },
      { label: 'Always open', get: r => r.alwaysOpen ? 'Yes' : '' }
    ], d.zones.zones) +
    '<p class="note">Minimum open airflow ' + esc(d.zones.minimumOpenAirflowLs) + ' L/s (' +
      esc(d.zones.minimumOpenFractionPct) + '% of system); required ' + esc(d.zones.requiredMinimumLs) +
      ' L/s. ' + esc(d.zones.bypassNote) + '</p>';
  }

  if (d.pressure) {
    b += '<h2>Static pressure — ' + esc(PRESSURE_DISCLAIMER) + '</h2>';
    // The three states are spelled out. A report that simply omitted the
    // comparison would let a reader assume the design cleared it.
    if (d.pressure.status !== 'pass') {
      b += '<div class="warnbox' + (d.pressure.status === 'fail' ? ' crit' : '') + '"><strong>' +
        esc(d.pressure.statusLabel) + '</strong></div>';
    }
    b += tbl([
      { label: 'Component', key: 'item' },
      { label: 'Detail', key: 'detail' },
      { label: 'Pa', r: true, key: 'pa' }
    ], d.pressure.components) +
    '<p class="note">Estimated requirement ' + esc(d.pressure.estimatedRequirementPa) + ' Pa. Unit available ' +
      esc(d.pressure.unitAvailableStaticPa ?? 'not on file') + '. Margin ' +
      esc(d.pressure.remainingMarginPa ?? '—') + ' Pa. Result: ' + esc(d.pressure.statusLabel) + '.</p>';
  }

  b += '<h2 class="pagebreak">Design assumptions</h2>' + tbl([
    { label: 'Assumption', key: 'label' },
    { label: 'Value', key: 'value' },
    { label: 'Source', key: 'source' }
  ], d.assumptions || []);

  const warnings = d.warnings || [];
  if (warnings.length) {
    b += '<h2>Warnings</h2>';
    const crit = warnings.filter(w => w.severity === 'CRITICAL');
    crit.forEach(w => {
      b += '<div class="warnbox crit"><strong>CRITICAL — ' + esc(w.code) + '</strong><br>' + esc(w.message) +
        (w.acknowledged ? '<br><em>Acknowledged by ' + esc(w.acknowledgedBy) + ' on ' +
          esc(new Date(w.acknowledgedAt).toLocaleString('en-AU')) + '</em>' : '<br><em>NOT ACKNOWLEDGED</em>') +
        '</div>';
    });
    b += tbl([
      { label: 'Severity', get: r => r.severity },
      { label: 'Area', key: 'area' },
      { label: 'Code', key: 'code' },
      { label: 'Detail', key: 'message' }
    ], warnings.filter(w => w.severity !== 'CRITICAL'));
  }

  if (d.bom) {
    b += '<h2 class="pagebreak">Bill of materials</h2>' + tbl([
      { label: 'Category', key: 'category' },
      { label: 'Item', key: 'label' },
      { label: 'Qty', r: true, key: 'quantity' },
      { label: 'Unit', key: 'unit' },
      { label: 'Unit cost', r: true, get: r => r.unitCost === null ? '—' : money(r.unitCost) },
      { label: 'Total', r: true, get: r => r.totalCost === null ? '—' : money(r.totalCost) },
      { label: 'Price source', get: r => r.priceSource === 'nac' ? 'NAC'
          : r.priceSource === 'default_placeholder' ? 'PLACEHOLDER' : 'NONE' }
    ], d.bom.items);
  }

  if (d.labour) {
    if (d.labour.mode === 'flat') {
      b += '<h2>Installation charge</h2>' + tbl([
        { label: 'Item', key: 'task' },
        { label: 'Amount', r: true, get: r => money(r.cost) }
      ], d.labour.rows) +
      '<p class="note">Flat job fee: ' + money(d.labour.totalFee) + ' ' +
        (d.labour.jobFeeExGst ? 'ex GST' : 'inc GST') +
        '. This is margin, not cost, so it is not included in the job cost below.</p>';
    } else {
      b += '<h2>Labour</h2>' + tbl([
        { label: 'Task', key: 'task' },
        { label: 'Hours', r: true, key: 'hours' },
        { label: 'Cost', r: true, get: r => money(r.cost) }
      ], d.labour.rows) +
      '<p class="note">' + esc(d.labour.totalHours) + ' h at ' + money(d.labour.ratePerHour) + '/h = ' +
        money(d.labour.totalCost) + '</p>';
    }
  }

  if (d.commercials) {
    const c = d.commercials;
    const onFee = c.pricingBasis?.key === 'materials_plus_fee';
    b += '<h2>Costing</h2>' + kv([
      ['Equipment', money(c.equipmentCost)], ['Materials', money(c.materialsCost)],
      ['Labour', money(c.labourCost)], ['Subcontractor', money(c.subcontractorCost)],
      ['Other', money(c.otherCost)], ['Total job cost', money(c.totalJobCost)],
      ['Job fee', onFee ? money(c.jobFee) : '—'],
      ['Sell (ex GST)', money(c.sellPriceExGst)], ['GST', money(c.gstAmount)],
      ['Sell (inc GST)', money(c.sellPriceIncGst)],
      ['Gross profit', money(c.grossProfit)],
      ['Gross margin', c.grossMarginPct === null ? '—' : c.grossMarginPct + '%'],
      ['Pricing basis', c.pricingBasis?.label || 'none'],
      ['Quote', d.quoteId || 'not yet quoted']
    ]);
    if (onFee) {
      b += tbl([
        { label: 'Price build-up' , key: 'line' },
        { label: 'Amount', r: true, get: r => money(r.amount) }
      ], [
        { line: 'Total job cost', amount: c.totalJobCost },
        { line: 'Job fee (' + (c.pricingBasis.jobFeeExGst ? 'ex GST' : 'inc GST, applied ex GST') + ')',
          amount: c.pricingBasis.feeAppliedExGst },
        { line: 'Sell price ex GST', amount: c.sellPriceExGst },
        { line: 'GST', amount: c.gstAmount },
        { line: 'Sell price inc GST', amount: c.sellPriceIncGst }
      ]);
    }
  }

  b += '<div class="disclaimer"><strong>Engineering note.</strong> ' + esc(ENGINEERING_DISCLAIMER) +
    ' Manufacturer requirements always override the assumptions in this application.</div>';

  return shell('Internal HVAC Design Sheet', logo, d, b);
}

/** PART 26 — CUSTOMER HVAC DESIGN SUMMARY. No costs, no internal detail. */
export function customerReportHtml(design, { logo = null, planSnapshot = null } = {}) {
  const d = design;
  const u = d.selectedUnit;
  let b = '';

  b += '<h2>Your system</h2>' + kv([
    ['System', u ? u.brandName + ' ' + u.model : '—', u ? u.capacityKw + ' kW reverse cycle ducted' : ''],
    ['Conditioned area', nn(d.systemLoad?.totalConditionedAreaSqM, 0) + ' m²'],
    ['Rooms served', (d.systemLoad?.roomCount ?? '—')],
    ['Outlets', d.outlets?.totals?.total ?? '—'],
    ['Zones', d.zones?.zoneCount ?? '—', d.controller?.name || ''],
    ['Return air', d.returnDesign ? d.returnDesign.returnCount + ' return point(s)' : '—']
  ]);

  if (planSnapshot) {
    b += '<h2>Your floor plan</h2><img class="planimg" src="' + planSnapshot + '">';
  }

  b += '<h2>Rooms and airflow</h2>' + tbl([
    { label: 'Room', key: 'label' },
    { label: 'Area (m²)', r: true, get: r => nn(r.areaSqM, 1) },
    { label: 'Outlets', r: true, get: r => {
        const o = (d.outlets?.rows || []).find(x => x.roomId === r.roomId);
        return o ? o.quantity : '—';
      } }
  ], (d.systemLoad?.rooms || []));

  if (d.zones) {
    b += '<h2>Zoning</h2>' + tbl([
      { label: 'Zone', key: 'name' },
      { label: 'Rooms', get: r => r.rooms.join(', ') }
    ], d.zones.zones);
    b += '<p class="note">Zoning lets you condition only the parts of the home you are using.</p>';
  }

  b += '<h2>What is included</h2><ul style="font-size:10.5px;margin:0 0 10px 16px;padding:0">' +
    ['Supply and installation of all supply air outlets',
     'Return air grille and filter, supplied and installed',
     'Insulated flexible ductwork throughout',
     'All refrigerant pipework',
     'Dedicated electrical circuit with isolator and RCD protection',
     'Zoning and controller as listed above',
     'Full rubbish removal and site clean-up on completion',
     'System commissioning and performance testing']
      .map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>';

  b += '<div class="disclaimer">' + esc(ENGINEERING_DISCLAIMER) + '</div>';

  return shell('HVAC Design Summary', logo, d, b);
}

export function openReport(html, title) {
  const w = window.open('', '_blank');
  if (!w) { alert('Allow pop-ups to open the ' + title + '.'); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
}
