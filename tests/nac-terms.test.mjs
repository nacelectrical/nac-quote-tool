// ─────────────────────────────────────────────────────────────────────────────
// NAC'S TERMS AND CONDITIONS OF TRADE
//
// The real document, v1.0, effective 23 September 2026. It is not decoration:
// three of its clauses are also settings, and the customer receives both
// documents. If they disagree, the one that binds NAC is whichever the other
// side's solicitor reads first.
// ─────────────────────────────────────────────────────────────────────────────

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NAC_TERMS_BODY, NAC_TERMS_VERSION, NAC_TERMS_EFFECTIVE, NAC_TERMS_LABEL,
         TERMS_COMMITMENTS, checkTermsAgainstSettings, licencePromiseCheck,
         resolveTermsContact, termsContactGaps, termsPlaceholders }
  from '../designer/engines/nac-terms.mjs';
import { DEFAULT_SETTINGS } from '../designer/engines/settings.mjs';
import { seedTrust, seedTermsAndConditions, NAC_TRUST }
  from '../designer/engines/presentation-content.mjs';

test('the document is carried whole, not summarised', () => {
  assert.equal(NAC_TERMS_VERSION, '1.0');
  assert.equal(NAC_TERMS_EFFECTIVE, '2026-09-23');
  assert.match(NAC_TERMS_LABEL, /NAC T&C v1\.0/);
  assert.ok(NAC_TERMS_BODY.length > 20000, 'the terms look truncated');
  // All twenty-one headings, in order.
  for (const h of ['1 DEFINITIONS', '2 QUOTATIONS', '5 DEPOSIT AND PAYMENT',
                   '9 WHAT THE PRICE DOES NOT COVER', '12 WARRANTY', '14 LIABILITY',
                   '17 INSURANCE AND LICENCES', '20 GENERAL', '21 CONTACT']) {
    assert.ok(NAC_TERMS_BODY.includes(h), 'clause missing: ' + h);
  }
  // Nothing was invented on the way in: the ABN in the document is NAC's.
  assert.ok(NAC_TERMS_BODY.includes('97 636 392 982'));
});

test('the clauses that are also settings say the same thing', () => {
  assert.ok(/quotations hold for 30 days/i.test(NAC_TERMS_BODY));      // 2.1
  assert.ok(/deposit of 50% of the quoted price/i.test(NAC_TERMS_BODY)); // 5.1
  assert.ok(/balance falls due on completion/i.test(NAC_TERMS_BODY));   // 5.2
  assert.equal(TERMS_COMMITMENTS.validityDays, 30);
  assert.equal(TERMS_COMMITMENTS.depositPercent, 50);

  const t = DEFAULT_SETTINGS.commercial.terms;
  assert.equal(t.validityDays, TERMS_COMMITMENTS.validityDays);
  assert.equal(t.depositPercent, TERMS_COMMITMENTS.depositPercent);
  assert.equal(checkTermsAgainstSettings(DEFAULT_SETTINGS).ok, true);
});

test('a setting that drifts from the document is reported, one per clause', () => {
  const c = (terms) => checkTermsAgainstSettings({ commercial: { terms } }).conflicts;
  assert.deepEqual(c({ validityDays: 60 }).map(x => x.code), ['TERMS_VALIDITY_CONFLICT']);
  assert.deepEqual(c({ depositPercent: 30 }).map(x => x.code), ['TERMS_DEPOSIT_CONFLICT']);
  assert.deepEqual(c({ balanceDueEvent: 'handover' }).map(x => x.code),
    ['TERMS_BALANCE_CONFLICT']);
  // An empty field is not a conflict — it is a gap, and commercial-terms.mjs
  // reports gaps. Two engines saying the same thing differently is worse than
  // one saying it once.
  assert.deepEqual(c({ validityDays: null, depositPercent: null, balanceDueEvent: '' }), []);
  // "completion and commissioning" still satisfies clause 5.2.
  assert.deepEqual(c({ balanceDueEvent: 'completion and commissioning' }), []);
});

test('clause 17.2 promises licence numbers, so a blank one is reported', () => {
  const none = licencePromiseCheck({});
  assert.equal(none.ok, false);
  assert.deepEqual(none.missing, ['electrical contractor licence', 'ARC authorisation']);
  assert.match(none.note, /17\.2/);

  // NAC's seeded credentials carry the ARC number but not the licence.
  const seeded = licencePromiseCheck(seedTrust(null));
  assert.equal(seeded.ok, false);
  assert.deepEqual(seeded.missing, ['electrical contractor licence']);

  const both = licencePromiseCheck({ electricalLicence: '86420', arcAuthorisation: 'AU64234' });
  assert.equal(both.ok, true);
  assert.equal(both.note, null);
});

test('NAC states only what its own terms already commit it to', () => {
  const t = seedTrust(null);
  assert.equal(t.abn, '97 636 392 982');
  assert.equal(t.arcAuthorisation, 'AU64234');
  assert.equal(t.electricalLicence, '', 'a licence number was invented');
  // Every warranty claim on the proposal is a clause of the document.
  assert.match(t.workmanshipWarranty, /5 years/);              // 12.1.1
  assert.ok(NAC_TERMS_BODY.includes('workmanship for 5 years'));
  assert.match(t.manufacturerWarranty, /passed through to you in full/); // 12.1.3
  assert.ok(NAC_TERMS_BODY.includes('passed through to you in full'));
  assert.match(t.insuranceStatement, /public liability/i);     // 17.1
  assert.equal(t.phone, NAC_TRUST.phone);
});

test('a library that has never been filled in still shows the real terms', () => {
  // The body comes back resolved: clause 21's contact block is templated, so
  // the seeded text is NAC_TERMS_BODY with the tokens filled from the trust
  // settings rather than the template verbatim.
  const seeded = seedTermsAndConditions(null);
  assert.ok(seeded.startsWith('These Terms apply to every quotation we issue'));
  assert.ok(seeded.includes('21 CONTACT'));
  assert.equal(seedTermsAndConditions(''), seeded);
  assert.equal(seedTermsAndConditions('NAC house terms, 2027'), 'NAC house terms, 2027');
});

test('no unfilled bracket survives into the terms a customer signs', () => {
  // The template carried "[insert street address]" and three "[insert
  // number]"s, and they went out on the proposal.
  const seeded = seedTermsAndConditions(null);
  assert.deepEqual(termsPlaceholders(seeded), [],
    'a placeholder reached the terms: ' + termsPlaceholders(seeded).join(', '));
  assert.ok(!/\[insert/i.test(seeded));
});

test('a credential NAC holds is printed, and one it does not takes its line out', () => {
  const seeded = seedTermsAndConditions(null);
  // Clause 21's contact block only. Clause 12 separately UNDERTAKES that NAC
  // holds an electrical contractor licence and a QBCC licence where the work
  // calls for one, which is a commitment and stays in the document whatever
  // numbers are on file.
  const i = seeded.indexOf('21 CONTACT');
  const contact = seeded.slice(i, seeded.indexOf('ACCEPTANCE', i));
  // Nick has the ARCtick authorisation, so clause 21 states it.
  assert.ok(contact.includes('ARCtick authorisation AU64234'));
  // Nick, 15 October 2026: "Leave licence number out for now until I have it."
  // The label goes with the number — never "Electrical contractor licence" on
  // its own, and never a bracket, a "TBC" or an invented number.
  assert.ok(!contact.includes('Electrical contractor licence'));
  assert.ok(!contact.includes('QBCC licence'));
  assert.ok(!contact.includes('Business address'));
  assert.ok(!/\b(TBC|TBA|pending|on application)\b/i.test(contact));
});

test('a value that is itself a placeholder is treated as no value', () => {
  const body = 'Business X{{electricalLicence}} END';
  assert.equal(resolveTermsContact(body, { electricalLicence: '[insert number]' }),
    'Business X END');
  assert.equal(resolveTermsContact(body, { electricalLicence: 'TBC' }), 'Business X END');
  assert.equal(resolveTermsContact(body, { electricalLicence: '86421' }),
    'Business X Electrical contractor licence 86421 END');
});

test('the gaps in clause 21 are reportable, so they can be asked for', () => {
  const gaps = termsContactGaps(NAC_TRUST).map(g => g.field);
  assert.ok(gaps.includes('businessAddress'));
  assert.ok(gaps.includes('electricalLicence'));
  assert.ok(!gaps.includes('arcAuthorisation'), 'the ARC number is on file');
});

test('the terms never describe the job as a fixed price', () => {
  // The proposal gate refuses to issue an allowance-priced job whose terms
  // call it fixed. NAC's document says the opposite at clause 2.4, and this
  // holds that so a future edit cannot quietly block every proposal.
  assert.ok(!/\bfixed[- ]price\b/i.test(NAC_TERMS_BODY));
  assert.ok(/the final price is calculated on what the job actually required/i
    .test(NAC_TERMS_BODY));
});
