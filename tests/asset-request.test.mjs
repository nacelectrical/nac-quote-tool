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
import { equipmentImagesFor, normaliseImageAsset, IMAGE_ROLES }
  from '../designer/engines/presentation-content.mjs';

const image = (id, role, models, extra = {}) => normaliseImageAsset({
  id, alt: id, role, equipmentModels: models, approved: true,
  exifStripped: true, gpsRemoved: true,
  derivatives: [{ ref: 'https://cdn.example/' + id + '.jpg', width: 800, height: 600,
                  format: 'jpeg', bytes: 90000 }],
  ...extra
});

const DAIKIN = { model: 'FDYAN160AV1', outdoorModel: 'RZA160C2V1', brandName: 'Daikin' };

// ── THE PHOTOGRAPH HAS TO BE OF THE RIGHT MACHINE ───────────────────────────

test('an equipment photo is matched on the model, never on the brand', () => {
  const lib = [
    image('indoor', IMAGE_ROLES.EQUIPMENT, ['FDYAN160AV1']),
    image('outdoor', IMAGE_ROLES.EQUIPMENT, ['RZA160C2V1']),
    // Same brand, completely different machine.
    image('wall-split', IMAGE_ROLES.EQUIPMENT, ['FTXM35R']),
    image('ceiling', IMAGE_ROLES.INSTALLATION, ['FDYAN160AV1'])
  ];
  const got = equipmentImagesFor(lib, DAIKIN).map(i => i.id);
  assert.deepEqual(got, ['indoor', 'outdoor']);

  // A Braemar quote gets nothing rather than the Daikin that looks similar.
  assert.deepEqual(equipmentImagesFor(lib, { model: 'KDHV160D1S' }), []);
  // And a quote with no unit on it gets nothing at all.
  assert.deepEqual(equipmentImagesFor(lib, {}), []);
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
  for (const must of ['logo', 'terms', 'warranty', 'licences']) {
    assert.ok(ids.includes(must), 'nothing asked for ' + must);
  }
  // Every entry says what it is, why, where it appears and how to supply it.
  for (const x of r.needs) {
    assert.ok(x.what && x.what.length > 5, JSON.stringify(x));
    assert.ok(x.why && x.why.length > 20, x.id + ' gives no reason');
    assert.ok(x.where && x.where.length > 5, x.id + ' does not say where it appears');
    assert.ok(x.association, x.id + ' does not say how to supply it');
  }
});

test('the equipment request names the models, not "a photo of the unit"', () => {
  const r = assetRequest({}, { unit: DAIKIN });
  const eq = r.optional.find(x => x.id.startsWith('equipment:'));
  assert.ok(eq, 'no equipment photograph was asked for');
  assert.match(eq.what, /FDYAN160AV1/);
  assert.match(eq.what, /RZA160C2V1/);
  assert.match(eq.association, /FDYAN160AV1/);
  // And it says what happens meanwhile, rather than leaving a hole.
  assert.match(eq.why, /hidden|misled/i);
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
    warranty: { equipment: '5 years manufacturer', labour: '2 years NAC workmanship' },
    aftercare: { servicing: 'Annual', filterCare: 'Three-monthly', support: 'Call us' },
    trust: { licenceNumber: '86420', arcLicence: 'AU00000' },
    images: [], reviews: [], installations: []
  };
  const r = assetRequest(content, { unit: DAIKIN });
  assert.equal(r.canIssue, true, JSON.stringify(r.essential));
  assert.equal(r.essential.length, 0);
  // Optional things are still listed — the proposal is sendable and thinner.
  assert.ok(r.optional.length > 0);
  assert.equal(r.have.terms, true);
  assert.equal(r.have.warranty, true);
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
