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

import { ownWorkGallery, upgradeImageFor, optionImageFor, normaliseImageAsset,
         controllerImageFor }
  from '../designer/engines/presentation-content.mjs';
import { readFileSync } from 'node:fs';
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

test('NAC’s own photographs are marked as NAC’s own work', () => {
  // Nine of NAC's own work, plus seven manufacturer images: the room sensor,
  // a ducted set for each of five brands, and the Zonemaster wall panel.
  assert.equal(IMAGES.length, 16);
  const own = IMAGES.filter(i => normaliseImageAsset(i).ownWork === true);
  assert.equal(own.length, 9);
  for (const i of own) {
    assert.ok(/outdoor|console|controller/.test(i.id),
      i.id + ' is marked as NAC’s work and does not look like a job photograph');
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

// ── THE BRAND SET IMAGES NICK SUPPLIED ──────────────────────────────────────
//
// Nick, 5 November 2026: "Put these in the options for each brand", with a
// product set for each — the indoor fan coil, the outdoor unit and the
// controller, on white. They beat NAC's own photographs on the option, because
// an outdoor unit against a rendered wall does not show a customer what they
// are buying.

const SET_BRANDS = [
  ['Daikin', 'daikin', 'daikin-ducted-set'],
  ['Braemar', 'braemar', 'braemar-ducted-set'],
  ['Fujitsu', 'fujitsu', 'fujitsu-airstage-ducted-set'],
  ['Mitsubishi Electric', 'me', 'mitsubishi-electric-ducted-set'],
  ['Mitsubishi Heavy Industries', 'mhi', 'mitsubishi-heavy-ducted-set']
];

test('every brand Nick supplied a set for gets that set on its option', () => {
  for (const [brand, brandId, expected] of SET_BRANDS) {
    const img = optionImageFor(IMAGES, { brand, brandId, model: 'ANY-1' });
    assert.ok(img, brand + ' got no picture at all');
    assert.equal(img.id, expected, brand + ' got ' + img.id);
  }
});

test('MITSUBISHI ELECTRIC AND MITSUBISHI HEAVY INDUSTRIES ARE NOT THE SAME COMPANY', () => {
  // Two different manufacturers that both say "Mitsubishi" on the badge. A
  // customer quoted one of them must never be shown the other's machine, so
  // the match is on the brand exactly as it is named.
  const electric = optionImageFor(IMAGES,
    { brand: 'Mitsubishi Electric', brandId: 'me' });
  const heavy = optionImageFor(IMAGES,
    { brand: 'Mitsubishi Heavy Industries', brandId: 'mhi' });
  assert.notEqual(electric.id, heavy.id);
  assert.ok(/electric/.test(electric.id));
  assert.ok(/heavy/.test(heavy.id));

  // And a bare "Mitsubishi" is not enough to pick either. No picture is the
  // safe answer; a coin flip between two manufacturers is not.
  assert.equal(optionImageFor(IMAGES, { brand: 'Mitsubishi', brandId: 'mitsubishi' }),
    null, 'a bare "Mitsubishi" was matched to one of them');
});

test('a brand with no set image still gets nothing invented for it', () => {
  // Samsung is in NAC's catalogue and Nick supplied no set for it.
  assert.equal(optionImageFor(IMAGES, { brand: 'Samsung', brandId: 'samsung' }), null);
});

test('the set images are 4:3, which is the box the option renders in', () => {
  for (const [, , id] of SET_BRANDS) {
    const a = normaliseImageAsset(IMAGES.find(i => i.id === id));
    const d = a.derivatives[a.derivatives.length - 1];
    const ratio = d.width / d.height;
    assert.ok(Math.abs(ratio - 4 / 3) < 0.02,
      id + ' is ' + d.width + '×' + d.height + ' — the option box crops it');
  }
});

test('no set image is in the gallery of NAC’s own work', () => {
  // They are manufacturer product shots on white. The gallery is headed
  // "Recent NAC installations" and these are not installations.
  const gallery = ownWorkGallery(IMAGES, { max: 20 }).map(g => g.id);
  for (const [, , id] of SET_BRANDS) {
    assert.ok(!gallery.includes(id), id + ' reached the gallery of NAC’s own work');
  }
});

test('no set image carries a warranty badge into the page', () => {
  // Two of them arrived with a "5 YEARS WARRANTY" roundel. The warranty NAC
  // states on the option is the one that binds NAC, and a badge in a picture
  // that disagrees with the line beside it is what gets argued about later —
  // NAC quote the Braemar at seven.
  const doc = JSON.parse(readFileSync(
    new URL('../designer/content/nac-photos.json', import.meta.url), 'utf8'));
  const badged = doc.photos.filter(p => /ducted-set/.test(p.file)
    && /WARRANTY/i.test(p._provenance || ''));
  assert.equal(badged.length, 2, 'the two badged sets are not recorded as such');
  for (const p of badged) {
    assert.match(p._provenance, /removed/,
      p.file + ' records a warranty badge and does not say it was removed');
  }
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

test('the sensors upgrade gets the sensor, not a console', () => {
  // Nick, 5 November 2026: "Just need Airtouch sensor pic replaced." The
  // sensors line showed a photograph of a wall console that happens to have
  // sensors configured on it. It shows the sensor now.
  const img = upgradeImageFor(IMAGES, SENSORS);
  assert.ok(img, 'no picture was matched at all');
  assert.equal(img.id, 'airtouch-room-sensor');
  assert.notEqual(img.id, upgradeImageFor(IMAGES, AIRTOUCH).id,
    'both upgrades took the same photograph');
});

test('a tag matches a title that says the shorter word', () => {
  // A "controller" tag belongs to an upgrade titled "…smart control", and a
  // plain substring test gets that backwards: `'airtouchcontrol'.includes(
  // 'controller')` is false. The tag scored nothing, the AirTouch console lost
  // to a photograph of a sensor, and the sensor photograph took BOTH lines.
  const img = upgradeImageFor(IMAGES, AIRTOUCH);
  assert.equal(img.id, 'airtouch-console-4-zone',
    'the console lost its own line to another photograph');
});

test('the sensor photograph is not in the installations gallery', () => {
  // It is a manufacturer product image — the temperatures float over a styled
  // interior — so it is the right picture of the sensor and the wrong picture
  // for a gallery headed "Recent NAC installations".
  const sensor = IMAGES.find(i => i.id === 'airtouch-room-sensor');
  assert.ok(sensor, 'the sensor photograph is not in the library');
  assert.equal(normaliseImageAsset(sensor).ownWork, false);
  assert.ok(!ownWorkGallery(IMAGES, { max: 20 }).some(g => g.id === 'airtouch-room-sensor'),
    'a manufacturer image reached the gallery of NAC’s own work');
});

test('the sensor photograph is cropped to the sensor, not to the kitchen', () => {
  // The page crops it to a square beside the upgrade and object-fit takes the
  // middle unless told otherwise. The sensor is on the left of a wide shot, so
  // the middle is a picture of somebody else's kitchen.
  const sensor = normaliseImageAsset(IMAGES.find(i => i.id === 'airtouch-room-sensor'));
  assert.ok(sensor.focalPoint.x < 0.4,
    'the focal point is at ' + sensor.focalPoint.x + ', which crops the sensor out');
  // And the asset itself is cropped square, because a square thumbnail is the
  // only place it is ever used.
  const d = sensor.derivatives[0];
  assert.ok(d.width >= 400 && d.height >= 400,
    'the sensor photograph is ' + d.width + '×' + d.height
    + ', which is too small for the page to use');
  assert.ok(Math.abs(d.width - d.height) < 20,
    'the sensor photograph is ' + d.width + '×' + d.height
    + ' — a wide shot squeezed into a square box is a picture of the kitchen');
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
  assert.equal(byId.sensor.image.id, 'airtouch-room-sensor');
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

// ─────────────────────────────────────────────────────────────────────────────
// THE ZONE CONTROL, AND WHY THIS ONE IS MATCHED BY HAND
//
// Nick, 5 November 2026, sending a photograph of a Zonemaster six-zone wall
// panel on its own, straight after the exchange that made a Siemens kit the
// zone control in the price and the AirTouch the upgrade from it.
//
// The zones section named the part and showed nothing, so the one component
// the customer touches every day was the one thing on the proposal they could
// not picture. It shows a picture now — but ONLY the picture NAC picked, or
// one whose own brand is in the controller's name.
//
// The reason is the whole point of these checks. Every zone controller ever
// made is named with the words "zone" and "control". Score a library on those
// and a Zonemaster panel matches "Siemens Home zone control — 6 zone" with
// room to spare, and a customer buying a Siemens kit is shown a photograph of
// another manufacturer's part, beside its price, on the page they sign.
//
// NAC's price list records the zone kits as Siemens — MMASEM4ZTPKIT,
// MMASEM6ZTPKIT, MMASEM8ZTPKIT — and NOTHING anywhere says a Zonemaster panel
// is the plate that ships with them. So the library holds the photograph and
// the matcher refuses to make that claim on its own.
// ─────────────────────────────────────────────────────────────────────────────

test('THE SIEMENS KIT GETS NO PICTURE ON ITS OWN, AND THAT IS THE CHECK', () => {
  // The quote's actual zone control. There is a Zonemaster panel in the
  // library, a Fujitsu wall controller and two AirTouch consoles, and the
  // honest answer is none of them.
  const got = controllerImageFor(IMAGES,
    { name: 'Siemens Home zone control — 6 zone' });
  assert.equal(got, null, 'a Siemens line was given somebody else’s panel');
});

test('a controller whose own name carries the brand gets that brand’s picture', () => {
  const zm = controllerImageFor(IMAGES, { name: 'Zonemaster 6 zone wall panel' });
  assert.ok(zm, 'the Zonemaster panel was not matched to a Zonemaster controller');
  assert.equal(zm.id, 'zonemaster-6-zone-wall-panel');

  // And the AirTouch console, not the AirTouch room sensor: both are AirTouch,
  // and the console is the one tagged as the controller.
  const at = controllerImageFor(IMAGES, { name: 'AirTouch 5 zone control' });
  assert.ok(at, 'no AirTouch picture for an AirTouch controller');
  assert.match(at.id, /console/);
});

test('NAC naming the picture wins, and it is the only way onto a Siemens line', () => {
  const got = controllerImageFor(IMAGES,
    { name: 'Siemens Home zone control — 6 zone',
      imageId: 'zonemaster-6-zone-wall-panel' });
  assert.ok(got, 'the chosen picture did not appear');
  assert.equal(got.id, 'zonemaster-6-zone-wall-panel');
  assert.ok(got.alt && /Zonemaster/.test(got.alt), 'no alt text travelled');
});

test('a chosen picture that is not publishable shows none, not the nearest thing', () => {
  assert.equal(controllerImageFor(IMAGES,
    { name: 'Zonemaster 6 zone wall panel', imageId: 'no-such-picture' }), null);

  // Unapproved is not publishable either, and "Zonemaster" in the name would
  // otherwise have matched it.
  const unapproved = IMAGES.map(i =>
    /zonemaster/.test(i.id) ? { ...i, approved: false } : i);
  assert.equal(controllerImageFor(unapproved,
    { name: 'Zonemaster 6 zone wall panel' }), null);
});

test('an unnamed controller is not matched to anything', () => {
  assert.equal(controllerImageFor(IMAGES, {}), null);
  assert.equal(controllerImageFor(IMAGES, { name: '   ' }), null);
});

test('the chosen picture reaches the customer page, with its description', () => {
  // The real path: the draft carries the id, draftToQuoteSource carries it to
  // the quote source, the presentation resolves it against the library and the
  // page renders it.
  const { built } = buildTestQuote({}, {
    controller: { id: 'siemens_z6', name: 'Siemens Home zone control — 6 zone',
                  zoneCount: 6, includedInPrice: true,
                  imageId: 'zonemaster-6-zone-wall-panel' }
  });
  assert.equal(built.ok, true,
    'blocked: ' + JSON.stringify((built.blockers || []).map(b => b.code)));
  const p = built.presentation;
  assert.ok(p.zones.controllerImage, 'the zones section carries no picture');
  assert.equal(p.zones.controllerImage.id, 'zonemaster-6-zone-wall-panel');

  const html = markup(renderPresentationHtml(p, { token: 'T' }));
  const zones = html.slice(html.indexOf('id="zones"'), html.indexOf('id="coverage"'));
  assert.match(zones, /class="ctrl-img"/, 'no picture in the zones section');
  // ALT TEXT, not aria-hidden. Unlike the upgrade thumbnails, nothing beside
  // this says what the panel looks like, so the description is the only way a
  // screen reader conveys it.
  assert.match(zones, /alt="A Zonemaster six-zone wall panel/);
  assert.ok(!/ctrl-img[\s\S]{0,200}aria-hidden/.test(zones),
    'the only description of the panel was hidden from a screen reader');
  // The part is still named. The picture is beside the words, not instead.
  assert.match(zones, /Siemens Home zone control/);

  // And it prints. A photograph that only appears when somebody scrolls past
  // it is a photograph that is missing from the PDF.
  const printed = markup(presentationPrintHtml(p));
  const pz = printed.slice(printed.indexOf('id="zones"'), printed.indexOf('id="coverage"'));
  assert.match(pz, /class="ctrl-img"/);
  assert.ok(!/ctrl-img[\s\S]{0,400}loading="lazy"/.test(pz),
    'the panel is lazy-loaded in a document nobody scrolls');
});

test('the shipped test quote shows NO zone-control picture, because none is paired', () => {
  // Deliberate, and worth pinning so nobody "fixes" it later. The fixture's
  // zone control is a Siemens kit and NAC has no photograph of one. Until Nick
  // confirms which plate ships with his Siemens kits, the proposal names the
  // part and shows nothing — which is the truth.
  assert.equal(P.zones.controllerImage, null);
  const zones = WEB_MARKUP.slice(WEB_MARKUP.indexOf('id="zones"'),
    WEB_MARKUP.indexOf('id="coverage"'));
  assert.ok(!/ctrl-img/.test(zones), 'a zone-control picture appeared unpaired');
  assert.ok(!/zonemaster/i.test(WEB_MARKUP),
    'the Zonemaster panel reached a Siemens quote');
});
