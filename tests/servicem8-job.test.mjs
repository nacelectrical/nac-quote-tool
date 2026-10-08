// ─────────────────────────────────────────────────────────────────────────────
// AN ACCEPTED QUOTE BECOMES A SERVICEM8 JOB
//
// Nick: "Need acceptance button with signature to upload a job into ServiceM8
// with all fields filled out so it's set up without having to do anything
// manually."
//
// What was there: api/servicem8.js, twenty-nine lines, which LOOK UP a job
// somebody had already typed in by hand. Nothing created one.
//
// ── WHAT THESE TESTS DO AND DO NOT PROVE ───────────────────────────────────
//
// The MAPPING is proved properly: given a real accepted issue and the frozen
// presentation, these assert the exact fields, line items, quantities, prices
// and description that get posted, and that a job missing an address or a
// customer is refused rather than created half-filled.
//
// The SENDING is exercised against a fake that implements ServiceM8's shape —
// POST returns the new uuid in an x-record-uuid header, the attachment bytes
// go to a second URL, a job read back carries generated_job_id. That proves
// the ORDER, the IDEMPOTENCY and the FAILURE HANDLING of this code.
//
// IT DOES NOT PROVE SERVICEM8 ACCEPTS THESE PAYLOADS. No API key and no
// outbound access to api.servicem8.com exists in this environment. The first
// real job must be created against NAC's own account and checked by eye, and
// /api/servicem8-selftest is the thing that says whether the key works at all.
// Nothing here should be read as "ServiceM8 is working".
// ─────────────────────────────────────────────────────────────────────────────

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildJobPlan, jobReadiness, jobMaterials, jobDescription, splitName, JOB_STATUS }
  from '../designer/engines/servicem8-job.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createJob, dataUriBytes } = require('../server/servicem8-job.js');

const SIGNATURE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';

const ISSUE = {
  token: 'T'.repeat(43), quoteRevision: 2, status: 'accepted',
  proposalNumber: 'NAC-2026-0184',
  customer: { name: 'Sarah Whitlock', email: 'sarah.whitlock@bigpond.com',
              phone: '0412 665 108', address: '12 Boronia Street, Buderim QLD 4556' },
  job: { siteAddress: '12 Boronia Street, Buderim QLD 4556' },
  chosenSystemId: 'sys-b',
  selectedOptionIds: ['at5', 'sensor'],
  acceptance: {
    customerName: 'Sarah Whitlock', acknowledgedTerms: true, signature: SIGNATURE,
    acceptedAt: '2026-10-08T05:12:44.000Z', quoteRevision: 2, totalIncGst: 16343,
    chosenSystemId: 'sys-b',
    selectedOptions: [
      { id: 'at5', title: 'AirTouch 5 smart control', quantity: 1,
        unitPriceIncGst: null, unitLabel: null, priceIncGst: 1350 },
      { id: 'sensor', title: 'Room temperature sensors', quantity: 4,
        unitPriceIncGst: 110, unitLabel: 'each', priceIncGst: 440 }
    ]
  }
};

const PRESENTATION = {
  system: { brand: 'Braemar', model: 'KDHV160D1S', capacityKw: 16.3 },
  zoneCount: 6,
  investment: { baseIncGst: 14553, totalIncGst: 16343,
                deposit: { percent: 50, amount: 8171.5 } }
};

// ── THE MAPPING ─────────────────────────────────────────────────────────────

test('a name splits the way ServiceM8 stores it', () => {
  assert.deepEqual(splitName('Sarah Whitlock'), { first: 'Sarah', last: 'Whitlock' });
  assert.deepEqual(splitName('Trish and Steve Hall'), { first: 'Trish', last: 'and Steve Hall' });
  assert.deepEqual(splitName('jen'), { first: 'jen', last: '' });
  assert.deepEqual(splitName('  '), { first: '', last: '' });
});

test('a job is refused rather than created half-filled', () => {
  // ServiceM8 will accept a job with no address. Somebody then drives to it.
  const noAddress = { ...ISSUE, customer: { ...ISSUE.customer, address: '' }, job: {} };
  const r = jobReadiness(noAddress);
  assert.equal(r.ok, false);
  assert.ok(r.blockers.some(b => /site address/i.test(b)));
  assert.equal(buildJobPlan(noAddress, PRESENTATION).ok, false);

  // And a quote nobody has accepted is not a job at all.
  const unaccepted = { ...ISSUE, status: 'issued', acceptance: null };
  assert.ok(jobReadiness(unaccepted).blockers.some(b => /not been accepted/i.test(b)));

  // No contact details is worth saying, but it does not stop the work.
  const noContact = { ...ISSUE, customer: { ...ISSUE.customer, email: '', phone: '' } };
  const w = jobReadiness(noContact);
  assert.equal(w.ok, true);
  assert.ok(w.warnings.some(x => /no way to contact/i.test(x)));
});

test('the line items are what the customer agreed to buy', () => {
  const mats = jobMaterials(ISSUE, PRESENTATION);
  assert.equal(mats.length, 3);

  assert.equal(mats[0].name, 'Braemar KDHV160D1S 16.3 kW');
  assert.equal(mats[0].quantity, 1);
  assert.equal(mats[0].priceIncGst, 14553);

  assert.equal(mats[1].name, 'AirTouch 5 smart control');
  assert.equal(mats[1].quantity, 1);
  assert.equal(mats[1].priceIncGst, 1350);

  // Bought by the unit: the quantity and the unit price both have to survive.
  assert.equal(mats[2].name, 'Room temperature sensors');
  assert.equal(mats[2].quantity, 4);
  assert.equal(mats[2].priceIncGst, 440);
  assert.match(mats[2].description, /4 × \$110\.00 each/);

  // And they add up to what was accepted, to the cent.
  const sum = mats.reduce((s, m) => s + m.priceIncGst, 0);
  assert.equal(Math.round(sum * 100), Math.round(ISSUE.acceptance.totalIncGst * 100));
});

test('the job description tells an installer what they are fitting', () => {
  const d = jobDescription(ISSUE, PRESENTATION);
  assert.match(d, /ACCEPTED QUOTE NAC-2026-0184 — revision 2/);
  assert.match(d, /System: Braemar KDHV160D1S · 16\.3 kW/);
  assert.match(d, /Zones: 6/);
  assert.match(d, /AirTouch 5 smart control × 1/);
  assert.match(d, /Room temperature sensors × 4/);
  assert.match(d, /Accepted by Sarah Whitlock on 2026-10-08/);
  assert.match(d, /Total accepted \(inc GST\): \$16343\.00/);
  assert.match(d, /Deposit to collect: \$8171\.50 \(50%\)/);
  assert.match(d, /signature attached/);

  // No internal cost, no margin, no bill of materials. This is what the office
  // and the installers read, not what the job cost NAC to buy.
  assert.ok(!/margin|cost price|markup|supplier/i.test(d), 'internal figures leaked into the job');
});

test('every field ServiceM8 needs is filled', () => {
  const plan = buildJobPlan(ISSUE, PRESENTATION);
  assert.equal(plan.ok, true, JSON.stringify(plan.blockers));

  assert.equal(plan.company.name, 'Sarah Whitlock');
  assert.equal(plan.company.address, '12 Boronia Street, Buderim QLD 4556');
  assert.equal(plan.company.is_individual, 1);

  assert.equal(plan.contact.first, 'Sarah');
  assert.equal(plan.contact.last, 'Whitlock');
  assert.equal(plan.contact.email, 'sarah.whitlock@bigpond.com');
  assert.equal(plan.contact.mobile, '0412 665 108');

  assert.equal(plan.job.job_address, '12 Boronia Street, Buderim QLD 4556');
  assert.equal(plan.job.billing_address, '12 Boronia Street, Buderim QLD 4556');
  // A signed quote is work NAC has won, not a quote still out.
  assert.equal(plan.job.status, JOB_STATUS.WORK_ORDER);
  assert.equal(plan.job.date, '2026-10-08');
  assert.equal(plan.job.purchase_order_number, 'NAC-2026-0184');
  assert.equal(plan.job.total_invoice_amount, 16343);
  assert.ok(plan.job.job_description.length > 100);

  assert.equal(plan.materials.length, 3);
  assert.equal(plan.attachments.length, 1);
  assert.equal(plan.attachments[0].fileName, 'customer-signature.png');
  assert.equal(plan.summary.signed, true);
});

test('an unsigned acceptance still makes a job, and says it was unsigned', () => {
  const unsigned = { ...ISSUE, acceptance: { ...ISSUE.acceptance, signature: null } };
  const plan = buildJobPlan(unsigned, PRESENTATION);
  assert.equal(plan.ok, true);
  assert.equal(plan.attachments.length, 0);
  assert.equal(plan.summary.signed, false);
  assert.ok(plan.warnings.some(w => /without drawing a signature/i.test(w)));
  assert.match(plan.job.job_description, /without a drawn signature/);
});

// ── THE SENDING, against a fake that behaves like ServiceM8 ─────────────────

/** Records every call so the ORDER and the PAYLOADS can be asserted. */
function fakeServiceM8({ failAt = null, existingCompany = null } = {}) {
  const calls = [];
  let seq = 0;
  const uuid = () => 'uuid-' + (++seq);
  const made = {};
  const fetchImpl = async (url, opts = {}) => {
    const method = opts.method || 'GET';
    const path = String(url).replace(/^https:\/\/api\.servicem8\.com\/api_1\.0\//, '');
    calls.push({ method, path, body: opts.body && typeof opts.body === 'string'
      ? JSON.parse(opts.body) : opts.body });

    const reply = (status, body, id) => ({
      ok: status < 300, status,
      headers: { get: (k) => (k.toLowerCase() === 'x-record-uuid' ? id || null : null) },
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body || ''))
    });

    if (failAt && path.startsWith(failAt) && method === 'POST') return reply(400, 'nope');

    if (method === 'GET' && path.startsWith('company.json')) {
      return reply(200, existingCompany ? [existingCompany] : []);
    }
    if (method === 'GET' && /^job\/.+\.json$/.test(path)) {
      return reply(200, { uuid: made.job, generated_job_id: '1482' });
    }
    if (method === 'POST') {
      const id = uuid();
      if (path === 'job.json') made.job = id;
      return reply(200, '', id);
    }
    return reply(404, '');
  };
  return { fetchImpl, calls };
}

test('creating a job posts the client, the contact, the job, the lines and the signature', async () => {
  const plan = buildJobPlan(ISSUE, PRESENTATION);
  const { fetchImpl, calls } = fakeServiceM8();
  const out = await createJob(plan, { key: 'test-key', fetch: fetchImpl });

  assert.equal(out.ok, true, JSON.stringify(out));
  assert.ok(out.jobUuid);
  assert.equal(out.generatedJobId, '1482', 'the readable job number was not fetched back');
  assert.equal(out.materialCount, 3);
  assert.equal(out.attachmentCount, 1);

  const posts = calls.filter(c => c.method === 'POST').map(c => c.path);
  // Order matters: a contact or a job cannot be posted before the client exists.
  assert.deepEqual(posts.slice(0, 3), ['company.json', 'companycontact.json', 'job.json']);
  assert.equal(posts.filter(p => p === 'jobmaterial.json').length, 3);
  assert.equal(posts.filter(p => p === 'attachment.json').length, 1);
  assert.ok(calls.some(c => /Attachment\/.*\.file$/.test(c.path)),
    'the signature metadata was created with no file behind it');

  // The job carries the client it was created under.
  const job = calls.find(c => c.path === 'job.json').body;
  assert.ok(job.company_uuid, 'the job was posted with no client');
  assert.equal(job.job_address, '12 Boronia Street, Buderim QLD 4556');

  // And the line items carry real quantities and prices.
  const mats = calls.filter(c => c.path === 'jobmaterial.json').map(c => c.body);
  assert.equal(mats[2].qty, 4);
  assert.equal(mats[2].price, 440);
  assert.ok(mats.every(m => m.job_uuid === out.jobUuid), 'a line item was orphaned');
});

test('an existing client at the same address is reused, not duplicated', async () => {
  const plan = buildJobPlan(ISSUE, PRESENTATION);
  const { fetchImpl, calls } = fakeServiceM8({
    existingCompany: { uuid: 'existing-1', name: 'Sarah Whitlock',
                       address: '12 Boronia Street, Buderim QLD 4556' } });
  const out = await createJob(plan, { key: 'test-key', fetch: fetchImpl });
  assert.equal(out.ok, true);
  assert.equal(out.companyUuid, 'existing-1');
  assert.equal(calls.filter(c => c.method === 'POST' && c.path === 'company.json').length, 0,
    'a second client record was created for a customer who is already in ServiceM8');

  // Same name at a DIFFERENT address is a different customer.
  const other = fakeServiceM8({
    existingCompany: { uuid: 'existing-2', name: 'Sarah Whitlock', address: '9 Other Road' } });
  const out2 = await createJob(plan, { key: 'test-key', fetch: other.fetchImpl });
  assert.notEqual(out2.companyUuid, 'existing-2');
  assert.equal(other.calls.filter(c => c.method === 'POST' && c.path === 'company.json').length, 1);
});

test('a ServiceM8 failure is reported, never silently swallowed', async () => {
  const plan = buildJobPlan(ISSUE, PRESENTATION);

  const noJob = fakeServiceM8({ failAt: 'job.json' });
  const r1 = await createJob(plan, { key: 'k', fetch: noJob.fetchImpl });
  assert.equal(r1.ok, false);
  assert.equal(r1.reason, 'job_failed');
  assert.ok(r1.steps.length, 'no record of what was attempted');

  const noClient = fakeServiceM8({ failAt: 'company.json' });
  const r2 = await createJob(plan, { key: 'k', fetch: noClient.fetchImpl });
  assert.equal(r2.ok, false);
  assert.equal(r2.reason, 'company_failed');

  // No key is a deployment fact, and says so rather than looking like an outage.
  const r3 = await createJob(plan, { key: null });
  assert.equal(r3.ok, false);
  assert.equal(r3.reason, 'no_api_key');
  assert.match(r3.message, /SERVICEM8_API_KEY/);

  // A network that throws does not take the acceptance down with it.
  const r4 = await createJob(plan, { key: 'k', fetch: async () => { throw new Error('ECONNRESET'); } });
  assert.equal(r4.ok, false);
  assert.equal(r4.reason, 'upstream_unavailable');
});

test('a data URI becomes the bytes ServiceM8 is sent', () => {
  const b = dataUriBytes(SIGNATURE);
  assert.ok(Buffer.isBuffer(b));
  assert.equal(b[0], 0x89); assert.equal(b.toString('ascii', 1, 4), 'PNG');
  assert.equal(dataUriBytes('not a data uri'), null);
  assert.equal(dataUriBytes(null), null);
});
