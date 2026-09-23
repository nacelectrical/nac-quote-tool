// Which key does the server write quotes with?
//
// This is the check that stands between applying row level security and the
// intake form going quiet. Once the security SQL is applied an anon INSERT into
// nac_quotes is refused — that was verified against a real PostgreSQL — so if
// the Vercel variable SUPABASE_KEY holds the anon key, /api/intake-submit stops
// creating quotes and nothing says so.
//
// What is tested here is the part that is entirely NAC's to get right: getting
// the answer right, refusing the request outright unless a signed-in NAC user
// asked for it, and never describing the credential the server is holding --
// not the key, not a fragment, not its length, not its role.

import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

const realFetch = globalThis.fetch;
let routes = [];

globalThis.fetch = async (url, opts = {}) => {
  for (const r of routes) if (r.match(String(url))) return r.reply(String(url), opts);
  return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
};

const handler = (await import('../api/server-key-selftest.js')).default;
after(() => { globalThis.fetch = realFetch; });

function makeRes() {
  const out = { statusCode: null, body: null };
  return { status(c) { out.statusCode = c; return this; },
           json(b) { out.body = b; return out; }, out };
}
const run = (headers = {}) => handler({ method: 'GET', headers }, makeRes()).then(r => r.out ?? r);

/** A Supabase key is a JWT; only its middle segment is read, never the whole. */
const keyWithRole = (role) =>
  'eyJhbGciOiJIUzI1NiJ9.' +
  Buffer.from(JSON.stringify({ iss: 'supabase', role, iat: 1, exp: 9 })).toString('base64url') +
  '.notarealsignature';

const STAFF = { authorization: 'Bearer staff-token' };
const signedIn = () => routes.push({
  match: (u) => u.includes('/auth/v1/user'),
  reply: () => new Response(JSON.stringify({ id: 'user-1' }), { status: 200 })
});
const settingsReadable = (rows) => routes.push({
  match: (u) => u.includes('/rest/v1/nac_settings'),
  reply: () => new Response(JSON.stringify(rows), { status: rows.length ? 200 : 200 })
});

beforeEach(() => { routes = []; delete process.env.SUPABASE_KEY; });

test('an unauthenticated caller is refused and told nothing', async () => {
  const out = await run({});
  assert.equal(out.statusCode, 401);
  assert.ok(!('checks' in out.body), 'a refused caller must not see the configuration');
});

test('a token Supabase does not accept is refused', async () => {
  routes.push({ match: (u) => u.includes('/auth/v1/user'),
                reply: () => new Response('{}', { status: 401 }) });
  process.env.SUPABASE_KEY = keyWithRole('service_role');
  const out = await run(STAFF);
  assert.equal(out.statusCode, 401);
});

test('the service role key reads as ready', async () => {
  signedIn(); settingsReadable([{ key: 'materials' }]);
  process.env.SUPABASE_KEY = keyWithRole('service_role');
  const out = await run(STAFF);
  assert.equal(out.statusCode, 200);
  assert.equal(out.body.ready, true);
  assert.equal(out.body.willWrite, true);
});

test('a key without the write access is a failure that names the consequence', async () => {
  signedIn(); settingsReadable([{ key: 'materials' }]);
  process.env.SUPABASE_KEY = keyWithRole('anon');
  const out = await run(STAFF);
  assert.equal(out.body.ready, false);
  assert.equal(out.body.willWrite, false);
  assert.match(out.body.summary, /intake form/i);
  const accessCheck = out.body.checks.find(c => /access the write endpoints need/.test(c.name));
  assert.equal(accessCheck.result, 'FAIL');
  // The remedy — where to get the right key and what to do with it — is the
  // useful part of a failure, and it is the same sentence whatever is
  // currently configured.
  assert.match(accessCheck.detail, /Project Settings . API/);
  assert.match(accessCheck.detail, /redeploy/);
});

test('a missing key is reported rather than guessed at', async () => {
  signedIn();
  const out = await run(STAFF);
  assert.equal(out.body.ready, false);
  assert.match(out.body.checks[0].detail, /Add SUPABASE_KEY/);
});

test('a key that is not a JWT does not throw', async () => {
  signedIn(); settingsReadable([{ key: 'materials' }]);
  process.env.SUPABASE_KEY = 'not-a-jwt-at-all';
  const out = await run(STAFF);
  assert.equal(out.statusCode, 200);
  assert.equal(out.body.willWrite, false);
  assert.equal(out.body.ready, false);
});

test('the key itself is never in the answer', async () => {
  signedIn(); settingsReadable([{ key: 'materials' }]);
  const key = keyWithRole('service_role');
  process.env.SUPABASE_KEY = key;
  const out = await run(STAFF);
  assert.ok(!JSON.stringify(out.body).includes(key), 'the key must never be returned');
  assert.ok(!JSON.stringify(out.body).includes(key.split('.')[1]), 'not even its payload');
});

test('a database that refuses the server key is a failure, not a pass', async () => {
  signedIn();
  routes.push({ match: (u) => u.includes('/rest/v1/nac_settings'),
                reply: () => new Response('[]', { status: 200 }) });
  process.env.SUPABASE_KEY = keyWithRole('anon');
  const out = await run(STAFF);
  const probe = out.body.checks.find(c => /can read nac_settings/.test(c.name));
  assert.equal(probe.result, 'FAIL');
});

// ── THE ENDPOINT IS PASS OR FAIL, AND NOTHING ELSE ─────────────────────────
//
// NAC's rule: this check may say whether the server can write, and may say how
// to fix it. It may not describe the credential the server is holding. Not the
// key, not a fragment of it, not its length, not its JWT, not the name of its
// role — a reader who is not entitled to the key must not learn from a failure
// which key is sitting in Vercel.

/** Every string anywhere in the response, flattened. */
const allText = (body) => JSON.stringify(body);

test('no response contains a key, a fragment of one, or a JWT', async () => {
  for (const role of ['service_role', 'anon', 'authenticated']) {
    routes = [];
    signedIn(); settingsReadable([{ key: 'materials' }]);
    const key = keyWithRole(role);
    process.env.SUPABASE_KEY = key;
    const text = allText((await run(STAFF)).body);

    assert.ok(!text.includes(key), role + ': the whole key was returned');
    for (const seg of key.split('.')) {
      assert.ok(!text.includes(seg), role + ': a JWT segment was returned');
    }
    // No run of 12+ key characters anywhere in the answer.
    for (let i = 0; i + 12 <= key.length; i++) {
      assert.ok(!text.includes(key.slice(i, i + 12)), role + ': a fragment of the key was returned');
    }
    // Nothing shaped like a JWT at all.
    assert.ok(!/[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\./.test(text), role + ': a JWT appeared');
  }
});

test('no response states the length of the configured key', async () => {
  routes = [];
  signedIn(); settingsReadable([{ key: 'materials' }]);
  const key = keyWithRole('service_role');
  process.env.SUPABASE_KEY = key;
  const text = allText((await run(STAFF)).body);
  for (const n of [key.length, key.length - 1, key.length + 1]) {
    assert.ok(!text.includes(String(n)), 'the key length appeared in the answer');
  }
});

test('a failure never names the role the server is configured with', async () => {
  // Two different keys that both lack the access. If the answers differ, the
  // endpoint is describing the credential rather than reporting the outcome.
  const answers = [];
  for (const key of [keyWithRole('anon'), keyWithRole('authenticated'), 'not-a-jwt-at-all']) {
    routes = [];
    signedIn(); settingsReadable([{ key: 'materials' }]);
    process.env.SUPABASE_KEY = key;
    answers.push(allText((await run(STAFF)).body));
  }
  assert.equal(answers[0], answers[1],
    'the answer differs depending on which key is configured');
  assert.equal(answers[1], answers[2],
    'an unreadable key is distinguishable from a readable one that lacks access');

  // And the word itself is only ever there as the remedy — "copy the
  // service_role key from Supabase" — never as a statement about this server.
  const body = (await (async () => {
    routes = []; signedIn(); settingsReadable([{ key: 'materials' }]);
    process.env.SUPABASE_KEY = keyWithRole('anon');
    return (await run(STAFF)).body;
  })());
  const text = allText(body);
  assert.ok(!/\bis the anon\b|\banon key is configured\b|\bthis is the anon\b/i.test(text),
    'the answer says which key is configured');
  assert.ok(!/"role"|role claim|the role is/i.test(text), 'a role claim was reported');
});

test('the note tells the reader what is withheld', async () => {
  routes = [];
  signedIn(); settingsReadable([{ key: 'materials' }]);
  process.env.SUPABASE_KEY = keyWithRole('service_role');
  const out = await run(STAFF);
  assert.match(out.body.note, /no key length/i);
  assert.match(out.body.note, /no role name/i);
  assert.match(out.body.note, /read-only/i);
});
