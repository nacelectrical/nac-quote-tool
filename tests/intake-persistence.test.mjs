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

async function run(label, { anthropic = 'k', supaKey = 'k', notifyStatus = 200, saveStatus = 201, saveThrows = false, notifyThrows = false }) {
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
  for (const opts of [{ saveStatus: 500, notifyStatus: 500 },
                      { saveThrows: true, notifyThrows: true }]) {
    const r = await run('both-fail', opts);
    assert.equal(r.code, 502, 'must not be a 200');
    assert.equal(r.body.saved, false);
    assert.equal(r.body.notified, false);
    // Nobody at NAC will see this lead, so the customer needs to ring.
    assert.match(r.body.error, /call NAC/);
    assert.ok(r.body.detail, 'the reason must be reported');
  }
});
