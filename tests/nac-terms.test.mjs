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
         TERMS_COMMITMENTS, checkTermsAgainstSettings, licencePromiseCheck }
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
  assert.equal(seedTermsAndConditions(null), NAC_TERMS_BODY);
  assert.equal(seedTermsAndConditions(''), NAC_TERMS_BODY);
  assert.equal(seedTermsAndConditions('NAC house terms, 2027'), 'NAC house terms, 2027');
});

test('the terms never describe the job as a fixed price', () => {
  // The proposal gate refuses to issue an allowance-priced job whose terms
  // call it fixed. NAC's document says the opposite at clause 2.4, and this
  // holds that so a future edit cannot quietly block every proposal.
  assert.ok(!/\bfixed[- ]price\b/i.test(NAC_TERMS_BODY));
  assert.ok(/the final price is calculated on what the job actually required/i
    .test(NAC_TERMS_BODY));
});
