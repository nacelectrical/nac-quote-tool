// ─────────────────────────────────────────────────────────────────────────────
// AN ENQUIRY IS A RECORD
//
// The enquiry used to be a paragraph of text in the `notes` column of a QUOTE
// row: "INTAKE DRAFT | 0400 000 000 | 12 Smith St", then the AI sizing pack,
// then a list of photo URLs. Readable by a person, unreadable by a program,
// and impossible to link to the assessment that came out of it.
//
// This suite holds both halves: the record, and the reader that recovers one
// from the old text rows so NAC's history is not left behind.
// ─────────────────────────────────────────────────────────────────────────────

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  enquiryId, parseAssessmentPack, normaliseEnquiry, enquiryFromIntake,
  isLegacyEnquiryRow, enquiryFromLegacyQuoteRow, linkEnquiry, toRow, fromRow,
  openEnquiries, ENQUIRY_STATE, ENQUIRY_SOURCE
} from '../designer/engines/enquiry.mjs';

/** The pack api/intake-submit.js actually writes, as it writes it. */
const PACK = [
  'SIZE:            15.7 kW  (conditioned area 108 m2 x 145)',
  'CONDITIONED_M2: 108',
  'CONFIDENCE:      MEDIUM',
  'ACTION:          NEEDS REVIEW',
  'FLAGS:           Garage excluded; one bedroom undimensioned',
  '',
  'ROOMS COUNTED:   Living 32, Kitchen 14, Bed 1 16, Bed 2 12, Bed 3 12, Hall 22',
  'NOT COUNTED:     Double garage, Laundry, Bath, Ensuite, Alfresco',
  '',
  'NOTES:           Single storey. Roof access via hatch in robe.'
].join('\n');

const LEGACY_ROW = {
  id: 'NAC-TESTCUST-1762567890123',
  client: 'TEST ENQUIRY — do not contact',
  notes: 'INTAKE DRAFT | 0400 000 111 | 7 Example Court, Testville QLD 4000\n\n'
    + PACK + '\n\nPHOTOS:\nhttps://x.invalid/plan-abc.pdf\nhttps://x.invalid/photo-1.jpg',
  accepted: false,
  created_at: '2026-11-07T23:00:00.000Z'
};

// ── THE ID ─────────────────────────────────────────────────────────────────

test('the id is the one the intake form already mints', () => {
  // Byte-for-byte compatible with api/intake-submit.js, because the links in
  // NAC's sent mail are built from it. A second identifier for the same
  // enquiry would point every one of them at the wrong record.
  assert.equal(enquiryId('Smith & Co', 1762567890123), 'NAC-SMITHCO-1762567890123');
  assert.equal(enquiryId('A Very Long Customer Name Indeed', 1),
    'NAC-AVERYLONGC-1');
});

// ── THE SIZING PACK ────────────────────────────────────────────────────────

test('the pack parses into fields without inventing any of them', () => {
  const a = parseAssessmentPack(PACK);
  assert.equal(a.conditionedAreaSqM, 108);
  assert.equal(a.indicativeKw, 15.7);
  assert.equal(a.confidence, 'MEDIUM');
  assert.equal(a.action, 'NEEDS REVIEW');
  assert.equal(a.roomsCounted.length, 6);
  assert.equal(a.roomsNotCounted.length, 5);
  assert.ok(a.roomsNotCounted.some(r => /garage/i.test(r)),
    'the garage is recorded as NOT counted — the room rule has to survive the trip');
  // It is a draft note and says so, every time.
  assert.equal(a.isDraftNote, true);
});

test('a figure the pack does not carry is null, never zero', () => {
  const a = parseAssessmentPack('CONFIDENCE: LOW\nACTION: SITE VISIT FIRST');
  assert.equal(a.conditionedAreaSqM, null);
  assert.equal(a.indicativeKw, null);
  assert.equal(a.confidence, 'LOW');
  // The whole bug class: Number(null) is 0 and an area of 0 m² prices a job at
  // nothing. Absent has to stay absent.
  assert.notEqual(a.conditionedAreaSqM, 0);
});

test('an unreadable pack yields a record, not an exception', () => {
  for (const junk of [null, undefined, '', 'total gibberish', '{}']) {
    const a = parseAssessmentPack(junk);
    assert.equal(a.conditionedAreaSqM, null);
    assert.equal(a.roomsCounted.length, 0);
  }
});

// ── WHAT IS MISSING ────────────────────────────────────────────────────────

test('what an enquiry is missing is computed, never a reason to reject it', () => {
  const bare = normaliseEnquiry({ id: 'E1', customer: { phone: '0400 000 000' } });
  assert.equal(bare.id, 'E1');
  assert.deepEqual(bare.missing, ['customer name', 'site address']);

  const nothing = normaliseEnquiry({ id: 'E2' });
  assert.ok(nothing.missing.includes('a way to contact them'));

  const full = normaliseEnquiry({
    id: 'E3', customer: { name: 'A', email: 'a@b.invalid' }, site: { address: '1 St' }
  });
  assert.deepEqual(full.missing, []);
});

// ── FROM THE INTAKE FORM ───────────────────────────────────────────────────

test('an intake submission becomes an enquiry with its links started', () => {
  const e = enquiryFromIntake({
    client: 'TEST ENQUIRY', phone: '0400 000 111', email: 't@example.invalid',
    address: '7 Example Court', houseType: 'Single storey', existingAC: 'None',
    brand: 'Daikin', comments: 'Keen to go ahead'
  }, { id: 'NAC-TESTENQUI-1', pack: PACK, planUrl: 'https://x.invalid/plan-a.pdf',
       photoUrls: ['https://x.invalid/photo-1.jpg'], now: 1 });

  assert.equal(e.source, ENQUIRY_SOURCE.INTAKE);
  assert.equal(e.state, ENQUIRY_STATE.NEW);
  assert.equal(e.customer.phone, '0400 000 111');
  assert.equal(e.site.propertyType, 'Single storey');
  assert.equal(e.planUrl, 'https://x.invalid/plan-a.pdf');
  assert.equal(e.assessment.conditionedAreaSqM, 108);
  // The nac_quotes row the intake has always written, kept rather than replaced.
  assert.equal(e.links.legacyQuoteId, 'NAC-TESTENQUI-1');
  assert.equal(e.links.designId, null);
});

// ── THE RECORDS NAC ALREADY HAS ────────────────────────────────────────────

test('a pre-table enquiry is read out of the quote notes where it lies', () => {
  assert.equal(isLegacyEnquiryRow(LEGACY_ROW), true);
  assert.equal(isLegacyEnquiryRow({ notes: 'A normal quote' }), false);
  assert.equal(isLegacyEnquiryRow({}), false);

  const e = enquiryFromLegacyQuoteRow(LEGACY_ROW);
  assert.equal(e.id, LEGACY_ROW.id);
  assert.equal(e.source, ENQUIRY_SOURCE.LEGACY);
  assert.equal(e.customer.name, LEGACY_ROW.client);
  assert.equal(e.customer.phone, '0400 000 111');
  assert.equal(e.site.address, '7 Example Court, Testville QLD 4000');
  // The plan is the one labelled `plan-` by /api/upload. The rest are photos.
  assert.equal(e.planUrl, 'https://x.invalid/plan-abc.pdf');
  assert.deepEqual(e.photoUrls, ['https://x.invalid/photo-1.jpg']);
  assert.equal(e.assessment.conditionedAreaSqM, 108);
  assert.equal(e.links.legacyQuoteId, LEGACY_ROW.id);
});

test('an old row that was accepted is not reported as an open enquiry', () => {
  const e = enquiryFromLegacyQuoteRow({ ...LEGACY_ROW, accepted: true });
  assert.equal(e.state, ENQUIRY_STATE.QUOTED);
  assert.equal(openEnquiries([e]).length, 0);
});

// ── THE LINKS, WHICH WERE THE WHOLE POINT ──────────────────────────────────

test('linking an enquiry to its assessment moves it to assessing', () => {
  const e = enquiryFromLegacyQuoteRow(LEGACY_ROW);
  const linked = linkEnquiry(e, { designId: 'Q-20261108-ABCDE' });
  assert.equal(linked.links.designId, 'Q-20261108-ABCDE');
  assert.equal(linked.state, ENQUIRY_STATE.ASSESSING);
  assert.deepEqual(linked.conflicts, []);
});

test('an issued token moves it to quoted, and the state follows the links', () => {
  const e = normaliseEnquiry({ id: 'E1', customer: { name: 'A' }, site: { address: '1' } });
  const a = linkEnquiry(e, { designId: 'D1' });
  const b = linkEnquiry(a, { issuedToken: 'tok-1' });
  assert.equal(b.state, ENQUIRY_STATE.QUOTED);
  assert.equal(b.links.designId, 'D1', 'the earlier link is kept');
});

test('a second, different link is a conflict and does not overwrite the first', () => {
  // Two assessments against one enquiry is either a mistake worth seeing or a
  // second enquiry wearing the first one's id. Overwriting hides both.
  const e = linkEnquiry(normaliseEnquiry({ id: 'E1' }), { designId: 'D1' });
  const clash = linkEnquiry(e, { designId: 'D2' });
  assert.equal(clash.links.designId, 'D1');
  assert.deepEqual(clash.conflicts,
    [{ field: 'designId', existing: 'D1', offered: 'D2' }]);
});

test('relinking the SAME design is not a conflict', () => {
  // The builder calls this on every save. A repeat must be quiet.
  const e = linkEnquiry(normaliseEnquiry({ id: 'E1' }), { designId: 'D1' });
  const again = linkEnquiry(e, { designId: 'D1' });
  assert.deepEqual(again.conflicts, []);
  assert.equal(again.links.designId, 'D1');
});

test('closing an enquiry records why, and a closed one stays closed', () => {
  const e = linkEnquiry(normaliseEnquiry({ id: 'E1' }), { closedReason: 'Went elsewhere' });
  assert.equal(e.state, ENQUIRY_STATE.CLOSED);
  assert.equal(e.closedReason, 'Went elsewhere');
  const after = linkEnquiry(e, { designId: 'D9' });
  assert.equal(after.state, ENQUIRY_STATE.CLOSED,
    'a link does not reopen an enquiry somebody closed');
});

// ── THE DATABASE SHAPE ─────────────────────────────────────────────────────

test('a record survives the round trip through the row shape', () => {
  const before = enquiryFromIntake({
    client: 'Round Trip', phone: '0400 111 222', address: '2 Example St'
  }, { id: 'E-RT', pack: PACK, planUrl: 'https://x.invalid/plan-z.png',
       photoUrls: ['https://x.invalid/photo-9.jpg'], now: 5 });

  const after = fromRow(toRow(linkEnquiry(before, { designId: 'D-RT' })));
  assert.equal(after.id, 'E-RT');
  assert.equal(after.customer.phone, '0400 111 222');
  assert.equal(after.planUrl, 'https://x.invalid/plan-z.png');
  assert.deepEqual(after.photoUrls, ['https://x.invalid/photo-9.jpg']);
  assert.equal(after.assessment.conditionedAreaSqM, 108);
  assert.equal(after.links.designId, 'D-RT');
  assert.equal(after.state, ENQUIRY_STATE.ASSESSING);
});

test('the row shape names every column the migration creates', () => {
  // The `nac_designs.design` / `.data` bug was three endpoints asking
  // PostgREST for a column that existed in neither schema file, with every
  // test stubbing the call. This reads the real migration.
  const sqlText = readMigration();
  const row = toRow(normaliseEnquiry({ id: 'E1' }));
  for (const column of Object.keys(row)) {
    assert.match(sqlText, new RegExp('^\\s+' + column + '\\s', 'm'),
      'nac_enquiries has no column `' + column + '` in '
      + 'designer/enquiries-handovers-schema.sql');
  }
});

function readMigration() {
  const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
  return readFileSync(root + '/designer/enquiries-handovers-schema.sql', 'utf8');
}

// ── UNAVAILABLE IS NOT ZERO ────────────────────────────────────────────────

test('an unreadable enquiry source stays null all the way through', () => {
  // The rule the whole join with the ops assistant depends on. A null that
  // became [] would turn "I could not look" into "there is nothing to do".
  assert.equal(openEnquiries(null), null);
  assert.equal(openEnquiries(undefined), null);
  assert.deepEqual(openEnquiries([]), [], 'a real empty read is a real answer');
});

test('openEnquiries reports only what is still open, with no contact details lost', () => {
  const rows = [
    normaliseEnquiry({ id: 'A', customer: { name: 'A', phone: '1' }, site: { address: 'x' } }),
    linkEnquiry(normaliseEnquiry({ id: 'B' }), { issuedToken: 't' }),
    linkEnquiry(normaliseEnquiry({ id: 'C' }), { closedReason: 'no' })
  ];
  const open = openEnquiries(rows);
  assert.deepEqual(open.map(e => e.id), ['A']);
  // The board needs the phone to say "no way to contact them". It is an
  // INTERNAL board; quote.board strips it before an integration sees it.
  assert.equal(open[0].phone, '1');
});
