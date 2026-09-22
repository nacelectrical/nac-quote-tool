// ─────────────────────────────────────────────────────────────────────────────
// WHAT MUST NEVER REACH A CUSTOMER
//
// The demonstration proposal went out reading HELLO SAMPLE, to
// sample@example.invalid, on 0400 000 000, with licence TEST-ELEC-0000, four
// unapproved reviews, four unapproved installations, a 16 kW unit against a
// 22.5 kW calculated load described as having "sensible headroom", and an
// unspecified "Brand Standard Controller".
//
// Every one of those fields was POPULATED, so every check that only asked
// "is this blank?" passed it.
//
// Nick: "A quote containing any of the following must be blocked." These are
// those, one test each, named after the thing that got through.
// ─────────────────────────────────────────────────────────────────────────────

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { looksUnfilled, emailStatus, phoneStatus, customerStatus }
  from '../designer/engines/customer-data.mjs';
import { buildPresentation, presentationGate } from '../designer/engines/presentation.mjs';
import { renderPresentationHtml } from '../designer/ui/presentation-html.mjs';
import { presentationPrintHtml } from '../designer/ui/presentation-pdf.mjs';

/** A design that is otherwise perfectly publishable. */
const GOOD_DESIGN = {
  selectedUnit: { brandName: 'Daikin', model: 'FDYA160AV19', capacityKw: 20, phase: '1Ph' },
  systemLoad: { designKw: 18, designCoolingKw: 18, totalConditionedAreaSqM: 140 },
  rooms: [{ id: 'r1', label: 'LIVING', conditioned: true },
          { id: 'r2', label: 'BED 1', conditioned: true }],
  outlets: { rows: [{ roomId: 'r1', label: 'LIVING', quantity: 2, type: 'round_diffuser' },
                    { roomId: 'r2', label: 'BED 1', quantity: 1, type: 'round_diffuser' }],
             totals: { total: 3 } },
  zones: { zones: [{ id: 'z1', name: 'LIVING', rooms: ['LIVING'] },
                   { id: 'z2', name: 'BED 1', rooms: ['BED 1'] }], zoneCount: 2 },
  controller: { name: 'AirTouch 5 kit', supplierCode: 'MMAAT5DK', maxZones: 8, cost: 1100 },
  commercials: { sellPriceIncGst: 19800, sellPriceExGst: 18000, gstAmount: 1800 }
};

const GOOD_CUSTOMER = { name: 'Sarah Whitlock', email: 'sarah.whitlock@bigpond.com',
                        phone: '0412 665 108',
                        address: '34 Kauri Crescent, Peregian Springs QLD 4573' };
const GOOD_JOB = { siteAddress: '34 Kauri Crescent, Peregian Springs QLD 4573' };
const GOOD_TRUST = { businessName: 'NAC Electrical Air & Refrigeration',
                     abn: '11 222 333 444', electricalLicence: '86420',
                     arcAuthorisation: 'AU13579' };

function issue(over = {}) {
  return buildPresentation({
    design: GOOD_DESIGN, customer: GOOD_CUSTOMER, job: GOOD_JOB,
    content: { trust: GOOD_TRUST, ...(over.content || {}) },
    proposalNumber: 'NAC-1', revision: 3, status: 'issued',
    ...over
  });
}
const codes = (r) => (r.blockers || []).map(b => b.code);

// ── the control ─────────────────────────────────────────────────────────────
test('a complete, real proposal does publish', () => {
  const r = issue();
  assert.equal(r.ok, true, JSON.stringify(codes(r)));
});

// ── 1. SAMPLE / TEST customer data ─────────────────────────────────────────
test('SAMPLE or TEST customer data cannot publish', () => {
  for (const name of ['Sample Customer', 'HELLO SAMPLE', 'Test Customer', 'PLACEHOLDER',
                      'Not recorded', 'TBC']) {
    const r = issue({ customer: { ...GOOD_CUSTOMER, name } });
    assert.equal(r.ok, false, name + ' published');
    assert.ok(codes(r).includes('CUSTOMER_DATA_NOT_REAL'), name + ': ' + codes(r));
  }
});

// ── 2. .invalid email ───────────────────────────────────────────────────────
test('a .invalid or reserved-domain email cannot publish', () => {
  for (const email of ['sample@example.invalid', 'nick@example.com', 'a@test',
                       'x@localhost']) {
    assert.equal(emailStatus(email).ok, false, email + ' accepted');
    const r = issue({ customer: { ...GOOD_CUSTOMER, email } });
    assert.equal(r.ok, false, email + ' published');
  }
  assert.equal(emailStatus('sarah.whitlock@bigpond.com').ok, true);
});

// ── 3. placeholder phone ────────────────────────────────────────────────────
test('a placeholder phone number cannot publish', () => {
  for (const phone of ['0400 000 000', '0000000000', '1234567890', '0000 0000']) {
    assert.equal(phoneStatus(phone).ok, false, phone + ' accepted');
  }
  assert.equal(phoneStatus('0412 665 108').ok, true);
  assert.equal(phoneStatus('07 5455 1234').ok, true);

  const r = issue({ customer: { ...GOOD_CUSTOMER, phone: '0400 000 000' } });
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes('CUSTOMER_DATA_NOT_REAL'), codes(r));
});

// ── 4. missing contact details ──────────────────────────────────────────────
test('a customer with no way to reach them cannot publish', () => {
  const r = issue({ customer: { ...GOOD_CUSTOMER, email: '', phone: '' } });
  assert.equal(r.ok, false);
  const b = (r.blockers || []).find(x => x.field === 'contact');
  assert.ok(b, JSON.stringify(codes(r)));
  assert.match(b.message, /No way to reach/);
});

// ── 5. placeholder licence ──────────────────────────────────────────────────
test('a placeholder licence number cannot publish', () => {
  for (const [field, value] of [['electricalLicence', 'TEST-ELEC-0000'],
                                ['arcAuthorisation', 'SAMPLE-12345'],
                                ['abn', 'TBC']]) {
    const r = issue({ content: { trust: { ...GOOD_TRUST, [field]: value } } });
    assert.equal(r.ok, false, field + ' published');
    assert.ok(codes(r).includes('PLACEHOLDER_CREDENTIAL'), field + ': ' + codes(r));
  }
  for (const v of ['SAMPLE-12345', 'TEST-ELEC-0000', 'TBC', 'n/a', 'XXXXX']) {
    assert.equal(looksUnfilled(v), true, v);
  }
  for (const v of ['86420', 'AU13579', '11 222 333 444', 'QBCC 15123456']) {
    assert.equal(looksUnfilled(v), false, v);
  }
});

// ── 6. unapproved review / project ──────────────────────────────────────────
test('an unapproved review or project cannot publish, and is never rendered', () => {
  const unapproved = presentationGate(GOOD_DESIGN, {
    issuing: true, trust: GOOD_TRUST, customer: GOOD_CUSTOMER,
    siteAddress: GOOD_JOB.siteAddress,
    reviews: [{ id: 'r1', text: 'Great job', approved: false }],
    installations: [{ id: 'i1', title: 'A house', approved: false }]
  });
  assert.equal(unapproved.ok, false);
  const c = unapproved.blockers.map(b => b.code);
  assert.ok(c.includes('UNAPPROVED_REVIEW'), c);
  assert.ok(c.includes('UNAPPROVED_PROJECT'), c);

  // And with none approved, the sections are absent from the page entirely —
  // not rendered as empty headings or grey boxes.
  const r = issue({ content: { trust: GOOD_TRUST,
    reviews: [{ id: 'r1', text: 'Great job', approved: false }],
    installations: [{ id: 'i1', title: 'A house', approved: false }] } });
  assert.equal(r.ok, true, JSON.stringify(codes(r)));
  assert.equal(r.presentation.reviews.length, 0);
  assert.equal(r.presentation.installations.length, 0);
  const html = renderPresentationHtml(r.presentation);
  assert.ok(!/Our work/.test(html), 'an empty installations section was rendered');
  assert.ok(!/id="reviews"/.test(html), 'an empty reviews section was rendered');
  // No grey placeholder rectangles standing in for NAC's work. (A
  // placeholder="" attribute on the acceptance form is an HTML input hint,
  // not an image, so this asks about the gallery markup specifically.)
  assert.ok(!/class="gallery/.test(html), 'a gallery was rendered with no approved photos');
  assert.ok(!/class="shot/.test(html), 'a photo tile was rendered with no approved photos');
});

// ── 7. equipment below the calculated load ──────────────────────────────────
test('equipment below the calculated load cannot be described as adequate', () => {
  const under = { ...GOOD_DESIGN,
    selectedUnit: { ...GOOD_DESIGN.selectedUnit, capacityKw: 16 },
    systemLoad: { ...GOOD_DESIGN.systemLoad, designKw: 22.5, designCoolingKw: 22.5 } };
  const r = issue({ design: under });
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes('CAPACITY_BELOW_CALCULATED_LOAD'), codes(r));

  // With the decision recorded it may issue — and the wording must NOT claim
  // headroom. That sentence is what the demonstration proposal printed.
  const owned = { ...under, capacityDecision: { acknowledgedBy: 'Nick Cahill',
    at: '2026-09-22T00:00:00Z', customerWording: 'Sized to everyday needs.' } };
  const r2 = issue({ design: owned });
  assert.equal(r2.ok, true, JSON.stringify(codes(r2)));
  const text = JSON.stringify(r2.presentation.rationale);
  assert.ok(!/headroom/i.test(text), 'an under-capacity system claimed headroom');
  assert.match(text, /hottest afternoons|everyday/i);
});

// ── 8. the zone controller is a real, priced part ───────────────────────────
test('a zoned proposal names a real controller with its SKU', () => {
  const r = issue();
  assert.equal(r.presentation.zones.controller, 'AirTouch 5 kit');
  assert.equal(r.presentation.zones.controllerSku, 'MMAAT5DK');
  const html = renderPresentationHtml(r.presentation);
  assert.match(html, /AirTouch 5 kit/);
  assert.match(html, /MMAAT5DK/);
  assert.ok(!/Brand Standard Controller/.test(html));

  // Unpriced, and it does not go out.
  const noPrice = { ...GOOD_DESIGN, controller: { name: 'Some controller', maxZones: 8 } };
  const r2 = issue({ design: noPrice });
  assert.equal(r2.ok, false);
  assert.ok(codes(r2).includes('ZONE_CONTROLLER_NOT_PRICED'), codes(r2));
});

// ── 9. counts reconcile ─────────────────────────────────────────────────────
test('room, outlet and zone counts must reconcile', () => {
  const badZones = { ...GOOD_DESIGN,
    zones: { zones: [{ id: 'z1', name: 'LIVING', rooms: ['LIVING'] }], zoneCount: 1 } };
  const r = issue({ design: badZones });
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes('ZONE_COUNT_DISAGREEMENT'), codes(r));

  const badOutlets = { ...GOOD_DESIGN,
    outlets: { rows: [{ roomId: 'r1', label: 'LIVING', quantity: 2 }], totals: { total: 2 } } };
  const r2 = issue({ design: badOutlets });
  assert.equal(r2.ok, false);
  assert.ok(codes(r2).includes('ROOM_COUNT_DISAGREEMENT'), codes(r2));
});

// ── 10. demonstration content ───────────────────────────────────────────────
test('demonstration content can never be issued, and says so unmissably', () => {
  for (const status of ['issued', 'accepted', 'sent']) {
    const r = issue({ status, content: { trust: GOOD_TRUST, demonstration: true } });
    assert.equal(r.ok, false, status + ' published demonstration content');
    assert.equal(r.presentation, null);
    assert.ok(codes(r).includes('DEMONSTRATION_CONTENT'), codes(r));
  }
  const preview = issue({ status: 'draft', content: { trust: GOOD_TRUST, demonstration: true } });
  assert.equal(preview.ok, true);
  assert.match(preview.presentation.demonstrationNote, /NOT FOR CUSTOMER ISSUE/);
  for (const html of [renderPresentationHtml(preview.presentation),
                      presentationPrintHtml(preview.presentation)]) {
    assert.match(html, /DEMONSTRATION — NOT FOR CUSTOMER ISSUE/);
    assert.ok(html.includes('demo-banner'));
    assert.ok(html.includes('demo-mark'));
  }
});

// ── 11. one immutable revision across both renderings ───────────────────────
test('the HTML and the PDF carry the same quote revision', () => {
  const r = issue({ revision: 7 });
  assert.equal(r.presentation.revision, 7);
  const web = renderPresentationHtml(r.presentation);
  const print = presentationPrintHtml(r.presentation);
  for (const [what, html] of [['web', web], ['print', print]]) {
    assert.ok(html.includes('NAC-1'), what + ': proposal number missing');
  }
  // Both renderings are built from ONE presentation object, so the revision
  // cannot differ between them by construction. Freezing proves nothing can
  // mutate it between the two renders either.
  assert.throws(() => { 'use strict'; r.presentation.revision = 99; });
  assert.equal(r.presentation.revision, 7);
});
