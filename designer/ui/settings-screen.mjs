// NAC AI HVAC DESIGNER — PART 12: HVAC DESIGN SETTINGS.
// Every engineering assumption the deterministic engines use is edited here,
// not buried in source. Saved to the existing nac_settings store.

import { h, card, table, field, input, select, button, banner, mount, money } from './dom.mjs';
import { MATERIAL_CATALOGUE } from '../engines/materials.mjs';
import { REQUIRED_SPEC_FIELDS, allModels } from '../engines/catalogue.mjs';

/** Read a nested settings value by dotted path. Writes go through app.updateSetting. */
function pathGet(obj, path) {
  return path.split('.').reduce((o, k) => (o === undefined || o === null ? o : o[k]), obj);
}

export function renderSettingsScreen(app, section = 'load') {
  const S = app.settings;
  const root = h('div', { class: 'settings' });

  const numField = (label, path, hint, step = 'any') => field(label,
    input(pathGet(S, path), v => app.updateSetting(path, Number(v)), { type: 'number', step }), hint);
  const textField = (label, path, hint) => field(label,
    input(pathGet(S, path), v => app.updateSetting(path, v)), hint);

  /** A key→number map rendered as an editable table. */
  const mapTable = (label, path, hint) => {
    const map = pathGet(S, path) || {};
    return card(label, hint,
      table([
        { key: 'k', label: 'Key' },
        { key: 'v', label: 'Value', align: 'right', width: '140px',
          render: (r) => input(r.v, v => app.updateSetting(path + '.' + r.k, Number(v)),
            { type: 'number', step: 'any' }) }
      ], Object.entries(map).map(([k, v]) => ({ id: k, k, v }))));
  };

  const nav = h('div', { class: 'settings-nav' },
    ['load', 'confidence', 'equipment', 'airflow', 'outlets', 'duct', 'return', 'zoning', 'pressure',
     'commercial', 'plan', 'materials', 'specs'].map(s =>
      button(s === 'specs' ? 'Equipment specs' : s === 'materials' ? 'Material rates'
        : s.charAt(0).toUpperCase() + s.slice(1),
        () => app.openSettings(s), 'chip' + (s === section ? ' on' : ''))));

  const body = h('div', { class: 'settings-body' });

  const sections = {
    load: () => [
      banner('info', 'The 145 W/m² all-in rule below is NAC\'s existing sizing rule and is used for the ' +
        'side-by-side comparison. The fabric base is what the detailed engine uses before glazing, ' +
        'occupancy and appliances are added.'),
      card('Base assumptions', null, h('div', { class: 'grid-3' },
        numField('NAC all-in rule (W/m²)', 'load.baseWattsPerM2', 'The existing 145 W/m² rule'),
        numField('Fabric base (W/m²)', 'load.fabricWattsPerM2', 'Detailed engine, fabric only'),
        numField('Heating factor', 'load.heatingFactor', '× cooling load'),
        numField('Reference ceiling height (mm)', 'load.referenceCeilingHeightMm'),
        numField('Default ceiling height (mm)', 'load.defaultCeilingHeightMm'),
        numField('Ceiling height damping', 'load.ceilingHeightDamping', '1 = full volume scaling'),
        numField('Ceiling factor cap', 'load.ceilingHeightFactorMax'),
        numField('Glazing W/m²', 'load.glazingWattsPerM2'),
        numField('Assumed glazing ratio', 'load.assumedGlazingRatio', 'Fraction of floor area'),
        numField('Watts per occupant', 'load.wattsPerOccupant'),
        numField('Open-plan diversity', 'load.openPlanDiversity'),
        numField('System diversity', 'load.systemDiversity'),
        numField('Safety margin', 'load.safetyMargin'),
        numField('External wall uplift', 'load.externalWallUplift', 'Per wall beyond the first'),
        field('Default climate', select(S.load.defaultClimate, Object.keys(S.load.climateFactors),
          v => app.updateSetting('load.defaultClimate', v))),
        field('Default insulation', select(S.load.defaultInsulation, Object.keys(S.load.insulationFactors),
          v => app.updateSetting('load.defaultInsulation', v))),
        field('Default wall', select(S.load.defaultWall, Object.keys(S.load.wallFactors),
          v => app.updateSetting('load.defaultWall', v))),
        field('Default glazing', select(S.load.defaultGlazing, Object.keys(S.load.glazingFactors),
          v => app.updateSetting('load.defaultGlazing', v))))),
      mapTable('Room type fabric base (W/m²)', 'load.roomTypeWattsPerM2'),
      mapTable('Climate factors', 'load.climateFactors'),
      mapTable('Insulation factors', 'load.insulationFactors'),
      mapTable('Wall construction factors', 'load.wallFactors'),
      mapTable('Glazing factors', 'load.glazingFactors'),
      mapTable('Solar orientation factors', 'load.orientationFactors'),
      mapTable('Shading factors', 'load.shadingFactors'),
      mapTable('Default occupancy by room type', 'load.defaultOccupancy'),
      mapTable('Appliance allowance (W)', 'load.applianceWatts')
    ],

    confidence: () => [
      card('Confidence thresholds', 'Where HIGH / MEDIUM / LOW sit, and when an estimator must verify',
        h('div', { class: 'grid-3' },
          numField('HIGH from (%)', 'confidence.highMin'),
          numField('MEDIUM from (%)', 'confidence.mediumMin'),
          numField('Approval threshold (%)', 'confidence.approvalThreshold',
            'Below this, a room cannot enter sizing without an explicit override'))),
      mapTable('Base score by measurement source', 'confidence.sourceScores',
        'The PART 30 priority order — a higher score is a more trustworthy source')
    ],

    equipment: () => [
      card('Equipment selection', null, h('div', { class: 'grid-3' },
        numField('Minimum capacity ratio', 'equipment.minCapacityRatio'),
        numField('Maximum capacity ratio', 'equipment.maxCapacityRatio'),
        numField('Oversize warning ratio', 'equipment.oversizeWarnRatio'),
        numField('Undersize warning ratio', 'equipment.undersizeWarnRatio'),
        numField('Max single unit (kW)', 'equipment.maxSingleUnitKw')))
    ],

    airflow: () => [
      card('Airflow', null, h('div', { class: 'grid-3' },
        numField('L/s per kW', 'airflow.litresPerSecPerKw'),
        numField('Minimum room airflow (L/s)', 'airflow.minRoomAirflowLs'),
        numField('Balance tolerance', 'airflow.balanceTolerance', 'Fraction, e.g. 0.15 = 15%')))
    ],

    outlets: () => [
      card('Outlet rules', null, h('div', { class: 'grid-3' },
        field('Default type', select(S.outlets.defaultType,
          Object.entries(S.outlets.types).map(([k, v]) => ({ value: k, label: v.label })),
          v => app.updateSetting('outlets.defaultType', v))),
        numField('Split if longest dim over (m)', 'outlets.splitIfLongestDimM'),
        numField('Max outlets per room', 'outlets.maxOutletsPerRoom'))),
      card('Outlet capacity table', 'The capacities the outlet engine sizes against',
        table([
          { key: 'label', label: 'Outlet type' },
          { key: 'minLs', label: 'Min L/s', align: 'right', width: '100px',
            render: (r) => input(r.minLs, v => app.updateSetting('outlets.types.' + r.id + '.minLs', Number(v)), { type: 'number' }) },
          { key: 'nominalLs', label: 'Nominal L/s', align: 'right', width: '110px',
            render: (r) => input(r.nominalLs, v => app.updateSetting('outlets.types.' + r.id + '.nominalLs', Number(v)), { type: 'number' }) },
          { key: 'maxLs', label: 'Max L/s', align: 'right', width: '100px',
            render: (r) => input(r.maxLs, v => app.updateSetting('outlets.types.' + r.id + '.maxLs', Number(v)), { type: 'number' }) },
          { key: 'throwM', label: 'Throw (m)', align: 'right', width: '100px',
            render: (r) => input(r.throwM, v => app.updateSetting('outlets.types.' + r.id + '.throwM', Number(v)), { type: 'number', step: '0.1' }) },
          { key: 'faceVelocityMs', label: 'Face velocity (m/s)', align: 'right', width: '130px',
            render: (r) => input(r.faceVelocityMs, v => app.updateSetting('outlets.types.' + r.id + '.faceVelocityMs', Number(v)), { type: 'number', step: '0.1' }) }
        ], Object.entries(S.outlets.types).map(([id, v]) => ({ id, ...v }))))
    ],

    duct: () => [
      card('Duct diameters', 'The only diameters the sizing engine may choose from',
        field('Available diameters (mm, comma separated)',
          input(S.duct.availableDiametersMm.join(', '),
            v => app.updateSetting('duct.availableDiametersMm',
              v.split(',').map(x => Number(x.trim())).filter(x => x > 0).sort((a, b) => a - b))))),
      card('Velocity targets by duct role', null,
        table([
          { key: 'role', label: 'Role' },
          { key: 'preferredMin', label: 'Preferred min (m/s)', align: 'right', width: '150px',
            render: (r) => input(r.preferredMin, v => app.updateSetting('duct.velocity.' + r.role + '.preferredMin', Number(v)), { type: 'number', step: '0.1' }) },
          { key: 'preferred', label: 'Preferred (m/s)', align: 'right', width: '140px',
            render: (r) => input(r.preferred, v => app.updateSetting('duct.velocity.' + r.role + '.preferred', Number(v)), { type: 'number', step: '0.1' }) },
          { key: 'max', label: 'Maximum (m/s)', align: 'right', width: '140px',
            render: (r) => input(r.max, v => app.updateSetting('duct.velocity.' + r.role + '.max', Number(v)), { type: 'number', step: '0.1' }) }
        ], Object.entries(S.duct.velocity).map(([role, v]) => ({ id: role, role, ...v })))),
      card('Duct behaviour', null, h('div', { class: 'grid-3' },
        numField('Flexible duct roughness factor', 'duct.flexRoughnessFactor', '1 = rigid spiral'),
        numField('Long run warning (m)', 'duct.longRunWarnM'),
        numField('Drawn route slack factor', 'duct.routeSlackFactor', 'Rise, drop and sag'),
        numField('Straight-line estimate factor', 'duct.straightLineFactor')))
    ],

    return: () => [
      card('Return air', null, h('div', { class: 'grid-3' },
        numField('Design fraction of supply', 'returnAir.designFraction'),
        numField('Max grille face velocity (m/s)', 'returnAir.maxGrilleFaceVelocityMs'),
        numField('Max filter face velocity (m/s)', 'returnAir.maxFilterFaceVelocityMs'),
        numField('Grille free area ratio', 'returnAir.grilleFreeAreaRatio'),
        numField('Max single return (L/s)', 'returnAir.maxSingleReturnLs'))),
      card('Standard grille sizes', 'One "width x height" pair per line, in mm',
        field('Sizes', h('textarea', { class: 'inp ta',
          onchange: (e) => app.updateSetting('returnAir.standardGrilleSizesMm',
            e.target.value.split('\n').map(l => l.split(/[x×,]/).map(n => Number(n.trim())))
              .filter(p => p.length === 2 && p.every(n => n > 0)))
        }, S.returnAir.standardGrilleSizesMm.map(p => p.join(' x ')).join('\n'))))
    ],

    zoning: () => [
      card('Zoning', null, h('div', { class: 'grid-3' },
        numField('Minimum open airflow fraction', 'zoning.minOpenAirflowFraction', 'e.g. 0.40 = 40%'),
        numField('Constant zone threshold', 'zoning.constantZoneThreshold'),
        numField('Maximum zones', 'zoning.maxZones'),
        numField('Small zone fraction', 'zoning.smallZoneFraction')))
    ],

    pressure: () => [
      card('Static pressure', null, h('div', { class: 'grid-3' },
        numField('Low margin fraction', 'pressure.lowMarginFraction'),
        numField('Air density (kg/m³)', 'pressure.airDensity'))),
      mapTable('Fitting equivalent lengths (m)', 'pressure.equivalentLengthM'),
      mapTable('Component losses (Pa)', 'pressure.componentPa')
    ],

    commercial: () => {
      const flat = S.commercial.labourMode !== 'hourly';
      return [
        card('How the job is charged', null,
          h('div', { class: 'grid-3' },
            field('Charging basis', select(S.commercial.labourMode,
              [{ value: 'flat', label: 'Flat fee per job' },
               { value: 'hourly', label: 'Hourly labour from the design' }],
              v => app.updateSetting('commercial.labourMode', v)),
              'NAC charges a flat fee — everything bought for the job, plus a set amount on top.'),
            flat ? numField('Job fee ($)', 'commercial.jobFee',
              'What NAC makes on the job. Covers labour, overhead and profit together.') : null,
            flat ? field('The fee is', select(S.commercial.jobFeeExGst === false ? 'inc' : 'ex',
              [{ value: 'ex', label: 'Ex GST — GST added on top for the customer' },
               { value: 'inc', label: 'Already includes GST' }],
              v => app.updateSetting('commercial.jobFeeExGst', v === 'ex')),
              'Ex GST means the full fee lands with NAC.') : null,
            numField('GST rate', 'commercial.gstRate')),
          flat ? banner('info',
            'Sell price = equipment + materials + subcontractor + other, plus the ' +
            money(S.commercial.jobFee) + ' fee. Gross profit on every job comes out at exactly the fee, ' +
            'so anything you enter as a cost is automatically recovered.') : null),

        card('How the sell price is worked out', null,
          field('Pricing basis', select(S.commercial.pricingBasis,
            [{ value: 'materials_plus_fee', label: 'Job cost + flat fee' },
             { value: 'catalogue_price', label: 'Installed price from Price Setup' }],
            v => app.updateSetting('commercial.pricingBasis', v)),
            S.commercial.pricingBasis === 'materials_plus_fee'
              ? 'The per-model installed prices in Price Setup are ignored for pricing. They are still shown ' +
                'on the Financials tab for comparison, and a price typed on that tab still overrides everything.'
              : 'Uses the installed price NAC has stored against the selected model.'),
          S.commercial.pricingBasis === 'materials_plus_fee'
            ? banner('warn', 'On this basis your material rates go straight through to the customer. ' +
                'Any line still on a shipped placeholder rate raises a warning on the design.')
            : null),

        !flat ? card('Hourly rates', 'Used only while the charging basis is hourly',
          h('div', { class: 'grid-3' },
            numField('Labour rate ($/h)', 'commercial.labourRatePerHour'),
            numField('Hours per outlet', 'commercial.labourHoursPerOutlet'),
            numField('Hours per zone', 'commercial.labourHoursPerZone'),
            numField('Hours — indoor unit', 'commercial.labourHoursIndoorUnit'),
            numField('Hours — outdoor unit', 'commercial.labourHoursOutdoorUnit'),
            numField('Hours per duct metre', 'commercial.labourHoursPerDuctMetre'),
            numField('Hours — return air', 'commercial.labourHoursReturn'),
            numField('Hours — commissioning', 'commercial.labourHoursCommissioning'))) : null
      ];
    },

    plan: () => [
      card('Plan interpretation', null, h('div', { class: 'grid-3' },
        numField('Minimum room dimension (mm)', 'plan.minRoomDimensionMm'),
        numField('Maximum room dimension (mm)', 'plan.maxRoomDimensionMm'),
        numField('Wall thickness tolerance (mm)', 'plan.wallThicknessToleranceMm'),
        numField('Chain closure tolerance (mm)', 'plan.chainClosureToleranceMm'),
        numField('Minimum chain segment (mm)', 'plan.minChainSegmentMm'))),
      card('Standard wall thicknesses', 'Used to tell a wall apart from a room in a dimension chain',
        field('Thicknesses (mm, comma separated)',
          input(S.plan.wallThicknessesMm.join(', '),
            v => app.updateSetting('plan.wallThicknessesMm',
              v.split(',').map(x => Number(x.trim())).filter(x => x > 0).sort((a, b) => a - b)))))
    ],

    materials: () => [
      banner('info', 'Anything left blank falls back to the shipped placeholder rate, and every design ' +
        'that uses one says so on the Materials tab.'),
      card('Flexible duct rate by diameter ($/m)', null,
        table([
          { key: 'dia', label: 'Diameter (mm)', align: 'right' },
          { key: 'placeholder', label: 'Placeholder', align: 'right', format: v => '$' + v.toFixed(2) },
          { key: 'nac', label: 'NAC rate', align: 'right', width: '140px',
            render: (r) => input(app.materialRates?.flex_duct?.[r.dia] ?? '',
              v => app.updateMaterialRate('flex_duct.' + r.dia, v === '' ? null : Number(v)),
              { type: 'number', step: '0.01', placeholder: r.placeholder.toFixed(2) }) }
        ], Object.entries(MATERIAL_CATALOGUE.flex_duct.byDiameter)
          .map(([dia, cost]) => ({ id: dia, dia: Number(dia), placeholder: cost })))),
      card('Item rates', null,
        table([
          { key: 'label', label: 'Item' },
          { key: 'unit', label: 'Unit', width: '70px' },
          { key: 'placeholder', label: 'Placeholder', align: 'right',
            format: v => v === undefined ? '—' : '$' + Number(v).toFixed(2) },
          { key: 'nac', label: 'NAC rate', align: 'right', width: '140px',
            render: (r) => input(app.materialRates?.[r.id] ?? '',
              v => app.updateMaterialRate(r.id, v === '' ? null : Number(v)),
              { type: 'number', step: '0.01', placeholder: r.placeholder !== undefined ? Number(r.placeholder).toFixed(2) : '' }) }
        ], Object.entries(MATERIAL_CATALOGUE).filter(([k]) => k !== 'flex_duct')
          .map(([id, v]) => ({ id, label: v.label, unit: v.unit, placeholder: v.cost }))))
    ],

    specs: () => [
      banner('warn', 'Manufacturer data is never invented by this application. Anything not entered here is ' +
        'reported as SPECIFICATION DATA REQUIRED and excluded from airflow and static-pressure checks.'),
      card('Equipment specifications', 'Enter from the manufacturer\'s data sheet',
        h('div', {},
          field('Model', select(app.specModelKey || '',
            [{ value: '', label: 'Choose a model…' },
             ...allModels(app.catalogue).map(m => ({ value: m.specKey,
               label: m.brandName + ' — ' + m.name + ' (' + m.kw + ' kW ' + m.phase + ')' +
                 (m.specStatus === 'complete' ? ' ✓' : '') }))],
            v => app.setSpecModel(v))),
          app.specModelKey ? h('div', {},
            banner('info', 'Supplier cost is what the unit costs NAC. On the job-cost-plus-fee basis it ' +
              'goes straight into the customer price, so a missing one under-prices the job.'),
            h('div', { class: 'grid-3' },
              field('supplierCost ($)',
                input(app.equipmentSpecs?.[app.specModelKey]?.supplierCost ?? '',
                  v => app.updateSpec(app.specModelKey, 'supplierCost', v),
                  { type: 'number', step: '0.01' }),
                'What NAC pays for the indoor + outdoor set'),
              ...REQUIRED_SPEC_FIELDS.map(f => field(f,
                input(app.equipmentSpecs?.[app.specModelKey]?.[f] ?? '',
                  v => app.updateSpec(app.specModelKey, f, v),
                  { type: /Mm$|Pa$|Ls$|Kw$|A$/.test(f) ? 'number' : 'text' })))))
            : null))
    ]
  };

  mount(body, (sections[section] || sections.load)().filter(Boolean));

  root.appendChild(h('div', { class: 'settings-head' },
    h('h2', {}, 'HVAC Design Settings'),
    h('div', {},
      button('Reset this section to defaults', () => app.resetSettingsSection(section), 'ghost small'),
      button('Save settings', () => app.saveSettings(), 'primary small'),
      button('Close', () => app.closeSettings(), 'ghost small'))));
  root.appendChild(nav);
  root.appendChild(body);
  return root;
}
