// NAC AI HVAC DESIGNER — PART 25: the design tabs.
// Progressive disclosure throughout: headline numbers first, the full
// engineering working behind an expander.

import { h, card, table, badge, confidenceBadge, severityBadge, field, input, select,
         checkbox, button, expandable, banner, empty, money, num, int, mount } from './dom.mjs';
import { SOURCE_LABELS } from '../engines/rooms.mjs';
import { PRESSURE_DISCLAIMER } from '../engines/pressure.mjs';
import { SPEC_REQUIRED } from '../engines/catalogue.mjs';

export const ENGINEERING_DISCLAIMER =
  'Design calculations are installation estimates based on the information entered and/or ' +
  'detected from the uploaded plans. Final room measurements, equipment selection, airflow, ' +
  'static pressure, duct installation and commissioning must be verified against manufacturer ' +
  'specifications and actual site conditions.';

function stat(label, value, sub, kind = '') {
  return h('div', { class: 'stat ' + kind },
    h('div', { class: 'stat-label' }, label),
    h('div', { class: 'stat-value' }, value),
    sub ? h('div', { class: 'stat-sub' }, sub) : null);
}

function needsDesign(d) {
  return !d || d.stage !== 'complete';
}

function awaitingBanner(app) {
  return banner('warn',
    'Rooms must be verified before the system can be sized. Nothing downstream is calculated until then.',
    button('Go to Rooms', () => app.setTab('rooms'), 'small'));
}

// ── Overview ────────────────────────────────────────────────────────────────

export function renderOverview(app) {
  const d = app.design;
  const s = app.summary || {};
  const load = d.systemLoad;

  const blocks = [];

  if (d.warningSummary && !d.warningSummary.canApprove) {
    blocks.push(banner('bad', d.warningSummary.blockReason,
      button('Review warnings', () => app.setTab('warnings'), 'small')));
  }

  blocks.push(h('div', { class: 'stat-grid' },
    stat('Conditioned area', num(s.totalConditionedAreaSqM, 2) + ' m²',
      (d.rooms || []).filter(r => r.conditioned).length + ' conditioned rooms'),
    stat('Total cooling load', num(s.totalCoolingLoadKw, 2) + ' kW',
      load ? 'NAC 145 W/m² rule: ' + load.legacy.kw + ' kW' : null),
    stat('Total heating load', num(s.totalHeatingLoadKw, 2) + ' kW',
      load ? '×' + app.settings.load.heatingFactor + ' of cooling' : null),
    stat('Recommended system', s.recommendedSystem || '—', 'From the NAC catalogue'),
    stat('Selected system', s.selectedSystem || '—',
      d.selectedUnit?.hasPrice ? 'Priced in NAC Price Setup' : 'No NAC price configured',
      d.selectedUnit?.hasPrice ? '' : 'warn'),
    stat('Total airflow', int(s.totalAirflowLs) + ' L/s',
      d.airflow ? d.airflow.basisLabel : null),
    stat('Outlets', int(s.outletCount), d.outlets ? Object.entries(d.outlets.totals.byType)
      .map(([k, v]) => v + ' × ' + (app.settings.outlets.types[k]?.label || k)).join(', ') : null),
    stat('Total duct length', num(s.totalDuctLengthM, 1) + ' m',
      d.network ? d.network.sections.length + ' sections' : null),
    stat('Return design', s.returnDesign || '—',
      d.returnDesign ? d.returnDesign.filter.size + ' filter' : null),
    stat('Zones', int(s.zoneCount), d.controller ? d.controller.name : 'No controller selected'),
    stat('Estimated static', num(s.estimatedStaticPa, 0) + ' Pa',
      // Never let the absence of a failure read as a pass.
      d.pressure && !d.pressure.checkCompleted ? d.pressure.statusLabel
        : s.unitAvailableStaticPa ? 'Unit available: ' + s.unitAvailableStaticPa + ' Pa'
        : SPEC_REQUIRED + ' — unit ESP not on file',
      d.pressure && d.pressure.status === 'fail' ? 'bad'
        : s.unitAvailableStaticPa ? '' : 'warn'),
    stat('Estimated cost', money(s.estimatedCost),
      d.labour?.mode === 'flat' ? 'Equipment + materials (the fee is margin)' : 'Equipment + materials + labour'),
    stat('Sell price (inc GST)', money(s.sellPrice),
      d.commercials?.pricingBasis?.label || 'No pricing basis'),
    stat('Gross profit', money(s.grossProfit),
      s.grossMarginPct !== null && s.grossMarginPct !== undefined ? s.grossMarginPct + '% margin' : null,
      s.grossMarginPct !== null && s.grossMarginPct < 20 ? 'warn' : '')));

  if (load) {
    blocks.push(card('Sizing cross-check', 'The detailed engine against NAC\'s existing rule',
      h('div', { class: 'row-2' },
        stat('Detailed engine', load.designKw + ' kW', load.averageWattsPerM2 + ' W/m² average'),
        stat('NAC 145 W/m² rule', load.legacy.kw + ' kW', load.legacy.rule)),
      h('p', { class: 'note' + (Math.abs(load.varianceVsLegacyPct) > 15 ? ' warn' : '') },
        'Variance: ' + (load.varianceVsLegacyPct > 0 ? '+' : '') + load.varianceVsLegacyPct + '%. ' +
        (Math.abs(load.varianceVsLegacyPct) > 15
          ? 'That is a large divergence — check the room inputs on the Sizing tab before relying on it.'
          : 'The two figures agree closely.'))));
  }

  blocks.push(card('Assumptions', 'Every value here is set in HVAC Design Settings',
    table([
      { key: 'label', label: 'Assumption' },
      { key: 'value', label: 'Value' },
      { key: 'source', label: 'Source' }
    ], d.assumptions || []),
    button('Open HVAC Design Settings', () => app.openSettings(), 'ghost small')));

  blocks.push(h('p', { class: 'disclaimer' }, ENGINEERING_DISCLAIMER));
  return blocks;
}

// ── Rooms (PART 9) ──────────────────────────────────────────────────────────

export function renderRooms(app) {
  const d = app.design;
  const rooms = d.rooms || [];
  if (!rooms.length) {
    return [empty('No rooms yet. Read the plan on the Plan tab, or add rooms by hand below.'),
            button('+ Add room manually', () => app.addManualRoom())];
  }

  const blocks = [];
  const blocked = rooms.filter(r => r.conditioned && r.status !== 'Verified' && r.status !== 'Manual');
  if (blocked.length) {
    blocks.push(banner('warn',
      blocked.length + ' conditioned room(s) are not verified yet and are excluded from sizing.',
      h('div', {},
        button('Verify all HIGH confidence', () => app.verifyAllHigh(), 'small'),
        button('Verify all', () => app.verifyAll(), 'small ghost'))));
  }

  blocks.push(card('Room verification', 'Tap a row to highlight it on the plan. Edit any value directly.',
    table([
      { key: 'label', label: 'Room' },
      { key: 'widthMm', label: 'Width (m)', align: 'right', width: '92px',
        render: (r) => input(r.widthMm !== null ? (r.widthMm / 1000).toFixed(2) : '',
          v => app.editRoom(r.id, { widthMm: v === '' ? null : Number(v) * 1000 }),
          { type: 'number', step: '0.01', inputmode: 'decimal' }) },
      { key: 'lengthMm', label: 'Length (m)', align: 'right', width: '92px',
        render: (r) => input(r.lengthMm !== null ? (r.lengthMm / 1000).toFixed(2) : '',
          v => app.editRoom(r.id, { lengthMm: v === '' ? null : Number(v) * 1000 }),
          { type: 'number', step: '0.01', inputmode: 'decimal' }) },
      { key: 'areaSqM', label: 'Area (m²)', align: 'right', width: '92px',
        render: (r) => input(r.areaSqM !== null ? Number(r.areaSqM).toFixed(2) : '',
          v => app.editRoom(r.id, { areaSqM: v === '' ? null : Number(v) }),
          { type: 'number', step: '0.01', inputmode: 'decimal' }) },
      { key: 'ceilingHeightMm', label: 'Ceiling (m)', align: 'right', width: '90px',
        render: (r) => input((r.ceilingHeightMm / 1000).toFixed(2),
          v => app.editRoom(r.id, { ceilingHeightMm: Number(v) * 1000 }),
          { type: 'number', step: '0.05', inputmode: 'decimal' }) },
      { key: 'source', label: 'Source', render: (r) => h('span', { class: 'src' },
          r.measurement?.sourceLabel || SOURCE_LABELS.estimated) },
      { key: 'confidence', label: 'Confidence', align: 'center', width: '110px',
        render: (r) => confidenceBadge(r.confidence, r.confidenceBand) },
      { key: 'conditioned', label: 'Conditioned', align: 'center', width: '90px',
        render: (r) => h('input', { type: 'checkbox', checked: r.conditioned,
          onchange: (e) => app.editRoom(r.id, { conditioned: e.target.checked }),
          onclick: (e) => e.stopPropagation() }) },
      { key: 'status', label: 'Status', align: 'center', width: '150px',
        render: (r) => h('div', { class: 'status-cell' },
          badge(r.status, r.status === 'Verified' ? 'ok' : r.status === 'Manual' ? 'ok'
            : r.status === 'Excluded' ? 'muted' : 'warn'),
          r.conditioned && r.status !== 'Verified'
            ? button('✓ Verify', (e) => { e.stopPropagation(); app.verifyRoom(r.id); }, 'tiny')
            : null) },
      { key: 'actions', label: '', align: 'right', width: '40px',
        render: (r) => button('✕', (e) => { e.stopPropagation(); app.deleteRoom(r.id); }, 'tiny ghost') }
    ], rooms, {
      selectedId: app.selectedRoomId,
      onRowClick: (r) => app.selectRoom(r.id),
      rowClass: (r) => r.conditioned ? '' : 'muted-row'
    }),
    h('div', { class: 'btn-row' },
      button('+ Add room manually', () => app.addManualRoom(), 'ghost'),
      button('Merge selected into…', () => app.mergeRoomPrompt(), 'ghost'),
      button('Split selected room', () => app.splitRoomPrompt(), 'ghost'))));

  const sel = rooms.find(r => r.id === app.selectedRoomId);
  if (sel) blocks.push(renderRoomDetail(app, sel));

  return blocks;
}

function renderRoomDetail(app, room) {
  return card(room.label, 'Measurement detail and load inputs',
    h('div', { class: 'grid-3' },
      field('Room name', input(room.label, v => app.editRoom(room.id, { label: v }))),
      field('Room type', select(room.roomType,
        ['bedroom', 'living', 'dining', 'kitchen', 'media', 'study', 'hallway', 'other'],
        v => app.editRoom(room.id, { roomType: v })),
        'Sets the base W/m² from HVAC Design Settings'),
      field('Open-plan group', input(room.openPlanGroup || '',
        v => app.editRoom(room.id, { openPlanGroup: v || null })),
        'Rooms sharing a name are zoned and diversified together'),
      field('External walls', input(room.externalWalls ?? '',
        v => app.editRoom(room.id, { externalWalls: v === '' ? null : Number(v) }),
        { type: 'number', min: 0, max: 4 }), 'Blank = assume 1'),
      field('Glazing area (m²)', input(room.glazingAreaSqM ?? '',
        v => app.editRoom(room.id, { glazingAreaSqM: v === '' ? null : Number(v) }),
        { type: 'number', step: '0.1' }),
        'Blank = ' + Math.round(app.settings.load.assumedGlazingRatio * 100) + '% of floor area'),
      field('Glazing type', select(room.glazingType || '',
        [{ value: '', label: 'Use default (' + app.settings.load.defaultGlazing + ')' },
         ...Object.keys(app.settings.load.glazingFactors).map(k => ({ value: k, label: k }))],
        v => app.editRoom(room.id, { glazingType: v || null }))),
      field('Window orientation', select(room.orientation || 'unknown',
        Object.keys(app.settings.load.orientationFactors),
        v => app.editRoom(room.id, { orientation: v }))),
      field('Shading', select(room.shading || 'unknown',
        Object.keys(app.settings.load.shadingFactors),
        v => app.editRoom(room.id, { shading: v }))),
      field('Insulation', select(room.insulation || '',
        [{ value: '', label: 'Use default (' + app.settings.load.defaultInsulation + ')' },
         ...Object.keys(app.settings.load.insulationFactors).map(k => ({ value: k, label: k }))],
        v => app.editRoom(room.id, { insulation: v || null }))),
      field('Wall construction', select(room.wallConstruction || '',
        [{ value: '', label: 'Use default (' + app.settings.load.defaultWall + ')' },
         ...Object.keys(app.settings.load.wallFactors).map(k => ({ value: k, label: k }))],
        v => app.editRoom(room.id, { wallConstruction: v || null }))),
      field('Occupancy', input(room.occupancy ?? '',
        v => app.editRoom(room.id, { occupancy: v === '' ? null : Number(v) }),
        { type: 'number', min: 0 }), 'Blank = default for the room type')),

    expandable('How this measurement was arrived at', () => h('div', {},
      h('p', { class: 'note' }, 'Source: ' + (room.measurement?.sourceLabel || '—')),
      h('ul', { class: 'evidence' },
        (room.measurement?.evidence || []).map(e => h('li', {}, e))),
      room.measurement?.alternatives?.length
        ? h('div', {},
            h('p', { class: 'note' }, 'Other sources that were available:'),
            table([
              { key: 'sourceLabel', label: 'Source' },
              { key: 'widthMm', label: 'Width (mm)', align: 'right' },
              { key: 'lengthMm', label: 'Length (mm)', align: 'right' },
              { key: 'areaSqM', label: 'Area (m²)', align: 'right' }
            ], room.measurement.alternatives))
        : null,
      h('p', { class: 'note' }, 'Confidence working:'),
      table([
        { key: 'reason', label: 'Factor' },
        { key: 'delta', label: 'Change', align: 'right', format: (v) => (v > 0 ? '+' : '') + v },
        { key: 'running', label: 'Running', align: 'right' }
      ], room.confidenceFactors || []),
      room.overrides?.length
        ? h('div', {}, h('p', { class: 'note' }, 'Estimator overrides:'),
            table([
              { key: 'field', label: 'Field' },
              { key: 'from', label: 'From' },
              { key: 'to', label: 'To' },
              { key: 'by', label: 'By' },
              { key: 'at', label: 'When' }
            ], room.overrides))
        : null)));
}

// ── Sizing (PART 11) ────────────────────────────────────────────────────────

export function renderSizing(app) {
  const d = app.design;
  if (needsDesign(d)) return [awaitingBanner(app)];
  const load = d.systemLoad;

  return [
    h('div', { class: 'stat-grid' },
      stat('Conditioned area', load.totalConditionedAreaSqM + ' m²', load.roomCount + ' rooms'),
      stat('Raw cooling load', num(load.rawCoolingW / 1000, 2) + ' kW', 'Before diversity'),
      stat('System diversity', '×' + load.systemDiversity, 'HVAC Design Settings'),
      stat('Safety margin', '×' + load.safetyMargin, 'HVAC Design Settings'),
      stat('Design cooling', load.designCoolingKw + ' kW', load.averageWattsPerM2 + ' W/m²'),
      stat('Design heating', load.designHeatingKw + ' kW', '×' + app.settings.load.heatingFactor)),

    card('Room loads', 'Every figure is deterministic. Override any room and the override is recorded.',
      table([
        { key: 'label', label: 'Room' },
        { key: 'areaSqM', label: 'Area (m²)', align: 'right' },
        { key: 'coolingW', label: 'Cooling (W)', align: 'right' },
        { key: 'heatingW', label: 'Heating (W)', align: 'right' },
        { key: 'wattsPerM2', label: 'W/m²', align: 'right' },
        { key: 'shareOfTotal', label: '% of total', align: 'right', format: v => v + '%' },
        { key: 'override', label: 'Override cooling (W)', align: 'right', width: '150px',
          render: (r) => input(app.design.roomLoadOverrides?.find(o => o.roomId === r.roomId)?.coolingW ?? '',
            v => app.setLoadOverride(r.roomId, v === '' ? null : Number(v)),
            { type: 'number', placeholder: String(r.coolingW) }) },
        { key: 'overridden', label: '', align: 'center', width: '40px',
          render: (r) => r.overridden ? badge('OVR', 'warn') : null }
      ], load.rooms, {
        onRowClick: (r) => app.selectRoom(r.roomId),
        selectedId: app.selectedRoomId
      })),

    ...load.rooms.map(r => expandable('Calculation details — ' + r.label, () => renderLoadDetail(r))),

    h('p', { class: 'disclaimer' }, ENGINEERING_DISCLAIMER)
  ];
}

function renderLoadDetail(r) {
  const b = r.breakdown;
  return h('div', {},
    h('div', { class: 'grid-4' },
      stat('Floor area', b.floorAreaSqM + ' m²'),
      stat('Ceiling height', b.ceilingHeightMm + ' mm'),
      stat('Room volume', b.roomVolumeM3 + ' m³'),
      stat('Fabric base', b.baseWattsPerM2 + ' W/m²')),
    h('p', { class: 'note' }, 'Fabric: ' + b.fabricBaseW + ' W base, factored to ' + b.fabricW + ' W'),
    table([
      { key: 'name', label: 'Factor' },
      { key: 'key', label: 'Setting' },
      { key: 'value', label: 'Multiplier', align: 'right' }
    ], b.factors),
    h('p', { class: 'note' }, 'Glazing: ' + b.glazing.areaSqM + ' m² × ' + b.glazing.wattsPerM2 +
      ' W/m² × ' + b.glazing.typeFactor.value + ' (' + b.glazing.typeFactor.key + ') × ' +
      b.glazing.orientationFactor.value + ' (' + b.glazing.orientationFactor.key + ') × ' +
      b.glazing.shadingFactor.value + ' (' + b.glazing.shadingFactor.key + ') = ' + b.glazing.watts + ' W'),
    b.glazing.assumedNote ? h('p', { class: 'note warn' }, b.glazing.assumedNote) : null,
    h('p', { class: 'note' }, 'Occupancy: ' + b.occupancy.people + ' × ' + b.occupancy.wattsPerPerson +
      ' W = ' + b.occupancy.watts + ' W    ·    Appliances: ' + b.appliances.watts + ' W'),
    b.openPlanDiversity ? h('p', { class: 'note' }, 'Open-plan diversity applied: ×' + b.openPlanDiversity) : null,
    h('p', { class: 'note strong' }, 'Cooling ' + r.coolingW + ' W  ·  Heating ' + r.heatingW +
      ' W  ·  ' + r.wattsPerM2 + ' W/m²'),
    r.overridden ? h('p', { class: 'note warn' }, 'Manually overridden. Original: ' +
      (r.originalCoolingW ?? '—') + ' W. ' + (r.overrideNote || '')) : null);
}

// ── Equipment (PART 13) ─────────────────────────────────────────────────────

export function renderEquipment(app) {
  const d = app.design;
  if (needsDesign(d)) return [awaitingBanner(app)];
  const sel = d.equipmentSelection;

  const blocks = [];
  sel.systemWarnings.forEach(w => blocks.push(banner(w.severity === 'CRITICAL' ? 'bad' : 'warn', w.message)));

  blocks.push(card('Selection filters', null,
    h('div', { class: 'grid-4' },
      field('Brand preference', select(d.brandPreference || '',
        [{ value: '', label: 'No preference' }, ...app.catalogue.map(b => ({ value: b.id, label: b.name }))],
        v => app.setDesignField('brandPreference', v || null))),
      field('Phase', select(d.phase || '',
        [{ value: '', label: 'Any' }, { value: '1Ph', label: 'Single phase' }, { value: '3Ph', label: 'Three phase' }],
        v => app.setDesignField('phase', v || null)),
        'Which models to list'),
      // What the HOUSE has, which is the expensive question. A three-phase unit
      // on a single-phase house is a supply upgrade nobody quoted for.
      field('Supply at the site', select(d.sitePhase || '',
        [{ value: '', label: 'Not confirmed' }, { value: '1', label: 'Single phase' },
         { value: '3', label: 'Three phase' }],
        v => app.setDesignField('sitePhase', v || null)),
        'Confirm this before quoting a three-phase unit'),
      field('Availability', h('div', {},
        checkbox(!!d.requireCost, 'Only models with a supplier cost',
          v => app.setDesignField('requireCost', v)),
        checkbox(!!d.requirePrice, 'Only models with a Price Setup price',
          v => app.setDesignField('requirePrice', v)))),
      field('Capacity window', h('div', { class: 'readout' },
        sel.window.minKw + ' – ' + sel.window.maxKw + ' kW'),
        'Around the ' + sel.designKw + ' kW design load'))));

  const cols = [
    { key: 'pick', label: '', align: 'center', width: '46px',
      render: (r) => h('input', { type: 'radio', name: 'unitpick',
        checked: d.selectedUnit && d.selectedUnit.brandId === r.brandId && d.selectedUnit.modelId === r.modelId,
        onchange: () => app.selectUnit(r.brandId, r.modelId) }) },
    { key: 'brandName', label: 'Brand' },
    { key: 'model', label: 'Model' },
    { key: 'capacityKw', label: 'kW', align: 'right' },
    { key: 'phase', label: 'Phase' },
    { key: 'capacityRatio', label: 'vs load', align: 'right', format: v => '×' + v },
    { key: 'ratedAirflowLs', label: 'Rated L/s', align: 'right', format: v => v ?? '—' },
    { key: 'availableStaticPa', label: 'ESP (Pa)', align: 'right', format: v => v ?? '—' },
    { key: 'supplierCost', label: 'Cost', align: 'right', format: v => v === null ? '—' : money(v) },
    { key: 'sellPrice', label: 'Price Setup', align: 'right', format: v => v === null ? '—' : money(v) },
    { key: 'specStatus', label: 'Data', align: 'center',
      render: (r) => r.specStatus === 'complete' ? badge('complete', 'ok')
        : badge(r.specStatus === 'partial' ? 'partial' : 'none', 'warn') },
    { key: 'warnings', label: 'Flags', render: (r) => h('div', {},
        r.warnings.map(w => severityBadge(w.severity))) }
  ];

  blocks.push(card('Recommended', 'Ranked against the calculated design load',
    sel.recommended.length ? table(cols, sel.recommended)
      : empty('No catalogued model falls inside the capacity window. Widen it in HVAC Design Settings, or select from all models below.')));

  blocks.push(card('All models', 'Everything in the NAC catalogue, ranked',
    table(cols, sel.allCandidates.slice(0, 40))));

  const noCost = sel.allCandidates.filter(c => c.supplierCost === null);
  if (noCost.length) {
    blocks.push(expandable(noCost.length + ' model(s) have no supplier cost on file', () => h('div', {},
      h('p', { class: 'note' },
        'These are models the quote tool lists that are not on the current supplier price list. ' +
        'On the job-cost-plus-fee basis they cannot be priced until a cost is entered in ' +
        'HVAC Design Settings → Equipment specs.'),
      table([
        { key: 'brandName', label: 'Brand' },
        { key: 'model', label: 'Model' },
        { key: 'capacityKw', label: 'kW', align: 'right' },
        { key: 'phase', label: 'Phase' }
      ], noCost.map(c => ({ ...c, id: c.brandId + c.modelId }))))));
  }

  if (d.selectedUnit) blocks.push(renderSelectedUnit(app, d.selectedUnit));

  blocks.push(card('Zone controller', 'Compatible with the selected system and zone count',
    d.controllerSelection ? h('div', {},
      table([
        { key: 'pick', label: '', align: 'center', width: '46px',
          render: (c) => h('input', { type: 'radio', name: 'ctrlpick',
            checked: d.controller?.id === c.id,
            onchange: () => app.setDesignField('controllerId', c.id) }) },
        { key: 'name', label: 'Controller' },
        { key: 'maxZones', label: 'Max zones', align: 'right' },
        { key: 'note', label: 'Notes' }
      ], d.controllerSelection.compatible),
      d.controllerSelection.incompatible.length
        ? expandable('Not compatible with this design', () => table([
            { key: 'name', label: 'Controller' }, { key: 'reason', label: 'Why not' }
          ], d.controllerSelection.incompatible))
        : null) : empty('Zone controller options appear once zones are designed.')));

  return blocks;
}

function renderSelectedUnit(app, u) {
  const missing = [];
  if (!u.ratedAirflowLs) missing.push('rated airflow');
  if (!u.availableStaticPa) missing.push('available external static pressure');
  if (!u.dimensionsMm) missing.push('physical dimensions');
  if (!u.electricalSupply) missing.push('electrical supply');
  if (!u.refrigerant) missing.push('refrigerant');

  return card('Selected: ' + u.brandName + ' ' + u.model, null,
    h('div', { class: 'grid-4' },
      stat('Cooling capacity', u.capacityKw + ' kW', 'Catalogue'),
      stat('Heating capacity', u.heatingKw ? u.heatingKw + ' kW' : SPEC_REQUIRED, null, u.heatingKw ? '' : 'warn'),
      stat('Rated airflow', u.ratedAirflowLs ? u.ratedAirflowLs + ' L/s' : SPEC_REQUIRED, null, u.ratedAirflowLs ? '' : 'warn'),
      stat('Available static', u.availableStaticPa ? u.availableStaticPa + ' Pa' : SPEC_REQUIRED, null, u.availableStaticPa ? '' : 'warn'),
      stat('Indoor dimensions', u.dimensionsMm
        ? u.dimensionsMm.w + ' × ' + u.dimensionsMm.h + ' × ' + u.dimensionsMm.d + ' mm' : SPEC_REQUIRED,
        null, u.dimensionsMm ? '' : 'warn'),
      stat('Electrical', u.electricalSupply || SPEC_REQUIRED, null, u.electricalSupply ? '' : 'warn'),
      stat('Refrigerant', u.refrigerant || SPEC_REQUIRED, null, u.refrigerant ? '' : 'warn'),
      stat('Supplier cost', u.supplierCost === null ? 'Not on file' : money(u.supplierCost),
        u.supplierSource || 'Enter it in HVAC Design Settings → Equipment specs',
        u.supplierCost === null ? 'warn' : ''),
      stat('Price Setup price', u.sellPrice === null ? 'Not set' : money(u.sellPrice),
        app.settings.commercial.pricingBasis === 'materials_plus_fee'
          ? 'Not used — this job is priced at cost + fee' : 'From nac_brands_v4',
        u.sellPrice === null && app.settings.commercial.pricingBasis !== 'materials_plus_fee' ? 'warn' : '')),
    missing.length
      ? banner('warn', SPEC_REQUIRED + ' for ' + u.model + ': ' + missing.join(', ') +
          '. These are never guessed — enter them in HVAC Design Settings → Equipment specifications.',
          button('Enter specs', () => app.openSettings('equipment'), 'small'))
      : null,
    u.warnings.length ? h('ul', { class: 'warn-list' },
      u.warnings.map(w => h('li', {}, severityBadge(w.severity), ' ', w.message))) : null);
}

// ── Airflow (PART 14) ───────────────────────────────────────────────────────

export function renderAirflow(app) {
  const d = app.design;
  if (needsDesign(d)) return [awaitingBanner(app)];
  const a = d.airflow;

  return [
    h('div', { class: 'stat-grid' },
      stat('Basis', a.basisKw + ' kW', a.basisLabel),
      stat('Rate', a.litresPerSecPerKw + ' L/s per kW', 'HVAC Design Settings'),
      stat('System design airflow', a.systemAirflowLs + ' L/s'),
      stat('Allocated to rooms', a.allocatedAirflowLs + ' L/s',
        Math.abs(a.allocatedAirflowLs - a.systemAirflowLs) > a.systemAirflowLs * 0.05 ? 'Out of balance' : 'Balanced',
        Math.abs(a.allocatedAirflowLs - a.systemAirflowLs) > a.systemAirflowLs * 0.05 ? 'warn' : '')),

    card('Room airflow', 'Apportioned by calculated load. Override any room — the override is always shown.',
      table([
        { key: 'label', label: 'Room' },
        { key: 'loadW', label: 'Load (W)', align: 'right' },
        { key: 'loadShare', label: 'Load share', align: 'right', format: v => v + '%' },
        { key: 'recommendedLs', label: 'Recommended (L/s)', align: 'right' },
        { key: 'adjustedLs', label: 'Adjusted (L/s)', align: 'right', width: '130px',
          render: (r) => input(d.airflowOverrides?.[r.roomId] ?? '',
            v => app.setAirflowOverride(r.roomId, v),
            { type: 'number', placeholder: String(r.recommendedLs), inputmode: 'numeric' }) },
        { key: 'systemSharePct', label: '% of system', align: 'right', format: v => v + '%' },
        { key: 'overridden', label: '', align: 'center', width: '48px',
          render: (r) => r.overridden ? badge('OVR', 'warn') : null }
      ], a.rows, { onRowClick: (r) => app.selectRoom(r.roomId), selectedId: app.selectedRoomId })),

    a.warnings.length ? card('Airflow checks', null,
      h('ul', { class: 'warn-list' }, a.warnings.map(w =>
        h('li', {}, severityBadge(w.severity), ' ', w.message)))) : null
  ];
}

// ── Outlets (PART 15) ───────────────────────────────────────────────────────

export function renderOutlets(app) {
  const d = app.design;
  if (needsDesign(d)) return [awaitingBanner(app)];
  const o = d.outlets;
  const types = Object.entries(app.settings.outlets.types).map(([k, v]) => ({ value: k, label: v.label }));

  return [
    h('div', { class: 'stat-grid' },
      stat('Total outlets', o.totals.total),
      ...Object.entries(o.totals.byType).map(([k, v]) =>
        stat(app.settings.outlets.types[k]?.label || k, v))),

    card('Outlet schedule', 'Quantity follows the capacity table and throw limits in HVAC Design Settings',
      table([
        { key: 'label', label: 'Room' },
        { key: 'airflowLs', label: 'Airflow (L/s)', align: 'right' },
        { key: 'type', label: 'Type', width: '190px',
          render: (r) => select(r.type, types, v => app.setOutletOverride(r.roomId, { type: v })) },
        { key: 'quantity', label: 'Qty', align: 'right', width: '80px',
          render: (r) => input(d.outletOverrides?.[r.roomId]?.quantity ?? '',
            v => app.setOutletOverride(r.roomId, { quantity: v === '' ? null : Number(v) }),
            { type: 'number', min: 1, placeholder: String(r.quantity) }) },
        { key: 'perOutletLs', label: 'Per outlet (L/s)', align: 'right' },
        { key: 'throwRatingM', label: 'Throw (m)', align: 'right' },
        { key: 'longestDimM', label: 'Longest dim (m)', align: 'right' },
        { key: 'overridden', label: '', align: 'center', width: '48px',
          render: (r) => r.overridden ? badge('OVR', 'warn') : null }
      ], o.rows, { onRowClick: (r) => app.selectRoom(r.roomId), selectedId: app.selectedRoomId })),

    ...o.rows.map(r => expandable('Why ' + r.quantity + ' × ' + r.typeLabel + ' in ' + r.label, () =>
      h('ul', { class: 'evidence' }, r.reasons.map(x => h('li', {}, x))))),

    o.warnings.length ? card('Outlet checks', null,
      h('ul', { class: 'warn-list' }, o.warnings.map(w =>
        h('li', {}, severityBadge(w.severity), ' ', w.message)))) : null
  ];
}

// ── Ductwork (PART 16/17) ───────────────────────────────────────────────────

export function renderDuctwork(app) {
  const d = app.design;
  if (needsDesign(d)) return [awaitingBanner(app)];
  const net = d.network;
  const diameters = app.settings.duct.availableDiametersMm.map(x => ({ value: x, label: x + ' mm' }));

  const velocityClass = (s) => {
    const band = app.settings.duct.velocity[s.role] || app.settings.duct.velocity.branch;
    return s.velocityMs > band.max ? 'bad-row' : s.velocityMs > band.preferred ? 'warn-row' : '';
  };

  return [
    h('div', { class: 'stat-grid' },
      stat('Total duct length', net.totalDuctLengthM + ' m', net.sections.length + ' sections'),
      stat('Index run', d.pressure?.indexRun ? d.pressure.indexRun.destination : '—',
        d.pressure ? d.pressure.estimatedRequirementPa + ' Pa total' : null),
      ...Object.entries(net.totalsByDiameter).sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([dia, m]) => stat(dia + ' mm', m + ' m'))),

    banner('info',
      'Duct lengths come from routes drawn on the calibrated plan. Draw them on the Plan tab, ' +
      'or type any length directly below.',
      button('Draw routes on the plan', () => app.setTab('plan'), 'small')),

    card('Duct schedule', 'Diameters are chosen from the configured list to hit the velocity band for each role',
      table([
        { key: 'id', label: 'Branch' },
        { key: 'destination', label: 'Destination' },
        { key: 'role', label: 'Role', render: (s) => badge(s.role, 'muted') },
        { key: 'airflowLs', label: 'Airflow (L/s)', align: 'right' },
        { key: 'diameterMm', label: 'Diameter', align: 'right', width: '110px',
          render: (s) => select(s.diameterMm, diameters, v => app.setDuctDiameter(s.id, Number(v))) },
        { key: 'velocityMs', label: 'Velocity (m/s)', align: 'right' },
        { key: 'lengthM', label: 'Length (m)', align: 'right', width: '100px',
          render: (s) => input(s.lengthM || '', v => app.setDuctLength(s.id, v),
            { type: 'number', step: '0.1', placeholder: 'not measured' }) },
        { key: 'effectiveLengthM', label: 'Effective (m)', align: 'right' },
        { key: 'pressureDropPa', label: 'Δp (Pa)', align: 'right' },
        { key: 'warnings', label: 'Warning', render: (s) => h('div', {},
            s.warnings.map(w => h('div', { class: 'mini-warn' }, severityBadge(w.severity), ' ', w.code))) }
      ], net.sections, { rowClass: velocityClass })),

    card('Velocity targets', 'From HVAC Design Settings',
      table([
        { key: 'role', label: 'Duct role' },
        { key: 'preferredMin', label: 'Preferred min (m/s)', align: 'right' },
        { key: 'preferred', label: 'Preferred (m/s)', align: 'right' },
        { key: 'max', label: 'Maximum (m/s)', align: 'right' }
      ], Object.entries(net.settingsVelocity).map(([role, v]) => ({ role, ...v })))),

    ...net.sections.filter(s => s.fittings.length).map(s =>
      expandable('Fittings on ' + s.destination + ' (' + s.fittingEquivalentM + ' m equivalent)', () =>
        table([
          { key: 'type', label: 'Fitting' },
          { key: 'quantity', label: 'Qty', align: 'right' },
          { key: 'equivalentM', label: 'Equivalent length (m)', align: 'right' }
        ], s.fittings)))
  ];
}

// ── Return air (PART 19) ────────────────────────────────────────────────────

export function renderReturn(app) {
  const d = app.design;
  if (needsDesign(d)) return [awaitingBanner(app)];
  const r = d.returnDesign;

  return [
    h('div', { class: 'stat-grid' },
      stat('Design return airflow', r.designAirflowLs + ' L/s'),
      stat('Returns', r.returnCount, r.perReturnLs + ' L/s each'),
      stat('Grille', r.returns[0]?.grilleSize || '—', r.returns[0]?.faceVelocityMs + ' m/s face velocity',
        r.returns[0]?.faceVelocityMs > app.settings.returnAir.maxGrilleFaceVelocityMs ? 'warn' : ''),
      stat('Filter', r.filter.size, r.filter.faceVelocityMs + ' m/s face velocity',
        r.filter.faceVelocityMs > app.settings.returnAir.maxFilterFaceVelocityMs ? 'warn' : ''),
      stat('Return duct', r.duct.diameterMm + ' mm', r.duct.velocityMs + ' m/s')),

    card('Return air design', null,
      h('div', { class: 'grid-4' },
        field('Number of returns', input(d.returnCount || 1,
          v => app.setDesignField('returnCount', Math.max(1, Number(v) || 1)), { type: 'number', min: 1 })),
        field('Return duct length (m)', input(d.returnDuctLengthMm ? d.returnDuctLengthMm / 1000 : '',
          v => app.setDesignField('returnDuctLengthMm', v === '' ? null : Number(v) * 1000),
          { type: 'number', step: '0.1' })),
        field('Return duct diameter', select(d.returnDuctDiameterOverride || '',
          [{ value: '', label: 'Auto (' + r.duct.diameterMm + ' mm)' },
           ...app.settings.duct.availableDiametersMm.map(x => ({ value: x, label: x + ' mm' }))],
          v => app.setDesignField('returnDuctDiameterOverride', v === '' ? null : Number(v)))),
        field('Required free area', h('div', { class: 'readout' }, r.requiredFreeAreaM2 + ' m²'),
          'At ' + app.settings.returnAir.maxGrilleFaceVelocityMs + ' m/s max face velocity')),

      table([
        { key: 'index', label: '#', align: 'right', width: '40px' },
        { key: 'airflowLs', label: 'Airflow (L/s)', align: 'right' },
        { key: 'grilleSize', label: 'Grille size', width: '190px',
          render: (row) => select(row.grilleWidthMm + 'x' + row.grilleHeightMm,
            app.settings.returnAir.standardGrilleSizesMm.map(([w, hh]) =>
              ({ value: w + 'x' + hh, label: w + ' × ' + hh + ' mm' })),
            v => app.setReturnGrille(row.index - 1, v.split('x').map(Number))) },
        { key: 'freeAreaM2', label: 'Free area (m²)', align: 'right' },
        { key: 'faceVelocityMs', label: 'Face velocity (m/s)', align: 'right' },
        { key: 'manual', label: '', align: 'center', width: '48px',
          render: (row) => row.manual ? badge('SET', 'warn') : null }
      ], r.returns)),

    r.warnings.length ? card('Return air checks', null,
      h('ul', { class: 'warn-list' }, r.warnings.map(w =>
        h('li', {}, severityBadge(w.severity), ' ', w.message)))) : null,

    card('Static pressure estimate', PRESSURE_DISCLAIMER,
      d.pressure ? h('div', {},
        // Three states, and silence is not one of them. Without the
        // manufacturer's available static on file the check DID NOT HAPPEN,
        // and the estimator has to be told that in those words — an absence
        // of red must never read as a pass.
        banner(d.pressure.status === 'pass' ? 'ok' : 'bad', d.pressure.statusLabel,
          d.pressure.status === 'not_completed'
            ? button('Enter unit static', () => app.setTab('equipment'), 'small') : null),
        h('div', { class: 'grid-3' },
          stat('Estimated requirement', d.pressure.estimatedRequirementPa + ' Pa',
            d.pressure.indexRun ? 'Index run: ' + d.pressure.indexRun.destination : null),
          stat('Unit available static', d.pressure.unitAvailableStaticPa
            ? d.pressure.unitAvailableStaticPa + ' Pa' : SPEC_REQUIRED, null,
            d.pressure.unitAvailableStaticPa ? '' : 'warn'),
          stat('Remaining margin', d.pressure.remainingMarginPa === null
            ? '—' : d.pressure.remainingMarginPa + ' Pa',
            d.pressure.remainingMarginPct !== null ? d.pressure.remainingMarginPct + '%' : null,
            d.pressure.remainingMarginPa !== null && d.pressure.remainingMarginPa < 0 ? 'bad' : '')),
        table([
          { key: 'item', label: 'Component' },
          { key: 'detail', label: 'Detail' },
          { key: 'pa', label: 'Pa', align: 'right' }
        ], d.pressure.components),
        d.pressure.warnings.length ? h('ul', { class: 'warn-list' },
          d.pressure.warnings.map(w => h('li', {}, severityBadge(w.severity), ' ', w.message))) : null
      ) : empty('Pressure is estimated once the duct network is built.'))
  ];
}

// ── Zones (PART 20) ─────────────────────────────────────────────────────────

export function renderZones(app) {
  const d = app.design;
  if (needsDesign(d)) return [awaitingBanner(app)];
  const z = d.zones;
  const kinds = ['individual', 'grouped', 'constant', 'common', 'spill'];

  return [
    h('div', { class: 'stat-grid' },
      stat('Zones', z.zoneCount),
      stat('System airflow', z.systemAirflowLs + ' L/s'),
      stat('Minimum open airflow', z.minimumOpenAirflowLs + ' L/s', z.minimumOpenFractionPct + '% of system',
        z.meetsMinimum ? '' : 'bad'),
      stat('Required minimum', z.requiredMinimumLs + ' L/s',
        Math.round(app.settings.zoning.minOpenAirflowFraction * 100) + '% of system'),
      stat('Controller', d.controller?.name || '—', d.controller ? 'Max ' + d.controller.maxZones + ' zones' : null)),

    banner('info', z.bypassNote),

    card('Zone plan', 'Set a constant or common zone so the system always has a path for air',
      table([
        { key: 'name', label: 'Zone', width: '200px',
          render: (zz) => input(zz.name, v => app.renameZone(zz.id, v)) },
        { key: 'rooms', label: 'Rooms', format: (v) => v.join(', ') },
        { key: 'kind', label: 'Type', width: '150px',
          render: (zz) => select(zz.kind, kinds, v => app.setZoneKind(zz.id, v)) },
        { key: 'airflowLs', label: 'Airflow (L/s)', align: 'right' },
        { key: 'systemSharePct', label: '% of system', align: 'right', format: v => v + '%' },
        { key: 'alwaysOpen', label: 'Always open', align: 'center',
          render: (zz) => zz.alwaysOpen ? badge('OPEN', 'ok') : badge('closable', 'muted') }
      ], z.zones),
      h('div', { class: 'btn-row' },
        button('Reset to suggested zones', () => app.resetZones(), 'ghost'),
        button('Group selected rooms into one zone', () => app.groupZonePrompt(), 'ghost'))),

    z.warnings.length ? card('Zoning checks', null,
      h('ul', { class: 'warn-list' }, z.warnings.map(w =>
        h('li', {}, severityBadge(w.severity), ' ', w.message)))) : null
  ];
}

// ── Materials (PART 22) ─────────────────────────────────────────────────────

export function renderMaterials(app) {
  const d = app.design;
  if (needsDesign(d)) return [awaitingBanner(app)];
  const bom = d.bom;

  return [
    h('div', { class: 'stat-grid' },
      stat('Lines', bom.lineCount),
      stat('Equipment cost', money(bom.equipmentCost)),
      stat('Materials cost', money(bom.materialsCost)),
      stat('Total cost', money(bom.totalCost)),
      stat('On placeholder rates', bom.placeholderCount, bom.placeholderCount ? 'Set NAC rates in Settings' : 'All NAC rates',
        bom.placeholderCount ? 'warn' : '')),

    ...bom.warnings.map(w => banner(w.severity === 'WARNING' ? 'warn' : 'info', w.message,
      button('Set material rates', () => app.openSettings('materials'), 'small'))),

    card('Bill of materials', 'Quantities are derived from the design. Edit anything.',
      table([
        { key: 'category', label: 'Category', render: (r) => badge(r.category, 'muted') },
        { key: 'label', label: 'Item',
          // Anything bought by the length says what the design needs and what
          // the off-cut will be, so a quantity of "2" is never a mystery.
          render: (r) => h('div', {},
            h('div', {}, r.label),
            r.metresRequired !== undefined && r.metresRequired !== r.quantity
              ? h('div', { class: 'hint' }, r.metresRequired + ' m needed · ' +
                  r.metresBought + ' m bought · ' + r.offcutM + ' m off-cut')
              : null,
            r.supplierCode ? h('div', { class: 'hint' }, r.supplierCode) : null) },
        { key: 'quantity', label: 'Qty', align: 'right', width: '90px',
          render: (r, i) => input(r.quantity, v => app.editBom(i, { quantity: Number(v) }),
            { type: 'number', step: '0.01' }) },
        { key: 'unit', label: 'Unit', width: '60px' },
        { key: 'unitCost', label: 'Unit cost', align: 'right', width: '110px',
          render: (r, i) => input(r.unitCost ?? '', v => app.editBom(i, { unitCost: v === '' ? null : Number(v) }),
            { type: 'number', step: '0.01', placeholder: 'no price' }) },
        { key: 'totalCost', label: 'Total', align: 'right', format: v => v === null ? '—' : money(v) },
        { key: 'priceSource', label: 'Price', align: 'center',
          render: (r) => r.priceSource === 'nac' ? badge('NAC', 'ok')
            : r.priceSource === 'supplier_list' ? badge('supplier', 'ok')
            : r.priceSource === 'default_placeholder' ? badge('placeholder', 'warn') : badge('none', 'bad') }
      ], bom.items, { rowClass: (r) => r.priced ? '' : 'bad-row' }),
      h('div', { class: 'btn-row' },
        button('+ Add material line', () => app.addMaterialPrompt(), 'ghost'),
        button('Export BOM (CSV)', () => app.exportBomCsv(), 'ghost'))),

    d.labour.mode === 'flat'
      ? card('Installation charge', 'NAC charges a flat fee per job, not by the hour',
          table([
            { key: 'task', label: 'Item' },
            { key: 'cost', label: 'Amount', align: 'right', format: v => money(v) }
          ], d.labour.rows),
          h('p', { class: 'note strong' }, 'Job fee: ' + money(d.labour.totalFee) +
            ' (' + (d.labour.jobFeeExGst ? 'ex GST' : 'inc GST') + ')'),
          h('p', { class: 'note' }, 'The fee is not a cost — it sits on top of the job cost as NAC\'s margin, ' +
            'so it is not counted in the material totals above.'),
          h('div', { class: 'btn-row' },
            button('+ Add a charge', () => app.addLabourPrompt(), 'ghost'),
            button('Change the fee', () => app.openSettings('commercial'), 'ghost')))
      : card('Labour', 'Hours are built from the design at the configured rate',
          table([
            { key: 'task', label: 'Task' },
            { key: 'hours', label: 'Hours', align: 'right' },
            { key: 'cost', label: 'Cost', align: 'right', format: v => money(v) }
          ], d.labour.rows),
          h('p', { class: 'note strong' }, d.labour.totalHours + ' h × ' + money(d.labour.ratePerHour) +
            '/h = ' + money(d.labour.totalCost)),
          button('+ Add labour line', () => app.addLabourPrompt(), 'ghost'))
  ];
}

// ── Financials (PART 24) ────────────────────────────────────────────────────

export function renderFinancials(app) {
  const d = app.design;
  if (needsDesign(d)) return [awaitingBanner(app)];
  const c = d.commercials;

  const onFee = c.pricingBasis?.key === 'materials_plus_fee';

  return [
    h('div', { class: 'stat-grid' },
      stat('Equipment cost', money(c.equipmentCost)),
      stat('Materials cost', money(c.materialsCost)),
      stat('Labour cost', money(c.labourCost),
        d.labour?.mode === 'flat' ? 'Flat fee basis — labour sits in the fee, not the cost' : null),
      stat('Subcontractor', money(c.subcontractorCost)),
      stat('Other', money(c.otherCost)),
      stat('Total job cost', money(c.totalJobCost), null, 'strong'),
      onFee ? stat('Job fee', money(c.jobFee),
        (c.pricingBasis.jobFeeExGst ? 'ex GST' : 'inc GST') + ' — HVAC Design Settings') : null,
      stat('Sell price (ex GST)', money(c.sellPriceExGst), 'GST ' + money(c.gstAmount)),
      stat('Sell price (inc GST)', money(c.sellPriceIncGst), c.pricingBasis?.label || 'No pricing basis'),
      stat('Gross profit', money(c.grossProfit), null, c.grossProfit !== null && c.grossProfit < 0 ? 'bad' : 'ok'),
      stat('Gross margin', c.grossMarginPct === null ? '—' : c.grossMarginPct + '%', null,
        c.grossMarginPct !== null && c.grossMarginPct < 20 && !onFee ? 'warn' : '')),

    ...c.warnings.map(w => banner(
      w.severity === 'CRITICAL' ? 'bad' : w.severity === 'WARNING' ? 'warn' : 'info', w.message,
      /PLACEHOLDER/.test(w.code) ? button('Set material rates', () => app.openSettings('materials'), 'small') : null)),

    onFee ? card('How this price was worked out', null, priceBuildUp(c)) : null,

    card('Commercial inputs',
      onFee
        ? 'Costs feed the price directly on this basis, so anything entered here is recovered in full.'
        : 'The sell price is NAC\'s existing installed price for the selected model — the designer never invents one.',
      h('div', { class: 'grid-4' },
        field('Sell price override (inc GST)', input(d.sellPriceOverride ?? '',
          v => app.setDesignField('sellPriceOverride', v === '' ? null : Number(v)),
          { type: 'number', step: '0.01', placeholder: c.sellPriceIncGst ?? 'not set' }),
          'Overrides the pricing basis for this job only'),
        field('Subcontractor cost', input(d.subcontractorCost ?? '',
          v => app.setDesignField('subcontractorCost', Number(v) || 0), { type: 'number', step: '0.01' }),
          onFee ? 'Recovered, then the fee sits on top' : null),
        field('Other cost', input(d.otherCost ?? '',
          v => app.setDesignField('otherCost', Number(v) || 0), { type: 'number', step: '0.01' })),
        field('Price Setup comparison',
          h('div', { class: 'readout' }, c.cataloguePrice === null ? 'not set' : money(c.cataloguePrice)),
          onFee ? 'Stored installed price — not used on this basis' : 'The price in use'))),

    card('Extra quote lines', 'These are added to the customer quote alongside the system',
      (d.quoteExtras || []).length ? table([
        { key: 'label', label: 'Description', render: (r, i) => input(r.label, v => app.editExtra(i, { label: v })) },
        { key: 'qty', label: 'Qty', align: 'right', width: '80px',
          render: (r, i) => input(r.qty ?? 1, v => app.editExtra(i, { qty: Number(v) }), { type: 'number' }) },
        { key: 'price', label: 'Price (inc GST)', align: 'right', width: '130px',
          render: (r, i) => input(r.price ?? '', v => app.editExtra(i, { price: Number(v) }), { type: 'number', step: '0.01' }) },
        { key: 'remove', label: '', align: 'right', width: '40px',
          render: (r, i) => button('✕', () => app.removeExtra(i), 'tiny ghost') }
      ], d.quoteExtras) : empty('No extra lines.'),
      button('+ Add quote line', () => app.addExtra(), 'ghost')),

    card('Quote', 'Pushes into the existing NAC quote pipeline — same nac_quotes record, same customer signing page.',
      d.quoteId ? banner('info', 'Linked to quote ' + d.quoteId + '.',
        h('div', {},
          button('Update quote from design', () => app.updateQuoteFromDesign(), 'small'),
          button('Open customer quote', () => window.open('/sign.html?q=' + encodeURIComponent(d.quoteId), '_blank'), 'small ghost')))
        : null,
      table([
        { key: 'name', label: 'Line' },
        { key: 'desc', label: 'Description' },
        { key: 'price', label: 'Price (inc GST)', align: 'right', format: v => money(v) }
      ], d.quoteLineItems || []),
      h('div', { class: 'btn-row' },
        button('ADD DESIGN TO QUOTE', () => app.addDesignToQuote(), 'primary'),
        button('Open in Internal Quote Builder', () => app.openInQuoteBuilder(), 'ghost')))
  ];
}

/** The job-cost-plus-fee build-up, line by line. */
function priceBuildUp(c) {
  const rows = [
    { line: 'Equipment', amount: c.equipmentCost },
    { line: 'Materials', amount: c.materialsCost },
    { line: 'Subcontractor', amount: c.subcontractorCost },
    { line: 'Other', amount: c.otherCost },
    { line: 'Total job cost', amount: c.totalJobCost, strong: true },
    { line: 'Job fee (' + (c.pricingBasis.jobFeeExGst ? 'ex GST' : 'inc GST, applied ex GST') + ')',
      amount: c.pricingBasis.feeAppliedExGst },
    { line: 'Sell price ex GST', amount: c.sellPriceExGst, strong: true },
    { line: 'GST (' + (c.gstRate * 100) + '%)', amount: c.gstAmount },
    { line: 'Sell price inc GST', amount: c.sellPriceIncGst, strong: true }
  ].filter(r => r.amount !== 0 || r.strong);

  return h('div', {},
    table([
      { key: 'line', label: '' },
      { key: 'amount', label: 'Amount', align: 'right', format: v => money(v) }
    ], rows, { compact: true, rowClass: (r) => r.strong ? 'warn-row' : '' }),
    h('p', { class: 'note' },
      'Gross profit is the fee itself: ' + money(c.grossProfit) + '. Every cost entered above is recovered ' +
      'before the fee is added, so the fee is what NAC makes whatever the job costs.'));
}

// ── Warnings (PART 27) ──────────────────────────────────────────────────────

export function renderWarnings(app) {
  const d = app.design;
  const warnings = d.warnings || [];
  const sum = d.warningSummary;

  if (!warnings.length) return [empty('No warnings. Everything checks out against the configured limits.')];

  return [
    h('div', { class: 'stat-grid' },
      stat('Critical', sum.counts.CRITICAL, null, sum.counts.CRITICAL ? 'bad' : ''),
      stat('Warning', sum.counts.WARNING, null, sum.counts.WARNING ? 'warn' : ''),
      stat('Check', sum.counts.CHECK),
      stat('Info', sum.counts.INFO),
      stat('Approval', sum.canApprove ? 'Available' : 'Blocked', sum.blockReason, sum.canApprove ? 'ok' : 'bad')),

    ...['CRITICAL', 'WARNING', 'CHECK', 'INFO'].map(sev => {
      const list = warnings.filter(w => w.severity === sev);
      if (!list.length) return null;
      return card(sev + ' (' + list.length + ')', null,
        table([
          { key: 'area', label: 'Area', width: '100px', render: (w) => badge(w.area, 'muted') },
          { key: 'code', label: 'Code', width: '250px' },
          { key: 'message', label: 'Detail' },
          { key: 'ack', label: '', align: 'right', width: '180px',
            render: (w) => sev !== 'CRITICAL' ? null
              : w.acknowledged
                ? badge('acknowledged by ' + w.acknowledgedBy, 'ok')
                : button('Acknowledge', () => app.acknowledgeWarning(w), 'small') }
        ], list));
    }).filter(Boolean),

    h('p', { class: 'disclaimer' }, ENGINEERING_DISCLAIMER)
  ];
}
