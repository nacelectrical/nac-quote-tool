// Which key does the server write quotes with?
//
// This is the check that stands between applying row level security and the
// intake form going quiet. Once the security SQL is applied an anon INSERT into
// nac_quotes is refused — that was verified against a real PostgreSQL — so if
// the Vercel variable SUPABASE_KEY holds the anon key, /api/intake-submit stops
// creating quotes and nothing says so.
//
// What is tested here is the part that is entirely NAC's to get right: reading
// the role correctly, never returning the key itself, and refusing the request
// outright unless a signed-in NAC user asked for it.

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

test('the anon key is reported as a failure that names the consequence', async () => {
  signedIn(); settingsReadable([{ key: 'materials' }]);
  process.env.SUPABASE_KEY = keyWithRole('anon');
  const out = await run(STAFF);
  assert.equal(out.body.ready, false);
  assert.equal(out.body.willWrite, false);
  assert.match(out.body.summary, /intake form/i);
  const roleCheck = out.body.checks.find(c => /SERVICE ROLE/.test(c.name));
  assert.equal(roleCheck.result, 'FAIL');
  assert.match(roleCheck.detail, /service_role/);
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
  assert.match(out.body.checks[1].detail, /could not be read/i);
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
