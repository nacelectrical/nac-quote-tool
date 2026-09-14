// Reading and writing customers and jobs when the tables may not exist.
//
// The designer has to work on a Supabase project where designer/crm-schema.sql
// has not been run yet, and it must never report a save that did not happen.
// These run the real module against a stubbed fetch and localStorage.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── Stubs, installed before the module under test is imported ──────────────
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear()
};

let routes = [];     // [{ match, reply }]
let calls = [];
globalThis.fetch = async (url, opts = {}) => {
  calls.push({ url: String(url), method: opts.method || 'GET', body: opts.body || null });
  for (const r of routes) {
    if (r.match(String(url), opts)) return r.reply(String(url), opts);
  }
  return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const Crm = await import('../designer/engines/crm-store.mjs');

beforeEach(() => { routes = []; calls = []; store.clear(); Crm._resetAvailability(); });

// ── With the tables present ────────────────────────────────────────────────

test('with nac_customers present, a customer is written to the table', async () => {
  const written = [];
  routes = [
    { match: (u, o) => /nac_customers/.test(u) && (o.method || 'GET') === 'GET', reply: () => json([]) },
    { match: (u, o) => /nac_customers/.test(u) && o.method === 'POST',
      reply: (u, o) => { written.push(JSON.parse(o.body)); return json([], 201); } }
  ];
  const r = await Crm.saveCustomer({ id: 'CUS-A-0001', name: 'John Smith', phone: '0400 111 222' });
  assert.equal(r.ok, true);
  assert.equal(r.synced, true, 'the database took it');
  assert.equal(written.length, 1);
  assert.equal(written[0].id, 'CUS-A-0001');
  assert.equal(written[0].name, 'John Smith');
  assert.equal(written[0].phone, '0400 111 222');
  assert.ok(written[0].updated_at, 'it is stamped');
});

test('a database refusal is reported as a refusal, not a save', async () => {
  routes = [
    { match: (u, o) => /nac_customers/.test(u) && (o.method || 'GET') === 'GET', reply: () => json([]) },
    { match: (u, o) => /nac_customers/.test(u) && o.method === 'POST',
      reply: () => new Response('permission denied for table nac_customers', { status: 401 }) }
  ];
  const r = await Crm.saveCustomer({ id: 'CUS-A-0001', name: 'John Smith' });
  assert.equal(r.ok, false);
  assert.equal(r.synced, false);
  assert.match(r.error, /401/);
  assert.match(r.error, /permission denied/);
});

test('an unreachable database is reported, not swallowed', async () => {
  routes = [
    { match: (u, o) => /nac_customers/.test(u) && (o.method || 'GET') === 'GET', reply: () => json([]) },
    { match: (u, o) => /nac_customers/.test(u) && o.method === 'POST',
      reply: () => { throw new TypeError('Failed to fetch'); } }
  ];
  const r = await Crm.saveCustomer({ id: 'CUS-A-0001', name: 'John Smith' });
  assert.equal(r.synced, false);
  assert.match(r.error, /could not reach the database/);
});

test('rows come back as customers, not as raw table columns', async () => {
  routes = [{ match: (u) => /nac_customers/.test(u), reply: () => json([
    { id: 'CUS-A-0001', name: 'John Smith', email: null, phone: '0400 111 222',
      address: '1 A St', notes: null, created_at: '2026-01-01', updated_at: '2026-02-02' }
  ]) }];
  const list = await Crm.listCustomers();
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'John Smith');
  assert.equal(list[0].email, '', 'a null column reads as empty, not as "null"');
  assert.equal(list[0].updatedAt, '2026-02-02');
});

// ── Without the tables ─────────────────────────────────────────────────────

test('without the tables, it falls back rather than failing', async () => {
  const settings = new Map();
  routes = [
    { match: (u) => /nac_customers|nac_jobs/.test(u),
      reply: () => new Response('relation "public.nac_customers" does not exist', { status: 404 }) },
    { match: (u, o) => /nac_settings/.test(u) && o.method === 'POST',
      reply: (u, o) => { const b = JSON.parse(o.body); settings.set(b.key, b.value); return json([], 201); } },
    { match: (u) => /nac_settings/.test(u), reply: (u) => {
        const m = /key=eq\.([^&]+)/.exec(u);
        const v = m ? settings.get(decodeURIComponent(m[1])) : undefined;
        return json(v !== undefined ? [{ value: v }] : []);
      } }
  ];

  const r = await Crm.saveCustomer({ id: 'CUS-A-0001', name: 'John Smith', phone: '0400 111 222' });
  assert.equal(r.ok, true);
  assert.equal(r.synced, true, 'the fallback store still reached the database');
  assert.ok(settings.has(Crm.FALLBACK_KEYS.customers), 'it went into nac_settings');

  const back = await Crm.listCustomers();
  assert.equal(back.length, 1);
  assert.equal(back[0].name, 'John Smith');
});

test('a fallback write that does not reach the database says so', async () => {
  routes = [
    { match: (u) => /nac_customers|nac_jobs/.test(u), reply: () => new Response('nope', { status: 404 }) },
    { match: (u, o) => /nac_settings/.test(u) && o.method === 'POST',
      reply: () => new Response('service unavailable', { status: 503 }) },
    { match: (u) => /nac_settings/.test(u), reply: () => json([]) }
  ];
  const r = await Crm.saveCustomer({ id: 'CUS-A-0001', name: 'John Smith' });
  assert.equal(r.ok, true, 'the work is not lost');
  assert.equal(r.synced, false, 'but it is NOT reported as saved');
  assert.match(r.error, /this device only/);
});

test('the table is probed once, not on every call', async () => {
  routes = [{ match: (u) => /nac_customers/.test(u), reply: () => json([]) }];
  await Crm.listCustomers();
  await Crm.listCustomers();
  await Crm.listCustomers();
  const probes = calls.filter(c => /nac_customers\?select=id&limit=1/.test(c.url));
  assert.equal(probes.length, 1, 'asked once: ' + probes.length);
});

// ── Linking ────────────────────────────────────────────────────────────────

test('linking a row patches ONLY the two link columns', async () => {
  let patched = null;
  routes = [{ match: (u, o) => o.method === 'PATCH',
              reply: (u, o) => { patched = { url: u, body: JSON.parse(o.body) }; return new Response(null, { status: 204 }); } }];
  const r = await Crm.linkRow('nac_quotes', 'NAC-ABC-1', { customerId: 'CUS-A-0001', jobId: 'JOB-B-0001' });
  assert.equal(r.ok, true);
  assert.match(patched.url, /nac_quotes\?id=eq\.NAC-ABC-1/);
  assert.deepEqual(Object.keys(patched.body).sort(), ['customer_id', 'job_ref'],
    'nothing else on the row is sent, so nothing else can be overwritten');
});

test('a link that the database rejects is reported', async () => {
  routes = [{ match: (u, o) => o.method === 'PATCH',
              reply: () => new Response('column "job_ref" does not exist', { status: 400 }) }];
  const r = await Crm.linkRow('nac_quotes', 'NAC-ABC-1', { customerId: 'C1' });
  assert.equal(r.ok, false);
  assert.match(r.error, /400/);
  assert.match(r.error, /job_ref/);
});

test('linking nothing does nothing rather than sending an empty patch', async () => {
  const r = await Crm.linkRow('nac_quotes', 'NAC-ABC-1', {});
  assert.equal(r.ok, true);
  assert.equal(r.skipped, true);
  assert.equal(calls.length, 0);
});

// ── Applying a plan ────────────────────────────────────────────────────────

test('applying a plan stops at the first failure and says how far it got', async () => {
  let customerWrites = 0;
  routes = [
    { match: (u, o) => /nac_customers/.test(u) && (o.method || 'GET') === 'GET', reply: () => json([]) },
    { match: (u, o) => /nac_customers/.test(u) && o.method === 'POST', reply: () => {
        customerWrites++;
        return customerWrites === 2 ? new Response('boom', { status: 500 }) : json([], 201);
      } },
    { match: (u, o) => /nac_jobs/.test(u), reply: () => json([]) }
  ];
  const plan = {
    newCustomers: [{ id: 'C1', name: 'A' }, { id: 'C2', name: 'B' }, { id: 'C3', name: 'C' }],
    customerUpdates: [], newJobs: [{ id: 'J1' }], jobUpdates: [], links: [{ table: 'nac_quotes', id: 'Q1', customerId: 'C1' }]
  };
  const r = await Crm.applyPlan(plan);
  assert.equal(r.done.customers, 1, 'the first one was written');
  assert.equal(r.done.jobs, 0, 'and it stopped before the jobs');
  assert.equal(r.done.links, 0);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /C2/);
});

test('a clean plan applies everything and reports the counts', async () => {
  routes = [
    { match: (u, o) => (o.method || 'GET') === 'GET', reply: () => json([]) },
    { match: (u, o) => o.method === 'POST', reply: () => json([], 201) },
    { match: (u, o) => o.method === 'PATCH', reply: () => new Response(null, { status: 204 }) }
  ];
  const plan = {
    newCustomers: [{ id: 'C1', name: 'A' }], customerUpdates: [{ id: 'C2', fields: { id: 'C2', name: 'B' }, filled: ['phone'] }],
    newJobs: [{ id: 'J1' }], jobUpdates: [],
    links: [{ table: 'nac_quotes', id: 'Q1', customerId: 'C1', jobId: 'J1' },
            { table: 'nac_designs', id: 'D1', customerId: 'C1', jobId: 'J1' }]
  };
  const r = await Crm.applyPlan(plan);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.done, { customers: 2, jobs: 1, links: 2 });
});
