// NAC AI HVAC DESIGNER — what goes in the two documents.
//
// ONE SOURCE, TWO RENDERERS.
//
// The internal sheet and the customer summary used to be built as HTML strings.
// The PDF has to carry the same content, and two separate builders is how a
// supplier cost ends up in a customer document by accident. So the content is
// decided here, once, as plain data; designer/ui/report-html.mjs turns it into
// a print page and designer/ui/report-pdf.mjs into a PDF file. Neither renderer
// knows anything about HVAC, and neither can add a figure this file withheld.
//
// The customer document is defined by what it CONTAINS, not by what is stripped
// out of the internal one: customerReportDoc builds its own block list from
// scratch and never touches d.bom, d.labour or d.commercials. There is a test
// (tests/report-doc.test.mjs) that scans the finished customer document for any
// dollar figure, margin, supplier or cost wording and fails if one appears.

export const REPORT_KIND = { INTERNAL: 'internal', CUSTOMER: 'customer' };

const money = (n) => n === null || n === undefined || !isFinite(n) ? '—'
  : '$' + Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const nn = (n, dp = 1) => n === null || n === undefined || !isFinite(n) ? '—' : Number(n).toFixed(dp);
const str = (v) => v === null || v === undefined ? '—' : String(v);

// ── Block constructors ─────────────────────────────────────────────────────
const h2      = (text) => ({ t: 'h2', text });
const kv      = (items) => ({ t: 'kv', items: items.map(([l, v, s]) => [str(l), str(v), s ? String(s) : '']) });
const note    = (text) => ({ t: 'note', text: String(text) });
const flag    = (level, text) => ({ t: 'flag', level, text: String(text) });
const bullets = (items) => ({ t: 'bullets', items: items.map(String) });
const image   = (src, caption) => ({ t: 'image', src, caption: caption || '' });
const pageBreak = () => ({ t: 'pagebreak' });

/** cols: [{ label, r?, w? }]; rows built through `get` so the cells are strings. */
function table(cols, rows, get) {
  return {
    t: 'table',
    cols: cols.map(c => ({ label: c.label, r: !!c.r, w: c.w || null })),
    rows: (rows || []).map(r => get(r).map(str))
  };
}

export const ENGINEERING_DISCLAIMER =
  'Design calculations are installation estimates based on the information entered and/or ' +
  'detected from the uploaded plans. Final room measurements, equipment selection, airflow, ' +
  'static pressure, duct installation and commissioning must be verified against manufacturer ' +
  'specifications and actual site conditions.';

function header(design, title, kind) {
  return {
    kind,
    title,
    designId: design.id || '',
    jobDescription: design.job?.description || '',
    dateText: new Date().toLocaleDateString('en-AU'),
    customer: {
      name: design.customer?.name || '—',
      address: design.customer?.address || '—',
      phone: design.customer?.phone || '—',
      email: design.customer?.email || '—'
    },
    abn: '97 636 392 982',
    business: 'NAC Electrical Air & Refrigeration',
    website: 'nacelectrical.com.au'
  };
}

/** THE INTERNAL HVAC DESIGN SHEET — the full working, NAC only. */
export function internalReportDoc(design, { planSnapshot = null } = {}) {
  const d = design;
  const load = d.systemLoad, u = d.selectedUnit;
  const b = [];

  b.push(h2('Design summary'));
  b.push(kv([
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
    ['Return', d.returnDesign
      ? d.returnDesign.returnCount + ' × ' + (d.returnDesign.returns?.[0]?.grilleSize || '') : '—',
      d.returnDesign ? d.returnDesign.perReturnLs + ' L/s each' : ''],
    ['Estimated static', nn(d.pressure?.estimatedRequirementPa, 0) + ' Pa',
      d.pressure && !d.pressure.checkCompleted ? d.pressure.statusLabel
        : d.pressure?.unitAvailableStaticPa ? 'of ' + d.pressure.unitAvailableStaticPa + ' Pa available'
        : 'unit ESP not on file'],
    ['Plan calibration', d.calibration ? nn(d.calibration.pixelsPerMm, 5) + ' px/mm' : 'NOT CALIBRATED']
  ]));

  if (planSnapshot) {
    b.push(h2('Floor plan overlay'));
    b.push(image(planSnapshot,
      'Rooms, duct routes and equipment positions as marked up in NAC AI HVAC Designer.'));
  }

  b.push(h2('Room schedule'));
  b.push(table(
    [{ label: 'Room', w: 2.2 }, { label: 'Width (m)', r: true }, { label: 'Length (m)', r: true },
     { label: 'Area (m²)', r: true }, { label: 'Ceiling (m)', r: true }, { label: 'Cond.' },
     { label: 'Source', w: 1.8 }, { label: 'Confidence', r: true }, { label: 'Status' }],
    d.rooms || [],
    r => [r.label, r.widthMm ? (r.widthMm / 1000).toFixed(2) : '—',
          r.lengthMm ? (r.lengthMm / 1000).toFixed(2) : '—', nn(r.areaSqM, 2),
          (r.ceilingHeightMm / 1000).toFixed(2), r.conditioned ? 'Yes' : 'No',
          r.measurement?.sourceLabel || '—', Math.round(r.confidence) + '% ' + r.confidenceBand, r.status]));

  if (load) {
    b.push(h2('Room loads'));
    b.push(table(
      [{ label: 'Room', w: 2.2 }, { label: 'Area (m²)', r: true }, { label: 'Cooling (W)', r: true },
       { label: 'Heating (W)', r: true }, { label: 'W/m²', r: true }, { label: '% of total', r: true },
       { label: 'Override', w: 2 }],
      load.rooms,
      r => [r.label, nn(r.areaSqM, 2), r.coolingW, r.heatingW, r.wattsPerM2, r.shareOfTotal + '%',
            r.overridden ? 'YES — ' + (r.overrideNote || '') : '']));
  }

  if (d.airflow) {
    b.push(pageBreak());
    b.push(h2('Airflow'));
    b.push(table(
      [{ label: 'Room', w: 2.2 }, { label: 'Load (W)', r: true }, { label: 'Recommended (L/s)', r: true },
       { label: 'Design (L/s)', r: true }, { label: '% of system', r: true }, { label: 'Override' }],
      d.airflow.rows,
      r => [r.label, r.loadW, r.recommendedLs, r.adjustedLs, r.systemSharePct + '%', r.overridden ? 'YES' : '']));
  }

  if (d.outlets) {
    b.push(h2('Outlets'));
    b.push(table(
      [{ label: 'Room', w: 2 }, { label: 'Type', w: 1.8 }, { label: 'Qty', r: true },
       { label: 'Airflow (L/s)', r: true }, { label: 'Per outlet (L/s)', r: true }],
      d.outlets.rows,
      r => [r.label, r.typeLabel, r.quantity, r.airflowLs, r.perOutletLs]));
  }

  if (d.network) {
    b.push(h2('Ductwork'));
    b.push(table(
      [{ label: 'Branch' }, { label: 'Destination', w: 2 }, { label: 'Role' },
       { label: 'Airflow (L/s)', r: true }, { label: 'Diameter (mm)', r: true },
       { label: 'Velocity (m/s)', r: true }, { label: 'Length (m)', r: true }, { label: 'Δp (Pa)', r: true }],
      d.network.sections,
      r => [r.id, r.destination, r.role, r.airflowLs, r.diameterMm, r.velocityMs, r.lengthM || '—',
            r.pressureDropPa]));
  }

  if (d.returnDesign) {
    b.push(h2('Return air'));
    b.push(table(
      [{ label: '#', r: true }, { label: 'Airflow (L/s)', r: true }, { label: 'Grille' },
       { label: 'Free area (m²)', r: true }, { label: 'Face velocity (m/s)', r: true }],
      d.returnDesign.returns,
      r => [r.index, r.airflowLs, r.grilleSize, r.freeAreaM2, r.faceVelocityMs]));
    b.push(note('Filter ' + (d.returnDesign.filter?.size ?? '—') + ' at ' +
      (d.returnDesign.filter?.faceVelocityMs ?? '—') + ' m/s. Return duct ' +
      (d.returnDesign.duct?.diameterMm ?? '—') + ' mm at ' + (d.returnDesign.duct?.velocityMs ?? '—') + ' m/s.'));
  }

  if (d.zones) {
    b.push(h2('Zones'));
    b.push(table(
      [{ label: 'Zone', w: 1.6 }, { label: 'Rooms', w: 3 }, { label: 'Type' },
       { label: 'Airflow (L/s)', r: true }, { label: '% of system', r: true }, { label: 'Always open' }],
      d.zones.zones,
      r => [r.name, (r.rooms || []).join(', '), r.kind, r.airflowLs, r.systemSharePct + '%',
            r.alwaysOpen ? 'Yes' : '']));
    b.push(note('Minimum open airflow ' + d.zones.minimumOpenAirflowLs + ' L/s (' +
      d.zones.minimumOpenFractionPct + '% of system); required ' + d.zones.requiredMinimumLs +
      ' L/s. ' + (d.zones.bypassNote || '')));
  }

  if (d.pressure) {
    b.push(h2('Static pressure'));
    // The three states are spelled out. A document that simply omitted the
    // comparison would let a reader assume the design cleared it.
    if (d.pressure.status !== 'pass') {
      b.push(flag(d.pressure.status === 'fail' ? 'crit' : 'warn', d.pressure.statusLabel));
    }
    b.push(table(
      [{ label: 'Component', w: 2 }, { label: 'Detail', w: 3 }, { label: 'Pa', r: true }],
      d.pressure.components,
      r => [r.item, r.detail, r.pa]));
    b.push(note('Estimated requirement ' + d.pressure.estimatedRequirementPa + ' Pa. Unit available ' +
      (d.pressure.unitAvailableStaticPa ?? 'not on file') + '. Margin ' +
      (d.pressure.remainingMarginPa ?? '—') + ' Pa. Result: ' + d.pressure.statusLabel + '.'));
    if (d.pressure.disclaimer) b.push(note(d.pressure.disclaimer));
  }

  b.push(pageBreak());
  b.push(h2('Design assumptions'));
  b.push(table(
    [{ label: 'Assumption', w: 2 }, { label: 'Value' }, { label: 'Source', w: 2 }],
    d.assumptions || [],
    r => [r.label, r.value, r.source]));

  const warnings = d.warnings || [];
  if (warnings.length) {
    b.push(h2('Warnings'));
    for (const w of warnings.filter(x => x.severity === 'CRITICAL')) {
      b.push(flag('crit', 'CRITICAL — ' + w.code + '. ' + w.message + ' ' +
        (w.acknowledged
          ? 'Acknowledged by ' + w.acknowledgedBy + ' on ' + new Date(w.acknowledgedAt).toLocaleString('en-AU') + '.'
          : 'NOT ACKNOWLEDGED.')));
    }
    b.push(table(
      [{ label: 'Severity' }, { label: 'Area' }, { label: 'Code', w: 2 }, { label: 'Detail', w: 5 }],
      warnings.filter(w => w.severity !== 'CRITICAL'),
      r => [r.severity, r.area, r.code, r.message]));
  }

  if (d.bom) {
    b.push(pageBreak());
    b.push(h2('Bill of materials'));
    b.push(table(
      [{ label: 'Category' }, { label: 'Item', w: 3 }, { label: 'Qty', r: true }, { label: 'Unit' },
       { label: 'Unit cost', r: true }, { label: 'Total', r: true }, { label: 'Price source' }],
      d.bom.items,
      r => [r.category, r.label, r.quantity, r.unit,
            r.unitCost === null ? 'PRICE REQUIRED' : money(r.unitCost),
            r.totalCost === null ? 'PRICE REQUIRED' : money(r.totalCost),
            r.priceSource === 'nac' ? 'NAC'
              : r.priceSource === 'supplier_list' ? 'Supplier list'
              : r.priceSource === 'default_placeholder' ? 'PLACEHOLDER' : 'NONE']));
    if (d.bom.placeholderCount) {
      b.push(flag('warn', d.bom.placeholderCount + ' line(s) use shipped placeholder rates worth ' +
        money(d.bom.placeholderCost) + '. They are not confirmed NAC prices.'));
    }
    if (d.bom.unpricedCount) {
      b.push(flag('crit', d.bom.unpricedCount + ' line(s) have no cost at all, so the job cost is short ' +
        'by whatever they are worth: ' + (d.bom.unpricedLabels || []).join(', ') + '.'));
    }
  }

  if (d.labour) {
    if (d.labour.mode === 'flat') {
      b.push(h2('Installation charge'));
      b.push(table([{ label: 'Item', w: 4 }, { label: 'Amount', r: true }], d.labour.rows,
        r => [r.task, money(r.cost)]));
      b.push(note('Flat job fee: ' + money(d.labour.totalFee) + ' ' +
        (d.labour.jobFeeExGst ? 'ex GST' : 'inc GST') +
        '. This is margin, not cost, so it is not included in the job cost below.'));
    } else {
      b.push(h2('Labour'));
      b.push(table([{ label: 'Task', w: 4 }, { label: 'Hours', r: true }, { label: 'Cost', r: true }],
        d.labour.rows, r => [r.task, r.hours, money(r.cost)]));
      b.push(note(d.labour.totalHours + ' h at ' + money(d.labour.ratePerHour) + '/h = ' +
        money(d.labour.totalCost)));
    }
  }

  if (d.commercials) {
    const c = d.commercials;
    const onFee = c.pricingBasis?.key === 'materials_plus_fee';
    b.push(h2('Costing'));
    b.push(kv([
      ['Equipment', money(c.equipmentCost)], ['Materials', money(c.materialsCost)],
      ['Labour', money(c.labourCost)], ['Subcontractor', money(c.subcontractorCost)],
      ['Other', money(c.otherCost)], ['Total job cost', money(c.totalJobCost)],
      ['Job fee', onFee ? money(c.jobFee) : '—'],
      ['Sell (ex GST)', money(c.sellPriceExGst)], ['GST', money(c.gstAmount)],
      ['Sell (inc GST)', money(c.sellPriceIncGst)],
      ['Gross profit', money(c.grossProfit)],
      ['Gross margin', c.grossMarginPct === null || c.grossMarginPct === undefined ? '—' : c.grossMarginPct + '%'],
      ['Pricing basis', c.pricingBasis?.label || 'none'],
      ['Quote', d.quoteId || 'not yet quoted']
    ]));
    if (onFee) {
      b.push(table([{ label: 'Price build-up', w: 4 }, { label: 'Amount', r: true }], [
        { line: 'Total job cost', amount: c.totalJobCost },
        { line: 'Job fee (' + (c.pricingBasis.jobFeeExGst ? 'ex GST' : 'inc GST, applied ex GST') + ')',
          amount: c.pricingBasis.feeAppliedExGst },
        { line: 'Sell price ex GST', amount: c.sellPriceExGst },
        { line: 'GST', amount: c.gstAmount },
        { line: 'Sell price inc GST', amount: c.sellPriceIncGst }
      ], r => [r.line, money(r.amount)]));
    }
  }

  b.push(note('Engineering note. ' + ENGINEERING_DISCLAIMER +
    ' Manufacturer requirements always override the assumptions in this application.'));

  return { ...header(design, 'Internal HVAC Design Sheet', REPORT_KIND.INTERNAL), blocks: b };
}

/**
 * THE CUSTOMER HVAC DESIGN SUMMARY.
 *
 * Built from scratch, not by filtering the internal sheet. It reads only the
 * engineering description of the system — never d.bom, d.labour, d.commercials,
 * d.warnings, d.assumptions or anything carrying a supplier code or a cost.
 */
export function customerReportDoc(design, { planSnapshot = null } = {}) {
  const d = design;
  const u = d.selectedUnit;
  const b = [];

  b.push(h2('Your system'));
  b.push(kv([
    ['System', u ? u.brandName + ' ' + u.model : '—', u ? u.capacityKw + ' kW reverse cycle ducted' : ''],
    ['Conditioned area', nn(d.systemLoad?.totalConditionedAreaSqM, 0) + ' m²'],
    ['Rooms served', d.systemLoad?.roomCount ?? '—'],
    ['Outlets', d.outlets?.totals?.total ?? '—'],
    ['Zones', d.zones?.zoneCount ?? '—', d.controller?.name || ''],
    ['Return air', d.returnDesign ? d.returnDesign.returnCount + ' return point(s)' : '—']
  ]));

  if (planSnapshot) {
    b.push(h2('Your floor plan'));
    b.push(image(planSnapshot, ''));
  }

  b.push(h2('Rooms and airflow'));
  b.push(table(
    [{ label: 'Room', w: 3 }, { label: 'Area (m²)', r: true }, { label: 'Outlets', r: true }],
    d.systemLoad?.rooms || [],
    r => {
      const o = (d.outlets?.rows || []).find(x => x.roomId === r.roomId);
      return [r.label, nn(r.areaSqM, 1), o ? o.quantity : '—'];
    }));

  if (d.zones) {
    b.push(h2('Zoning'));
    b.push(table([{ label: 'Zone', w: 1.5 }, { label: 'Rooms', w: 4 }], d.zones.zones,
      r => [r.name, (r.rooms || []).join(', ')]));
    b.push(note('Zoning lets you condition only the parts of the home you are using.'));
  }

  b.push(h2('What is included'));
  b.push(bullets([
    'Supply and installation of all supply air outlets',
    'Return air grille and filter, supplied and installed',
    'Insulated flexible ductwork throughout',
    'All refrigerant pipework',
    'Dedicated electrical circuit with isolator and RCD protection',
    'Zoning and controller as listed above',
    'Full rubbish removal and site clean-up on completion',
    'System commissioning and performance testing'
  ]));

  b.push(note(ENGINEERING_DISCLAIMER));

  return { ...header(design, 'HVAC Design Summary', REPORT_KIND.CUSTOMER), blocks: b };
}

/** Every piece of text in a document, for tests and for a plain-text export. */
export function docText(doc) {
  const out = [doc.title, doc.designId, doc.jobDescription,
               doc.customer.name, doc.customer.address, doc.customer.phone, doc.customer.email];
  for (const blk of doc.blocks) {
    if (blk.t === 'h2' || blk.t === 'note' || blk.t === 'flag') out.push(blk.text);
    else if (blk.t === 'kv') blk.items.forEach(i => out.push(i[0], i[1], i[2]));
    else if (blk.t === 'table') { blk.cols.forEach(c => out.push(c.label)); blk.rows.forEach(r => out.push(...r)); }
    else if (blk.t === 'bullets') out.push(...blk.items);
    else if (blk.t === 'image') out.push(blk.caption);
  }
  return out.filter(Boolean).join('\n');
}
