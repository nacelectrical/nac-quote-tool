// ─────────────────────────────────────────────────────────────────────────────
// PICTURES, BESIDE THE THING THEY ARE OF
//
// Nick, 5 November 2026: "I want to have pictures of our installs in also as
// well as unit pic next to each option. And Airtouch pictures next to Airtouch
// option, sensor next to sensor option."
//
// Three asks, three mechanisms, and one rule running through all of them: a
// photograph appears because NAC said what it is OF, never because it looked
// close enough. A lookalike beside a price is a product claim.
//
// Every photograph here is NAC's own, out of designer/content/nac-images.json.
// ─────────────────────────────────────────────────────────────────────────────

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ownWorkGallery, upgradeImageFor, optionImageFor, normaliseImageAsset }
  from '../designer/engines/presentation-content.mjs';
import { loadNacImages } from '../tools/import-nac-photos.mjs';
import { buildTestQuote } from '../tools/quote-only-proof.mjs';
import { renderPresentationHtml } from '../designer/ui/presentation-html.mjs';
import { presentationPrintHtml } from '../designer/ui/presentation-pdf.mjs';

const IMAGES = loadNacImages({ inline: true }).images;

const AIRTOUCH = { id: 'at5', title: 'AirTouch 5 smart control',
  description: 'Colour touchscreen, phone app control, each zone to its own temperature.' };
const SENSORS = { id: 'sensor', title: 'Room temperature sensors',
  description: 'A sensor in the rooms you choose, so the system holds that room to '
    + 'its setpoint rather than the hallway’s.' };

// ── PICTURES OF NAC'S OWN WORK ──────────────────────────────────────────────

test('NAC’s nine photographs are marked as NAC’s own work', () => {
  assert.equal(IMAGES.length, 9);
  for (const i of IMAGES) {
    assert.equal(normaliseImageAsset(i).ownWork, true,
      i.id + ' is a photograph of a job NAC did and is not marked as one');
  }
});

test('the gallery is drawn from them', () => {
  const g = ownWorkGallery(IMAGES, { max: 6 });
  assert.equal(g.length, 6);
  for (const one of g) {
    assert.ok(one.cover.src, one.id + ' has no usable image');
    assert.ok(one.caption.length > 20,
      'the caption is the description already written for the photograph');
  }
});

test('a photograph nobody marked as NAC’s work is not in the gallery', () => {
  // A manufacturer's stock shot is a picture of the same machine and not a
  // picture of NAC's work, and a gallery headed "our installations" must not
  // carry one.
  const stock = IMAGES.map(i => ({ ...i, ownWork: false }));
  assert.deepEqual(ownWorkGallery(stock), []);
});

test('the logo and the cover photograph are never gallery entries', () => {
  const odd = [
    { ...IMAGES[0], id: 'logo', role: 'logo', ownWork: true },
    { ...IMAGES[1], id: 'hero', role: 'hero', ownWork: true }
  ];
  assert.deepEqual(ownWorkGallery(odd).map(g => g.id), []);
});

// ── THE UNIT, BESIDE THE OPTION ─────────────────────────────────────────────

test('each option gets a photograph of ITS brand, not the other one’s', () => {
  const daikin = optionImageFor(IMAGES,
    { brand: 'Daikin', brandId: 'daikin', model: 'FDYAN160AV1' });
  const braemar = optionImageFor(IMAGES,
    { brand: 'Braemar', brandId: 'braemar', model: 'KDHV160D1S' });
  assert.ok(/daikin/.test(daikin.id), 'the Daikin option got ' + daikin.id);
  assert.ok(/braemar/.test(braemar.id), 'the Braemar option got ' + braemar.id);
  assert.notEqual(daikin.id, braemar.id);
});

test('a brand NAC has no photograph of gets no photograph', () => {
  assert.equal(optionImageFor(IMAGES,
    { brand: 'Some Other Brand', brandId: 'someother', model: 'XYZ-1' }), null);
});

test('a picture NAC set on the option itself wins', () => {
  const chosen = optionImageFor(IMAGES, {
    brand: 'Daikin', brandId: 'daikin', model: 'FDYAN160AV1',
    image: { src: 'https://example.test/our-own.jpg', alt: 'The actual unit' }
  });
  assert.equal(chosen.src, 'https://example.test/our-own.jpg');
});

test('a src the page could not load is refused rather than rendered broken', () => {
  for (const bad of ['media/local.jpg', 'http://insecure.test/x.jpg',
                     'javascript:alert(1)', '']) {
    const r = optionImageFor([], { brand: 'Nobody', image: { src: bad } });
    assert.equal(r, null, bad + ' was accepted as an option picture');
  }
});

// ── THE AIRTOUCH BESIDE THE AIRTOUCH, THE SENSOR BESIDE THE SENSOR ─────────

test('the AirTouch upgrade gets the AirTouch console', () => {
  const img = upgradeImageFor(IMAGES, AIRTOUCH);
  assert.ok(img, 'no picture was matched at all');
  assert.equal(img.id, 'airtouch-console-4-zone');
  assert.match(img.alt, /AirTouch wall console/);
});

test('the sensors upgrade gets the console showing sensors, not the other one', () => {
  const img = upgradeImageFor(IMAGES, SENSORS);
  assert.ok(img, 'no picture was matched at all');
  assert.equal(img.id, 'airtouch-console-5-zone-sensors',
    'the sensors line took the console with no sensors on it');
  assert.notEqual(img.id, upgradeImageFor(IMAGES, AIRTOUCH).id,
    'both upgrades took the same photograph');
});

test('an upgrade NAC has no picture of gets none, rather than the nearest thing', () => {
  for (const u of [{ id: 'x', title: 'Extended warranty' },
                   { id: 'y', title: 'Annual service plan' },
                   { id: 'z', title: '' }]) {
    assert.equal(upgradeImageFor(IMAGES, u), null,
      '"' + u.title + '" was given a photograph of something else');
  }
});

test('NAC naming the picture wins outright', () => {
  const img = upgradeImageFor(IMAGES, { ...SENSORS, imageId: 'airtouch-console-4-zone' });
  assert.equal(img.id, 'airtouch-console-4-zone');
});

test('a named picture that is not there is not quietly replaced by a guess', () => {
  // NAC asked for that photograph. Substituting another one silently is how a
  // customer ends up looking at the wrong machine.
  assert.equal(upgradeImageFor(IMAGES, { ...AIRTOUCH, imageId: 'does-not-exist' }), null);
});

test('an unapproved photograph is never offered', () => {
  const unapproved = IMAGES.map(i => ({ ...i, approved: false }));
  assert.equal(upgradeImageFor(unapproved, AIRTOUCH), null);
  assert.equal(optionImageFor(unapproved, { brand: 'Daikin', brandId: 'daikin' }), null);
  assert.deepEqual(ownWorkGallery(unapproved), []);
});

// ── ALL THREE, ON THE PAGE A CUSTOMER READS ────────────────────────────────

const { built } = buildTestQuote();
assert.ok(built.ok);
const P = built.presentation;
const HTML = renderPresentationHtml(P);
const PRINT = presentationPrintHtml(P);

/**
 * The document without its own stylesheet and script.
 *
 * Searching the whole file for a word finds it in the page's CSS rule names
 * and in its inline JavaScript — `e.button !== undefined` is not "undefined
 * reached the customer page", and a `.shot-btn` style rule is not a button.
 * A check that cannot tell those apart fails on the wrong thing and teaches
 * you to loosen it.
 */
const markup = (doc) => doc
  .replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/<style[\s\S]*?<\/style>/gi, '');
const WEB_MARKUP = markup(HTML);
const PRINT_MARKUP = markup(PRINT);

test('the gallery of NAC’s work is a section on the proposal', () => {
  assert.equal(P.installations.length, 6);
  assert.ok(/<section class="sec" id="work"/.test(HTML),
    'the installations section is not on the page');
  assert.ok(HTML.includes('Recent NAC installations'));
  // And on paper.
  assert.ok(/<section class="sec" id="work"/.test(PRINT));
});

test('a gallery entry drawn from a photograph prints no empty heading', () => {
  assert.ok(P.installations.every(g => g.fromPhoto === true));
  assert.ok(!/<h3><\/h3>/.test(WEB_MARKUP), 'an empty heading was printed');
  assert.ok(!/undefined/.test(WEB_MARKUP), '"undefined" reached the customer page');
});

test('the printed gallery has no lightbox button, because paper has no lightbox', () => {
  assert.ok(WEB_MARKUP.includes('shot-btn'), 'the web page should open a larger image');
  assert.ok(!PRINT_MARKUP.includes('shot-btn'), 'a lightbox button reached the paper');
  assert.ok(!PRINT_MARKUP.includes('<button'), 'a control reached the printed document');
  // The photograph itself is still there — the button went, not the picture.
  assert.ok((PRINT_MARKUP.match(/class="shot"/g) || []).length === 6);
});

test('both options carry their own unit picture on the page', () => {
  const opts = P.systemChoice.options;
  assert.equal(opts.length, 2);
  for (const o of opts) {
    assert.ok(o.image && o.image.src, o.brand + ' has no picture');
  }
  assert.equal((HTML.match(/class="sys-img"/g) || []).length, 2);
});

test('both upgrades carry their own picture on the page', () => {
  const byId = Object.fromEntries(P.options.map(o => [o.id, o]));
  assert.equal(byId.at5.image.id, 'airtouch-console-4-zone');
  assert.equal(byId.sensor.image.id, 'airtouch-console-5-zone-sensors');
  assert.equal((HTML.match(/class="opt-img"/g) || []).length, 2);
  // Decorative: the title beside it already says what it is, and a screen
  // reader should not say it twice.
  assert.ok(/class="opt-img" aria-hidden="true"/.test(HTML));
});

test('none of this put a cost, a margin or a supplier on the page', () => {
  for (const doc of [WEB_MARKUP, PRINT_MARKUP]) {
    for (const leak of ['supplierCost', 'markupPct', 'marginPct', 'MMEM', 'ownWork']) {
      assert.ok(!doc.includes(leak), '"' + leak + '" reached a customer document');
    }
  }
});
