// ─────────────────────────────────────────────────────────────────────────────
// ACCEPTANCE — the seven conditions Nick named, each one asserted on its own.
//
// These are not unit tests of a helper. Each one is a sentence from the brief,
// turned into a check against the real engines running on a real job, so that
// "it does that" stops being something anyone has to take on trust:
//
//   1. a customer never sees a cost or a margin, on screen or in the PDF;
//   2. an accepted quote revision cannot be changed afterwards;
//   3. a job designed to ø250 cannot produce a ø200 supply branch;
//   4. the outlet schedule and the bill of materials agree;
//   5. airflow off a main reconciles with the outlets it feeds;
//   6. the plenum has exactly as many collars as there are spigots;
//   7. a design with no routed length cannot pass a static pressure check.
// ─────────────────────────────────────────────────────────────────────────────

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildApproved } from './fixtures/approved-job.mjs';
import { DEMO_CONTENT, buildDemoDesign } from './fixtures/demo-presentation.mjs';
import { buildPresentation } from '../designer/engines/presentation.mjs';
import { renderPresentationHtml } from '../designer/ui/presentation-html.mjs';
import { presentationPrintHtml } from '../designer/ui/presentation-pdf.mjs';
import { customerReportDoc, docText } from '../designer/engines/report-doc.mjs';
import { issuePresentation, acceptPresentation, declinePresentation,
         revokePresentation, changeOptions, supersede,
         ISSUE_STATUS } from '../designer/engines/presentation-share.mjs';
import { designRulesFor, settingsForDesign } from '../designer/engines/design-rules.mjs';
import { selectDiameter } from '../designer/engines/ducts.mjs';
import { DEFAULT_SETTINGS } from '../designer/engines/settings.mjs';
import { pressureReadiness } from '../designer/engines/supply-graph.mjs';
import { quoteGate } from '../designer/engines/quote-gate.mjs';

const APPROVED = (await buildApproved()).out;
const DEMO = (await buildDemoDesign()).out;

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE CUSTOMER NEVER SEES A COST OR A MARGIN
// ─────────────────────────────────────────────────────────────────────────────

const ISSUABLE_CUSTOMER = {
  name: 'Sarah Whitlock', email: 'sarah.whitlock@bigpond.com', phone: '0412 665 108',
  address: '34 Kauri Crescent, Peregian Springs QLD 4573',
  notes: 'INTERNAL: chase deposit, customer haggles'
};
const CONFIRMED_SETTINGS = { commercial: { terms: {
  depositPercent: 20, balanceDueEvent: 'completion and commissioning', validityDays: 30,
  paymentMethods: ['Bank transfer'], termsVersion: 'NAC-T&C-2026-01',
  paymentStages: [{ label: 'Deposit on acceptance', detail: 'Confirms your booking' }],
  confirmed: true, confirmedBy: 'Nick Cahill', confirmedAt: '2026-09-22T00:00:00Z'
} } };

const BUILT = buildPresentation({
  design: DEMO, customer: ISSUABLE_CUSTOMER,
  job: { siteAddress: '34 Kauri Crescent, Peregian Springs QLD 4573',
         notes: 'INTERNAL: roof access is tight' },
  content: DEMO_CONTENT, settings: CONFIRMED_SETTINGS,
  proposalNumber: 'NAC-2026-0184', preparedAt: '2026-09-22T00:00:00Z',
  expiresAt: '2026-10-22T00:00:00Z', revision: 1, status: 'draft'
});
assert.equal(BUILT.ok, true, 'the acceptance fixture must produce a presentation');
const P = BUILT.presentation;
// Embedded images are base64, and base64 contains every digit string sooner or
// later. Searching inside a photograph for "8275" finds it and means nothing —
// it made this suite fail about one run in three. The bytes are replaced before
// anything is searched; what remains is the text a customer can actually read.
const readable = (text) => String(text)
  .replace(/data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi, 'data:[image]')
  .replace(/"[A-Za-z0-9+/=]{200,}"/g, '"[bytes]"');

const SURFACES = {
  'the customer HTML': readable(renderPresentationHtml(P)),
  'the print / PDF HTML': readable(presentationPrintHtml(P)),
  'the customer report document': readable(docText(customerReportDoc(DEMO))),
  'the presentation payload itself': readable(JSON.stringify(P))
};

/** $4,833 · $4833 · 4833 · 4833.00 — every way a figure can reach a page. */
function moneyForms(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return [];
  const whole = Math.round(n);
  return [...new Set([
    String(n), n.toFixed(2), String(whole),
    whole.toLocaleString('en-AU'), '$' + whole.toLocaleString('en-AU')
  ])].filter(s => s.replace(/[^0-9]/g, '').length >= 3);
}

/**
 * Does this figure actually appear, as a figure?
 *
 * A plain substring search finds "95.00" inside "$495.00" and calls a Wi-Fi
 * upgrade a leaked cost. A number only counts as present when it is not part
 * of a longer one, so the match must not have a digit, comma or point on
 * either side of it.
 */
function leaks(text, form) {
  const esc = form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(?<![\\d.,])' + esc + '(?![\\d])').test(text);
}

test('no cost, fee or margin figure appears on any customer surface', () => {
  const c = DEMO.commercials;
  const secret = {
    equipmentCost: c.equipmentCost, materialsCost: c.materialsCost,
    labourCost: c.labourCost, subcontractorCost: c.subcontractorCost,
    otherCost: c.otherCost, totalJobCost: c.totalJobCost,
    jobFee: c.jobFee, grossProfit: c.grossProfit
  };
  for (const [name, value] of Object.entries(secret)) {
    for (const form of moneyForms(value)) {
      for (const [where, text] of Object.entries(SURFACES)) {
        assert.ok(!leaks(text, form), name + ' (' + form + ') reached ' + where);
      }
    }
  }
  // The margin percentage, to whatever precision it is carried at.
  const pct = Number(c.grossMarginPct);
  assert.ok(Number.isFinite(pct) && pct > 0, 'the fixture must have a margin to leak');
  for (const form of [String(pct), pct.toFixed(1), String(Math.round(pct))]) {
    for (const [where, text] of Object.entries(SURFACES)) {
      assert.ok(!new RegExp(form.replace('.', '\\.') + '\\s*%').test(text),
        'the gross margin reached ' + where);
    }
  }
});

test('no cost, margin or supplier field name reaches a customer surface', () => {
  const FORBIDDEN = [
    /unitCost/, /totalCost/, /equipmentCost/, /materialsCost/, /labourCost/,
    /totalJobCost/, /grossProfit/, /grossMarginPct/, /\bjobFee\b/, /markup/i,
    /priceSource/, /supplierCode/, /costPlus/i, /pricingBasis/, /pricingMode/
  ];
  for (const [where, text] of Object.entries(SURFACES)) {
    for (const re of FORBIDDEN) {
      assert.ok(!re.test(text), String(re) + ' reached ' + where);
    }
  }
});

test('the bill of materials never reaches a customer surface', () => {
  // A line-by-line BOM is NAC's cost structure written out. The customer gets
  // what is being installed, not what each piece was bought for.
  assert.ok(!('bom' in P), 'the presentation carries the BOM');
  for (const [where, text] of Object.entries(SURFACES)) {
    for (const item of DEMO.bom.items) {
      for (const form of moneyForms(item.unitCost)) {
        assert.ok(!leaks(text, form),
          'the cost of "' + item.label + '" (' + form + ') reached ' + where);
      }
    }
  }
});

test('an internal note on the customer or the job never reaches the page', () => {
  for (const [where, text] of Object.entries(SURFACES)) {
    assert.ok(!/INTERNAL:/.test(text), 'an internal note reached ' + where);
    assert.ok(!/haggles/.test(text), 'an internal note reached ' + where);
  }
});

test('the price the customer DOES see is on every surface', () => {
  // The test above would also pass if the page showed nothing at all. It has to
  // show the one number the customer is agreeing to.
  const total = '$' + Math.round(P.investment.totalIncGst).toLocaleString('en-AU');
  for (const where of ['the customer HTML', 'the print / PDF HTML']) {
    assert.ok(SURFACES[where].includes(total), 'the total is missing from ' + where);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. AN ACCEPTED REVISION IS IMMUTABLE
// ─────────────────────────────────────────────────────────────────────────────

const issueOne = () => issuePresentation({
  designId: 'design-1', quoteRevision: 3, issuedBy: 'Nick Cahill',
  validDays: 30, now: '2026-09-22T00:00:00Z'
});

function accepted() {
  const r = acceptPresentation(issueOne(), {
    customerName: 'Sarah Whitlock', acknowledgedTerms: true,
    totalIncGst: P.investment.totalIncGst, now: '2026-09-23T00:00:00Z'
  });
  assert.equal(r.ok, true, 'the fixture acceptance must succeed');
  return r.issue;
}

test('an accepted revision cannot be written to, at any depth', () => {
  const a = accepted();
  const before = JSON.stringify(a);
  // Silent failure in sloppy mode, TypeError in strict — either way, no change.
  const poke = (fn) => { try { fn(); } catch (e) { /* strict mode refused it */ } };
  poke(() => { a.status = ISSUE_STATUS.DRAFT; });
  poke(() => { a.quoteRevision = 99; });
  poke(() => { a.acceptance.totalIncGst = 1; });
  poke(() => { a.acceptance.customerName = 'Someone Else'; });
  poke(() => { a.acceptance.selectedOptionIds.push('u-wifi'); });
  poke(() => { a.selectedOptionIds.push('u-wifi'); });
  poke(() => { a.audit.push({ event: 'forged' }); });
  poke(() => { delete a.acceptance; });
  assert.equal(JSON.stringify(a), before, 'an accepted revision was modified');
});

test('the accepted total is the one that was accepted', () => {
  const a = accepted();
  assert.equal(a.acceptance.totalIncGst, P.investment.totalIncGst);
  assert.equal(a.acceptance.quoteRevision, 3);
  assert.equal(a.status, ISSUE_STATUS.ACCEPTED);
});

test('an accepted revision cannot be accepted, declined or revoked again', () => {
  const a = accepted();
  const again = acceptPresentation(a, { customerName: 'Sarah Whitlock',
    acknowledgedTerms: true, totalIncGst: 1 });
  assert.equal(again.ok, false);
  assert.equal(again.reason, 'already_answered');
  assert.equal(again.issue.acceptance.totalIncGst, P.investment.totalIncGst);

  assert.equal(declinePresentation(a, { reason: 'changed my mind' }).ok, false);
  const revoked = revokePresentation(a, { by: 'Nick', reason: 'oops' });
  assert.equal(revoked.ok, false);
  assert.equal(revoked.reason, 'accepted');
  assert.equal(revoked.issue.status, ISSUE_STATUS.ACCEPTED);
});

test('changing an option on an accepted quote demands a new revision', () => {
  const a = accepted();
  const r = changeOptions(a, ['u-wifi']);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'requires_new_revision');
  assert.equal(r.needsNewRevision, true);
  assert.deepEqual(a.selectedOptionIds, [], 'the accepted revision took the option anyway');
});

test('superseding an accepted revision archives it without altering it', () => {
  const a = accepted();
  const next = issuePresentation({
    designId: 'design-1', quoteRevision: 4, issuedBy: 'Nick Cahill',
    now: '2026-09-24T00:00:00Z'
  });
  const { previous, next: live } = supersede(a, next);

  assert.equal(previous.status, ISSUE_STATUS.ACCEPTED, 'an accepted quote was re-labelled');
  assert.equal(previous.acceptance.totalIncGst, P.investment.totalIncGst);
  assert.equal(previous.quoteRevision, 3);
  assert.equal(previous.supersededBy, next.token);
  assert.equal(live.supersedes, a.token);
  assert.notEqual(live.token, previous.token, 'a new revision must be a new token');

  const before = JSON.stringify(previous);
  try { previous.acceptance.totalIncGst = 1; } catch (e) { /* strict mode */ }
  assert.equal(JSON.stringify(previous), before, 'the archived revision was modified');
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Ø250 PREVENTS Ø200
// ─────────────────────────────────────────────────────────────────────────────

test('the approved job carries ø250 as its own rule, not the application default', () => {
  const rules = designRulesFor(APPROVED, DEFAULT_SETTINGS);
  assert.equal(rules.minimumSupplyBranchDiameterMm, 250);
  assert.equal(rules.source.minimumSupplyBranchDiameterMm, 'design',
    'the minimum came from settings, so opening the job elsewhere could resize it');
});

test('no supply duct in a ø250 job is smaller than ø250', () => {
  const supply = APPROVED.network.sections.filter(s => s.role !== 'return');
  assert.ok(supply.length >= 10, 'the fixture must have a network to check');
  for (const s of supply) {
    assert.ok(s.diameterMm >= 250,
      s.id + ' (' + s.destination + ') is ø' + s.diameterMm + ' in a ø250 job');
  }
  // The schedule and the outlet register say the same thing.
  for (const r of APPROVED.nacSchedule.rooms) {
    for (const mm of r.finalSizesMm) {
      assert.ok(mm >= 250, r.room + ' is scheduled at ø' + mm);
    }
  }
  for (const line of APPROVED.bom.items.filter(i => i.key === 'flex_duct')) {
    assert.ok(/ (250|300|350|400) mm$/.test(line.label),
      'the order buys ' + line.label + ' for a ø250 job');
  }
});

test('the rule is what prevents it — the same airflow sizes to ø200 without it', () => {
  // 40 L/s is a small bedroom, and it is exactly the case that produced ø200.
  const at = (minMm) => selectDiameter(40, 'final', {
    settings: settingsForDesign(
      { designRules: { minimumSupplyBranchDiameterMm: minMm } }, DEFAULT_SETTINGS)
  });
  const held = at(250);
  const free = at(200);
  assert.equal(held.diameterMm, 250, 'the ø250 minimum did not hold');
  assert.ok(free.diameterMm <= 200, 'ø200 is no longer reachable at all — the rule proves nothing');
  // And the engine owns up to WHY, rather than passing the minimum off as maths.
  assert.equal(held.sizeBasis, 'installer_minimum');
  assert.equal(held.raisedByMinimum, true);
  assert.equal(held.minimumAppliedMm, 250);
  assert.ok(held.calculatedDiameterMm < 250, 'the calculation is being reported as 250');
  assert.match(held.reason, /NOT because the airflow required it/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE OUTLET SCHEDULE AND THE BILL OF MATERIALS AGREE
// ─────────────────────────────────────────────────────────────────────────────

const finals = APPROVED.network.sections.filter(s => s.role === 'final');
const bomQty = (key, re = null) => APPROVED.bom.items
  .filter(i => i.key === key && (!re || re.test(i.label)))
  .reduce((n, i) => n + Number(i.quantity || 0), 0);

test('one outlet, one final duct, one diffuser, one schedule row', () => {
  const scheduled = APPROVED.nacSchedule.rooms.reduce((n, r) => n + r.outletCount, 0);
  assert.equal(APPROVED.outlets.totals.total, 10);
  assert.equal(finals.length, APPROVED.outlets.totals.total, 'finals vs outlets');
  assert.equal(scheduled, APPROVED.outlets.totals.total, 'schedule vs outlets');
  assert.equal(APPROVED.nacSchedule.totals.outlets, APPROVED.outlets.totals.total);
  assert.equal(bomQty('diffuser_round'), APPROVED.outlets.totals.total,
    'the order buys a different number of diffusers than the design has outlets');
});

test('every diffuser bought is the size the schedule calls for', () => {
  const wanted = new Map();
  for (const r of APPROVED.nacSchedule.rooms) {
    for (const mm of r.finalSizesMm) wanted.set(mm, (wanted.get(mm) || 0) + 1);
  }
  const bought = new Map();
  for (const i of APPROVED.bom.items.filter(x => x.key === 'diffuser_round')) {
    const mm = Number(/(\d+)\s*mm/.exec(i.label)?.[1]);
    bought.set(mm, (bought.get(mm) || 0) + Number(i.quantity || 0));
  }
  assert.deepEqual([...bought.entries()].sort(), [...wanted.entries()].sort(),
    'the diffusers ordered do not match the sizes on the schedule');
});

test('the return grilles on the schedule are the return grilles on the order', () => {
  assert.equal(bomQty('return_grille'), APPROVED.nacSchedule.totals.returns);
  assert.equal(APPROVED.returnComponents.grilles.length, APPROVED.nacSchedule.totals.returns);
});

test('every fabricated BTO on the schedule is on the order, once each', () => {
  const onSchedule = APPROVED.btos.length;
  assert.ok(onSchedule > 0, 'the fixture must have BTOs');
  assert.equal(bomQty('bto_fitting'), onSchedule,
    onSchedule + ' fabricated fittings in the design, ' + bomQty('bto_fitting') + ' on the order');
});

test('the duct bought covers the duct routed, in whole 6 m lengths', () => {
  const lengths = APPROVED.bom.items.filter(i => i.key === 'flex_duct');
  assert.ok(lengths.length > 0);
  for (const l of lengths) {
    assert.equal(l.unit, '6 m length', 'duct is bought in 6 m lengths');
    assert.equal(l.quantity, Math.ceil(l.quantity), 'a part length cannot be bought');
  }
  const bought = lengths.reduce((n, l) => n + Number(l.quantity) * 6, 0);
  const routed = Number(APPROVED.network.totalDuctLengthM)
    + Number(APPROVED.returnDesign?.totalDuctLengthM || 0);
  assert.ok(bought >= routed,
    'the order buys ' + bought + ' m for ' + routed.toFixed(1) + ' m of routed duct');
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. AIRFLOW OFF A MAIN RECONCILES
// ─────────────────────────────────────────────────────────────────────────────

/** Every final duct downstream of a section, following parentId. */
function finalsUnder(id) {
  const byParent = new Map();
  for (const s of APPROVED.network.sections) {
    if (!byParent.has(s.parentId)) byParent.set(s.parentId, []);
    byParent.get(s.parentId).push(s);
  }
  const out = [];
  const walk = (sectionId) => {
    for (const child of byParent.get(sectionId) || []) {
      if (child.role === 'final') out.push(child); else walk(child.id);
    }
  };
  walk(id);
  return out;
}

test('each main carries exactly the air its own outlets take', () => {
  const mains = APPROVED.network.sections.filter(s => s.role === 'main');
  assert.ok(mains.length >= 2 && mains.length <= 3, 'NAC runs 2 or 3 mains off the plenum');
  for (const m of mains) {
    const under = finalsUnder(m.id);
    assert.ok(under.length > 0, m.id + ' feeds nothing');
    const sum = under.reduce((n, f) => n + Number(f.airflowLs || 0), 0);
    assert.ok(Math.abs(sum - Number(m.airflowLs)) <= 1,
      m.id + ' carries ' + m.airflowLs + ' L/s to outlets totalling ' + sum + ' L/s');
  }
});

test('an outlet taken straight off a main is counted once, not twice', () => {
  // The direct case is the one that double-counted: a final hanging off a main
  // through its own BTO, with no branch in between.
  const direct = finals.filter(f => {
    const parent = APPROVED.network.sections.find(s => s.id === f.parentId);
    return parent && parent.role === 'main';
  });
  assert.ok(direct.length > 0, 'the fixture must have a direct-off-main outlet');
  const total = finals.reduce((n, f) => n + Number(f.airflowLs || 0), 0);
  const mains = APPROVED.network.sections.filter(s => s.role === 'main');
  const carried = mains.reduce((n, m) => n + Number(m.airflowLs || 0), 0);
  assert.ok(Math.abs(carried - total) <= 2,
    'the mains carry ' + carried + ' L/s and the outlets take ' + total + ' L/s');
});

test('the mains, the schedule and the spigots all state the same airflow', () => {
  const sched = APPROVED.nacSchedule.plenum;
  const carried = APPROVED.network.sections
    .filter(s => s.role === 'main').reduce((n, m) => n + Number(m.airflowLs || 0), 0);
  assert.ok(Math.abs(sched.totalAirflowLs - carried) <= 2, 'schedule vs network');
  const spigots = APPROVED.supplySpigots.rows
    .reduce((n, r) => n + Number(r.airflowLs || 0), 0);
  assert.ok(Math.abs(spigots - carried) <= 2, 'spigots vs network');
  // And every room's scheduled total is its outlets' airflow. The outlet
  // register is the join between an outlet and the duct that feeds it, so the
  // reconciliation goes through it rather than guessing at an id.
  const sectionOf = (outletId) => {
    const row = APPROVED.outletRegister.find(o => o.id === outletId);
    assert.ok(row, 'outlet ' + outletId + ' is not in the register');
    const sec = APPROVED.network.sections.find(x => x.id === row.finalSectionId);
    assert.ok(sec, 'outlet ' + outletId + ' points at a duct that does not exist');
    return sec;
  };
  for (const r of APPROVED.nacSchedule.rooms) {
    const own = r.outletIds.reduce((n, id) => n + Number(sectionOf(id).airflowLs || 0), 0);
    assert.ok(Math.abs(own - r.totalLs) <= 1,
      r.room + ' is scheduled at ' + r.totalLs + ' L/s and ducted for ' + own + ' L/s');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. PLENUM COLLARS = SPIGOTS
// ─────────────────────────────────────────────────────────────────────────────

test('the plenum is fabricated with one collar per main, and no spare', () => {
  const plenum = APPROVED.supplyPlenum;
  const spigots = APPROVED.supplySpigots;
  const mains = APPROVED.network.sections.filter(s => s.role === 'main');
  assert.equal(plenum.collarCount, spigots.count, 'collars vs spigots');
  assert.equal(plenum.collarCount, mains.length, 'collars vs mains off the plenum');
  assert.equal(plenum.collarCount, spigots.rows.length, 'collars vs spigot rows');
  assert.equal(APPROVED.nacSchedule.plenum.ductCount, plenum.collarCount,
    'the schedule states a different number of ducts off the plenum');
});

test('every collar is the diameter of the duct that goes into it', () => {
  const plenum = APPROVED.supplyPlenum;
  for (const r of APPROVED.supplySpigots.rows) {
    assert.equal(r.diameterMm, plenum.collarDiameterMm,
      'spigot ' + r.key + ' is ø' + r.diameterMm + ' into a ø' + plenum.collarDiameterMm + ' collar');
  }
  for (const m of APPROVED.network.sections.filter(s => s.role === 'main')) {
    assert.equal(m.diameterMm, plenum.collarDiameterMm,
      m.id + ' leaves the plenum at ø' + m.diameterMm);
  }
  assert.equal(APPROVED.plenumCheck.ok, true,
    'the plenum check failed: ' + JSON.stringify(APPROVED.plenumCheck.failures));
});

test('the collars physically fit across the face NAC fabricates', () => {
  const p = APPROVED.supplyPlenum;
  const needed = p.collarCount * p.collarDiameterMm;
  assert.ok(p.collarRowMm >= needed,
    p.collarCount + ' × ø' + p.collarDiameterMm + ' needs ' + needed
      + ' mm and the collar row is ' + p.collarRowMm + ' mm');
  assert.ok(p.bodyWidthMm >= p.collarRowMm, 'the collar row is wider than the plenum body');
  // And the order buys the plenum that was designed, not a catalogue box.
  const line = APPROVED.bom.items.find(i => i.key === 'supply_plenum');
  assert.ok(line, 'the plenum is not on the order');
  assert.ok(line.label.includes(String(p.collarCount)),
    'the plenum on the order does not state its collar count: ' + line.label);
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. ZERO ROUTE LENGTH CANNOT PASS A STATIC PRESSURE CHECK
// ─────────────────────────────────────────────────────────────────────────────

/** The same network with every duct length erased — the Kauri failure exactly. */
const unmeasured = (sections) => ({
  sections: sections.map(s => ({ ...s, lengthM: 0, lengthMm: 0, effectiveLengthM: 0 })),
  totalDuctLengthM: 0
});

test('a network with no measured length is NOT CALCULATED, not "passed"', () => {
  const r = pressureReadiness(unmeasured(APPROVED.network.sections));
  assert.equal(r.ok, false);
  assert.match(r.status, /NOT CALCULATED/i);
  assert.match(r.reason, /zero/i);
});

test('one measured duct among many is still not a calculation', () => {
  const some = APPROVED.network.sections.map((s, i) =>
    (i === 0 ? { ...s } : { ...s, lengthM: 0, lengthMm: 0, effectiveLengthM: 0 }));
  const r = pressureReadiness({ sections: some, totalDuctLengthM: some[0].lengthM });
  assert.equal(r.ok, false);
  assert.match(r.reason, /no measured length/i);
});

test('an empty network is not a low pressure drop either', () => {
  assert.equal(pressureReadiness({ sections: [], totalDuctLengthM: 0 }).ok, false);
  assert.equal(pressureReadiness(null).ok, false);
  assert.equal(pressureReadiness(undefined).ok, false);
});

test('an unmeasured design is blocked from quoting on exactly that ground', () => {
  const blind = { ...APPROVED,
    network: unmeasured(APPROVED.network.sections),
    pressureReadiness: pressureReadiness(unmeasured(APPROVED.network.sections)) };
  const gate = quoteGate(blind);
  assert.equal(gate.ok, false);
  assert.ok(gate.blockers.some(b => /pressure/i.test(b.code + ' ' + b.message)),
    'nothing in the quote gate mentions the missing pressure calculation');
});

test('the measured design DOES calculate, so the check is worth something', () => {
  const r = pressureReadiness(APPROVED.network);
  assert.equal(r.ok, true, r.reason || '');
  assert.ok(Number(APPROVED.pressure?.totalPa ?? APPROVED.pressure?.totalStaticPa ?? 0) > 0
    || APPROVED.pressure?.components?.length > 0,
    'the approved job has no pressure figure at all');
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. A SELL PRICE IS NOT A COST
//
// Nick priced six sundry lines and said: "these look good as sell price."
// Everywhere else a material line is what NAC PAY, and the $6,000 fee goes on
// top. Entering a sell price as a cost charges the margin inside it twice —
// once in the price NAC set, and again as its share of the fee — on every
// quote, quietly. So these lines sit OUTSIDE the base the fee is worked out
// over, and are added after it.
// ─────────────────────────────────────────────────────────────────────────────

test('all six fixed-price lines are on the order, priced, and cost nothing', () => {
  const fixed = APPROVED.bom.items.filter(i => i.fixedSell);
  assert.equal(fixed.length, 6, fixed.map(f => f.key).join(','));
  assert.deepEqual(fixed.map(f => f.key).sort(),
    ['consumables', 'drain_kit', 'interconnect_cable', 'isolator',
     'outdoor_feet', 'power_cable']);
  for (const l of fixed) {
    assert.equal(l.priceSource, 'nac_sell');
    assert.equal(l.priced, true, l.label + ' reads as a hole in the costing');
    assert.equal(l.totalCost, null, l.label + ' put a sell price into the job cost');
    assert.ok(l.sellPrice > 0 && l.sellTotal > 0);
    assert.equal(l.sellTotal, Math.round(l.sellPrice * l.quantity * 100) / 100);
  }
  // The exact figures NAC gave.
  const at = (k) => fixed.find(f => f.key === k).sellPrice;
  assert.equal(at('outdoor_feet'), 95);
  assert.equal(at('drain_kit'), 80);
  assert.equal(at('interconnect_cable'), 7.20);
  assert.equal(at('power_cable'), 9.40);
  assert.equal(at('isolator'), 68);
  assert.equal(at('consumables'), 145);
});

test('the job fee is worked out over the cost, never over the sell lines', () => {
  const c = APPROVED.commercials;
  assert.equal(c.pricingBasis.feeBaseExGst, c.totalJobCost);
  assert.equal(c.fixedSellExGst, APPROVED.bom.fixedSellTotal);
  assert.equal(c.sellPriceExGst,
    Math.round((c.totalJobCost + c.jobFee + c.fixedSellExGst) * 100) / 100);

  // The counter-check: charging them the other way round costs the customer
  // the fee's share of them again. That difference is what this is preventing.
  const ifTreatedAsCost = (c.totalJobCost + c.fixedSellExGst) + c.jobFee;
  assert.equal(Math.round(ifTreatedAsCost * 100) / 100, c.sellPriceExGst,
    'on a flat fee the totals coincide — the difference shows on any percentage basis');
  // What must NOT happen is the sell figure landing in the job cost.
  assert.ok(!APPROVED.bom.items.some(i => i.fixedSell && i.totalCost !== null));
  assert.equal(APPROVED.bom.materialsCost,
    Math.round(APPROVED.bom.items
      .filter(i => i.category !== 'equipment')
      .reduce((n, i) => n + (i.totalCost || 0), 0) * 100) / 100);
});

test('the margin says what it does not know', () => {
  const c = APPROVED.commercials;
  assert.ok(c.marginExcludesCostOf, 'the margin is overstated and nothing says so');
  assert.equal(c.marginExcludesCostOf.fixedSellExGst, c.fixedSellExGst);
  assert.match(c.marginExcludesCostOf.note, /not recorded/);
  assert.match(c.marginExcludesCostOf.note, /lower than the figure shown/);
  assert.equal(c.grossProfit, Math.round((c.jobFee + c.fixedSellExGst) * 100) / 100);
});

test('the strap is still bought, it is just not charged for', () => {
  const strap = APPROVED.bom.items.find(i => i.key === 'hanging_kit');
  assert.ok(strap, 'the duct hanging strap fell off the order');
  assert.equal(strap.noCharge, true);
  assert.ok(strap.quantity > 0, 'an installer cannot hang duct with no strap');
  assert.equal(strap.totalCost, 0);
  assert.ok(APPROVED.bom.warnings.some(w => w.code === 'LINES_NOT_SEPARATELY_CHARGED'));
});

test('no fixed-price figure reaches a customer surface either', () => {
  // A sell price is still NAC's commercial structure. The customer sees one
  // total, not a line saying the isolator was $68.
  for (const l of APPROVED.bom.items.filter(i => i.fixedSell)) {
    for (const form of moneyForms(l.sellTotal)) {
      for (const [where, text] of Object.entries(SURFACES)) {
        assert.ok(!leaks(text, form),
          'the charge for "' + l.label + '" (' + form + ') reached ' + where);
      }
    }
  }
});
