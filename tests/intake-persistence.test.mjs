// NAC AI HVAC DESIGNER — the intake form must never say "thanks" for a
// submission nobody received.
//
// api/intake-submit.js used to return { ok: true } whatever happened: a missing
// SUPABASE_KEY skipped the write, a thrown error was swallowed as "non-fatal",
// and fetch resolves on a 401 or a 500 so a REJECTED write looked exactly like
// a successful one. A customer filled in the form, uploaded their floor plan,
// saw a thank-you, and the lead never existed.
//
// This drives the real handler with fetch stubbed, so each failure mode is
// exercised exactly as production would hit it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/intake-submit.js';

const realFetch = globalThis.fetch;
function res() {
  const o = { code: null, body: null };
  o.status = c => { o.code = c; return o; };
  o.json = b => { o.body = b; return o; };
  return o;
}
const BODY = { client: 'Test Customer', phone: '0400000000', address: '1 Test St',
               planBase64: 'AAAA', planMediaType: 'image/png' };

async function run(label, { anthropic = 'k', supaKey = 'k', notifyStatus = 200,
                            saveStatus = 201, saveThrows = false, notifyThrows = false,
                            // ── THE THIRD DURABLE PATH, ADDED 8 November 2026 ──
                            // The submission now also writes a row to
                            // nac_enquiries. It is a separate fate from the
                            // nac_quotes write and has to be stubbed as one, or
                            // the "nothing was recorded" case cannot be
                            // reached: the enquiry write would succeed and the
                            // handler would be right to report a success.
                            enquiryStatus = 201, enquiryThrows = false }) {
  process.env.ANTHROPIC_API_KEY = anthropic;
  if (supaKey) process.env.SUPABASE_KEY = supaKey; else delete process.env.SUPABASE_KEY;
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('api.anthropic.com')) {
      return { ok: true, json: async () => ({ content: [{ type: 'text',
        text: JSON.stringify({ conditionedAreaM2: 120, recommendedKw: 14, confidence: 'high',
          action: 'quote', rooms: [], notes: '' }) }] }) };
    }
    if (u.includes('webhook-trigger') || u.includes('leadconnectorhq')) {
      if (notifyThrows) throw new Error('network down');
      return { ok: notifyStatus < 400, status: notifyStatus, text: async () => '' };
    }
    if (u.includes('nac_enquiries')) {
      if (enquiryThrows) throw new Error('connection reset');
      return { ok: enquiryStatus < 400, status: enquiryStatus,
               text: async () => 'db said no' };
    }
    if (u.includes('nac_quotes')) {
      if (saveThrows) throw new Error('connection reset');
      return { ok: saveStatus < 400, status: saveStatus, text: async () => 'db said no' };
    }
    return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
  };
  const r = res();
  await handler({ method: 'POST', body: BODY }, r);
  const b = r.body || {};
  globalThis.fetch = realFetch;
  return { code: r.code, body: b };
}

test('a submission that reaches both the database and the notification is a clean success', async () => {
  const r = await run('both', {});
  assert.equal(r.code, 200);
  assert.equal(r.body.saved, true);
  assert.equal(r.body.notified, true);
  assert.equal(r.body.warning, null);
  assert.ok(r.body.quoteId);
});

test('a database that REJECTS the write is not reported as a save', async () => {
  // fetch resolves on a 401, so this is the case that used to read as success.
  const r = await run('401', { saveStatus: 401 });
  assert.equal(r.body.saved, false);
  assert.match(String(r.body.warning), /401/);
});

test('a database that cannot be reached is not reported as a save', async () => {
  const r = await run('throw', { saveThrows: true });
  assert.equal(r.body.saved, false);
  assert.match(String(r.body.warning), /database write failed/);
});

test('a missing SUPABASE_KEY says so instead of skipping quietly', async () => {
  const r = await run('nokey', { supaKey: null });
  assert.equal(r.body.saved, false);
  assert.match(String(r.body.warning), /SUPABASE_KEY/);
});

test('the notification failing does not invalidate a saved quote', async () => {
  const r = await run('nonotify', { notifyStatus: 500 });
  assert.equal(r.code, 200);
  assert.equal(r.body.saved, true);
  assert.equal(r.body.notified, false);
});

test('when NOTHING recorded the submission, the customer is told', async () => {
  for (const opts of [{ saveStatus: 500, notifyStatus: 500, enquiryStatus: 500 },
                      { saveThrows: true, notifyThrows: true, enquiryThrows: true }]) {
    const r = await run('both-fail', opts);
    assert.equal(r.code, 502, 'must not be a 200');
    assert.equal(r.body.saved, false);
    assert.equal(r.body.notified, false);
    // Nobody at NAC will see this lead, so the customer needs to ring.
    assert.match(r.body.error, /call NAC/);
    assert.ok(r.body.detail, 'the reason must be reported');
  }
});

// ── THE ENQUIRY ROW ────────────────────────────────────────────────────────

test('the submission also lands as an enquiry record, under the same id', async () => {
  // It used to be a paragraph of text in the notes column of a QUOTE row.
  // Both writes happen now, and they share an id so they are provably the
  // same enquiry.
  const r = await run('enquiry', {});
  assert.equal(r.code, 200);
  assert.equal(r.body.enquiryStored, true);
  assert.equal(r.body.enquiryId, r.body.quoteId,
    'one enquiry, two rows, findable from either');
});

test('an enquiry table that does not exist yet does not fail the submission', async () => {
  // nac_enquiries ships in a migration that has NOT been applied. A customer
  // mid-form must not be told to ring because of an outstanding deployment
  // step: the other two paths still took the lead.
  const r = await run('absent', { enquiryStatus: 404 });
  assert.equal(r.code, 200);
  assert.equal(r.body.enquiryStored, false);
  assert.equal(r.body.saved, true);
  assert.match(String(r.body.warning), /enquiries-handovers-schema\.sql/);
});

test('an enquiry recorded is enough on its own — the lead is not lost', async () => {
  // The quote row rejected and the webhook down, and the enquiry written. That
  // IS a recorded lead: Nick can see it on the board. Telling the customer to
  // ring would be wrong.
  const r = await run('enquiry-only', { saveStatus: 500, notifyStatus: 500 });
  assert.equal(r.code, 200);
  assert.equal(r.body.enquiryStored, true);
  assert.equal(r.body.saved, false);
  assert.equal(r.body.notified, false);
  assert.ok(r.body.warning, 'and the half-failure is still reported');
});

test('a missing SUPABASE_KEY stops the enquiry write too, and says so', async () => {
  const r = await run('nokey', { supaKey: null });
  assert.equal(r.body.enquiryStored, false);
  assert.equal(r.body.saved, false);
});
