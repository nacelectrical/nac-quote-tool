// NAC AI HVAC DESIGNER — PART 12: HVAC DESIGN SETTINGS.
// Every engineering assumption the deterministic engines use is edited here,
// not buried in source. Saved to the existing nac_settings store.

import { h, card, table, field, input, select, button, banner, mount, money, toast,
         badge, empty } from './dom.mjs';
import { currentUserEmail } from '../auth.mjs';
import { MATERIAL_CATALOGUE, resolveCost } from '../engines/materials.mjs';
import { VERIFICATION_FIELDS } from '../engines/material-verification.mjs';
import { MINIMUM_AIRFLOW_FIELDS, minimumVerified, minimumMissing }
  from '../engines/minimum-airflow.mjs';
import { DEFAULT_SETTINGS } from '../engines/settings.mjs';
import { REQUIRED_SPEC_FIELDS, allModels } from '../engines/catalogue.mjs';
import { MMEM_META, MMEM_ACCESSORIES_META, MMEM_DUCTED, MMEM_ZONE_CONTROLS } from '../engines/supplier-pricing.mjs';
import { ALLOWANCE_FIELDS } from '../engines/design-stage.mjs';
import { commercialTermsStatus } from '../engines/commercial-terms.mjs';
import { activeMode } from '../engines/pricing-mode.mjs';

/** Read a nested settings value by dotted path. Writes go through app.updateSetting. */
function pathGet(obj, path) {
  return path.split('.').reduce((o, k) => (o === undefined || o === null ? o : o[k]), obj);
}

/**
 * Every material rate NAC can set, per diameter where the line has diameters.
 *
 * A line's own table is not the list of sizes it can be ASKED for: a diameter
 * on the duct ladder but missing from the table has no price at all, which is
 * the worst case and the easiest to miss. Both are offered here, so there is
 * nowhere the application can ask for a price that cannot then be entered.
 */
/**
 * §5 — MATERIAL RATES REQUIRING CONFIRMATION.
 *
 * The lines THIS job actually leans on, and what is still missing from each.
 * Only used lines: the catalogue carries rates for sizes a given house will
 * never see, and blocking a quote on those is noise that teaches an estimator
 * to ignore the check.
 */
function ratesRequiringConfirmation(app) {
  const status = app.design?.rateVerification || null;
  if (!status) {
    return card('Material rates requiring confirmation',
      'Open a design to see which rates it uses.', empty('No design open.'));
  }
  const V = app.rateVerifications || {};
  const write = (id, key, v) => app.updateRateVerification(id, key, v);

  const rows = status.rows.map(r => ({ id: r.id, ...r, rec: V[r.id] || {} }));
  const needing = rows.filter(r => r.needsConfirmation);

  const cell = (r, f) => f.key === 'cost'
    ? input(r.rec.cost ?? '', v => write(r.id, 'cost', v === '' ? null : Number(v)),
        { type: 'number', step: '0.01', inputmode: 'decimal',
          placeholder: r.currentRate === null ? '' : Number(r.currentRate).toFixed(2) })
    : input(r.rec[f.key] || '', v => write(r.id, f.key, v),
        { type: /Date$/.test(f.key) ? 'date' : 'text',
          placeholder: f.required ? 'required' : 'optional' });

  return card('Material rates requiring confirmation',
    'Every rate this job uses, and what each still needs. A customer quote is blocked '
    + 'until every used line is verified \u2014 marking a rate as "not a placeholder" is not '
    + 'the same as being able to say where it came from.',
    needing.length === 0
      ? banner('ok', 'All ' + rows.length + ' rate(s) this job uses are verified.')
      : banner('warn', needing.length + ' of ' + rows.length + ' rate(s) this job uses are '
          + 'not verified. The quote is blocked until they are.'),
    table([
      { key: 'label', label: 'Item', render: (r) => h('div', {},
          h('strong', {}, r.label),
          h('div', { class: 'alw-help' },
            (r.diameterMm ? '\u00f8' + r.diameterMm + ' mm \u00b7 ' : '')
            + 'per ' + r.unit
            + (r.supplierCode ? ' \u00b7 ' + r.supplierCode : '')
            + (r.placeholder ? ' \u00b7 SHIPPED PLACEHOLDER'
               : r.unpriced ? ' \u00b7 NO PRICE AT ALL' : ''))) },
      { key: 'cur', label: 'Current', align: 'right', width: '90px',
        render: (r) => r.currentRate === null ? '\u2014' : money(r.currentRate) },
      ...VERIFICATION_FIELDS.map(f => ({
        key: f.key, label: f.label, width: f.key === 'supplierDesc' ? '180px' : '130px',
        render: (r) => cell(r, f)
      })),
      { key: 'state', label: 'Status', width: '160px', render: (r) => r.verified
          ? badge('VERIFIED', 'ok')
          : h('div', { class: 'alw-help' },
              'Needs: ' + (r.missing.length
                ? r.missing.map(m => m.label.toLowerCase()).join(', ') : 'nothing')) }
    ], rows));
}

function materialRateCards(app) {
  const LADDER = DEFAULT_SETTINGS.duct.availableDiametersMm;
  const rateInput = (id, shipped) => input(pathGet(app.materialRates || {}, id) ?? '',
    v => app.updateMaterialRate(id, v === '' ? null : Number(v)),
    { type: 'number', step: '0.01', inputmode: 'decimal',
      placeholder: shipped === null || shipped === undefined ? '' : Number(shipped).toFixed(2) });

  const rows = [];
  for (const [key, def] of Object.entries(MATERIAL_CATALOGUE)) {
    if (def.byDiameter) {
      const sizes = [...new Set([...Object.keys(def.byDiameter).map(Number), ...LADDER])]
        .sort((a, b) => a - b);
      for (const dia of sizes) {
        const r = resolveCost(key, { diameterMm: dia });
        rows.push({
          id: key + '.' + dia,
          label: def.label + ' ' + dia + ' mm',
          unit: def.unit,
          // On a line sold by the length, the box takes the price of ONE
          // LENGTH, so the shipped figure beside it has to be the same thing.
          // Showing the per-metre figure next to a per-length box is how a
          // rate gets typed in six times too small.
          shipped: r.pack ? r.pack.cost : r.cost,
          origin: r.cost === null ? 'NO PRICE AT ALL'
            : r.source === 'default_placeholder' ? 'PLACEHOLDER'
            : (r.supplierCode || MMEM_ACCESSORIES_META.quoteNo)
        });
      }
    } else {
      const r = resolveCost(key, {});
      rows.push({
        id: key, label: def.label, unit: def.unit,
        shipped: r.pack ? r.pack.cost : r.cost,
        origin: r.cost === null ? 'NO PRICE AT ALL'
          : r.source === 'default_placeholder' ? 'PLACEHOLDER'
          : (def.supplierCode || MMEM_ACCESSORIES_META.quoteNo)
      });
    }
  }

  const toConfirm = rows.filter(r => r.origin === 'PLACEHOLDER' || r.origin === 'NO PRICE AT ALL');
  const set = rows.filter(r => pathGet(app.materialRates || {}, r.id) !== undefined &&
                               pathGet(app.materialRates || {}, r.id) !== null);

  const cols = [
    { key: 'label', label: 'Item' },
    { key: 'unit', label: 'Unit', width: '104px' },
    { key: 'shipped', label: 'Shipped rate', align: 'right',
      format: v => v === undefined || v === null ? 'NONE' : '$' + Number(v).toFixed(2) },
    { key: 'origin', label: 'Source' },
    { key: 'nac', label: 'NAC rate', align: 'right', width: '140px',
      render: (r) => rateInput(r.id, r.shipped) }
  ];

  return [
    toConfirm.length
      ? banner('warn', toConfirm.length + ' rate(s) are still to be confirmed — ' +
          toConfirm.filter(r => r.origin === 'NO PRICE AT ALL').length + ' with no price at all and ' +
          toConfirm.filter(r => r.origin === 'PLACEHOLDER').length + ' on shipped placeholders. ' +
          'Anything typed here becomes NAC\'s own rate and overrides both.' +
          (set.length ? ' ' + set.length + ' rate(s) already entered.' : ''))
      : banner('info', 'Every material rate is either a confirmed supplier price or a NAC rate you have entered.'),

    card('Still to confirm', 'The only rates that change a quote you cannot stand behind',
      toConfirm.length ? table(cols, toConfirm)
        : h('p', { class: 'note' }, 'None — every line has a real price.')),

    card('Confirmed rates', 'From the MMEM quotation, or already entered by NAC',
      table(cols, rows.filter(r => r.origin !== 'PLACEHOLDER' && r.origin !== 'NO PRICE AT ALL')))
  ];
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
        numField('Max single unit (kW)', 'equipment.maxSingleUnitKw'),
        field('House-standard zone controller', select(S.equipment.defaultControllerId || '',
          [{ value: '', label: 'Cheapest that fits' },
           ...(app.controllers || []).map(c => ({
             value: c.id,
             label: c.name + (c.cost != null ? ' — $' + Number(c.cost).toFixed(2) : ' — no cost on file')
           }))],
          v => app.updateSetting('equipment.defaultControllerId', v)),
          'Used whenever the design does not name one. It is still skipped if it is not compatible.'))),
      card('Supplier price list', 'Where equipment costs come from when NAC has not entered one',
        h('p', { class: 'note' },
          MMEM_META.source + ' — ' + MMEM_META.edition + ', ' + MMEM_META.basis +
          ' (account ' + MMEM_META.account + '). ' + MMEM_META.note),
        h('p', { class: 'note' },
          MMEM_DUCTED.length + ' ducted sets and ' + MMEM_ZONE_CONTROLS.length +
          ' zone controls are priced. Costs entered per model below always take precedence.'))
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

        // ── §4 ONE PRICING METHOD, CHOSEN OUT LOUD ────────────────────────
        (() => {
          const mode = activeMode(S).mode;
          const costPlus = mode === 'COST_PLUS_JOB_FEE';
          return card('How the sell price is worked out',
            'One method at a time. The two are never combined.',
            field('Pricing method', select(mode || '',
              [{ value: 'COST_PLUS_JOB_FEE',
                 label: 'Cost plus job fee — what the job costs, plus the fixed fee' },
               { value: 'COMPONENT_SELL_PRICES',
                 label: 'Component sell prices — every line priced individually' }],
              v => app.updateSetting('commercial.pricingMode', v)),
              costPlus
                ? 'The customer pays what NAC paid for everything, plus the fee. The fee IS the '
                  + 'margin. You need verified COSTS on every line — you do NOT need a sell price '
                  + 'on anything, including the equipment.'
                : 'Every line carries its own sell price and the price is their sum. The flat job '
                  + 'fee is NOT added on top, because these prices already carry the margin.'),
            costPlus
              ? banner('warn', 'On this method your material rates go straight through to the '
                  + 'customer. Any line still on a shipped placeholder rate blocks the quote.')
              : field('Also add the flat job fee?',
                  select(S.commercial.applyJobFeeOnComponentPricing === true ? 'yes' : 'no',
                    [{ value: 'no', label: 'No — the line prices already include the margin' },
                     { value: 'yes', label: 'Yes — add the job fee on top as well' }],
                    v => app.updateSetting('commercial.applyJobFeeOnComponentPricing', v === 'yes')),
                  'Adding a flat fee on top of individually priced lines charges the margin '
                  + 'twice. Only say yes if you mean it.'));
        })(),

        // ── §3 THE PROPOSAL ALLOWANCE ─────────────────────────────────────
        (() => {
          const a = S.commercial.proposalAllowance || {};
          const set = ALLOWANCE_FIELDS.filter(f => a[f.key] !== null && a[f.key] !== undefined
                                                   && a[f.key] !== '');
          const rows = ALLOWANCE_FIELDS.map(f => {
            const v = a[f.key];
            const unset = v === null || v === undefined || v === '';
            return h('div', { class: 'alw-row' + (unset && !f.optional ? ' unset' : '') },
              h('div', { class: 'alw-label' },
                h('strong', {}, f.label + (f.unit ? ' (' + f.unit + ')' : '')),
                h('span', { class: 'alw-help' }, f.help)),
              h('div', { class: 'alw-input' },
                input(v ?? '', (nv) => {
                  const t = String(nv).trim();
                  if (t === '') return app.updateSetting(
                    'commercial.proposalAllowance.' + f.key, null);
                  const num = Number(t);
                  // VALIDATED BEFORE IT IS SAVED. A typo here is a typo on a
                  // customer's price.
                  if (!Number.isFinite(num) || num < 0) {
                    return toast('"' + t + '" is not an amount. Enter a number, or clear '
                      + 'the box to leave ' + f.label.toLowerCase() + ' unset.');
                  }
                  if (f.unit === '%' && num > 100) {
                    return toast('A contingency of ' + num + '% more than doubles the job.', 'bad');
                  }
                  app.updateSetting('commercial.proposalAllowance.' + f.key, num);
                }, { type: 'number', step: 'any', min: '0',
                     placeholder: f.optional ? 'optional' : 'not set' })),
              h('div', { class: 'alw-state' },
                unset ? (f.optional ? '—' : 'NOT SET') : 'set'));
          });
          return card('Proposal allowance — what a job is worth before it is designed',
            'A proposal quotes a job whose ductwork has not been designed yet, so the ductwork '
            + 'is a declared allowance instead of measured quantities. These are NAC\u2019s own '
            + 'commercial numbers — nothing here has a default, and nothing is invented.',
            h('div', { class: 'alw' }, ...rows),
            set.length === 0
              ? banner('warn', 'No allowance is set, so no proposal-stage quote can be produced. '
                  + 'Enter at least the standard ductwork figure, or the per-outlet and per-zone '
                  + 'rates, above.')
              : banner('info', set.length + ' of ' + ALLOWANCE_FIELDS.length + ' elements set. '
                  + 'A proposal shows each one as its own line, so an estimator can see what the '
                  + 'allowance covers and judge whether a job needs more.'));
        })(),

        // ── §6 DEPOSIT, PAYMENT AND VALIDITY ──────────────────────────────
        (() => {
          const t = S.commercial.terms || {};
          const status = commercialTermsStatus(S);
          const stages = Array.isArray(t.paymentStages) ? t.paymentStages : [];
          return card('Deposit, payment and validity',
            'These are the terms a customer agrees to when they accept a quote. Nothing here '
            + 'has a default and no quote can be issued until they are entered and confirmed.',
            h('div', { class: 'grid-3' },
              field('Deposit (%)', input(t.depositPercent ?? '',
                v => app.updateSetting('commercial.terms.depositPercent',
                  String(v).trim() === '' ? null : Number(v)),
                { type: 'number', step: 'any', min: '0', max: '100', placeholder: 'not set' }),
                'A percentage of the quote. Use this OR the fixed amount, not both.'),
              field('Deposit ($)', input(t.depositAmount ?? '',
                v => app.updateSetting('commercial.terms.depositAmount',
                  String(v).trim() === '' ? null : Number(v)),
                { type: 'number', step: 'any', min: '0', placeholder: 'not set' }),
                'A fixed amount, whatever the job is worth.'),
              field('Quote valid for (days)', input(t.validityDays ?? '',
                v => app.updateSetting('commercial.terms.validityDays',
                  String(v).trim() === '' ? null : Number(v)),
                { type: 'number', step: '1', min: '1', placeholder: 'not set' }),
                'After this the quote shows as expired and cannot be accepted.')),
            h('div', { class: 'grid-2' },
              field('Balance due on', input(t.balanceDueEvent || '',
                v => app.updateSetting('commercial.terms.balanceDueEvent', v),
                { placeholder: 'e.g. completion and commissioning' }),
                'The event that makes the balance payable. Not a date \u2014 the install day is '
                + 'not known when the quote goes out.'),
              field('Payment methods', input((t.paymentMethods || []).join(', '),
                v => app.updateSetting('commercial.terms.paymentMethods',
                  String(v).split(',').map(x => x.trim()).filter(Boolean)),
                { placeholder: 'e.g. Bank transfer, Card' }),
                'Comma separated. How the customer can actually pay.'),
              field('Terms and conditions version', input(t.termsVersion || '',
                v => app.updateSetting('commercial.terms.termsVersion', v),
                { placeholder: 'e.g. NAC-T&C-2026-01' }),
                'Recorded on every accepted quote, so what was agreed is on file.')),
            card('Payment stages', 'Optional. Leave empty if it is simply deposit then balance.',
              (() => {
                // updateSetting walks a dotted path creating plain OBJECTS, so
                // 'paymentStages.0.label' would quietly turn the array into
                // {0:{...}}. The whole array is written instead.
                const writeStage = (i, key, v) => app.updateSetting(
                  'commercial.terms.paymentStages',
                  stages.map((st, j) => j === i ? { ...st, [key]: v } : st));
                return table([
                  { key: 'label', label: 'Stage', render: (r) => input(r.label || '',
                      v => writeStage(r.id, 'label', v)) },
                  { key: 'detail', label: 'Detail', render: (r) => input(r.detail || '',
                      v => writeStage(r.id, 'detail', v)) },
                  { key: 'x', label: '', width: '60px', render: (r) =>
                      button('Remove', () => app.updateSetting(
                        'commercial.terms.paymentStages',
                        stages.filter((_, j) => j !== r.id)), 'ghost') }
                ], stages.map((st, i) => ({ id: i, ...st })));
              })(),
              button('Add a stage', () => app.updateSetting('commercial.terms.paymentStages',
                [...stages, { label: '', detail: '' }]), 'ghost')),
            status.missing.length
              ? banner('warn', 'Still to enter: ' + status.missing.map(m => m.label).join(', ')
                  + '. A customer quote is blocked until these are set.')
              : status.confirmed
                ? banner('ok', 'Confirmed by ' + (t.confirmedBy || 'nobody')
                    + (t.confirmedAt ? ' on ' + String(t.confirmedAt).slice(0, 10) : '') + '.')
                : h('div', {},
                    banner('warn', 'Everything is filled in, but confirming is a separate step \u2014 '
                      + 'these are the terms NAC honours if a customer signs.'),
                    button('I confirm these are NAC\u2019s terms', () => {
                      app.updateSetting('commercial.terms.confirmedBy', currentUserEmail() || 'estimator');
                      app.updateSetting('commercial.terms.confirmedAt', new Date().toISOString());
                      app.updateSetting('commercial.terms.confirmed', true);
                    }, 'primary')));
        })(),

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
      // WHAT THIS JOB IS BLOCKED ON, FIRST. The full catalogue is below it.
      ratesRequiringConfirmation(app),
      banner('info', 'Rates marked ' + MMEM_ACCESSORIES_META.quoteNo + ' come straight off the MMEM ' +
        'quotation of ' + MMEM_ACCESSORIES_META.date + ' (' + MMEM_ACCESSORIES_META.basis + ') and are real ' +
        'costs. Rates marked PLACEHOLDER are shipped starting values that nobody at NAC has confirmed — ' +
        'every design that uses one says so on the Materials tab. Anything you enter here overrides both.'),
      // Every rate NAC can set, including the per-diameter ones. This used to
      // render flexible duct by diameter and everything else as a single flat
      // row — so a diffuser or zone motor rate for one size had nowhere to be
      // typed, and the Materials tab asked for prices the settings screen gave
      // no way to enter.
      ...materialRateCards(app)
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
              'goes straight into the customer price, so a missing one under-prices the job. ' +
              'Leave it blank to use the ' + MMEM_META.source + ' rate where there is one.'),
            h('div', { class: 'grid-3' },
              field('supplierCost ($)',
                input(app.equipmentSpecs?.[app.specModelKey]?.supplierCost ?? '',
                  v => app.updateSpec(app.specModelKey, 'supplierCost', v),
                  { type: 'number', step: '0.01' }),
                'What NAC pays for the indoor + outdoor set'),
              ...REQUIRED_SPEC_FIELDS.map(f => field(f,
                input(app.equipmentSpecs?.[app.specModelKey]?.[f] ?? '',
                  v => app.updateSpec(app.specModelKey, f, v),
                  { type: /Mm$|Pa$|Ls$|Kw$|A$/.test(f) ? 'number' : 'text' }))),

              // ── §7 THE MINIMUM AIRFLOW, WITH ITS SOURCE ──────────────────
              (() => {
                const rec = app.equipmentSpecs?.[app.specModelKey]?.minimumAirflow || {};
                const verified = minimumVerified(rec);
                const missing = minimumMissing(rec);
                return card('Minimum airflow',
                  'The lowest airflow the manufacturer permits through this unit. It decides '
                  + 'whether a zoned house needs a spill zone, so it has to come off their '
                  + 'document \u2014 not from a rule of thumb. Until it is entered, the zoning '
                  + 'check falls back to an internal screening figure that cannot approve a '
                  + 'design.',
                  h('div', { class: 'alw' },
                    ...MINIMUM_AIRFLOW_FIELDS.map(mf => h('div', { class: 'alw-row' },
                      h('div', { class: 'alw-label' },
                        h('strong', {}, mf.label + (mf.unit ? ' (' + mf.unit + ')' : '')),
                        h('span', { class: 'alw-help' }, mf.help)),
                      h('div', { class: 'alw-input' },
                        input(rec[mf.key] ?? '',
                          v => app.updateSpecMinimumAirflow(app.specModelKey, mf.key,
                            v === '' ? null : (mf.type === 'number' ? Number(v) : v)),
                          { type: mf.type === 'number' ? 'number'
                                  : mf.type === 'date' ? 'date' : 'text',
                            step: 'any', min: '0',
                            placeholder: mf.required ? 'required' : 'optional' })),
                      h('div', { class: 'alw-state' },
                        rec[mf.key] === undefined || rec[mf.key] === null || rec[mf.key] === ''
                          ? (mf.required ? 'NOT SET' : '\u2014') : 'set')))),
                  verified
                    ? banner('ok', 'Verified. The zoning check will use this figure and cite the '
                        + 'document it came from.')
                    : banner('warn', 'Still needed: '
                        + missing.map(m => m.label.toLowerCase()).join(', ')
                        + '. Until then the zoning check is a provisional screening check only.'));
              })()))
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
