// ─────────────────────────────────────────────────────────────────────────────
// THE CONTENT LIBRARY IS NAC'S, NOT THE INTERNET'S
//
// /api/presentation-content and /api/presentation-media both run with the
// service-role key and both had NO check on the caller. Anyone who knew the
// URL could:
//
//   • read the whole library — the trust copy, the payment terms with their
//     deposit instructions, and every review on file, approved or not, with
//     the customer's name and suburb attached;
//   • write it back changed, including the terms and conditions printed on
//     every customer quote;
//   • upload into, or delete out of, NAC's storage buckets.
//
// Nick: "An unauthenticated user attempting to open an NAC internal page
// should not gain access to customer, pricing or design information."
//
// These run the real handlers against the real database, so the refusal is the
// endpoint's own and not a stub's.
// ─────────────────────────────────────────────────────────────────────────────

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { startRest, reset, sql, row } from './helpers/pg-rest.mjs';

const HAVE_PG = existsSync('/usr/lib/postgresql/16/bin/psql');
const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
/** The real anon key, read out of the source rather than retyped here. */
const ANON_KEY = /const ANON_KEY = '([^']+)'/.exec(
  readFileSync(ROOT + '/server/staff-auth.js', 'utf8'))[1];

function call(handler, { method = 'GET', body = null, headers = {} } = {}) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      setHeader() { return this; },
      status(c) { this.statusCode = c; return this; },
      json(o) { resolve({ status: this.statusCode, body: o }); return this; },
      send(o) { return this.json(o); },
      end(o) { return this.json(o ?? null); }
    };
    Promise.resolve(handler({ method, body, headers, query: {} }, res))
      .catch(e => resolve({ status: 500, body: { error: String(e && e.message) } }));
  });
}

const SECRETS = {
  trust: { businessName: 'NAC Electrical Air & Refrigeration', abn: '97 636 392 982' },
  paymentTerms: { depositInstructions: 'BSB 064-000 ACC 1234 5678 — NAC Electrical' },
  reviews: [{ id: 'r1', text: 'Brilliant job', displayName: 'Margaret Hollis',
              suburb: 'Buderim', rating: 5, approved: true,
              permissionStatus: 'public_source', source: 'google' }],
  termsAndConditions: 'NAC Terms and Conditions of Trade v1.0'
};

async function seed() {
  reset();
  process.env.SUPABASE_KEY = 'test-service-key';
  sql("insert into public.nac_presentation_content (key, data, updated_at) values ('library', "
    + '$nacjson$' + JSON.stringify(SECRETS) + '$nacjson$::jsonb, now())');
  // Supabase's auth endpoint is the one thing stood in for: a real token
  // answers with a user, anything else does not.
  globalThis.fetch = async (url, opts) => {
    const auth = (opts && opts.headers && opts.headers.Authorization) || '';
    if (!String(url).includes('/auth/v1/user')) {
      return { ok: false, status: 404, json: async () => ({}) };
    }
    if (auth === 'Bearer real-staff-token') {
      return { ok: true, json: async () => ({ id: 'u1', email: 'nick@nacelectrical.com.au' }) };
    }
    return { ok: false, status: 401, json: async () => ({}) };
  };
}

const STAFF = { Authorization: 'Bearer real-staff-token' };

test('a stranger cannot read NAC\'s content library',
  { skip: !HAVE_PG && 'needs PostgreSQL' }, async (t) => {
    const stop = await startRest(); t.after(() => stop());
    await seed();
    const handler = (await import('../server/presentation-content.js')).default;

    for (const [label, headers] of [
      ['no header at all', {}],
      ['an empty bearer', { Authorization: 'Bearer ' }],
      ['a made-up token', { Authorization: 'Bearer not-a-real-token' }],
      // The anon key is printed in the source of every public page. Accepting
      // it would be the same as having no check.
      ['the public anon key', { Authorization: 'Bearer ' + ANON_KEY }]
    ]) {
      const r = await call(handler, { method: 'GET', headers });
      assert.equal(r.status, 401, 'read allowed with ' + label);
      assert.equal(r.body.error, 'sign_in_required');
      const text = JSON.stringify(r.body);
      assert.ok(!/064-000/.test(text), 'the deposit bank details leaked in the refusal');
      assert.ok(!/Margaret Hollis/.test(text), 'a reviewer name leaked in the refusal');
    }
  });

test('a stranger cannot rewrite the terms that print on a customer quote',
  { skip: !HAVE_PG && 'needs PostgreSQL' }, async (t) => {
    const stop = await startRest(); t.after(() => stop());
    await seed();
    const handler = (await import('../server/presentation-content.js')).default;

    const r = await call(handler, { method: 'PUT', headers: {},
      body: { content: { termsAndConditions: 'YOU AGREE TO PAY ME INSTEAD' } } });
    assert.equal(r.status, 401);

    // And the database is untouched.
    const after = row("select data from public.nac_presentation_content where key='library'");
    assert.equal(after.data.termsAndConditions, 'NAC Terms and Conditions of Trade v1.0');
  });

test('NAC signed in can read and write it', { skip: !HAVE_PG && 'needs PostgreSQL' },
  async (t) => {
    const stop = await startRest(); t.after(() => stop());
    await seed();
    const handler = (await import('../server/presentation-content.js')).default;

    const got = await call(handler, { method: 'GET', headers: STAFF });
    assert.equal(got.status, 200);
    assert.equal(got.body.content.trust.abn, '97 636 392 982');
    assert.equal(got.body.content.reviews.length, 1);

    const put = await call(handler, { method: 'PUT', headers: STAFF,
      body: { content: { ...SECRETS, termsAndConditions: 'NAC T&C v1.1' } } });
    assert.equal(put.status, 200, JSON.stringify(put.body));
    const after = row("select data from public.nac_presentation_content where key='library'");
    assert.equal(after.data.termsAndConditions, 'NAC T&C v1.1');
  });

test('a stranger cannot touch the image store', { skip: !HAVE_PG && 'needs PostgreSQL' },
  async (t) => {
    const stop = await startRest(); t.after(() => stop());
    await seed();
    const handler = (await import('../server/presentation-media.js')).default;

    for (const action of ['status', 'upload', 'delete']) {
      const r = await call(handler, { method: 'POST', headers: {}, body: { action } });
      assert.equal(r.status, 401, action + ' was allowed without a sign-in');
      // `status` names the environment variable the deployment uses. That is
      // not a secret worth much on its own, and it is still nobody else's.
      assert.ok(!/SUPABASE/.test(JSON.stringify(r.body)),
        'the refusal named the key variable');
    }
  });

test('the admin screen signs in and signs its requests',
  { skip: !HAVE_PG && 'needs PostgreSQL' }, () => {
    const page = readFileSync(ROOT + '/quote-presentation.html', 'utf8');
    assert.match(page, /requireSignIn\(/, 'the content library screen has no sign-in gate');
    // Every call to either endpoint carries the session.
    const calls = page.match(/fetch\('\/api\/presentation-(content|media)'[^)]*\)/gs) || [];
    assert.ok(calls.length >= 5, 'expected the five endpoint calls, found ' + calls.length);
    for (const c of calls) {
      assert.match(c, /staffHeaders\(/, 'a call to the content API sends no session: ' + c);
    }
  });
