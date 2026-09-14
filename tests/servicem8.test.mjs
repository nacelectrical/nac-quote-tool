// Creating the ServiceM8 job when a customer accepts a quote.
//
// The live API cannot be reached from the test environment and there is no key
// here, so THIS IS NOT A TEST OF SERVICEM8. It is a test of the one thing that
// is entirely NAC's to get right: never reporting a job that was not created,
// and never losing the news that one failed.
//
// Every ServiceM8 answer below is one a real API gives: a rejected key, a 500,
// a timeout, and the nasty one — HTTP 200 with no record id, which the previous
// version reported as success.

import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

const realFetch = globalThis.fetch;
let routes = [];
let calls = [];

globalThis.fetch = async (url, opts = {}) => {
  calls.push({ url: String(url), method: opts.method || 'GET',
               body: opts.body ? JSON.parse(opts.body) : null, signal: opts.signal });
  for (const r of routes) if (r.match(String(url), opts)) return r.reply(String(url), opts);
  return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
};

const handler = (await import('../api/create-job.js')).default;

/** A stand-in for the Vercel res object. */
function makeRes() {
  const out = { statusCode: null, body: null };
  return {
    status(code) { out.statusCode = code; return this; },
    json(body) { out.body = body; return out; },
    send(body) { out.body = body; return out; },
    out
  };
}
const run = (body) => {
  const res = makeRes();
  return handler({ method: 'POST', body }, res).then(() => res.out);
};

const ok = (body, headers = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json', ...headers } });
const created = (uuid) => new Response('', { status: 200, headers: { 'x-record-uuid': uuid } });

const SM8 = (path) => (u) => u.includes('api.servicem8.com') && u.includes(path);
const SUPA = (u) => u.includes('supabase.co');

beforeEach(() => {
  routes = []; calls = [];
  process.env.SERVICEM8_API_KEY = 'test-key';
  process.env.SUPABASE_KEY = 'test-supabase-key';
});

const HAPPY = [
  { match: SM8('company.json?$filter'), reply: () => ok([]) },
  { match: (u, o) => SM8('company.json')(u) && o.method === 'POST', reply: () => created('COMPANY-UUID') },
  { match: (u, o) => SM8('companycontact.json')(u) && o.method === 'POST', reply: () => created('CONTACT-UUID') },
  { match: (u, o) => SM8('job.json')(u) && o.method === 'POST', reply: () => created('JOB-UUID') },
  { match: SM8('job/JOB-UUID.json'), reply: () => ok({ uuid: 'JOB-UUID', generated_job_id: '1234' }) },
  { match: SUPA, reply: () => new Response(null, { status: 204 }) }
];

const JOB = { quoteId: 'NAC-SMITH-1', clientName: 'John Smith', address: '1 Alpha St',
              phone: '0400 111 222', email: 'john@example.com', description: 'Ducted install' };

// ── The happy path ─────────────────────────────────────────────────────────

test('a job ServiceM8 confirms is reported as created, with its job number', async () => {
  routes = HAPPY;
  const r = await run(JOB);
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.ok, true);
  assert.equal(r.body.created, true);
  assert.equal(r.body.jobUuid, 'JOB-UUID');
  assert.equal(r.body.generatedJobId, '1234', 'the number NAC actually quotes against');
  assert.deepEqual(r.body.warnings, []);
});

test('the outcome is written back to the quote, not left in the browser', async () => {
  routes = HAPPY;
  await run(JOB);
  const patch = calls.find(c => SUPA(c.url) && c.method === 'PATCH');
  assert.ok(patch, 'the quote row was updated');
  assert.match(patch.url, /nac_quotes\?id=eq\.NAC-SMITH-1/);
  assert.equal(patch.body.servicem8_status, 'created');
  assert.equal(patch.body.servicem8_job_id, '1234');
  assert.equal(patch.body.servicem8_job_uuid, 'JOB-UUID');
  assert.equal(patch.body.servicem8_error, null);
  assert.ok(patch.body.servicem8_attempted_at);
});

test('an existing company is reused rather than duplicated', async () => {
  routes = [
    { match: SM8('company.json?$filter'), reply: () => ok([{ uuid: 'EXISTING-COMPANY' }]) },
    ...HAPPY.slice(1)
  ];
  const r = await run(JOB);
  assert.equal(r.body.created, true);
  assert.equal(r.body.reusedCompany, true);
  assert.equal(r.body.companyUuid, 'EXISTING-COMPANY');
  assert.equal(calls.filter(c => SM8('company.json')(c.url) && c.method === 'POST').length, 0,
    'no second company was created');
});

// ── The failures that used to read as success ──────────────────────────────

test('HTTP 200 with NO record id is a failure, not a job', async () => {
  routes = [
    { match: SM8('company.json?$filter'), reply: () => ok([]) },
    { match: (u, o) => SM8('company.json')(u) && o.method === 'POST', reply: () => created('COMPANY-UUID') },
    { match: (u, o) => SM8('companycontact.json')(u) && o.method === 'POST', reply: () => created('C') },
    // ServiceM8 answers 200 but gives back nothing identifying a record.
    { match: (u, o) => SM8('job.json')(u) && o.method === 'POST', reply: () => ok({ ok: 'sure' }) },
    { match: SUPA, reply: () => new Response(null, { status: 204 }) }
  ];
  const r = await run(JOB);
  assert.equal(r.statusCode, 502);
  assert.equal(r.body.ok, false);
  assert.equal(r.body.created, false);
  assert.match(r.body.error, /no record id/);
  assert.match(r.body.error, /nothing was created/);
  const patch = calls.find(c => SUPA(c.url) && c.method === 'PATCH');
  assert.equal(patch.body.servicem8_status, 'failed');
});

test('a rejected API key is reported as a rejected API key', async () => {
  routes = [
    { match: SM8('company.json?$filter'), reply: () => new Response('Unauthorized', { status: 401 }) },
    { match: SUPA, reply: () => new Response(null, { status: 204 }) }
  ];
  const r = await run(JOB);
  assert.equal(r.statusCode, 502);
  assert.equal(r.body.created, false);
  assert.match(r.body.error, /rejected the API key/);
  assert.match(r.body.error, /401/);
});

test('a ServiceM8 500 is reported with what it said', async () => {
  routes = [
    { match: SM8('company.json?$filter'), reply: () => ok([]) },
    { match: (u, o) => SM8('company.json')(u) && o.method === 'POST',
      reply: () => new Response('Internal Server Error: database is down', { status: 500 }) },
    { match: SUPA, reply: () => new Response(null, { status: 204 }) }
  ];
  const r = await run(JOB);
  assert.equal(r.body.created, false);
  assert.match(r.body.error, /HTTP 500/);
  assert.match(r.body.error, /database is down/);
});

test('a ServiceM8 that never answers is reported, not left hanging', async () => {
  routes = [
    { match: SM8('company.json?$filter'), reply: (u, o) => new Promise((_, reject) => {
        // Behave exactly as fetch does when the caller aborts.
        o.signal.addEventListener('abort', () => {
          const e = new Error('aborted'); e.name = 'AbortError'; reject(e);
        });
      }) },
    { match: SUPA, reply: () => new Response(null, { status: 204 }) }
  ];
  // The handler's own deadline is 12s; abort it sooner so the test is quick.
  const started = Date.now();
  const p = run(JOB);
  const signal = calls.find(c => SM8('company.json')(c.url))?.signal
    || await new Promise(r => setTimeout(() => r(calls.find(c => c.signal)?.signal), 20));
  signal.dispatchEvent(new Event('abort'));
  const r = await p;
  assert.equal(r.body.created, false);
  assert.match(r.body.error, /did not answer|could not be reached/);
  assert.ok(Date.now() - started < 5000, 'it gave up rather than hanging');
});

test('no API key is a clear server error, and is recorded', async () => {
  delete process.env.SERVICEM8_API_KEY;
  routes = [{ match: SUPA, reply: () => new Response(null, { status: 204 }) }];
  const r = await run(JOB);
  assert.equal(r.statusCode, 500);
  assert.equal(r.body.created, false);
  assert.match(r.body.error, /SERVICEM8_API_KEY/);
  const patch = calls.find(c => SUPA(c.url) && c.method === 'PATCH');
  assert.equal(patch.body.servicem8_status, 'failed', 'NAC can see it was never attempted');
});

// ── Partial success is described, not rounded up or down ───────────────────

test('a job created but not readable back is still a created job, with a warning', async () => {
  routes = [
    ...HAPPY.slice(0, 4),
    { match: SM8('job/JOB-UUID.json'), reply: () => new Response('gone', { status: 404 }) },
    { match: SUPA, reply: () => new Response(null, { status: 204 }) }
  ];
  const r = await run(JOB);
  assert.equal(r.body.created, true, 'ServiceM8 gave a record id, so the job exists');
  assert.equal(r.body.generatedJobId, null, 'but its number is not known');
  assert.equal(r.body.warnings.length, 1);
  assert.match(r.body.warnings[0], /could not be read back/);
  const patch = calls.find(c => SUPA(c.url) && c.method === 'PATCH');
  assert.equal(patch.body.servicem8_status, 'created');
  assert.match(patch.body.servicem8_error, /could not be read back/);
});

test('a contact that fails does NOT fail the job', async () => {
  routes = [
    { match: SM8('company.json?$filter'), reply: () => ok([]) },
    { match: (u, o) => SM8('company.json')(u) && o.method === 'POST', reply: () => created('COMPANY-UUID') },
    { match: (u, o) => SM8('companycontact.json')(u) && o.method === 'POST',
      reply: () => new Response('bad contact', { status: 400 }) },
    { match: (u, o) => SM8('job.json')(u) && o.method === 'POST', reply: () => created('JOB-UUID') },
    { match: SM8('job/JOB-UUID.json'), reply: () => ok({ generated_job_id: '1234' }) },
    { match: SUPA, reply: () => new Response(null, { status: 204 }) }
  ];
  const r = await run(JOB);
  assert.equal(r.body.created, true);
  assert.equal(r.body.generatedJobId, '1234');
  assert.equal(r.body.warnings.length, 1);
  assert.match(r.body.warnings[0], /contact was not/);
});

// ── Input handling ─────────────────────────────────────────────────────────

test('no client name is refused before anything is created', async () => {
  routes = HAPPY;
  const r = await run({ quoteId: 'Q1', clientName: '   ' });
  assert.equal(r.statusCode, 400);
  assert.equal(r.body.created, false);
  assert.equal(calls.filter(c => c.method === 'POST' && SM8('job.json')(c.url)).length, 0);
});

test('a quote id is not required — the job is still created', async () => {
  routes = HAPPY;
  const r = await run({ ...JOB, quoteId: '' });
  assert.equal(r.body.created, true);
  assert.equal(calls.filter(c => SUPA(c.url)).length, 0, 'and nothing is written to no quote');
});

test('an apostrophe in a name does not break the company lookup', async () => {
  routes = HAPPY;
  await run({ ...JOB, clientName: "O'Brien Holdings" });
  const find = calls.find(c => c.url.includes('$filter'));
  assert.match(decodeURI(find.url), /O''Brien Holdings/, 'the quote is escaped for the filter');
});

test('GET is refused', async () => {
  const res = makeRes();
  await handler({ method: 'GET' }, res);
  assert.equal(res.out.statusCode, 405);
});

// Put the real fetch back once every test has run — not at module evaluation,
// which would undo the stub before a single test started.
after(() => { globalThis.fetch = realFetch; });
