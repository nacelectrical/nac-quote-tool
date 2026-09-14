// NAC AI HVAC DESIGNER — QUICK QUOTE MODE.
//
//   UPLOAD → VERIFY → DESIGN → PRICE → SEND
//
// The default way an NAC estimator uses this tool. Five steps, and the tool
// does the engineering in the background: rooms, load, equipment, airflow,
// outlets, duct sizing, routing, return air, zoning, static pressure, bill of
// materials, costing and the customer's price.
//
// THE RULE THIS SCREEN IS BUILT ON:
//
//   Never ask the estimator anything that can be answered from the floor plan,
//   the job record, NAC's defaults, the supplier data or HVAC Design Settings.
//
// Which questions survive that rule is decided in engines/interruptions.mjs,
// not here. This module only presents them.
//
// Nothing is hidden that changes a number. Every engineering safeguard still
// runs — a static pressure check that could not be carried out still stops the
// job, an unpriced material line still stops the quote. What changes is that
// the estimator is not walked through thirteen tabs to find out.
//
// The thirteen tabs are still there under ADVANCED DESIGN for when the job is
// unusual, which is the other half of the same idea: simple by default,
// powerful when it has to be.

import { h, card, badge, banner, button, field, input, select, empty,
         money, num, int, table } from './dom.mjs';
import { collectInterruptions, INTERRUPT } from '../engines/interruptions.mjs';
import { AUTO_ROUTE_NOTICE } from '../engines/router.mjs';
import { supplierOrderList, JOB_STATE, READY_TO_ORDER } from '../engines/order.mjs';

export const QUICK_STEPS = [
  { key: 'upload', label: 'Upload', hint: 'The floor plan' },
  { key: 'verify', label: 'Verify', hint: 'Only what is uncertain' },
  { key: 'design', label: 'Design', hint: 'Review the finished design' },
  { key: 'price',  label: 'Price',  hint: 'Cost, fee and sell price' },
  { key: 'send',   label: 'Send',   hint: 'The customer’s quote' }
];

/** Which steps are behind us, so the stepper can show progress honestly. */
export function quickStepState(design, interruptions) {
  const d = design || {};
  return {
    upload: !!d.plan && !!d.calibration,
    verify: !!d.plan && !!d.calibration && interruptions.canQuote,
    design: d.stage === 'complete' && interruptions.canQuote,
    price:  !!d.commercials?.sellPriceIncGst,
    send:   !!d.quoteId
  };
}

// ── The stat cards down the right of the review screen ──────────────────────

function statCard(label, value, sub, kind = '') {
  return h('div', { class: 'qcard ' + kind },
    h('div', { class: 'qcard-label' }, label),
    h('div', { class: 'qcard-value' }, value ?? '—'),
    sub ? h('div', { class: 'qcard-sub' }, sub) : null);
}

// ── Step 1: UPLOAD ──────────────────────────────────────────────────────────

function stepUpload(app) {
  const d = app.design;
  // The real upload and calibrate panels, not copies of them. One source of
  // truth means a fix to either reaches both modes.
  return [
    app.renderUploadPanel(),

    // What the reader actually got off the plan. This is the tool showing its
    // working at the only moment the estimator cares — before they trust it.
    d.plan ? app.renderNumbersPanel() : null,

    d.plan
      ? banner('info', 'An uploaded screenshot does not keep its original A3 or A4 scale, so a ' +
          'printed "1:100" label is a hint only. The two points you set are what every ' +
          'measurement on this job uses.')
      : null,
    d.plan ? app.renderCalibratePanel() : null,

    d.calibration
      ? banner('ok', 'Plan calibrated. The tool has read the rooms and is sizing the system.',
          button('Next — Verify', () => app.setQuickStep('verify'), 'small'))
      : null
  ].filter(Boolean);
}

// ── Step 2: VERIFY — only what is genuinely uncertain ───────────────────────

function interruptionRow(app, i) {
  const kind = i.level === INTERRUPT.BLOCKING ? 'bad' : 'warn';
  return h('div', { class: 'qint ' + kind },
    h('div', { class: 'qint-head' },
      badge(i.level === INTERRUPT.BLOCKING ? 'MUST FIX' : 'CONFIRM', kind),
      h('span', { class: 'qint-title' }, i.title)),
    h('div', { class: 'qint-detail' }, i.detail),
    h('div', { class: 'btn-row' },
      button('Fix this', () => app.jumpToFix(i), 'small'),
      i.level === INTERRUPT.CONFIRM
        ? button('Confirmed', () => app.confirmInterruption(i), 'ghost small')
        : null));
}

function stepVerify(app, interruptions) {
  const d = app.design;
  if (!d.plan || !d.calibration) {
    return [banner('warn', 'Upload and calibrate the plan first.',
      button('Back to Upload', () => app.setQuickStep('upload'), 'small'))];
  }

  const outstanding = [...interruptions.blocking, ...interruptions.confirm];

  if (!outstanding.length) {
    return [
      banner('ok', 'Nothing needs you. The tool read the plan, sized the system and priced the job.'),
      card('What the tool did on its own', 'Every one of these ran and raised nothing worth stopping for',
        h('ul', { class: 'qlist' },
          ...['Rooms detected and measured', 'Heat load calculated', 'Equipment selected',
              'Airflow allocated', 'Outlets selected', 'Ducts sized', 'Return air designed',
              'Zoning worked out', 'Static pressure checked', 'Bill of materials built',
              'Job costed and priced'].map(t => h('li', {}, t)))),
      button('Next — Review the design', () => app.setQuickStep('design'), 'primary')
    ];
  }

  return [
    banner(interruptions.blocking.length ? 'bad' : 'warn', interruptions.summary),
    h('div', { class: 'note' },
      'Everything else was answered from the plan, the job, NAC’s settings and the supplier data. ' +
      'These are the only things the tool could not settle on its own.'),
    ...outstanding.map(i => interruptionRow(app, i)),
    interruptions.canQuote
      ? button('Next — Review the design', () => app.setQuickStep('design'), 'primary')
      : null
  ].filter(Boolean);
}

// ── Step 3: DESIGN — the one powerful review screen ─────────────────────────

function reviewCards(app, interruptions) {
  const d = app.design;
  const s = app.summary || {};
  const c = d.commercials || {};
  const p = d.pressure || {};

  const cards = [
    statCard('Selected system', s.selectedSystem || '—',
      d.selectedUnit ? d.selectedUnit.capacityKw + ' kW · ' + d.selectedUnit.phase : null),
    statCard('Total load', s.totalCoolingLoadKw != null ? num(s.totalCoolingLoadKw, 2) + ' kW' : '—',
      s.totalConditionedAreaSqM ? num(s.totalConditionedAreaSqM, 1) + ' m² conditioned' : null),
    statCard('Total airflow', s.totalAirflowLs != null ? int(s.totalAirflowLs) + ' L/s' : '—',
      s.outletCount != null ? s.outletCount + ' outlets' : null),
    statCard('Zones', s.zoneCount != null ? int(s.zoneCount) : '—',
      d.controller ? d.controller.name : null),
    statCard('Ductwork', s.totalDuctLengthM != null ? num(s.totalDuctLengthM, 1) + ' m' : '—',
      d.returnDesign ? 'Return ' + (d.returnDesign.duct?.diameterMm || '—') + 'Ø' : null),
    statCard('Static pressure',
      p.estimatedRequirementPa != null ? int(p.estimatedRequirementPa) + ' Pa' : '—',
      p.checkCompleted === false ? 'CHECK NOT COMPLETED'
        : p.unitAvailableStaticPa != null ? int(p.unitAvailableStaticPa) + ' Pa available' : null,
      p.checkCompleted === false ? 'bad' : p.status === 'fail' ? 'bad' : ''),

    // ── Internal money. Never shown to a customer. ──
    statCard('Material cost', c.materialCost != null ? money(c.materialCost) : '—',
      d.bom?.placeholderCount ? d.bom.placeholderCount + ' placeholder rates' : null,
      'internal'),
    statCard('Internal job cost', c.totalJobCost != null ? money(c.totalJobCost) : '—',
      'Everything bought and paid for', 'internal'),
    statCard('Customer sell price', c.sellPriceIncGst != null ? money(c.sellPriceIncGst) : '—',
      'inc GST', 'sell'),
    statCard('Gross profit', c.grossProfit != null ? money(c.grossProfit) : '—',
      c.grossMarginPct != null ? num(c.grossMarginPct, 1) + '% GP' : null, 'internal')
  ];

  return h('div', { class: 'qcards' }, ...cards);
}

function stepDesign(app, interruptions) {
  const d = app.design;
  if (d.stage !== 'complete') {
    return [banner('warn', 'The design is not complete yet.',
      button('Back to Verify', () => app.setQuickStep('verify'), 'small'))];
  }

  const attention = [...interruptions.blocking, ...interruptions.confirm];

  return [
    // The safety line is not negotiable and is not tucked away.
    d.autoRoute?.generated ? banner('warn', AUTO_ROUTE_NOTICE) : null,

    h('div', { class: 'qreview' },
      // LEFT — the plan, with everything on it.
      h('div', { class: 'qreview-plan' },
        h('div', { class: 'qreview-plan-head' },
          h('strong', {}, 'Floor plan'),
          h('span', { class: 'note' }, 'Indoor unit, outlets, ducts, diameters, return and zones'),
          button('Open the plan', () => app.setTab('plan'), 'ghost small')),
        app.quickPlanHost || h('div', { class: 'qplan-placeholder' }, 'Plan')),

      // RIGHT — the numbers that decide whether this goes out.
      h('div', { class: 'qreview-side' },
        reviewCards(app, interruptions),
        attention.length
          ? h('div', { class: 'qattn' },
              h('div', { class: 'qattn-head' }, 'Needs attention'),
              ...attention.map(i => h('div', { class: 'qattn-row ' + (i.level === INTERRUPT.BLOCKING ? 'bad' : 'warn') },
                badge(i.level === INTERRUPT.BLOCKING ? 'MUST FIX' : 'CONFIRM',
                      i.level === INTERRUPT.BLOCKING ? 'bad' : 'warn'),
                h('span', {}, i.title),
                button('Fix', () => app.jumpToFix(i), 'tiny ghost'))))
          : banner('ok', 'No warnings outstanding.'))),

    h('div', { class: 'btn-row qactions' },
      button('EDIT DESIGN', () => app.enterAdvanced(), 'ghost'),
      button('APPROVE DESIGN', () => app.approveDesign(),
        interruptions.canQuote ? 'primary' : 'ghost'),
      button('SEND QUOTE', () => app.setQuickStep('send'),
        d.approved ? 'primary' : 'ghost'))
  ].filter(Boolean);
}

// ── Step 4: PRICE ───────────────────────────────────────────────────────────

function stepPrice(app, interruptions) {
  const d = app.design;
  const c = d.commercials || {};
  if (!c.totalJobCost && c.totalJobCost !== 0) {
    return [banner('warn', 'Nothing is costed yet.',
      button('Back to Design', () => app.setQuickStep('design'), 'small'))];
  }

  return [
    banner('info', 'These figures are NAC’s. The customer sees the sell price and what they are ' +
      'getting — never the cost, the fee, the margin or the labour breakdown.'),

    card('What the job costs NAC', 'Everything bought and paid for',
      table([
        { key: 'label', label: 'Item' },
        { key: 'value', label: 'Cost', align: 'right', width: '130px',
          render: (r) => money(r.value) }
      ], [
        { label: 'Equipment', value: c.equipmentCost ?? 0 },
        { label: 'Materials', value: c.materialCost ?? 0 },
        { label: 'Labour', value: c.labourCost ?? 0 },
        { label: 'Subcontractor', value: c.subcontractorCost ?? 0 },
        { label: 'Other', value: c.otherCost ?? 0 }
      ], { compact: true }),
      h('div', { class: 'qtotal' }, 'Total job cost ', h('strong', {}, money(c.totalJobCost)))),

    card('What NAC charges', 'Cost plus a flat job fee — the fee is the entire margin',
      h('div', { class: 'qcards' },
        statCard('Job fee', c.jobFee != null ? money(c.jobFee) : '—', 'The margin on this job', 'internal'),
        statCard('Sell price ex GST', c.sellPriceExGst != null ? money(c.sellPriceExGst) : '—', null, 'sell'),
        statCard('Sell price inc GST', c.sellPriceIncGst != null ? money(c.sellPriceIncGst) : '—', null, 'sell'),
        statCard('Gross profit', c.grossProfit != null ? money(c.grossProfit) : '—',
          c.grossMarginPct != null ? num(c.grossMarginPct, 1) + '%' : null, 'internal'))),

    d.bom?.placeholderCount
      ? banner('warn', d.bom.placeholderCount + ' material rate(s) in this price are shipped ' +
          'placeholders, not NAC prices. On cost-plus-fee they go straight to the customer.',
          button('Set the real rates', () => app.openSettings('materials'), 'small'))
      : null,

    button('Next — Send the quote', () => app.setQuickStep('send'),
      interruptions.canQuote ? 'primary' : 'ghost')
  ].filter(Boolean);
}

// ── Step 5: SEND ────────────────────────────────────────────────────────────

function stepSend(app, interruptions) {
  const d = app.design;

  // A quote that EXISTS outranks the pre-quote gate. Once the job is sold,
  // telling the estimator they cannot quote it is nonsense — what they need is
  // the quote, and anything still outstanding listed underneath it.
  if (!d.quoteId && !interruptions.canQuote) {
    return [
      banner('bad', interruptions.summary),
      ...interruptions.blocking.map(i => interruptionRow(app, i))
    ];
  }

  if (d.quoteId) {
    return [
      d.jobState === JOB_STATE.READY_TO_ORDER
        ? banner('ok', 'Quote ' + d.quoteId + ' was ACCEPTED. This job is ' + READY_TO_ORDER + '.')
        : banner('ok', 'Quote ' + d.quoteId + ' exists for this design.'),
      // Outstanding items do not disappear because a quote went out — they
      // follow the job onto site.
      interruptions.blocking.length
        ? banner('warn', interruptions.blocking.length + ' thing(s) on this design were never ' +
            'resolved: ' + interruptions.blocking.map(i => i.title).join('; '))
        : null,
      card('The customer’s quote', 'What they see, and nothing else',
        h('div', { class: 'btn-row' },
          button('Open the signing link', () => app.showSignLink(), 'primary small'),
          button('Customer PDF', () => app.downloadCustomerReport(), 'small'),
          button('Internal design PDF', () => app.downloadInternalReport(), 'ghost small'),
          button('Update the quote from this design', () => app.updateQuoteFromDesign(), 'ghost small'))),
      d.jobState === JOB_STATE.READY_TO_ORDER
        ? readyToOrderCard(app)
        : h('div', { class: 'btn-row' },
            h('span', { class: 'note' },
              'Once the customer accepts, this job moves to ' + READY_TO_ORDER +
              ' and the supplier order list appears here.'),
            button('Check for acceptance', () => app.refreshAcceptance(), 'ghost small'))
    ];
  }

  return [
    interruptions.confirm.length
      ? banner('warn', interruptions.confirm.length + ' thing(s) still to confirm. You can quote anyway, ' +
          'but read them first.')
      : banner('ok', 'Ready to quote.'),
    ...interruptions.confirm.map(i => interruptionRow(app, i)),
    card('Create the customer’s quote', 'Builds the quote, the PDF and the signing link',
      h('div', { class: 'qsend-price' },
        h('span', {}, 'Customer price'),
        h('strong', {}, money(d.commercials?.sellPriceIncGst))),
      button('SEND QUOTE', () => app.addDesignToQuote(), 'primary'))
  ].filter(Boolean);
}

/**
 * AFTER CUSTOMER ACCEPTANCE.
 *
 * The question stops being "what does this cost?" and becomes "what do I buy
 * and what does the installer need?". Those are two different documents, and
 * the installer's has no money on it at all.
 */
function readyToOrderCard(app) {
  const d = app.design;
  const order = supplierOrderList(d);
  const unpriced = order.ready ? order.unpricedCount : 0;

  return card(READY_TO_ORDER, 'The customer accepted' +
      (d.acceptedAt ? ' on ' + new Date(d.acceptedAt).toLocaleDateString('en-AU') : '') +
      (d.chosenBrand ? ' — ' + d.chosenBrand : ''),

    order.ready
      ? h('div', { class: 'qcards' },
          statCard('Order lines', order.lineCount,
            order.groups.map(g => g.lineCount + ' ' + g.name.toLowerCase()).join(' · ')),
          statCard('Materials to buy', money(order.totalCost), 'at the prices on file', 'internal'),
          statCard('System', d.selectedUnit
            ? d.selectedUnit.brandName + ' ' + d.selectedUnit.model : '—',
            d.selectedUnit ? d.selectedUnit.capacityKw + ' kW' : null),
          statCard('ServiceM8', d.servicem8JobId || 'not created',
            d.servicem8Status || null, d.servicem8JobId ? '' : 'bad'))
      : banner('bad', 'There is no bill of materials to order from.'),

    unpriced
      ? banner('warn', unpriced + ' line(s) on this order have no confirmed price. They are ' +
          'on the list — check what they cost before the order goes in.',
          button('Set the rates', () => app.openSettings('materials'), 'small'))
      : null,

    h('div', { class: 'btn-row' },
      button('SUPPLIER ORDER LIST', () => app.showOrderList(), 'primary small'),
      button('INSTALLER DESIGN SHEET', () => app.showInstallerSheet(), 'small'),
      button('Design PDF', () => app.downloadInternalReport(), 'ghost small'),
      button('Customer PDF', () => app.downloadCustomerReport(), 'ghost small'),
      button('Re-check', () => app.refreshAcceptance(), 'ghost small')));
}

// ── Entry point ─────────────────────────────────────────────────────────────

export function renderQuickMode(app) {
  const interruptions = collectInterruptions(app.design);
  app.interruptions = interruptions;

  const step = app.quickStep || 'upload';
  const fn = { upload: stepUpload, verify: stepVerify, design: stepDesign,
               price: stepPrice, send: stepSend }[step] || stepUpload;
  return fn(app, interruptions).filter(Boolean);
}
