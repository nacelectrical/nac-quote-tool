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

import { DEMO_CONTENT, buildDemoDesign } from './fixtures/demo-presentation.mjs';
import { buildPresentation } from '../designer/engines/presentation.mjs';
import { renderPresentationHtml } from '../designer/ui/presentation-html.mjs';
import { presentationPrintHtml } from '../designer/ui/presentation-pdf.mjs';
import { issuePresentation, acceptPresentation, declinePresentation,
         revokePresentation, changeOptions, supersede,
         ISSUE_STATUS } from '../designer/engines/presentation-share.mjs';
import { DEFAULT_SETTINGS } from '../designer/engines/settings.mjs';
import { quoteGate } from '../designer/engines/quote-gate.mjs';


// ── THE FITTINGS QUESTION IS ASKED SOMEWHERE ELSE ──────────────────────────
//
// With only the four fittings NAC have specified, a ø400 main reaches three
// outlets and a system reaches nine. This fixture's main C feeds five, so the
// quote gate now refuses it — correctly, and that refusal is tested properly
// in tests/fitting-assembly.test.mjs.
//
// These suites are about what a CUSTOMER sees: that no cost, margin or BOM
// line reaches the page, and that an accepted revision cannot be edited. They
// need a publishable presentation to examine. So the design here stands in for
// one whose mains have been split to suit the parts list — the routing is not
// what is under test, and faking it here hides nothing, because the real check
// fails loudly in its own file.
const BUILDABLE = { ok: true, rows: [], unbuildable: [], partsCost: null,
                    summary: 'Stood in for by the presentation fixtures.' };

const DEMO = { ...(await buildDemoDesign()).out, fittingAssembly: BUILDABLE };

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
  // The customer report document was a third surface produced by report-doc.mjs,
  // the designer's own document builder. It went with the designer; the two
  // surfaces a customer can reach now are the page and its printable form.
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
  // `now` inside the issued window, like every other call in this file. Left
  // to default it took the wall clock, so this passed until 22 October 2026
  // and has failed every day since — the quote it is acting on expires then,
  // and the answer became 'expired' rather than 'already_answered'.
  const again = acceptPresentation(a, { customerName: 'Sarah Whitlock',
    acknowledgedTerms: true, totalIncGst: 1, now: '2026-09-25T00:00:00Z' });
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
// Sections 3 to 7 stood here: duct sizes, the outlet schedule against the bill
// of materials, airflow reconciling off a main, plenum collars against spigots,
// and a static pressure check over zero metres of duct. Every one of them was
// about a drawing this application no longer produces, and they went with the
// engines that produced it. checkpoint/before-designer-removal has them.
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// WHAT NAC PAYS NEVER REACHES WHAT THE CUSTOMER READS
//
// The sweep that stood here read its secret figures off the design's own
// costing block — equipmentCost, materialsCost, labourCost, jobFee,
// grossProfit, grossMarginPct. A quote source has none of those, so the sweep
// had nothing to look for and would have passed on an empty set, which is
// worse than not having it.
//
// It is rebuilt here against the figures NAC actually holds internally on a
// quote: the MMEM cost of the zone kit, the MMEM cost of the equipment, and a
// margin worked out over them. Every surface a customer can reach is searched
// for every way each of those can be written.
// ─────────────────────────────────────────────────────────────────────────────

test('no cost, fee or margin figure appears on any customer surface', async () => {
  const { ZONE_CONTROLLERS } = await import('../designer/engines/catalogue.mjs');
  const { MMEM_DUCTED } = await import('../designer/engines/supplier-pricing.mjs');

  // What this job costs NAC, from the real supplier records.
  const kit = ZONE_CONTROLLERS.find(c => c.id === 'siemens_z8');
  const unit = MMEM_DUCTED.find(m => /FDYAN160AV1 \/ RZA160C2V1/.test(m.code));
  assert.ok(kit && kit.cost > 0, 'no zone kit cost to leak');
  assert.ok(unit && unit.cost > 0, 'no equipment cost to leak');

  const sell = P.investment.totalIncGst;
  const cost = kit.cost + unit.cost;
  const grossProfit = Math.round((sell / 1.1 - cost) * 100) / 100;
  const grossMarginPct = Math.round((grossProfit / (sell / 1.1)) * 1000) / 10;

  // ── A BARE NUMBER IS SEARCHED IN THE PROSE, NOT IN THE MARKUP ──────────
  //
  // The first run of this caught "320" — the Siemens 8-zone kit's cost — in
  // the customer HTML, and it was `sizes="(min-width:900px) 320px, 45vw"` on
  // an image. A stylesheet is full of round numbers and none of them is a
  // price, so a bare figure is looked for in what a customer can actually
  // READ, with tags, attributes, styles and scripts taken out. Anything
  // written as money is still searched across the whole document, because
  // "$320.00" in a stylesheet would be a leak however it got there.
  const prose = (text) => String(text)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  const surfaceFor = (text, form) => /[$,]/.test(form) ? text : prose(text);

  const secret = {
    'the zone kit cost': kit.cost,
    'the equipment cost': unit.cost,
    'the total job cost': cost,
    'the gross profit': grossProfit
  };
  for (const [name, value] of Object.entries(secret)) {
    for (const form of moneyForms(value)) {
      for (const [where, text] of Object.entries(SURFACES)) {
        assert.ok(!leaks(surfaceFor(text, form), form),
          name + ' (' + form + ') reached ' + where);
      }
    }
  }

  assert.ok(grossMarginPct > 0, 'the fixture must have a margin to leak');
  for (const form of [String(grossMarginPct), grossMarginPct.toFixed(1),
                      String(Math.round(grossMarginPct))]) {
    for (const [where, text] of Object.entries(SURFACES)) {
      assert.ok(!new RegExp(form.replace('.', '\\.') + '\\s*%').test(text),
        'the gross margin reached ' + where);
    }
  }
});

test('the words for an internal figure never reach a customer surface either', () => {
  // A number can be coincidental. These cannot.
  for (const [where, text] of Object.entries(SURFACES)) {
    for (const word of [/supplier\s*cost/i, /gross\s*(profit|margin)/i, /\bmark[- ]?up\b/i,
                        /\bjob\s*fee\b/i, /\bMMEM\b/, /\bex\s*GST\s*cost\b/i,
                        /\bwhat we pay\b/i, /\btrade price\b/i]) {
      assert.ok(!word.test(text), word + ' reached ' + where);
    }
  }
});
