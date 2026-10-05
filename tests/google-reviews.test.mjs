// ─────────────────────────────────────────────────────────────────────────────
// NAC'S OWN GOOGLE REVIEWS
//
// The gap audit row read: "Genuine customer reviews — MISSING ENTIRELY.
// reviews = 0." designer/content/google-reviews.json closes it. Every review
// in that file was transcribed from a "New Google Review" notification in
// nick@nacelectrical.com.au, so the words, the spelling and the names are the
// customers' own.
//
// Nick: the AI must never invent a review, a name, a suburb or a rating.
//
// The notification emails render the star row as an image with no alt text, so
// the rating is NOT in them. Every review therefore ships with rating null,
// and these tests exist to prove that the shipped file cannot put an invented
// five stars on a customer quote: nothing in it is publishable until NAC types
// the real figure in.
//
// Nick: "Can you leave out reviews with my name in it?" Nine of the twelve
// name him. Those are held in `withheldByNac`, which the import does not read,
// so they cannot reach the library and cannot reach a quote. Three are
// quotable — which is exactly the minimum selectReviews() will show.
// ─────────────────────────────────────────────────────────────────────────────

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reviewPublishable, normaliseReview, publicReview, selectReviews, PERMISSION }
  from '../designer/engines/presentation-content.mjs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const DOC = JSON.parse(readFileSync(ROOT + '/designer/content/google-reviews.json', 'utf8'));

const ALL = [...DOC.reviews, ...DOC.withheldByNac];

test('every review carries a name, the customer\'s own words and a public source', () => {
  assert.ok(Array.isArray(DOC.reviews));
  assert.ok(Array.isArray(DOC.withheldByNac));
  assert.equal(ALL.length, 12, 'twelve notifications were found in Gmail');
  const ids = new Set();
  for (const r of ALL) {
    assert.ok(r.id && !ids.has(r.id), 'duplicate or missing id: ' + r.id);
    ids.add(r.id);
    assert.ok(r.displayName && r.displayName.trim(), r.id + ' has no name');
    assert.ok(r.text && r.text.trim().length > 20, r.id + ' has no review text');
    assert.equal(r.source, 'google');
    assert.equal(r.permissionStatus, PERMISSION.PUBLIC_SOURCE);
    // Month and year only, because that is all the notification carries.
    assert.match(r.reviewDate, /^20\d\d-(0[1-9]|1[0-2])$/, r.id + ' date: ' + r.reviewDate);
  }
});

test('no rating was invented, and no review was approved on NAC\'s behalf', () => {
  for (const r of ALL) {
    assert.equal(r.rating, null, r.id + ' carries a rating the email did not contain');
    assert.equal(r.approved, false, r.id + ' was approved without NAC saying so');
  }
});

test('nothing in the shipped file can reach a customer quote', () => {
  for (const r of ALL) {
    const v = reviewPublishable(normaliseReview(r));
    assert.equal(v.ok, false, r.id + ' is publishable with no rating and no approval');
    assert.ok(v.reasons.some(x => /Star rating must be 1 to 5/.test(x)), r.id);
    assert.ok(v.reasons.some(x => /Not approved/.test(x)), r.id);
  }
  // And the selector agrees: a quote built today shows no reviews rather than
  // showing them unrated.
  assert.deepEqual(selectReviews(ALL, {}), []);
});

test('not one quotable review names Nick', () => {
  assert.equal(DOC.reviews.length, 3, 'the three that do not name him');
  for (const r of DOC.reviews) {
    assert.ok(!/\bNick\b/.test(r.text), r.id + ' names Nick and is still quotable');
  }
  // Three is the floor. selectReviews() returns nothing below its minimum of
  // three, so withholding one more does not thin the section, it removes it.
  assert.ok(DOC.reviews.length >= 3,
    'below three reviews the section disappears entirely');

  assert.equal(DOC.withheldByNac.length, 9);
  for (const r of DOC.withheldByNac) {
    assert.ok(/\bNick\b/.test(r.text), r.id + ' was withheld but does not name him');
    assert.match(r.withheldReason, /Nick/, r.id + ' was withheld with no reason recorded');
  }

  // Held back, not thrown away: still verbatim, still a public source.
  for (const r of DOC.withheldByNac) {
    assert.equal(r.permissionStatus, PERMISSION.PUBLIC_SOURCE);
    assert.ok(r.text.trim().length > 20);
  }
});

test('the import loads only the quotable three', () => {
  const page = readFileSync(ROOT + '/quote-presentation.html', 'utf8');
  const fn = /async function importGoogleReviews\(\)[\s\S]*?\n}\n/.exec(page)[0];
  assert.match(fn, /doc\.reviews/, 'the import does not read the reviews list');
  assert.ok(!/withheldByNac/.test(fn.replace(/^\s*\*.*$/gm, '')),
    'the import reads the withheld list');
});

test('once NAC enters the real rating and approves, the words are passed through exactly', () => {
  const ready = ALL.map(r => normaliseReview({ ...r, rating: 5, approved: true }));
  for (let i = 0; i < ready.length; i++) {
    assert.equal(reviewPublishable(ready[i]).ok, true, ready[i].id + ' still withheld');
    const pub = publicReview(ready[i]);
    // Byte equality against the file. Not reworded, not trimmed, not ellipsised.
    assert.equal(pub.text, ALL[i].text, ready[i].id + ' text was altered');
    // Already published under that name on Google, so it shows as published.
    assert.equal(pub.name, ALL[i].displayName, ready[i].id + ' name was altered');
    // No suburb was recorded, so none is printed.
    assert.equal(pub.suburb, '');
  }
  const picked = selectReviews(ready, {});
  assert.equal(picked.length, 6, 'the quote shows up to six');
});

test('the admin screen can import them, and the import cannot approve or rate them', () => {
  const page = readFileSync(ROOT + '/quote-presentation.html', 'utf8');
  assert.match(page, /Import Google reviews/, 'the Reviews panel has no import button');
  assert.match(page, /google-reviews\.json/, 'the import reads no file');
  const fn = /async function importGoogleReviews\(\)[\s\S]*?\n}\n/.exec(page);
  assert.ok(fn, 'importGoogleReviews is missing');
  // The import forces approved false, and never writes a rating of its own.
  assert.match(fn[0], /approved:\s*false/, 'the import does not force approved false');
  assert.ok(!/rating:\s*[1-5]/.test(fn[0]), 'the import writes a star rating');
});
