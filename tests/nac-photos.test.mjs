// ─────────────────────────────────────────────────────────────────────────────
// NAC'S OWN PHOTOGRAPHS
//
// Nick supplied seven on 15 October 2026 — four outdoor units, two AirTouch
// consoles and a Fujitsu wall controller. Unlike everything in tests/fixtures,
// these are real.
//
// TWO THINGS THIS FILE EXISTS TO HOLD.
//
// 1. NO MODEL IS GUESSED. The compliance plate is not legible in any of them.
//    equipmentImagesFor() matches on the model and only on the model, so a
//    guess would put a photograph of the wrong machine beside somebody's
//    quote — the one thing a picture on a proposal must never do. Every
//    `equipmentModels` is empty until Nick fills it from the job, and an empty
//    one is never offered as a photograph of anything.
//
// 2. THEY ARE NOT APPROVED BY THE IMPORT. Approval is NAC's act, here as
//    everywhere else in the library.
//
// The metadata stripping is measured in a real browser rather than asserted
// here, because the strip is a canvas re-encode and there is no canvas in
// node. tools/browser-tests/ and the proof script do that; what this checks is
// that the manifest cannot quietly start claiming things.
// ─────────────────────────────────────────────────────────────────────────────

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { equipmentImagesFor, normaliseImageAsset, IMAGE_ROLES }
  from '../designer/engines/presentation-content.mjs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const DOC = JSON.parse(readFileSync(ROOT + '/designer/content/nac-photos.json', 'utf8'));

test('every photograph in the manifest is actually in the repository', () => {
  assert.equal(DOC.photos.length, 7);
  for (const p of DOC.photos) {
    const full = ROOT + '/designer/content/' + p.file;
    assert.ok(existsSync(full), p.file + ' is listed and not present');
    assert.ok(statSync(full).size > 50000, p.file + ' is too small to be a photograph');
    assert.ok(p.alt && p.alt.length > 25, p.file + ' has no usable alt text');
    // `seen` is what is actually visible in the frame. It is the evidence for
    // the alt text and the brand, and it is how somebody checks this later.
    assert.ok(p.seen && p.seen.length > 40, p.file + ' records nothing about what is in it');
  }
});

test('not one model number was guessed', () => {
  for (const p of DOC.photos) {
    assert.ok(Array.isArray(p.equipmentModels), p.file);
    assert.equal(p.equipmentModels.length, 0,
      p.file + ' carries a model that nobody could read off the plate');
  }
  // And the file says why, so the next person does not helpfully fill them in
  // from the brand.
  assert.match(DOC._models, /not legible/i);
  assert.match(DOC._models, /matches on the model/i);
});

test('a photograph with no model is never offered as a photograph of one', () => {
  const assets = DOC.photos.map(p => normaliseImageAsset({
    id: p.file, alt: p.alt, role: p.role, equipmentBrand: p.equipmentBrand,
    equipmentModels: p.equipmentModels, approved: true,
    exifStripped: true, gpsRemoved: true,
    derivatives: [{ ref: 'https://cdn.example/' + p.file, width: 1600, height: 2133,
                    format: 'jpeg', bytes: 400000 }]
  }));
  // Four of these ARE Daikin outdoor units. A Daikin quote still gets none of
  // them, because none says WHICH Daikin.
  assert.deepEqual(equipmentImagesFor(assets, { model: 'FDYAN160AV1', brandName: 'Daikin' }), []);
  assert.deepEqual(equipmentImagesFor(assets, { model: 'RZA160C2V1', brandName: 'Daikin' }), []);

  // Once Nick records the model on one, that one appears — and only that one.
  const tagged = assets.map(a => a.id === 'photos/daikin-r32-outdoor-twin-fan.jpg'
    ? { ...a, equipmentModels: ['RZA160C2V1'] } : a);
  const got = equipmentImagesFor(tagged, { model: 'RZA160C2V1' });
  assert.equal(got.length, 1);
  assert.equal(got[0].id, 'photos/daikin-r32-outdoor-twin-fan.jpg');
});

test('the privacy note is a measurement, not a reassurance', () => {
  // It says what was checked and what was found, and it does not claim the
  // files in the repository are already clean — they are re-encoded on import.
  assert.match(DOC._privacy, /GPS/);
  assert.match(DOC._privacy, /re-encoded/i);
  assert.match(DOC._privacy, /measured|shown/i);
});

test('the import cannot approve a photograph or write a model', () => {
  const page = readFileSync(ROOT + '/quote-presentation.html', 'utf8');
  const fn = /async function importNacPhotos\(\)[\s\S]*?\n}\n/.exec(page);
  assert.ok(fn, 'importNacPhotos is missing');
  assert.match(fn[0], /approved\s*=\s*false/, 'the import approves images on NAC\'s behalf');
  assert.match(fn[0], /equipmentModels\s*=\s*\[\]/, 'the import writes models');
  // It goes through uploadOne, which is where the re-encode happens. Importing
  // any other way would put the one image in the library that had never been
  // through the strip.
  assert.match(fn[0], /uploadOne\(/, 'the import bypasses the upload path');
});

test('none of them is the cover photograph that is still missing', () => {
  // Every one is portrait. The cover wants one wide landscape shot, so the
  // asset request must go on asking for it rather than quietly using one of
  // these sideways.
  assert.match(DOC._orientation, /PORTRAIT/);
  assert.match(DOC._orientation, /landscape/i);
});
