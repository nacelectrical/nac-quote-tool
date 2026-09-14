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
import { CONDITIONING, EXCLUDED_BANNER, classificationSummary,
         isExcludedRoom, needsClassificationReview } from '../engines/classify.mjs';

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
  // RULE 4 — a plan whose conditioned rooms all carry printed dimensions is
  // finished with the upload step. Demanding a calibration it does not need
  // would leave the estimator stuck on step 1 of a job that is already sized.
  const scaleSettled = !!d.calibration || d.calibrationRequirement?.required === false;
  return {
    upload: !!d.plan && scaleSettled,
    verify: !!d.plan && scaleSettled && interruptions.canQuote,
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
  // THE PLAN HAS TO BE ON THE SCREEN. Calibrating means clicking two points on
  // the drawing, and drawing a room boundary means dragging a box on it — so a
  // step that shows a CALIBRATE button and no plan is a step nobody can
  // complete. The viewer is mounted into the placeholder below.
  const req = d.calibrationRequirement;
  const scaleSettled = !!d.calibration || req?.required === false;
  return [
    h('div', { class: 'qwork' },
      h('div', { class: 'qwork-tools' },
        app.renderUploadPanel(),
        // RULE 7 — the headline count, before anything else. The estimator
        // should not care that the house has two bathrooms, a laundry, a
        // garage, three robes and an alfresco.
        d.plan ? classificationPanel(app) : null,
        // What the reader got off the plan: the tool showing its working at the
        // only moment the estimator cares — before they trust it.
        d.plan ? app.renderNumbersPanel() : null,
        // RULE 4 — calibration is asked for only when a CONDITIONED room needs
        // a measurement taken off the image.
        d.plan && !d.calibration && req?.required === false
          ? banner('ok', 'CALIBRATION NOT REQUIRED — ' + req.reason)
          : null,
        d.plan && !d.calibration && req?.required
          ? banner('warn', 'CALIBRATION REQUIRED — ' + req.reason)
          : null,
        d.plan && d.calibration?.source === 'derived_from_dimensioned_rooms'
          ? banner('info', 'Scale worked out from the plan\u2019s own dimensioned rooms (' +
              d.calibration.display.calculatedScale + ', ' +
              d.calibration.agreementSpreadPct + '% spread across ' +
              (d.calibration.derivedFrom || []).length + ' rooms). Duct lengths are measured ' +
              'against it. Setting two points by hand overrides it.')
          : null,
        d.plan
          ? banner('info', 'An uploaded screenshot does not keep its original A3 or A4 scale, ' +
              'so a printed "1:100" label is a hint only. The two points you set are what ' +
              'every measurement on this job uses.')
          : null,
        d.plan ? app.renderCalibratePanel() : null,
        d.plan ? app.renderRoomToolsPanel?.() : null),
      h('div', { class: 'qwork-plan' },
        h('div', { class: 'qplan-placeholder' }, 'Plan'))),

    d.plan && scaleSettled
      ? banner('ok', d.calibration
          ? 'The tool has read the rooms and is sizing the system.'
          : 'NO DIMENSION INPUT REQUIRED — every conditioned room is measured from the plan.',
          button('Next — Verify', () => app.setQuickStep('verify'), 'small'))
      : null
  ].filter(Boolean);
}

/**
 * RULE 1 and RULE 7 — what NAC is conditioning on this job, and what it is
 * not. The excluded rooms are listed so the estimator can see they were
 * DETECTED and deliberately dropped, with one press to bring any of them back
 * in for the job that needs it.
 */
function classificationPanel(app) {
  const rooms = app.design.rooms || [];
  if (!rooms.length) return null;
  const c = classificationSummary(rooms);

  const overrideRow = (r, to) => h('div', { class: 'qexc-row' },
    h('span', { class: 'qexc-name' }, r.label),
    h('span', { class: 'qexc-why' }, r.conditioningReason || ''),
    button(to === CONDITIONING.CONDITIONED ? 'Condition it' : 'Exclude it',
      () => app.setRoomConditioning(r.id, to), 'tiny ghost'));

  return card('What NAC is conditioning',
    c.conditionedCount + ' CONDITIONED  ·  ' + c.excludedCount + ' EXCLUDED AUTOMATICALLY' +
    (c.reviewCount ? '  ·  ' + c.reviewCount + ' TO CLASSIFY' : ''),
    c.reviewCount
      ? h('div', { class: 'qexc' },
          h('div', { class: 'qexc-head warn' }, 'NAC\u2019s rules do not settle these'),
          ...c.review.map(r => h('div', { class: 'qexc-row' },
            h('span', { class: 'qexc-name' }, r.label),
            h('span', { class: 'qexc-why' }, r.conditioningReason || ''),
            button('Condition it', () => app.setRoomConditioning(r.id, CONDITIONING.CONDITIONED), 'tiny'),
            button('Exclude it', () => app.setRoomConditioning(r.id, CONDITIONING.NON_CONDITIONED), 'tiny ghost'))))
      : null,
    c.excludedCount
      ? h('div', { class: 'qexc' },
          h('div', { class: 'qexc-head' }, EXCLUDED_BANNER),
          h('div', { class: 'note' },
            'Not measured, not loaded, no airflow, no outlets, no duct and no zone. They are still ' +
            'drawn faintly on the plan so you can see they were found.'),
          ...c.excluded.map(r => overrideRow(r, CONDITIONING.CONDITIONED)))
      : null,
    // Bringing one back in is the override Nick asked for; putting one out
    // again has to be just as easy, or an estimator who mis-taps is stuck.
    c.conditioned.some(r => r.conditioningSource === 'estimator')
      ? h('div', { class: 'qexc' },
          h('div', { class: 'qexc-head' }, 'Conditioned by your override'),
          ...c.conditioned.filter(r => r.conditioningSource === 'estimator')
            .map(r => overrideRow(r, CONDITIONING.NON_CONDITIONED)))
      : null);
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
  if (!d.plan) {
    return [banner('warn', 'Upload the plan first.',
      button('Back to Upload', () => app.setQuickStep('upload'), 'small'))];
  }
  // RULE 4 — only stop here for a scale that a CONDITIONED room actually needs.
  if (!d.calibration && d.calibrationRequirement?.required) {
    return [banner('warn', 'CALIBRATION REQUIRED — ' + d.calibrationRequirement.reason,
      button('Back to Upload', () => app.setQuickStep('upload'), 'small'))];
  }

  const outstanding = [...interruptions.blocking, ...interruptions.confirm];
  // Checking a room means LOOKING at it on the plan. A verify step with no
  // drawing on it asks the estimator to confirm a number they cannot see.
  const withPlan = (blocks) => [
    h('div', { class: 'qwork' },
      h('div', { class: 'qwork-tools' }, ...blocks.filter(Boolean)),
      h('div', { class: 'qwork-plan' },
        h('div', { class: 'qreview-plan-head' },
          h('strong', {}, 'Rooms on the plan'),
          h('span', { class: 'note' }, 'Tap a room to select it. Drag its corners to correct it.'),
          button('Room tools', () => app.setTab('rooms'), 'ghost small')),
        h('div', { class: 'qplan-placeholder' }, 'Plan')))
  ];

  if (!outstanding.length) {
    return withPlan([
      banner('ok', 'Nothing needs you. The tool read the plan, sized the system and priced the job.'),
      classificationPanel(app),
      card('What the tool did on its own', 'Every one of these ran and raised nothing worth stopping for',
        h('ul', { class: 'qlist' },
          ...['Rooms detected and measured', 'Heat load calculated', 'Equipment selected',
              'Airflow allocated', 'Outlets selected', 'Ducts sized', 'Return air designed',
              'Zoning worked out', 'Static pressure checked', 'Bill of materials built',
              'Job costed and priced'].map(t => h('li', {}, t)))),
      button('Next — Review the design', () => app.setQuickStep('design'), 'primary')
    ]);
  }

  return withPlan([
    // RULE 5 — ONE exact reason, naming the room, not "calibration required".
    interruptions.blockReason
      ? banner('bad', interruptions.blockReason)
      : banner('warn', interruptions.summary),
    classificationPanel(app),
    h('div', { class: 'note' },
      'Everything else was answered from the plan, the job, NAC’s settings and the supplier data. ' +
      'These are the only things the tool could not settle on its own.'),
    ...outstanding.map(i => interruptionRow(app, i)),
    interruptions.canQuote
      ? button('Next — Review the design', () => app.setQuickStep('design'), 'primary')
      : null
  ]);
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
    // RULE 5 — name the one thing in the way, not a generic refusal.
    return [
      banner('bad', interruptions.blockReason || 'DESIGN BLOCKED — the design could not be produced'),
      ...interruptions.blocking.map(i => interruptionRow(app, i)),
      button('Back to Verify', () => app.setQuickStep('verify'), 'small')
    ];
  }

  const attention = [...interruptions.blocking, ...interruptions.confirm];
  const net = d.network || {};
  const routed = !!net.routed && !!d.autoRoute?.generated;

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
        app.quickPlanHost || h('div', { class: 'qplan-placeholder' }, 'Plan'),
        // RULE 5 / the closing line of Nick's brief — the layout is not
        // "complete" because lines appeared. This says what is actually on the
        // drawing, so a missing return or a missing zone is visible here
        // rather than discovered on site.
        routed
          ? h('div', { class: 'qlegend' },
              h('span', { class: 'qlegend-item trunk' }, 'TRUNK'),
              h('span', { class: 'qlegend-item branch' }, 'BRANCH'),
              h('span', { class: 'qlegend-item final' }, 'OUTLET RUN'),
              h('span', { class: 'qlegend-item return' }, 'RETURN'),
              h('span', { class: 'qlegend-count' },
                net.sections.length + ' sized runs · ' +
                (d.outlets?.rows?.length ?? 0) + ' outlets · ' +
                (d.returnRoutes?.length ?? (d.returnRoute ? 1 : 0)) + ' return · ' +
                (d.zones?.zoneCount ?? 0) + ' zones · ' +
                (d.zoneDampers?.length ?? 0) + ' dampers · every run labelled with its diameter'))
          : banner('warn', 'The duct layout has not been drawn on the plan. ' +
              'Generate it before this design goes anywhere.',
              button('Draw the duct layout', () => app.autoRoute(), 'small'))),

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
