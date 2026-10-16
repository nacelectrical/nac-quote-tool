// ─────────────────────────────────────────────────────────────────────────────
// WHAT NAC STILL HAS TO SUPPLY, AND WHAT THE PAGE DOES WITHOUT IT
//
// Nick: "Never invent photos, reviews, warranties, credentials or prices.
// Hide optional sections when approved assets are unavailable. Do not display
// empty cards, broken images, fake testimonials or unfinished placeholders as
// finished content."
//
// So there are two things to hold:
//
//   1. A SECTION WITH NOTHING IN IT IS NOT RENDERED. Not greyed out, not an
//      empty card with a heading above it. Absent.
//   2. THE MISSING THING IS NAMED. An estimator should not have to guess why
//      a section is not there, and Nick should not have to guess what to send.
//
// And the one that is easiest to get wrong: a photograph of the WRONG unit is
// worse than no photograph, because the customer believes it.
// ─────────────────────────────────────────────────────────────────────────────

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assetRequest, NEED } from '../designer/engines/asset-request.mjs';
import { equipmentImagesFor, normaliseImageAsset, IMAGE_ROLES, EMPTY_TRUST, NAC_TRUST }
  from '../designer/engines/presentation-content.mjs';

const image = (id, role, models, extra = {}) => normaliseImageAsset({
  id, alt: id, role, equipmentModels: models, approved: true,
  equipmentBrand: 'Daikin',
  exifStripped: true, gpsRemoved: true,
  derivatives: [{ ref: 'https://cdn.example/' + id + '.jpg', width: 800, height: 600,
                  format: 'jpeg', bytes: 90000 }],
  ...extra
});

const DAIKIN = { model: 'FDYAN160AV1', outdoorModel: 'RZA160C2V1', brandName: 'Daikin' };

// ── THE PHOTOGRAPH HAS TO BE OF THE RIGHT MACHINE ───────────────────────────

test('an exact model match still wins over the brand', () => {
  const lib = [
    image('indoor', IMAGE_ROLES.EQUIPMENT, ['FDYAN160AV1']),
    image('outdoor', IMAGE_ROLES.EQUIPMENT, ['RZA160C2V1']),
    image('wall-split', IMAGE_ROLES.EQUIPMENT, ['FTXM35R']),
    image('ceiling', IMAGE_ROLES.INSTALLATION, ['FDYAN160AV1'])
  ];
  // Where models are recorded they decide, and the FTXM35R is not on this
  // quote however much Daikin is.
  const got = equipmentImagesFor(lib, DAIKIN).map(i => i.id);
  assert.deepEqual(got, ['indoor', 'outdoor']);

  // An installation-role photo is still never offered as equipment.
  assert.ok(!got.includes('ceiling'));

  // A quote naming no unit at all gets nothing.
  assert.deepEqual(equipmentImagesFor(lib, {}), []);
});

test('with no model recorded, the brand decides — which is what Nick asked for', () => {
  // Nick, 16 October 2026: "Just use brands. Put one of the Daikin ones next
  // to a Daikin, Fujitsu next to Fujitsu."
  //
  // This file used to assert the opposite, on the reasoning that "a Daikin" is
  // four hundred different machines. That reasoning was about a library that
  // might contain anything; NAC's contains NAC's own photographs of NAC's own
  // ducted work, and what goes into it is his call.
  const lib = [
    image('daikin-outdoor', IMAGE_ROLES.EQUIPMENT, [], { equipmentBrand: 'Daikin',
      tags: ['daikin', 'outdoor', 'ducted'] }),
    image('daikin-vrv', IMAGE_ROLES.EQUIPMENT, [], { equipmentBrand: 'Daikin',
      tags: ['daikin', 'outdoor'] }),
    image('fujitsu-outdoor', IMAGE_ROLES.EQUIPMENT, [], { equipmentBrand: 'Fujitsu',
      tags: ['fujitsu', 'outdoor', 'ducted'] }),
    image('fujitsu-controller', IMAGE_ROLES.EQUIPMENT, [], { equipmentBrand: 'Fujitsu',
      tags: ['fujitsu', 'controller'] }),
    image('airtouch', IMAGE_ROLES.EQUIPMENT, [], { equipmentBrand: 'AirTouch',
      tags: ['airtouch', 'controller'] })
  ];

  const daikin = equipmentImagesFor(lib, { brandName: 'Daikin', model: 'FDYAN160AV1' })
    .map(i => i.id);
  assert.deepEqual(daikin, ['daikin-outdoor', 'daikin-vrv']);

  // The UNIT comes before the controller: a controller is part of the system
  // but it is not a picture of it.
  const fujitsu = equipmentImagesFor(lib, { brandName: 'Fujitsu', model: 'ARTG54LHTA' })
    .map(i => i.id);
  assert.deepEqual(fujitsu, ['fujitsu-outdoor', 'fujitsu-controller']);

  // A brand with no photograph gets none, rather than somebody else's unit.
  assert.deepEqual(equipmentImagesFor(lib, { brandName: 'Braemar',
                                             model: 'KDHV160D1S' }), []);

  // Case and spacing are noise; identity is not.
  assert.equal(equipmentImagesFor(lib, { brandName: ' daikin ' }).length, 2);
  assert.equal(equipmentImagesFor(lib, { brand: 'DAIKIN' }).length, 2);

  // Nothing is matched on nothing.
  const anonymous = [image('mystery', IMAGE_ROLES.EQUIPMENT, [], { equipmentBrand: '' })];
  assert.deepEqual(equipmentImagesFor(anonymous, { brandName: 'Daikin' }), []);
  assert.deepEqual(equipmentImagesFor(lib, { model: 'FDYAN160AV1' }), [],
    'a quote with no brand matched a photograph on nothing');
});

test('model matching ignores case and punctuation but not identity', () => {
  const lib = [image('a', IMAGE_ROLES.EQUIPMENT, ['fdyan-160 av1'])];
  assert.equal(equipmentImagesFor(lib, { model: 'FDYAN160AV1' }).length, 1,
    'a hyphen in the typed model lost the photograph');
  assert.equal(equipmentImagesFor(lib, { model: 'FDYAN100AV1' }).length, 0,
    '160 and 100 are different machines');
});

test('an unapproved or installation-role photo is never offered as equipment', () => {
  const unapproved = [normaliseImageAsset({ ...image('x', IMAGE_ROLES.EQUIPMENT, ['FDYAN160AV1']),
    approved: false })];
  assert.deepEqual(equipmentImagesFor(unapproved, DAIKIN), []);

  const withExif = [normaliseImageAsset({ ...image('y', IMAGE_ROLES.EQUIPMENT, ['FDYAN160AV1']),
    exifStripped: false })];
  assert.deepEqual(equipmentImagesFor(withExif, DAIKIN), [],
    'an image that still carries its metadata reached a customer page');

  const wrongRole = [image('z', IMAGE_ROLES.INSTALLATION, ['FDYAN160AV1'])];
  assert.deepEqual(equipmentImagesFor(wrongRole, DAIKIN), []);
});

// ── THE REQUEST LIST ────────────────────────────────────────────────────────

test('an empty library cannot issue, and says exactly why', () => {
  const r = assetRequest({}, { unit: DAIKIN });
  assert.equal(r.canIssue, false);

  const ids = r.essential.map(x => x.id);
  for (const must of ['logo', 'warranty', 'licence:arc']) {
    assert.ok(ids.includes(must), 'nothing asked for ' + must);
  }
  // The ELECTRICAL licence is outstanding, not blocking. Nick, 16 October
  // 2026: "Leave licence number out for now until I have it." The publish gate
  // already treats it that way — a CHECK, not a blocker — so listing it as
  // essential made this list stricter than the system it describes.
  assert.ok(!ids.includes('licence:electrical'),
    'the electrical licence is blocking again');
  const outstanding = r.optional.find(x => x.id === 'licence:electrical');
  assert.ok(outstanding, 'the electrical licence stopped being mentioned at all');
  // Still said, and said with the reason: NAC's own terms promise it.
  assert.match(outstanding.why, /17\.2/);
  // THE TERMS ARE NOT ON THAT LIST, and that is correct: an empty library is
  // still seeded with NAC's own Terms and Conditions of Trade, so a proposal
  // issued before anybody opens the library still shows the customer what they
  // are accepting. What is asked for instead is that somebody CONFIRM them.
  assert.ok(!ids.includes('terms'), 'asked for terms that are seeded and present');
  assert.ok(r.optional.some(x => x.id === 'terms:confirm'),
    'nobody was asked to confirm the seeded terms are current');
  // Every entry says what it is, why, where it appears and how to supply it.
  for (const x of r.needs) {
    assert.ok(x.what && x.what.length > 5, JSON.stringify(x));
    assert.ok(x.why && x.why.length > 20, x.id + ' gives no reason');
    assert.ok(x.where && x.where.length > 5, x.id + ' does not say where it appears');
    assert.ok(x.association, x.id + ' does not say how to supply it');
  }
});

test('the equipment request asks for the BRAND, which is what matching needs', () => {
  // It used to ask for a photograph of FDYAN160AV1 and RZA160C2V1, which sent
  // Nick looking for a compliance plate when a photograph of the machine would
  // do. Matching falls back to the brand, so the brand is what is missing.
  const r = assetRequest({}, { unit: DAIKIN });
  const eq = r.optional.find(x => x.id.startsWith('equipment:'));
  assert.ok(eq, 'no equipment photograph was asked for');
  assert.match(eq.what, /Daikin/);
  assert.match(eq.association, /Brand shown/);
  assert.match(eq.association, /model is optional/i);
  // And it says what the page does meanwhile, rather than leaving a hole.
  assert.match(eq.why, /branded panel|hidden/i);

  // A library with a Daikin photograph in it is not asked for one.
  const have = { images: [image('d', IMAGE_ROLES.EQUIPMENT, [],
    { equipmentBrand: 'Daikin', tags: ['daikin', 'outdoor'] })] };
  assert.ok(!assetRequest(have, { unit: DAIKIN }).needs.some(x => x.id.startsWith('equipment:')),
    'asked for a photograph of a brand already on file');

  // But a Braemar quote against that same library still is.
  const braemar = assetRequest(have, { unit: { brandName: 'Braemar', model: 'KDHV160D1S' } });
  const ask = braemar.optional.find(x => x.id.startsWith('equipment:'));
  assert.ok(ask, 'a Braemar quote with no Braemar photograph asked for nothing');
  assert.match(ask.what, /Braemar/);
});

test('an unrated review is asked for as a RATING, not as another review', () => {
  // NAC's own file: twelve real reviews, none with a star rating, because
  // Google's notification emails do not carry one.
  const content = { reviews: [
    { id: 'a', displayName: 'Christopher Trench', text: 'They replaced an ageing ducted system.',
      rating: null, approved: false, permissionStatus: 'public_source', source: 'google' },
    { id: 'b', displayName: 'Cheryl Judge', text: 'Very happy with the service, very professional.',
      rating: null, approved: false, permissionStatus: 'public_source', source: 'google' },
    { id: 'c', displayName: 'jen', text: 'Really great service, short wait time to come out.',
      rating: null, approved: false, permissionStatus: 'public_source', source: 'google' }
  ] };
  const r = assetRequest(content, { unit: DAIKIN });
  const rev = r.needs.find(x => x.id === 'reviews');
  assert.ok(rev);
  assert.match(rev.what, /star rating/i);
  assert.match(rev.why, /no alt text|not in them/i);
  assert.match(rev.association, /Business Profile/i);
  // It must NOT ask for more reviews — there are plenty, they just cannot
  // publish yet, and "send us three more reviews" would be the wrong job.
  assert.ok(!/more approved review/i.test(rev.what), 'asked for reviews instead of ratings');
});

test('a complete library can issue, and asks for nothing essential', () => {
  const content = {
    logo: 'data:image/jpeg;base64,/9j/',
    termsAndConditions: 'NAC Terms and Conditions of Trade v1.0',
    aftercare: { servicing: 'Annual', filterCare: 'Three-monthly', support: 'Call us' },
    // The names the library actually uses. See the field-name test below: the
    // warranty wording lives on the TRUST record, not in a `warranty` object,
    // because there has never been one.
    trust: { electricalLicence: '86420', arcAuthorisation: 'AU00000',
             workmanshipWarranty: '5 years on our installation workmanship.',
             manufacturerWarranty: 'The manufacturer\u2019s warranty, in full.' },
    images: [], reviews: [], installations: []
  };
  const r = assetRequest(content, { unit: DAIKIN });
  assert.equal(r.canIssue, true, JSON.stringify(r.essential));
  assert.equal(r.essential.length, 0);
  // Optional things are still listed — the proposal is sendable and thinner.
  assert.ok(r.optional.length > 0);
  assert.equal(r.have.terms, true);
  assert.equal(r.have.termsConfirmedInLibrary, true);
  assert.equal(r.have.workmanshipWarranty, true);
  assert.equal(r.have.manufacturerWarranty, true);
});

test('what is already there is not asked for again', () => {
  const content = {
    logo: 'data:image/jpeg;base64,/9j/',
    images: [image('e1', IMAGE_ROLES.EQUIPMENT, ['FDYAN160AV1'])]
  };
  const r = assetRequest(content, { unit: DAIKIN });
  assert.ok(!r.needs.some(x => x.id === 'logo'), 'asked for a logo that is on file');
  assert.ok(!r.needs.some(x => x.id.startsWith('equipment:')),
    'asked for a photograph of a model that already has one');
});

// ── THE ONE THAT WOULD HAVE CAUGHT IT ───────────────────────────────────────

test('the request list reads the field names the library actually has', () => {
  // This check asked for `licenceNumber`, `arcticLicence` and `arcLicence`.
  // The trust record has `electricalLicence` and `arcAuthorisation` and has
  // never had any of the other three, so the check could not see a licence
  // that WAS on file and reported it missing — it asked Nick for an ARC
  // number the project had already been given.
  //
  // A request list that asks for something already supplied teaches whoever
  // reads it to ignore the list, which costs more than the one wrong line.
  const keys = Object.keys(EMPTY_TRUST);
  for (const k of ['electricalLicence', 'arcAuthorisation']) {
    assert.ok(keys.includes(k), 'the trust record no longer has ' + k);
  }

  // A trust record carrying BOTH licences asks for neither.
  const both = assetRequest({ trust: { electricalLicence: '86420',
                                       arcAuthorisation: 'AU64234' } }, {});
  assert.ok(!both.needs.some(x => x.id.startsWith('licence:')),
    'asked for a licence that is on file: '
    + both.needs.filter(x => x.id.startsWith('licence:')).map(x => x.what).join(', '));

  // One on file, one not, is reported as exactly that — not as "licences".
  const arcOnly = assetRequest({ trust: { arcAuthorisation: 'AU64234' } }, {});
  const askedFor = arcOnly.needs.filter(x => x.id.startsWith('licence:')).map(x => x.id);
  assert.deepEqual(askedFor, ['licence:electrical'],
    'with the ARC authorisation on file, only the electrical licence is outstanding');
  // And it does not stop a quote going out.
  assert.ok(!arcOnly.essential.some(x => x.id.startsWith('licence:')));
  assert.equal(arcOnly.have.arcAuthorisation, 'AU64234');
  assert.equal(arcOnly.have.electricalLicence, false);
});

test('NAC\'s seeded credentials carry the ARC authorisation Nick confirmed', () => {
  // Nick, 16 October 2026: "Arc is AU:64234". The stored form carries no
  // colon; the digits are the ones he gave.
  assert.equal(NAC_TRUST.arcAuthorisation, 'AU64234');
  assert.match(NAC_TRUST.arcAuthorisation, /^AU\d+$/);
  // And the electrical licence is still blank, deliberately — a blank licence
  // keeps blocking, and the one thing worse than a missing licence number on a
  // quote is an invented one.
  assert.equal(NAC_TRUST.electricalLicence || '', '');

  const r = assetRequest({ trust: { ...NAC_TRUST } }, {});
  assert.ok(!r.needs.some(x => x.id === 'licence:arc'));
  assert.ok(r.needs.some(x => x.id === 'licence:electrical'));
  // Blank, and left out of the customer page rather than filled with
  // something that looks like a licence.
  assert.ok(!r.essential.some(x => x.id === 'licence:electrical'));
});

test('the warranty wording is read off the trust record, where it lives', () => {
  // There has never been a `content.warranty` object. This asked for
  // `warranty.equipment` and `warranty.labour`, found nothing, and reported
  // NAC's warranty missing while both halves of it sat on the trust record —
  // taken from clauses of NAC's own Terms.
  assert.ok(NAC_TRUST.workmanshipWarranty.length > 40);
  assert.ok(NAC_TRUST.manufacturerWarranty.length > 40);
  const r = assetRequest({ trust: { ...NAC_TRUST } }, {});
  assert.ok(!r.needs.some(x => x.id === 'warranty'),
    'asked for a warranty that is on file');
  assert.ok(!r.needs.some(x => x.id === 'warranty:half'));

  // Half of it is reported as half, not as none.
  const half = assetRequest({ trust: { workmanshipWarranty: 'five years' } }, {});
  assert.ok(!half.needs.some(x => x.id === 'warranty'));
  const only = half.needs.find(x => x.id === 'warranty:half');
  assert.ok(only);
  assert.match(only.why, /manufacturer one is not/);
});
