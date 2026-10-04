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
// ─────────────────────────────────────────────────────────────────────────────

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reviewPublishable, normaliseReview, publicReview, selectReviews, PERMISSION }
  from '../designer/engines/presentation-content.mjs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const DOC = JSON.parse(readFileSync(ROOT + '/designer/content/google-reviews.json', 'utf8'));

test('every review carries a name, the customer\'s own words and a public source', () => {
  assert.ok(Array.isArray(DOC.reviews));
  assert.equal(DOC.reviews.length, 12, 'twelve notifications were found in Gmail');
  const ids = new Set();
  for (const r of DOC.reviews) {
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
  for (const r of DOC.reviews) {
    assert.equal(r.rating, null, r.id + ' carries a rating the email did not contain');
    assert.equal(r.approved, false, r.id + ' was approved without NAC saying so');
  }
});

test('nothing in the shipped file can reach a customer quote', () => {
  for (const r of DOC.reviews) {
    const v = reviewPublishable(normaliseReview(r));
    assert.equal(v.ok, false, r.id + ' is publishable with no rating and no approval');
    assert.ok(v.reasons.some(x => /Star rating must be 1 to 5/.test(x)), r.id);
    assert.ok(v.reasons.some(x => /Not approved/.test(x)), r.id);
  }
  // And the selector agrees: a quote built today shows no reviews rather than
  // showing them unrated.
  assert.deepEqual(selectReviews(DOC.reviews, {}), []);
});

test('once NAC enters the real rating and approves, the words are passed through exactly', () => {
  const ready = DOC.reviews.map(r => normaliseReview({ ...r, rating: 5, approved: true }));
  for (let i = 0; i < ready.length; i++) {
    assert.equal(reviewPublishable(ready[i]).ok, true, ready[i].id + ' still withheld');
    const pub = publicReview(ready[i]);
    // Byte equality against the file. Not reworded, not trimmed, not ellipsised.
    assert.equal(pub.text, DOC.reviews[i].text, ready[i].id + ' text was altered');
    // Already published under that name on Google, so it shows as published.
    assert.equal(pub.name, DOC.reviews[i].displayName, ready[i].id + ' name was altered');
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
