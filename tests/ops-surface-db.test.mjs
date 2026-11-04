// ─────────────────────────────────────────────────────────────────────────────
// THE OPERATIONS SURFACE, AGAINST A REAL DATABASE
//
// Nick, 4 November 2026: "Until connections are verified, provide documented
// integration interfaces and clearly labelled local tests. Do not claim either
// integration is live." And: "Include... a demonstration using a test enquiry."
//
// NOTHING HERE IS A CLAIM THAT THE INTEGRATION IS LIVE. No assistant is
// involved: this suite is the caller, standing in for one, and what it proves
// is the surface NAC owns — that an enquiry becomes a customer, a job and a
// draft without duplicating anything, that a retry is not a second request,
// and above all what the surface REFUSES.
//
// It runs the real server/ops.js, unmodified, against PostgreSQL carrying
// NAC's own schema. The test customer is labelled as a test everywhere a
// person can read it.
//
// Needs PostgreSQL. Skipped with a reason when there is not one.
// ─────────────────────────────────────────────────────────────────────────────

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { startRest, reset, sql, row } from './helpers/pg-rest.mjs';
import { quoteOnlyDraft, UPGRADES, SETTINGS } from './fixtures/quote-only.mjs';
import { NAC_TRUST, seedTermsAndConditions } from '../designer/engines/presentation-content.mjs';
import { SCOPES } from '../designer/engines/ops-api.mjs';

const HAVE_PG = existsSync('/usr/lib/postgresql/16/bin/psql');
const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

/** A clearly labelled test enquiry. Nobody real, no real number. */
const ENQUIRY = {
  name: 'TEST ENQUIRY — Riley Nguyen (do not contact)',
  phone: '0400 000 111',
  email: 'test.enquiry@example.invalid',
  siteAddress: '7 Example Court, Testville QLD 4000',
  source: 'Podium (test)',
  note: 'Raised by tests/ops-surface-db.test.mjs. Not a real customer.'
};

/** The key the suite calls with. A fixture secret; nothing real. */
const SECRET = 'test-ops-secret-0000000000000000';
const FULL_KEY = [{
  id: 'test-assistant', name: 'Test assistant (local only)', secret: SECRET,
  scopes: Object.values(SCOPES)
}];
const KEYED = { Authorization: 'Bearer ' + SECRET };

/** A request/response pair shaped like the platform's. */
function call(handler, { method = 'GET', query = {}, body = null, headers = {} } = {}) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200, headers: {},
      setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; },
      status(c) { this.statusCode = c; return this; },
      json(o) { resolve({ status: this.statusCode, body: o, headers: this.headers }); return this; },
      send(o) { return this.json(o); },
      end(o) { return this.json(o ?? null); }
    };
    Promise.resolve(handler({ method, query, body, headers }, res)).catch((e) => {
      resolve({ status: 500, body: { error: 'threw', message: String(e && e.message) } });
    });
  });
}

const CONTENT = {
  trust: { ...NAC_TRUST },
  termsAndConditions: seedTermsAndConditions(null, NAC_TRUST),
  upgrades: UPGRADES
};

/**
 * The tables this surface needs that the shared test template does not carry.
 *
 * nac_customers and nac_jobs come from designer/crm-schema.sql and
 * nac_integration_calls from designer/ops-integration-schema.sql. Both are
 * additive migrations NAC applies to the real project; here they are applied
 * to this process's own clone so the suite tests the endpoint against the
 * schema it will actually meet.
 */
function applyMigrations({ callLog = true } = {}) {
  sql(`create table if not exists public.nac_customers (
         id text primary key, name text not null, email text, phone text,
         address text, notes text,
         created_at timestamptz default now(), updated_at timestamptz default now());
       create table if not exists public.nac_jobs (
         id text primary key, customer_id text references public.nac_customers (id),
         description text, site_address text, status text default 'open',
         servicem8_job_id text, notes text,
         created_at timestamptz default now(), updated_at timestamptz default now());
       alter table public.nac_designs add column if not exists customer_id text;
       alter table public.nac_designs add column if not exists job_ref text;`);
  sql('drop table if exists public.nac_integration_calls');
  if (callLog) {
    // The shipped migration, read from the file rather than retyped, so a
    // change to the schema that this surface cannot live with fails here.
    const ddl = readFileSync(ROOT + '/designer/ops-integration-schema.sql', 'utf8')
      // The RLS statements need roles this test database does not have.
      .split(/^-- ── Row level security/m)[0];
    sql(ddl);
  }
}

async function setup(opts = {}) {
  reset();
  sql('truncate public.nac_designs');
  // The migrations come first: on the first run of this process the CRM
  // tables do not exist yet, and emptying a table that is not there is an
  // error rather than a no-op.
  applyMigrations(opts);
  sql('delete from public.nac_jobs');
  sql('delete from public.nac_customers');
  process.env.SUPABASE_KEY = 'test-service-key';
  process.env.NAC_OPS_KEYS = JSON.stringify(opts.keys || FULL_KEY);
  // Supabase's auth endpoint is not a database, so the shim does not answer
  // it. One signed-in NAC user, for the endpoints that require staff.
  globalThis.fetch = async (url, init) => {
    const auth = (init && init.headers && init.headers.Authorization) || '';
    if (!String(url).includes('/auth/v1/user')) {
      return { ok: false, status: 404, json: async () => ({}) };
    }
    if (auth === 'Bearer test-staff-token') {
      return { ok: true, json: async () => ({ id: 'u1', email: 'nick@nacelectrical.com.au' }) };
    }
    return { ok: false, status: 401, json: async () => ({}) };
  };
  sql("insert into public.nac_presentation_content (key, data, updated_at) values "
    + "('library', $nacjson$" + JSON.stringify(CONTENT) + "$nacjson$::jsonb, now())");
  sql("insert into public.nac_settings (key, value, updated_at) values "
    + "('nac_hvac_settings_v1', $nacjson$" + JSON.stringify(SETTINGS) + "$nacjson$, now())");
  return (await import('../server/ops.js')).default;
}

const op = (handler, operation, body = {}, headers = KEYED) =>
  call(handler, { method: 'POST', headers, body: { operation, ...body } });

// ── IT IS NOT LIVE, AND IT SAYS SO ──────────────────────────────────────────

test('with no key configured, every operation answers 503 and says it is not connected',
  { skip: !HAVE_PG && 'needs PostgreSQL' }, async (t) => {
    const stop = await startRest(); t.after(() => stop());
    const h = await setup({ keys: [] });
    delete process.env.NAC_OPS_KEYS;

    const out = await op(h, 'quote.status', { quoteId: 'anything' });
    assert.equal(out.status, 503);
    assert.equal(out.body.error, 'integration_not_configured');
    assert.equal(out.body.live, false);
    assert.match(out.body.message, /not connected to anything/);
  });

test('the discovery document says what it is and what is still needed',
  { skip: !HAVE_PG && 'needs PostgreSQL' }, async (t) => {
    const stop = await startRest(); t.after(() => stop());
    const h = await setup();
    const out = await call(h, { method: 'GET', headers: KEYED });
    assert.equal(out.status, 200);
    const d = out.body;
    assert.equal(d.live, false, 'Nothing has been verified, so nothing claims to be live.');
    assert.ok(d.operations['quote.create_draft'], 'The operations have to be listed.');
    assert.ok(!d.operations['quote.approve'], 'There is no approve operation.');
    assert.equal(d.automation.enabled, false);
    assert.equal(d.automation.schedulingOwner, 'undecided');
    assert.ok(d.required.length >= 5, 'What is still unknown must be listed.');
    assert.ok(d.responsibilities.podium && d.responsibilities['ops assistant']);
    // The discovery document is the one thing a key is not needed for beyond
    // staff sign-in, so it must carry no customer, pricing or design data.
    const text = JSON.stringify(d);
    assert.ok(!/test-ops-secret/.test(text), 'A secret must never be echoed.');
    assert.ok(!/\$\d/.test(text), 'No prices in the discovery document.');
  });

test('a wrong key is refused, and told nothing about why',
  { skip: !HAVE_PG && 'needs PostgreSQL' }, async (t) => {
    const stop = await startRest(); t.after(() => stop());
    const h = await setup();
    const out = await op(h, 'quote.status', { quoteId: 'x' },
      { Authorization: 'Bearer not-the-key' });
    assert.equal(out.status, 401);
    assert.deepEqual(out.body, { error: 'unauthorised' },
      'A refused caller learns whether its key works and nothing else.');
  });

// ── A TEST ENQUIRY, ALL THE WAY TO A DRAFT ──────────────────────────────────

test('a test enquiry becomes a customer, a job and an empty draft',
  { skip: !HAVE_PG && 'needs PostgreSQL' }, async (t) => {
    const stop = await startRest(); t.after(() => stop());
    const h = await setup();

    const found = await op(h, 'enquiry.find_or_create',
      { ...ENQUIRY, idempotencyKey: 'enq-1' });
    assert.equal(found.status, 200, JSON.stringify(found.body));
    assert.equal(found.body.created, true);
    assert.match(found.body.customerId, /^CUS-/);
    assert.match(found.body.jobId, /^JOB-/);

    const cust = row("select id, name, phone from public.nac_customers where id = '"
      + found.body.customerId + "'");
    assert.ok(cust.name.includes('TEST ENQUIRY'), 'The test label has to survive.');

    // ── THE SAME ENQUIRY TWICE IS ONE CUSTOMER ─────────────────────────────
    // Nick: "Create or find a customer enquiry without duplicates."
    const again = await op(h, 'enquiry.find_or_create',
      { ...ENQUIRY, idempotencyKey: 'enq-2' });
    assert.equal(again.status, 200);
    assert.equal(again.body.customerId, found.body.customerId);
    assert.equal(again.body.jobId, found.body.jobId);
    assert.equal(again.body.matchedOn, 'phone');
    assert.equal(again.body.created, false);
    assert.equal(row('select count(*)::int as n from public.nac_customers').n, 1);
    assert.equal(row('select count(*)::int as n from public.nac_jobs').n, 1);

    // ── A DRAFT, WITH NO EQUIPMENT AND NO PRICE IN IT ──────────────────────
    const draft = await op(h, 'quote.create_draft',
      { jobId: found.body.jobId, idempotencyKey: 'draft-1' });
    assert.equal(draft.status, 200, JSON.stringify(draft.body));
    assert.match(draft.body.quoteId, /^Q-/);
    assert.equal(draft.body.status, 'draft');

    const stored = row("select design from public.nac_designs where id = '"
      + draft.body.quoteId + "'");
    const d = JSON.parse(stored.design);
    assert.equal(d.schema, 'nac.quote.draft.v1');
    assert.deepEqual(d.systems, [], 'An integration does not choose the equipment.');
    assert.ok(d.customer.name.includes('TEST ENQUIRY'),
      'The draft carries the customer the job belongs to.');

    // ── WHAT IS STILL MISSING, IN WORDS ────────────────────────────────────
    const preview = await op(h, 'quote.preview', { quoteId: draft.body.quoteId });
    assert.equal(preview.status, 200);
    assert.equal(preview.body.canIssue, false);
    assert.ok(preview.body.missing.length, 'It has to say what is missing.');
    assert.match(preview.body.note, /estimator/);
  });

test('a plan reference is attached without an integration ever setting a scale',
  { skip: !HAVE_PG && 'needs PostgreSQL' }, async (t) => {
    const stop = await startRest(); t.after(() => stop());
    const h = await setup();
    const enq = await op(h, 'enquiry.find_or_create', { ...ENQUIRY, idempotencyKey: 'e' });

    const out = await op(h, 'enquiry.attach_plan', {
      jobId: enq.body.jobId, idempotencyKey: 'plan-1',
      plan: { name: 'test-plan.pdf', mediaType: 'application/pdf',
              src: 'uploads/test-plan.pdf', notes: 'Dimensions printed on the plan.' },
      siteNotes: 'Single storey, tile roof, 2.4m ceilings per the plan.'
    });
    assert.equal(out.status, 200, JSON.stringify(out.body));
    assert.equal(out.body.planAttached, true);

    const d = JSON.parse(row("select design from public.nac_designs where id = '"
      + out.body.quoteId + "'").design);
    assert.equal(d.plan.name, 'test-plan.pdf');
    assert.equal(d.siteNotes, 'Single storey, tile roof, 2.4m ceilings per the plan.');
    // No scale came in and none was invented. Nick: "Never derive scale from
    // cars, furniture or guessed objects."
    assert.ok(!d.plan.calibration || !d.plan.calibration.mmPerPx,
      'An integration does not set the scale. An installer confirms it.');
  });

// ── NO PRICES, NO APPROVALS, NO CHANGES TO AN ANSWERED OFFER ────────────────

test('a price sent through the surface is refused by name',
  { skip: !HAVE_PG && 'needs PostgreSQL' }, async (t) => {
    const stop = await startRest(); t.after(() => stop());
    const h = await setup();
    const enq = await op(h, 'enquiry.find_or_create', { ...ENQUIRY, idempotencyKey: 'e' });
    const draft = await op(h, 'quote.create_draft',
      { jobId: enq.body.jobId, idempotencyKey: 'd' });

    const out = await op(h, 'quote.update_draft', {
      quoteId: draft.body.quoteId, idempotencyKey: 'p1',
      patch: { scope: { outletCount: 7 }, systems: [{ model: 'X', priceIncGst: 9000 }] }
    });
    assert.equal(out.status, 409);
    const r = out.body.refusals.find(x => x.code === 'PRICE_NOT_ACCEPTED');
    assert.ok(r, JSON.stringify(out.body));
    assert.ok(r.fields.includes('systems[0].priceIncGst'));

    const d = JSON.parse(row("select design from public.nac_designs where id = '"
      + draft.body.quoteId + "'").design);
    assert.deepEqual(d.systems, [], 'A refused call must change nothing at all.');
  });

test('an integration cannot approve a quote, by any route',
  { skip: !HAVE_PG && 'needs PostgreSQL' }, async (t) => {
    const stop = await startRest(); t.after(() => stop());
    const h = await setup();
    const enq = await op(h, 'enquiry.find_or_create', { ...ENQUIRY, idempotencyKey: 'e' });
    const draft = await op(h, 'quote.create_draft',
      { jobId: enq.body.jobId, idempotencyKey: 'd' });
    const quoteId = draft.body.quoteId;

    // There is no such operation.
    const direct = await op(h, 'quote.approve', { quoteId, idempotencyKey: 'a1' });
    assert.equal(direct.status, 404);
    assert.equal(direct.body.error, 'unknown_operation');

    // Nor through a patch.
    const sneaky = await op(h, 'quote.update_draft',
      { quoteId, idempotencyKey: 'a2', patch: { approvedBy: 'the assistant' } });
    assert.equal(sneaky.status, 409);
    assert.ok(sneaky.body.refusals.some(r => r.code === 'NOT_YOURS_TO_SET'));

    // Requesting approval is allowed, and it approves nothing.
    const asked = await op(h, 'quote.request_approval',
      { quoteId, idempotencyKey: 'a3', note: 'Ready for your look.' });
    assert.equal(asked.status, 200, JSON.stringify(asked.body));
    assert.equal(asked.body.state, 'requested');
    assert.equal(asked.body.event, 'quote.approval_requested');
    const d = JSON.parse(row("select design from public.nac_designs where id = '"
      + quoteId + "'").design);
    assert.equal(d.approvalRequest.state, 'requested');
    assert.ok(!d.approvedBy, 'Asking is not approving.');

    // And there is no link to hand over.
    const link = await op(h, 'quote.approved_link', { quoteId });
    assert.equal(link.status, 409);
    assert.ok(link.body.refusals.some(r => r.code === 'NOT_APPROVED'),
      'Nothing has been approved, so there is no link: ' + JSON.stringify(link.body));
  });

test('a read-only key cannot change a draft',
  { skip: !HAVE_PG && 'needs PostgreSQL' }, async (t) => {
    const stop = await startRest(); t.after(() => stop());
    const h = await setup({ keys: [{ id: 'reader', secret: SECRET,
      scopes: [SCOPES.QUOTE_READ] }] });
    const out = await op(h, 'quote.update_draft',
      { quoteId: 'Q-1', idempotencyKey: 'r1', patch: { summary: 'hello' } });
    assert.equal(out.status, 403);
    assert.equal(out.body.error, 'scope_required');
    assert.equal(out.body.needs, SCOPES.QUOTE_WRITE);
  });

// ── RETRIES ─────────────────────────────────────────────────────────────────

test('a retry carrying the same key returns the first result and creates nothing new',
  { skip: !HAVE_PG && 'needs PostgreSQL' }, async (t) => {
    const stop = await startRest(); t.after(() => stop());
    const h = await setup();

    const first = await op(h, 'enquiry.find_or_create',
      { ...ENQUIRY, idempotencyKey: 'retry-me' });
    assert.equal(first.status, 200);
    const retry = await op(h, 'enquiry.find_or_create',
      { ...ENQUIRY, idempotencyKey: 'retry-me' });
    assert.equal(retry.status, 200);
    assert.equal(retry.body.replayed, true, 'A retry must be recognised as one.');
    assert.equal(retry.body.customerId, first.body.customerId);
    assert.equal(row('select count(*)::int as n from public.nac_customers').n, 1);
  });

test('the same key on a different request is refused rather than answered wrongly',
  { skip: !HAVE_PG && 'needs PostgreSQL' }, async (t) => {
    const stop = await startRest(); t.after(() => stop());
    const h = await setup();
    await op(h, 'enquiry.find_or_create', { ...ENQUIRY, idempotencyKey: 'one-key' });
    const other = await op(h, 'enquiry.find_or_create',
      { ...ENQUIRY, name: 'TEST — somebody else', phone: '0400 000 222',
        idempotencyKey: 'one-key' });
    assert.equal(other.status, 409);
    assert.equal(other.body.error, 'idempotency_key_reused');
  });

test('a write with no idempotency key is refused',
  { skip: !HAVE_PG && 'needs PostgreSQL' }, async (t) => {
    const stop = await startRest(); t.after(() => stop());
    const h = await setup();
    const out = await op(h, 'enquiry.find_or_create', { ...ENQUIRY });
    assert.equal(out.status, 409);
    assert.ok(out.body.refusals.some(r => r.code === 'IDEMPOTENCY_KEY_REQUIRED'));
    assert.equal(row('select count(*)::int as n from public.nac_customers').n, 0);
  });

test('without the call log migration, writes are refused and reads still work',
  { skip: !HAVE_PG && 'needs PostgreSQL' }, async (t) => {
    const stop = await startRest(); t.after(() => stop());
    const h = await setup({ callLog: false });

    const write = await op(h, 'enquiry.find_or_create',
      { ...ENQUIRY, idempotencyKey: 'nolog' });
    assert.equal(write.status, 503);
    assert.equal(write.body.error, 'call_log_missing');
    assert.match(write.body.message, /ops-integration-schema\.sql/);
    assert.equal(row('select count(*)::int as n from public.nac_customers').n, 0,
      'Nothing is written without the record that makes a retry safe.');

    const read = await call(h, { method: 'GET', headers: KEYED });
    assert.equal(read.status, 200, 'Reading the interface never needed the log.');
  });

test('every call that changed something is in NAC’s own audit trail',
  { skip: !HAVE_PG && 'needs PostgreSQL' }, async (t) => {
    const stop = await startRest(); t.after(() => stop());
    const h = await setup();
    const enq = await op(h, 'enquiry.find_or_create', { ...ENQUIRY, idempotencyKey: 'a' });
    await op(h, 'quote.create_draft', { jobId: enq.body.jobId, idempotencyKey: 'b' });

    const calls = JSON.parse(sql("select coalesce(json_agg(t), '[]') from "
      + "(select id, integration, operation, status from public.nac_integration_calls "
      + "order by created_at) t").trim());
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map(c => c.operation),
      ['enquiry.find_or_create', 'quote.create_draft']);
    for (const c of calls) {
      assert.equal(c.status, 'ok');
      assert.equal(c.integration, 'test-assistant');
      assert.ok(!/test-ops-secret/.test(c.id), 'The log records the key’s id, never its secret.');
    }
  });

// ── STATUS, AND THE LINK THAT ONLY EXISTS ONCE IT IS REAL ───────────────────

test('status reads draft, then issued, then accepted, and the link follows',
  { skip: !HAVE_PG && 'needs PostgreSQL' }, async (t) => {
    const stop = await startRest(); t.after(() => stop());
    const h = await setup();
    const issueH = (await import('../server/quote-issue.js')).default;
    const respondH = (await import('../server/quote-respond.js')).default;

    // A real, priced draft — the estimator's work, saved the way the builder
    // saves it. The integration did not price it and could not have.
    const draft = quoteOnlyDraft({ id: 'Q-OPS-TEST-1', testQuote: true });
    sql("insert into public.nac_designs (id, design, updated_at) values ('"
      + draft.id + "', $nacjson$" + JSON.stringify(draft) + "$nacjson$, now())");

    const before = await op(h, 'quote.status', { quoteId: draft.id });
    assert.equal(before.status, 200);
    assert.equal(before.body.status, 'draft');

    // No link yet, because nothing has been issued.
    const noLink = await op(h, 'quote.approved_link', { quoteId: draft.id });
    assert.equal(noLink.status, 409);

    // Nick approves and issues it, in the application.
    const issued = await call(issueH, { method: 'POST',
      headers: { Authorization: 'Bearer test-staff-token' },
      body: { designId: draft.id, customer: draft.customer,
              job: { siteAddress: draft.siteAddress }, quoteRevision: 1, validDays: 30,
              testQuote: true, approvedBy: 'nick@nacelectrical.com.au' } });
    assert.equal(issued.status, 200, JSON.stringify(issued.body));

    const link = await op(h, 'quote.approved_link', { quoteId: draft.id });
    assert.equal(link.status, 200, JSON.stringify(link.body));
    assert.equal(link.body.revision, 1);
    assert.equal(link.body.approvedBy, 'nick@nacelectrical.com.au');
    assert.ok(link.body.url.includes('#' + issued.body.token),
      'The token is in the fragment, so it stays out of access logs.');

    const after = await op(h, 'quote.status', { quoteId: draft.id });
    assert.equal(after.body.status, 'issued');
    assert.equal(after.body.revision, 1);

    // A booking task is the step after an acceptance, not before it.
    const early = await op(h, 'booking.create_task',
      { quoteId: draft.id, idempotencyKey: 'book-early' });
    assert.equal(early.status, 409);
    assert.ok(early.body.refusals.some(r => r.code === 'NOT_ACCEPTED'));

    // The customer accepts, on the real page, through the real endpoint.
    const view = (await import('../server/quote-view.js')).default;
    const opened = await call(view, { method: 'GET', query: { token: issued.body.token } });
    assert.equal(opened.status, 200, JSON.stringify(opened.body));
    const accepted = await call(respondH, { method: 'POST',
      body: { token: issued.body.token, action: 'accept',
              customerName: 'TEST Riley Nguyen (do not contact)',
              acknowledgedTerms: true } });
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));

    const done = await op(h, 'quote.status', { quoteId: draft.id });
    assert.equal(done.body.status, 'accepted');
    assert.ok(done.body.totalIncGst > 0, 'The accepted total has to be readable.');

    // Now the booking task is allowed, and an accepted offer still cannot be changed.
    const task = await op(h, 'booking.create_task',
      { quoteId: draft.id, idempotencyKey: 'book-1' });
    assert.equal(task.status, 200, JSON.stringify(task.body));
    assert.match(task.body.taskId, /^BOOK-/);
    assert.match(task.body.note, /No customer message was sent/);

    const change = await op(h, 'quote.update_draft',
      { quoteId: draft.id, idempotencyKey: 'late', patch: { summary: 'changed' } });
    assert.equal(change.status, 409);
    assert.ok(change.body.refusals.some(r => r.code === 'OFFER_ANSWERED'));

    // And an accepted quote is handed no fresh link to chase.
    const deadLink = await op(h, 'quote.approved_link', { quoteId: draft.id });
    assert.equal(deadLink.status, 409);
    assert.equal(deadLink.body.error, 'NOT_DELIVERABLE');
  });

// ── WHAT AN INTEGRATION MAY READ ────────────────────────────────────────────

test('sizing comes back as an estimate that says which rule produced it',
  { skip: !HAVE_PG && 'needs PostgreSQL' }, async (t) => {
    const stop = await startRest(); t.after(() => stop());
    const h = await setup();
    const draft = quoteOnlyDraft({ id: 'Q-OPS-SIZE-1', testQuote: true });
    sql("insert into public.nac_designs (id, design, updated_at) values ('"
      + draft.id + "', $nacjson$" + JSON.stringify(draft) + "$nacjson$, now())");

    const out = await op(h, 'quote.sizing', { quoteId: draft.id });
    assert.equal(out.status, 200, JSON.stringify(out.body));
    assert.equal(out.body.isEstimate, true);
    assert.ok(out.body.methodLabel, 'The rule has to name itself.');
    assert.match(out.body.disclaimer, /not a load calculation/);
    assert.match(out.body.disclaimer, /not manufacturer performance data/);
  });

test('the options an integration reads carry customer prices and no costs at all',
  { skip: !HAVE_PG && 'needs PostgreSQL' }, async (t) => {
    const stop = await startRest(); t.after(() => stop());
    const h = await setup();
    const draft = quoteOnlyDraft({ id: 'Q-OPS-OPT-1', testQuote: true });
    sql("insert into public.nac_designs (id, design, updated_at) values ('"
      + draft.id + "', $nacjson$" + JSON.stringify(draft) + "$nacjson$, now())");

    const out = await op(h, 'quote.options', { quoteId: draft.id });
    assert.equal(out.status, 200, JSON.stringify(out.body));
    assert.ok(out.body.options.length >= 1);
    assert.equal(out.body.gstInclusive, true);
    for (const o of out.body.options) {
      assert.ok(o.model, 'An option without an exact model is not an option.');
      assert.ok(o.priceIncGst > 0);
    }
    const text = JSON.stringify(out.body);
    for (const leak of ['supplierCost', 'cost', 'margin', 'markup', 'jobFee',
                        'grossProfit']) {
      assert.ok(!text.includes(leak),
        '"' + leak + '" must never reach an integration.');
    }
  });
