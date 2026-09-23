// ─────────────────────────────────────────────────────────────────────────────
// THE CUSTOMER PRESENTATION
//
// These are the assertions Nick asked for, one test each, and they are written
// against the things that would actually go wrong in front of a customer:
// a total that disagrees with the quote, a review nobody approved, a margin on
// a page somebody outside the business can read, an accepted price that later
// changed by itself.
// ─────────────────────────────────────────────────────────────────────────────

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPresentation, presentationGate, auditPresentation, friendlyLabel, suburbOf
} from '../designer/engines/presentation.mjs';
import {
  normaliseReview, reviewPublishable, publicReview, publicDisplayName,
  normaliseInstallation, installationPublishable, publicInstallation,
  imagePublishable, selectReviews, selectInstallations,
  resolveInclusions, resolveUpgrades, normaliseTrust, trustFacts,
  PERMISSION, CONSENT
} from '../designer/engines/presentation-content.mjs';
import {
  issuePresentation, acceptPresentation, declinePresentation, revokePresentation,
  recordView, resolveAccess, changeOptions, supersede, tokenLooksSecure,
  tokenStrengthBits, randomToken, shareUrl, ISSUE_STATUS, MIN_TOKEN_BITS
} from '../designer/engines/presentation-share.mjs';
import { scanMetadata, hasPrivateMetadata } from '../designer/engines/image-privacy.mjs';
import { renderPresentationHtml } from '../designer/ui/presentation-html.mjs';
import { presentationPrintHtml, pdfOptions } from '../designer/ui/presentation-pdf.mjs';
import { buildDemoDesign, DEMO_CONTENT, DEMO_IMAGES } from './fixtures/demo-presentation.mjs';

// ── one shared build, because the pipeline run is the slow part ──────────────
const demo = await buildDemoDesign();

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

const DESIGN = { ...demo.out, fittingAssembly: BUILDABLE };

const heroAsset = DEMO_IMAGES.find(i => i.id === 'hero');
const HERO = { src: heroAsset.derivatives[1].ref, alt: heroAsset.alt, width: 1600, height: 700,
               srcset: heroAsset.derivatives.map(d => ({ ref: d.ref, width: d.width })) };

const CUSTOMER = { name: 'Sample Customer', email: 'sample@example.invalid',
                   phone: '0400 000 000', address: '12 Example Street, Peregian Springs QLD 4573',
                   notes: 'INTERNAL: chase deposit, customer haggles' };
const JOB = { siteAddress: '12 Example Street, Peregian Springs QLD 4573',
              notes: 'INTERNAL: roof access is tight, allow extra time' };

// Content that is NOT demonstration data, for the handful of tests that need a
// presentation in a real issued state. The credentials are fabricated in the
// sense that NAC did not issue them — but they are shaped like real ones on
// purpose, because a test of "what does an ACCEPTED page look like" has to get
// past the gate that refuses placeholders.
const ISSUABLE_CONTENT = {
  ...DEMO_CONTENT,
  demonstration: false,
  trust: {
    ...DEMO_CONTENT.trust,
    abn: '11 222 333 444',
    electricalLicence: '86420',
    arcAuthorisation: 'AU13579',
    email: 'quotes@nacelectrical.com.au'
  }
};

// A customer who could actually receive a quote. CUSTOMER above is deliberately
// demonstration data — sample@example.invalid on 0400 000 000 — and the publish
// gate now refuses to issue to it, which is the point. The handful of tests that
// need a genuinely issuable proposal use this one.
const ISSUABLE_CUSTOMER = {
  name: 'Sarah Whitlock',
  email: 'sarah.whitlock@bigpond.com',
  phone: '0412 665 108',
  address: '34 Kauri Crescent, Peregian Springs QLD 4573',
  notes: 'INTERNAL: chase deposit, customer haggles'
};
// JOB above is at "12 Example Street", which the gate reads as a placeholder
// address — correctly, because that is exactly what it is.
const ISSUABLE_JOB = {
  siteAddress: '34 Kauri Crescent, Peregian Springs QLD 4573',
  notes: 'INTERNAL: roof access is tight, allow extra time'
};


/** NAC's commercial terms, entered and confirmed. Nothing issues without them. */
const CONFIRMED_SETTINGS = { commercial: { terms: {
  depositPercent: 20,
  balanceDueEvent: 'completion and commissioning',
  validityDays: 30,
  paymentMethods: ['Bank transfer', 'Card'],
  termsVersion: 'NAC-T&C-2026-01',
  paymentStages: [{ label: 'Deposit on acceptance', detail: 'Confirms your booking' }],
  confirmed: true, confirmedBy: 'Nick Cahill', confirmedAt: '2026-09-22T00:00:00Z'
} } };

function build(over = {}) {
  return buildPresentation({
    design: DESIGN, customer: CUSTOMER, job: JOB, content: DEMO_CONTENT,
    settings: CONFIRMED_SETTINGS,
    proposalNumber: 'NAC-2026-0184',
    preparedAt: '2026-09-22T00:00:00Z', expiresAt: '2026-10-22T00:00:00Z',
    // DRAFT, not issued: DEMO_CONTENT is demonstration data and the builder
    // refuses to issue, accept or send one. The refusal itself is tested
    // below; everything else is tested against the preview, which renders the
    // same page with a DEMONSTRATION watermark on it.
    revision: 1, status: 'draft', heroImage: HERO, ...over
  });
}
const BUILT = build();
assert.equal(BUILT.ok, true, 'demo fixture must produce a publishable presentation');
const P = BUILT.presentation;
const HTML = renderPresentationHtml(P);
const PRINT = presentationPrintHtml(P);

// ─────────────────────────────────────────────────────────────────────────────

test('the quote total equals the authoritative quote revision', () => {
  const authoritative = DESIGN.commercials.sellPriceIncGst;
  assert.equal(P.investment.baseIncGst, authoritative);
  assert.equal(P.investment.totalIncGst, authoritative);
  assert.equal(P.system.totalIncGst, authoritative);
  // And ex-GST plus GST reconciles to it, rather than being separately rounded.
  assert.ok(Math.abs((P.investment.subtotalExGst + P.investment.gst) - authoritative) < 0.02,
    'subtotal + GST must reconcile with the inc-GST total');
});

test('selected options add to the total and nothing else changes', () => {
  const withOpt = build({ selectedOptionIds: ['u-wifi'] }).presentation;
  const opt = DEMO_CONTENT.upgrades.find(u => u.id === 'u-wifi');
  assert.equal(withOpt.investment.baseIncGst, DESIGN.commercials.sellPriceIncGst);
  assert.equal(withOpt.investment.optionsTotal, opt.priceIncGst);
  assert.equal(withOpt.investment.totalIncGst,
    DESIGN.commercials.sellPriceIncGst + opt.priceIncGst);
  // The base quote is untouched by a customer ticking a box.
  assert.equal(DESIGN.commercials.sellPriceIncGst, P.investment.baseIncGst);
});

test('the HTML and the PDF show the same equipment, options and total', () => {
  const money = '$' + Math.round(P.investment.totalIncGst).toLocaleString('en-AU');
  for (const doc of [HTML, PRINT]) {
    assert.ok(doc.includes(money), 'total must appear in both documents');
    assert.ok(doc.includes(P.system.indoorModel), 'indoor model must appear in both');
    assert.ok(doc.includes(P.system.outdoorModel), 'outdoor model must appear in both');
    assert.ok(doc.includes(P.system.brand), 'brand must appear in both');
  }
  // Both are produced from the same view model object, which is the actual
  // guarantee — the strings above only confirm the renderers use it.
  assert.equal(pdfOptions(P).format, 'A4');
  const withOpt = build({ selectedOptionIds: ['u-wifi'] }).presentation;
  const oHtml = renderPresentationHtml(withOpt);
  const oPrint = presentationPrintHtml(withOpt);
  const oMoney = '$' + Math.round(withOpt.investment.totalIncGst).toLocaleString('en-AU');
  assert.ok(oHtml.includes(oMoney) && oPrint.includes(oMoney),
    'a selected option must move the total in both documents together');
  assert.ok(oPrint.includes('Wi-Fi control adaptor'),
    'a selected option must be itemised in the printed document');
});

test('a blocked quote cannot be published', () => {
  const blocked = JSON.parse(JSON.stringify(DESIGN));
  blocked.bom.items = [...blocked.bom.items,
    { key: 'flex_duct', label: 'Insulated flexible duct R1.0 300 mm',
      priceStatus: 'PLACEHOLDER', priceSource: 'placeholder', cost: 12, lineTotal: 12 }];
  blocked.bom.placeholderCount = 1;
  blocked.bom.placeholderLabels = ['Insulated flexible duct R1.0 300 mm'];
  blocked.bom.placeholderValue = 12;
  const gate = presentationGate(blocked);
  assert.equal(gate.ok, false);
  const out = buildPresentation({ design: blocked, content: DEMO_CONTENT });
  assert.equal(out.ok, false);
  assert.equal(out.presentation, null, 'a blocked quote must yield no presentation at all');
  assert.ok(out.blockers.length > 0);
});

test('a quote with no equipment or no price cannot be published', () => {
  const noUnit = { ...DESIGN, selectedUnit: null };
  assert.equal(presentationGate(noUnit).ok, false);
  assert.ok(presentationGate(noUnit).blockers.some(b => b.code === 'NO_EQUIPMENT_SELECTED'));

  const noPrice = { ...DESIGN, commercials: { ...DESIGN.commercials, sellPriceIncGst: null } };
  assert.equal(presentationGate(noPrice).ok, false);
  assert.ok(presentationGate(noPrice).blockers.some(b => b.code === 'NO_SELL_PRICE'));
});

test('unapproved reviews never appear', () => {
  const bad = DEMO_CONTENT.reviews.find(r => r.id === 'r-unapproved');
  assert.equal(reviewPublishable(bad).ok, false);
  assert.ok(P.reviews.every(r => r.id !== 'r-unapproved'));
  assert.ok(!HTML.includes('MUST NEVER BE PUBLISHED'));
  assert.ok(!PRINT.includes('MUST NEVER BE PUBLISHED'));
  // Even naming it explicitly must not publish it.
  const forced = build({ content: { ...DEMO_CONTENT, selectedReviewIds: ['r-unapproved'] } });
  assert.ok(forced.presentation.reviews.every(r => r.id !== 'r-unapproved'),
    'an explicit selection must not override approval');
});

test('a review with no permission on file never appears', () => {
  const r = normaliseReview({ id: 'x', text: 'Great job', displayName: 'A Person',
    rating: 5, approved: true, permissionStatus: PERMISSION.NONE });
  const v = reviewPublishable(r);
  assert.equal(v.ok, false);
  assert.ok(v.reasons.some(x => /permission|public source/i.test(x)));
});

test('reviews are reproduced exactly', () => {
  for (const shown of P.reviews) {
    const source = DEMO_CONTENT.reviews.find(r => r.id === shown.id);
    assert.equal(shown.text, source.text.trim(),
      'review text must be the stored text, not a rewrite');
    // And it must survive into the rendered page character for character,
    // allowing only HTML escaping.
    const escaped = source.text.trim()
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    assert.ok(HTML.includes(escaped), 'review text must appear verbatim in the HTML');
    assert.ok(PRINT.includes(escaped), 'review text must appear verbatim in the PDF document');
  }
});

test('a reviewer surname is not exposed without permission', () => {
  const priv = normaliseReview({ id: 'p', text: 'Good', displayName: 'Jane Smith',
    rating: 5, approved: true, permissionStatus: PERMISSION.WRITTEN, surnameApproved: false });
  assert.equal(publicDisplayName(priv), 'Jane S.');
  const pub = normaliseReview({ ...priv, permissionStatus: PERMISSION.PUBLIC_SOURCE });
  assert.equal(publicDisplayName(pub), 'Jane Smith', 'a published Google name stays as published');
  const approved = normaliseReview({ ...priv, surnameApproved: true });
  assert.equal(publicDisplayName(approved), 'Jane Smith');
});

test('unapproved project images never appear', () => {
  const imagesById = {};
  for (const i of DEMO_IMAGES) imagesById[i.id] = i;
  const bad = DEMO_CONTENT.installations.find(i => i.id === 'i-unapproved');
  assert.equal(installationPublishable(bad, imagesById).ok, false);
  assert.ok(P.installations.every(i => i.id !== 'i-unapproved'));
  assert.ok(!HTML.includes('NOT APPROVED FOR MARKETING'));

  // An approved job whose cover image is NOT approved is still not publishable.
  const unapprovedCover = { ...imagesById, 'inst-1': { ...imagesById['inst-1'], approved: false } };
  const good = DEMO_CONTENT.installations.find(i => i.id === 'i1');
  assert.equal(installationPublishable(good, unapprovedCover).ok, false);
  assert.equal(imagePublishable({ ...imagesById['inst-1'], approved: false }).ok, false);
});

test('an installation shows suburb only unless the address was consented to', () => {
  const imagesById = {};
  for (const i of DEMO_IMAGES) imagesById[i.id] = i;
  const rec = normaliseInstallation({ id: 'z', coverImageId: 'inst-1', suburb: 'Coolum Beach',
    streetAddress: '9 Private Road, Coolum Beach', approved: true,
    consentStatus: CONSENT.SUBURB_ONLY });
  const pub = publicInstallation(rec, imagesById);
  assert.equal(pub.location, 'Coolum Beach');
  assert.ok(!JSON.stringify(pub).includes('Private Road'));

  const consented = publicInstallation({ ...rec, consentStatus: CONSENT.GRANTED }, imagesById);
  assert.equal(consented.location, '9 Private Road, Coolum Beach');
});

test('private customer data is excluded from the presentation', () => {
  const blob = JSON.stringify(P) + HTML + PRINT;
  assert.ok(!blob.includes(CUSTOMER.notes), 'internal customer notes must not appear');
  assert.ok(!blob.includes(JOB.notes), 'internal job notes must not appear');
  assert.ok(!blob.includes(CUSTOMER.email), 'the customer email is not content for their own page');
  assert.ok(!blob.includes(CUSTOMER.phone));
  // Address is reduced to a suburb by default.
  assert.equal(P.hero.site, 'Peregian Springs');
  assert.ok(!blob.includes('12 Example Street'));
  // And only shows in full when privacy settings say so.
  const full = build({ privacy: { showFullAddress: true } }).presentation;
  assert.equal(full.hero.site, JOB.siteAddress);
});

test('the public page contains no supplier cost, job cost or margin', () => {
  const audit = auditPresentation(P);
  assert.equal(audit.ok, true, 'leaked keys: ' + JSON.stringify(audit.leaks));

  const c = DESIGN.commercials;
  const forbiddenNumbers = [c.totalJobCost, c.grossProfit, c.grossMarginPct,
                            DESIGN.bom.equipmentCost, DESIGN.bom.materialsCost]
    .filter(v => typeof v === 'number' && v > 0);
  for (const doc of [HTML, PRINT]) {
    for (const v of forbiddenNumbers) {
      const printed = '$' + v.toLocaleString('en-AU', { minimumFractionDigits: 2 });
      assert.ok(!doc.includes(printed), 'internal figure ' + printed + ' must not be rendered');
    }
    assert.ok(!/gross\s*(profit|margin)/i.test(doc));
    assert.ok(!/supplier\s*cost/i.test(doc));
    assert.ok(!/job\s*cost/i.test(doc));
  }
});

test('internal warnings never appear in the customer presentation', () => {
  const codes = (DESIGN.warnings || []).map(w => w.code).filter(Boolean);
  assert.ok(codes.length > 0, 'the fixture should carry internal warnings to test against');
  for (const doc of [HTML, PRINT]) {
    for (const code of new Set(codes)) {
      assert.ok(!doc.includes(code), 'warning code ' + code + ' must not reach the customer');
    }
    // Narrow on purpose: the form's own placeholder="Full name" attribute is
    // not a pricing placeholder, and matching it would make this test lie.
    assert.ok(!/PLACEHOLDER_RATES|placeholder rate|NOT ACKNOWLEDGED|CRITICAL —/i.test(doc));
  }
  assert.ok(!('warnings' in P));
});

test('an inclusion is only claimed when the quote actually contains it', () => {
  // Nothing in the catalogue prints without strictly-true evidence.
  assert.deepEqual(resolveInclusions({}), []);
  assert.deepEqual(resolveInclusions({ wifi: 'yes' }), [], 'truthy is not true');
  assert.deepEqual(resolveInclusions({ wifi: 1 }), []);
  const one = resolveInclusions({ wifi: true });
  assert.equal(one.length, 1);
  assert.equal(one[0].key, 'wifi');

  // This design has no Wi-Fi adaptor on the bill, so the card is absent.
  assert.ok(P.inclusions.every(i => i.key !== 'wifi'));
  assert.ok(!HTML.includes('Wi-Fi control</h3>'));
  // But the things it does contain are there.
  for (const key of ['indoor_unit', 'outlets', 'returns', 'controller', 'pipework']) {
    assert.ok(P.inclusions.some(i => i.key === key), 'expected inclusion ' + key);
  }
});

test('an incompatible upgrade is never offered', () => {
  assert.ok(P.options.every(o => o.id !== 'u-3phase'));
  assert.ok(!HTML.includes('Three-phase equipment alternative'));
  assert.ok(P._internal.withheldUpgrades.some(u => u.id === 'u-3phase'));

  const { offerable, withheld } = resolveUpgrades(
    [{ id: 'a', title: 'A', priceIncGst: 10, requires: ['nope'] },
     { id: 'b', title: 'B', priceIncGst: 10, requires: [] },
     { id: 'c', title: 'C', requires: [] }], {});
  assert.deepEqual(offerable.map(o => o.id), ['b']);
  assert.ok(withheld.some(w => w.id === 'c' && /price/i.test(w.reason)),
    'an upgrade with no price is withheld, not shown at zero');
});

test('missing optional content leaves no blank section', () => {
  const bare = buildPresentation({
    design: DESIGN,
    customer: { name: '' }, job: {},
    content: { trust: {}, reviews: [], installations: [], images: [], upgrades: [],
               paymentTerms: {}, aftercare: {}, standardInclusions: {} },
    proposalNumber: '', revision: 1, status: 'draft'
  });
  assert.equal(bare.ok, true);
  const b = bare.presentation;
  assert.deepEqual(b.reviews, []);
  assert.deepEqual(b.installations, []);
  assert.deepEqual(b.options, []);
  assert.equal(b.warranty, null);
  const html = renderPresentationHtml(b);
  for (const id of ['id="work"', 'id="reviews"', 'id="options"', 'id="warranty"']) {
    assert.ok(!html.includes(id), 'empty section ' + id + ' must not be rendered at all');
  }
  // And no placeholder wording anywhere in the CONTENT — the page's own inline
  // script legitimately contains the word null, so it is excluded rather than
  // the assertion being weakened.
  const content = html.replace(/<script>[\s\S]*?<\/script>/g, '');
  assert.ok(!/undefined|NaN|\[object Object\]/.test(content));
  assert.ok(!/>\s*null\s*</.test(content), 'a null must never be rendered as text');
  assert.ok(!html.includes('<img src=""'));
  // Neutral greeting when there is no first name.
  assert.equal(b.hero.greeting, 'Hello');
  assert.ok(html.includes('Hello<'));
});

test('a proposal with no product image shows a branded card, not a lookalike', () => {
  assert.equal(P.system.image, null);
  assert.ok(HTML.includes('sys-card'), 'a branded system card stands in for a missing photo');
  assert.ok(HTML.includes('Ducted reverse cycle'));
});

test('room and zone names are not shouted at the customer', () => {
  assert.equal(friendlyLabel('MASTER BEDROOM'), 'Master Bedroom');
  assert.equal(friendlyLabel('BEDROOM 4'), 'Bedroom 4');
  assert.equal(friendlyLabel('Open plan — open-plan'), 'Open plan');
  assert.equal(friendlyLabel('WC'), 'WC', 'a short abbreviation is not shouting');
  assert.ok(P.zones.rows.every(r => r.name !== r.name.toUpperCase() || r.name.length <= 3));
  assert.ok(P.coverage.rooms.every(r => r.name !== r.name.toUpperCase() || r.name.length <= 3));
});

test('a customer link is unguessable', () => {
  const issue = issuePresentation({ designId: 'job_1', quoteRevision: 1 });
  assert.ok(tokenStrengthBits(issue.token) >= MIN_TOKEN_BITS);
  assert.ok(tokenLooksSecure(issue.token));
  // No database id, job number or sequence anywhere in the link.
  assert.ok(!issue.token.includes('job_1'));
  assert.ok(!shareUrl(issue, 'https://x.invalid').includes('job_1'));
  for (const bad of ['1', '000123', 'quote_17', 'job-4', 'abc']) {
    assert.equal(tokenLooksSecure(bad), false, bad + ' must not pass as a secure token');
  }
  // And two issues never collide.
  const seen = new Set();
  for (let i = 0; i < 400; i++) seen.add(randomToken());
  assert.equal(seen.size, 400);
});

test('a revoked link cannot be opened', () => {
  const issue = issuePresentation({ designId: 'j', quoteRevision: 1 });
  const { ok, issue: revoked } = revokePresentation(issue, { by: 'nick', reason: 'superseded by phone' });
  assert.equal(ok, true);
  const access = resolveAccess(revoked);
  assert.equal(access.ok, false);
  assert.equal(access.reason, 'revoked');
  // And it cannot be accepted through the back door either.
  const attempt = acceptPresentation(revoked,
    { customerName: 'Someone', acknowledgedTerms: true, totalIncGst: 1 });
  assert.equal(attempt.ok, false);
  assert.equal(attempt.reason, 'revoked');
});

test('an expired quote can be read but not accepted', () => {
  const issue = issuePresentation({ designId: 'j', quoteRevision: 1, validDays: 1,
    now: '2026-01-01T00:00:00.000Z' });
  const access = resolveAccess(issue, '2026-03-01T00:00:00.000Z');
  assert.equal(access.ok, true, 'a customer may still read what they were quoted');
  assert.equal(access.expired, true);
  assert.equal(access.canAccept, false);
  const attempt = acceptPresentation(issue, { customerName: 'A Person', acknowledgedTerms: true,
    totalIncGst: 1, now: '2026-03-01T00:00:00.000Z' });
  assert.equal(attempt.ok, false);
  assert.equal(attempt.reason, 'expired');

  // And the rendered page offers contact rather than an accept button.
  const p = build({ expiresAt: '2020-01-01T00:00:00Z' }).presentation;
  assert.equal(p.expired, true);
  assert.equal(p.acceptance.canAccept, false);
  const html = renderPresentationHtml(p);
  assert.ok(!html.includes('id="acceptForm"'));
  assert.ok(/expired/i.test(html));
});

test('an accepted quote cannot be modified', () => {
  const issue = issuePresentation({ designId: 'j', quoteRevision: 3 });
  const res = acceptPresentation(issue, { customerName: 'Sample Customer',
    acknowledgedTerms: true, totalIncGst: 15769.6, selectedOptionIds: ['u-wifi'] });
  assert.equal(res.ok, true);
  const accepted = res.issue;
  assert.equal(accepted.status, ISSUE_STATUS.ACCEPTED);
  assert.equal(accepted.acceptance.totalIncGst, 15769.6);
  assert.equal(accepted.acceptance.quoteRevision, 3);
  assert.ok(Object.isFrozen(accepted), 'an accepted issue is frozen');

  // Accepting again, declining, or revoking are all refused.
  assert.equal(acceptPresentation(accepted, { customerName: 'X', acknowledgedTerms: true,
    totalIncGst: 1 }).reason, 'already_answered');
  assert.equal(declinePresentation(accepted).ok, false);
  assert.equal(revokePresentation(accepted).ok, false);

  // A mutation attempt does not take.
  try { accepted.acceptance.totalIncGst = 1; } catch { /* strict mode throws */ }
  assert.equal(accepted.acceptance.totalIncGst, 15769.6);
});

test('changing options on an accepted quote requires a new revision', () => {
  const issue = issuePresentation({ designId: 'j', quoteRevision: 1 });
  const open = changeOptions(issue, ['u-wifi']);
  assert.equal(open.ok, true, 'before acceptance a selection is just a selection');
  assert.deepEqual(open.issue.selectedOptionIds, ['u-wifi']);

  const accepted = acceptPresentation(open.issue, { customerName: 'A Person',
    acknowledgedTerms: true, totalIncGst: 100 }).issue;
  const after = changeOptions(accepted, ['u-wifi', 'u-outlet']);
  assert.equal(after.ok, false);
  assert.equal(after.reason, 'requires_new_revision');
  assert.equal(after.needsNewRevision, true);
  assert.deepEqual(accepted.selectedOptionIds, ['u-wifi'], 'the accepted record is unchanged');
});

test('superseding points the customer forward without altering the archive', () => {
  const v1 = recordView(issuePresentation({ designId: 'j', quoteRevision: 1 }));
  const v2 = issuePresentation({ designId: 'j', quoteRevision: 2 });
  const { previous, next } = supersede(v1, v2);

  assert.equal(previous.status, ISSUE_STATUS.SUPERSEDED);
  assert.equal(previous.supersededBy, v2.token);
  assert.equal(previous.quoteRevision, 1, 'the archived revision is not renumbered');
  assert.equal(previous.viewCount, v1.viewCount, 'its history is unchanged');
  assert.equal(next.supersedes, v1.token);

  const access = resolveAccess(previous);
  assert.equal(access.ok, false);
  assert.equal(access.reason, 'superseded');
  assert.equal(access.redirectToken, v2.token);

  // An ACCEPTED issue is never relabelled as superseded.
  const acc = acceptPresentation(issuePresentation({ designId: 'j', quoteRevision: 1 }),
    { customerName: 'A', acknowledgedTerms: true, totalIncGst: 1 }).issue;
  assert.equal(supersede(acc, v2).previous.status, ISSUE_STATUS.ACCEPTED);
});

test('acceptance requires a name and an explicit terms acknowledgement', () => {
  const issue = issuePresentation({ designId: 'j', quoteRevision: 1 });
  assert.equal(acceptPresentation(issue, { customerName: '  ', acknowledgedTerms: true,
    totalIncGst: 1 }).reason, 'name_required');
  assert.equal(acceptPresentation(issue, { customerName: 'A Person', acknowledgedTerms: false,
    totalIncGst: 1 }).reason, 'terms_required');
  assert.equal(acceptPresentation(issue, { customerName: 'A Person', acknowledgedTerms: 'yes',
    totalIncGst: 1 }).reason, 'terms_required', 'a truthy value is not a tick');
});

test('the audit trail records every event', () => {
  let issue = issuePresentation({ designId: 'j', quoteRevision: 1, issuedBy: 'nick' });
  issue = recordView(issue);
  issue = recordView(issue);
  issue = changeOptions(issue, ['u-wifi']).issue;
  issue = acceptPresentation(issue, { customerName: 'A Person', acknowledgedTerms: true,
    totalIncGst: 1 }).issue;
  const events = issue.audit.map(a => a.event);
  assert.deepEqual(events, ['issued', 'viewed', 'viewed', 'options_changed', 'accepted']);
  assert.equal(issue.viewCount, 2);
  assert.ok(issue.firstViewedAt && issue.lastViewedAt);
  assert.ok(issue.audit.every(a => typeof a.at === 'string' && a.at.length > 0));
});

test('EXIF and GPS metadata is detected and a clean image passes', () => {
  // A JPEG carrying an APP1/Exif block, which is where GPS tags live.
  const withExif = new Uint8Array([
    0xFF, 0xD8,                                     // SOI
    0xFF, 0xE1, 0x00, 0x10,                         // APP1, length 16
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00,             // "Exif\0\0"
    0x4D, 0x4D, 0x00, 0x2A, 0x00, 0x00, 0x00, 0x08, // TIFF header
    0xFF, 0xDA, 0x00, 0x02,                         // SOS
    0xFF, 0xD9                                      // EOI
  ]);
  const scan = scanMetadata(withExif);
  assert.equal(scan.format, 'jpeg');
  assert.equal(scan.clean, false);
  assert.ok(scan.markers.includes('EXIF'));
  assert.equal(hasPrivateMetadata(withExif), true);

  // The same image with only a bare JFIF header and no thumbnail is clean.
  const clean = new Uint8Array([
    0xFF, 0xD8,
    0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00,
    0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xFF, 0xDA, 0x00, 0x02, 0xFF, 0xD9
  ]);
  assert.equal(scanMetadata(clean).clean, true);
  assert.equal(hasPrivateMetadata(clean), false);

  // A PNG carrying a text chunk is not clean either.
  const pngText = new Uint8Array([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
    0x00, 0x00, 0x00, 0x04, 0x74, 0x45, 0x58, 0x74, 0x61, 0x62, 0x63, 0x64,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0x00, 0x00, 0x00, 0x00
  ]);
  assert.equal(scanMetadata(pngText).clean, false);
});

test('an image with metadata still on it is not publishable', () => {
  const asset = { id: 'a', alt: 'A photo', approved: true,
    derivatives: [{ ref: 'x.jpg', width: 800, height: 600, format: 'jpeg' }],
    exifStripped: false, gpsRemoved: false };
  const v = imagePublishable(asset);
  assert.equal(v.ok, false);
  assert.ok(v.reasons.some(r => /metadata/i.test(r)));
  assert.equal(imagePublishable({ ...asset, exifStripped: true, gpsRemoved: true }).ok, true);
  // Alt text is required, for screen readers.
  assert.equal(imagePublishable({ ...asset, exifStripped: true, gpsRemoved: true, alt: '' }).ok, false);
});

test('reviews are selected between three and six, or not at all', () => {
  const ctx = { brand: 'Daikin', systemType: 'ducted', suburb: 'Peregian Springs' };
  assert.ok(P.reviews.length >= 3 && P.reviews.length <= 6);
  // Two publishable reviews is below the minimum, so the section is empty
  // rather than thin.
  const two = selectReviews(DEMO_CONTENT.reviews.slice(0, 2), ctx);
  assert.equal(two.length, 0);
  // And never more than six.
  const many = Array.from({ length: 12 }, (_, i) =>
    ({ ...DEMO_CONTENT.reviews[0], id: 'm' + i }));
  assert.equal(selectReviews(many, ctx).length, 6);
});

test('installations are capped at six and hidden when there are none', () => {
  const imagesById = {};
  for (const i of DEMO_IMAGES) imagesById[i.id] = i;
  assert.ok(P.installations.length > 0 && P.installations.length <= 6);
  assert.equal(selectInstallations([], imagesById, {}).length, 0);
  const many = Array.from({ length: 10 }, (_, i) =>
    ({ ...DEMO_CONTENT.installations[0], id: 'm' + i }));
  assert.equal(selectInstallations(many, imagesById, {}).length, 6);
});

test('trust facts are only the fields that were actually filled in', () => {
  assert.deepEqual(trustFacts({}), [], 'an empty admin form invents nothing');
  const t = normaliseTrust({ abn: '11 111 111 111', electricalLicence: '', memberships: ['', ' '] });
  const facts = trustFacts(t);
  assert.equal(facts.length, 1);
  assert.equal(facts[0].label, 'ABN');
  assert.ok(!facts.some(f => /licence/i.test(f.label)), 'a blank licence is omitted, not invented');
  // And nothing in the module supplies a default licence number.
  assert.equal(normaliseTrust({}).electricalLicence, '');
  assert.equal(normaliseTrust({}).arcAuthorisation, '');
});

test('a suburb is derived from an address without exposing the street', () => {
  assert.equal(suburbOf('34 Kauri Crescent, Peregian Springs QLD 4573'), 'Peregian Springs');
  assert.equal(suburbOf('12 Example Street, Coolum Beach'), 'Coolum Beach');
  assert.equal(suburbOf('Peregian Springs'), 'Peregian Springs');
  assert.equal(suburbOf(''), '');
});

test('the acceptance state drives what the page offers', () => {
  const accepted = build({ status: 'accepted', content: ISSUABLE_CONTENT,
                           customer: ISSUABLE_CUSTOMER, job: ISSUABLE_JOB }).presentation;
  assert.equal(accepted.acceptance.accepted, true);
  assert.equal(accepted.acceptance.canAccept, false);
  const html = renderPresentationHtml(accepted);
  assert.ok(html.includes('Proposal accepted'));
  assert.ok(!html.includes('id="acceptForm"'));

  const declined = build({ status: 'declined', content: ISSUABLE_CONTENT,
                           customer: ISSUABLE_CUSTOMER, job: ISSUABLE_JOB }).presentation;
  assert.ok(renderPresentationHtml(declined).includes('Proposal declined'));
});

// ── DEMONSTRATION DATA ──────────────────────────────────────────────────────

test('demonstration content can be previewed but never issued', () => {
  const preview = build({ status: 'draft' });
  assert.equal(preview.ok, true, 'a demonstration must still be reviewable');
  assert.equal(preview.presentation.demonstration, true);
  assert.match(preview.presentation.demonstrationNote, /DEMONSTRATION/);

  // And it is on the page, on screen and on paper, not just in the data.
  for (const [what, html] of [['web', renderPresentationHtml(preview.presentation)],
                              ['print', presentationPrintHtml(preview.presentation)]]) {
    assert.ok(html.includes('demo-banner'), what + ': no banner');
    assert.ok(html.includes('demo-mark'), what + ': no watermark');
    assert.ok(/DEMONSTRATION/.test(html), what + ': the word never appears');
  }

  for (const status of ['issued', 'accepted', 'sent']) {
    const r = build({ status });
    assert.equal(r.ok, false, status + ' was allowed on demonstration content');
    assert.equal(r.presentation, null, status + ' still returned a page to render');
    assert.ok(r.blockers.some(b => b.code === 'DEMONSTRATION_CONTENT'),
      status + ': ' + JSON.stringify(r.blockers.map(b => b.code)));
  }
});

test('a placeholder credential is never stated to a customer', () => {
  // DEMO_TRUST carries TEST-ELEC-0000 and TEST-ARC-0000.
  const r = buildPresentation({
    design: DESIGN, customer: CUSTOMER, job: JOB,
    content: { ...DEMO_CONTENT, demonstration: false },
    proposalNumber: 'NAC-2026-0184', revision: 1, status: 'issued', heroImage: HERO
  });
  assert.equal(r.ok, false);
  const codes = r.blockers.map(b => b.code);
  assert.ok(codes.includes('PLACEHOLDER_CREDENTIAL'), JSON.stringify(codes));
  // And it names the field rather than saying "something is wrong".
  const b = r.blockers.find(x => x.code === 'PLACEHOLDER_CREDENTIAL');
  assert.ok(['electricalLicence', 'arcAuthorisation'].includes(b.field), b.field);
});

test('NAC no longer claims it does not subcontract, or promises open-ended servicing', () => {
  const points = DEMO_CONTENT.trust.points.join(' | ');
  assert.ok(!/subcontract/i.test(points), points);
  assert.ok(!/ongoing support and servicing/i.test(points), points);
  // And nothing renders it either.
  assert.ok(!/subcontract/i.test(HTML));
});

test('the rendered page escapes content rather than trusting it', () => {
  const nasty = '<script>alert(1)</script>';
  const p = build({
    content: { ...DEMO_CONTENT, trust: { ...DEMO_CONTENT.trust, businessName: nasty } },
    proposalNumber: nasty
  }).presentation;
  const html = renderPresentationHtml(p);
  assert.ok(!html.includes(nasty));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('a javascript: or svg data URL is never emitted as an image source', () => {
  const p = build({ heroImage: { src: 'javascript:alert(1)', alt: 'x' } }).presentation;
  const html = renderPresentationHtml(p);
  assert.ok(!html.includes('javascript:'));

  const svg = build({ heroImage: { src: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', alt: 'x' } });
  assert.ok(!renderPresentationHtml(svg.presentation).includes('image/svg+xml'),
    'an SVG data URL can carry script and is not an allowed image source');
});

test('the print document drops the web furniture and keeps the figures', () => {
  assert.ok(!PRINT.includes('id="sticky"'));
  assert.ok(!PRINT.includes('id="lightbox"'));
  assert.ok(!PRINT.includes('class="nav"'));
  assert.ok(!PRINT.includes('<script>'));
  assert.ok(!PRINT.includes('id="acceptForm"'));
  assert.ok(PRINT.includes('@page'));
  assert.ok(PRINT.includes('size:A4'));
  // The figures survive.
  assert.ok(PRINT.includes(P.system.indoorModel));
  assert.ok(PRINT.includes('$' + Math.round(P.investment.totalIncGst).toLocaleString('en-AU')));
  // The web build still carries print rules, so Cmd-P works from the link.
  assert.ok(HTML.includes('@media print'));
});

test('the PDF footer carries the revision and page numbering', () => {
  const o = pdfOptions(P);
  assert.equal(o.format, 'A4');
  assert.equal(o.displayHeaderFooter, true);
  assert.ok(o.footerTemplate.includes('pageNumber'));
  assert.ok(o.footerTemplate.includes('totalPages'));
  assert.ok(o.footerTemplate.includes('revision 1'));
  assert.ok(o.footerTemplate.includes('NAC-2026-0184'));
  assert.ok(Number.parseFloat(o.margin.bottom) >= 14, 'the footer needs room or it overlaps');
});

test('exclusive option groups are enforced where the price is worked out', () => {
  // Two options in one group, both requested. Only one may count toward the
  // total — the page enforces this for the customer, this enforces it for the
  // price, so a request that never went through the page cannot stack them.
  const content = {
    ...DEMO_CONTENT,
    upgrades: [
      { id: 'g-a', title: 'Controller A', priceIncGst: 400, requires: [], group: 'controller' },
      { id: 'g-b', title: 'Controller B', priceIncGst: 900, requires: [], group: 'controller' },
      { id: 'free', title: 'Extra outlet', priceIncGst: 300, requires: [] }
    ]
  };
  const p = build({ content, selectedOptionIds: ['g-a', 'g-b', 'free'] }).presentation;
  const ids = p.investment.selectedOptions.map(o => o.id);
  assert.equal(ids.filter(i => i === 'g-a' || i === 'g-b').length, 1,
    'only one option from an exclusive group may be selected');
  assert.ok(ids.includes('free'));
  assert.equal(p.investment.optionsTotal, 400 + 300);
  assert.equal(p.investment.totalIncGst, DESIGN.commercials.sellPriceIncGst + 700);
});

test('the renderer does not drag the engines onto a customer phone', async () => {
  // The public page imports the renderer only. If the renderer imports the
  // engine, the quote gate and the whole content library ship with it.
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(
    new URL('../designer/ui/presentation-html.mjs', import.meta.url), 'utf8');
  const imports = [...src.matchAll(/^\s*import\s[^;]*from\s+'([^']+)'/gm)].map(m => m[1]);
  assert.deepEqual(imports, [], 'presentation-html.mjs must stand alone');
});
