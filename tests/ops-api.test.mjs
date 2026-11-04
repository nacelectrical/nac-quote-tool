// ─────────────────────────────────────────────────────────────────────────────
// THE OPERATIONS SURFACE FOR NAC'S AI OPS ASSISTANT
//
// Nick, 4 November 2026: "Nick approves the exact quote revision before it is
// sent." And: "The assistant cannot invent prices, alter accepted offers or
// approve its own quote." And: "Retries must not create duplicate customers,
// quotes, messages or booking tasks." And: "Until connections are verified,
// provide documented integration interfaces and clearly labelled local tests.
// Do not claim either integration is live."
//
// No assistant code or documentation has been supplied, so nothing here
// assumes anything about what the assistant can do. These test the half NAC
// owns: which operations exist, which do NOT exist, and what is refused.
// ─────────────────────────────────────────────────────────────────────────────

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SCOPES, OPERATIONS, STATUS_EVENTS, SCHEDULING_OWNER, AUTOMATION_ENABLED,
         PRICE_FIELDS, priceFieldsIn, offerFingerprint, authorise, guard,
         matchCustomer, replayOf, requestHash } from '../designer/engines/ops-api.mjs';

/** A key with everything, to prove that even then the refusals hold. */
const GOD_KEY = { id: 'test-key', scopes: Object.values(SCOPES) };

const QUOTE = {
  revision: 2,
  systems: [{ id: 's1', brand: 'Daikin', model: 'FDYAN100A-CV / RZA100C',
    capacityKw: 10, phase: 'single', priceIncGst: 12400 }],
  chosenSystemId: 's1',
  selectedUpgradeIds: ['at5'],
  upgradeQuantities: { sensor: 2 },
  scope: { outletCount: 7, returnCount: 1, zoneCount: 4 },
  inclusions: ['Supply and install'],
  exclusions: ['Electrical upgrade'],
  controller: { id: 'siemens_z4' },
  status: 'draft'
};

// ── WHAT THE ASSISTANT CANNOT DO, BECAUSE IT DOES NOT EXIST ──────────────────

test('there is no operation that approves a quote', () => {
  for (const name of Object.keys(OPERATIONS)) {
    assert.ok(!/\.approve$|\.approve_|_approve$/.test(name),
      name + ' looks like an approve operation. Approval is Nick’s, in the application.');
  }
  assert.ok(!OPERATIONS['quote.approve'],
    'An operation that does not exist cannot be granted by mistake.');
});

test('there is no operation that sets a price', () => {
  for (const name of Object.keys(OPERATIONS)) {
    assert.ok(!/price|cost|margin|markup|discount/i.test(name),
      name + ' looks like a pricing operation. Prices come from NAC’s catalogue.');
  }
});

test('even a key carrying every scope cannot reach an operation that does not exist', () => {
  const a = authorise('quote.approve', GOD_KEY);
  assert.equal(a.ok, false);
  assert.equal(a.status, 404);
  assert.equal(a.error, 'unknown_operation');
});

test('nothing in this surface calls out to an assistant', async () => {
  const src = await (await import('node:fs/promises')).readFile(
    new URL('../designer/engines/ops-api.mjs', import.meta.url), 'utf8');
  for (const forbidden of ['fetch(', 'XMLHttpRequest', 'https://', 'process.env']) {
    assert.ok(!src.includes(forbidden),
      'The operations surface must not contain "' + forbidden + '" — an assistant '
      + 'calls in; this application never calls out.');
  }
});

test('automation and scheduling ownership are both still off', () => {
  assert.equal(AUTOMATION_ENABLED, false);
  assert.equal(SCHEDULING_OWNER, 'undecided',
    'Nick: confirm whether Podium or the assistant owns scheduling before enabling it.');
});

// ── EVERY OPERATION IS DOCUMENTED AND SCOPED ─────────────────────────────────

test('every operation names a real scope, what it takes and what it returns', () => {
  const scopes = Object.values(SCOPES);
  for (const [name, op] of Object.entries(OPERATIONS)) {
    assert.ok(scopes.includes(op.scope), name + ' has an unknown scope: ' + op.scope);
    assert.equal(typeof op.mutates, 'boolean', name + ' must say whether it mutates.');
    assert.ok(op.summary && op.summary.length > 10, name + ' needs a summary.');
    assert.ok(Array.isArray(op.takes) && op.takes.length, name + ' must document takes.');
    assert.ok(Array.isArray(op.returns) && op.returns.length,
      name + ' must document returns.');
  }
});

test('the nine authenticated operations Nick listed are all present', () => {
  for (const name of ['enquiry.find_or_create', 'enquiry.attach_plan',
                      'quote.create_draft', 'quote.update_draft', 'quote.sizing',
                      'quote.options', 'quote.preview', 'quote.request_approval',
                      'quote.approved_link', 'quote.status', 'booking.create_task']) {
    assert.ok(OPERATIONS[name], name + ' is in the brief and must exist.');
  }
});

test('a read-only key cannot write', () => {
  const readOnly = { scopes: [SCOPES.QUOTE_READ] };
  assert.equal(authorise('quote.status', readOnly).ok, true);
  const w = authorise('quote.update_draft', readOnly);
  assert.equal(w.ok, false);
  assert.equal(w.status, 403);
  assert.equal(w.needs, SCOPES.QUOTE_WRITE);
});

test('a delivery key cannot open a draft or a booking task', () => {
  const delivery = { scopes: [SCOPES.DELIVERY_READ] };
  assert.equal(authorise('quote.approved_link', delivery).ok, true);
  assert.equal(authorise('quote.create_draft', delivery).ok, false);
  assert.equal(authorise('booking.create_task', delivery).ok, false);
});

test('every status event Nick listed is documented', () => {
  for (const e of ['quote.approval_requested', 'quote.approved', 'quote.issued',
                   'quote.accepted', 'quote.declined', 'quote.expired',
                   'quote.superseded']) {
    assert.ok(STATUS_EVENTS.includes(e), e + ' must be an event an integration can read.');
  }
});

// ── NO PRICES FROM OUTSIDE ───────────────────────────────────────────────────

test('a price anywhere in a patch is refused by name', () => {
  const g = guard('quote.update_draft', {
    idempotencyKey: 'k1', quoteId: 'q1',
    patch: { systems: [{ model: 'FDYAN100A-CV', priceIncGst: 9000 }] }
  }, { quote: QUOTE });
  assert.equal(g.ok, false);
  const r = g.refusals.find(x => x.code === 'PRICE_NOT_ACCEPTED');
  assert.ok(r, 'A price in a patch must be refused.');
  assert.deepEqual(r.fields, ['systems[0].priceIncGst']);
  assert.match(r.message, /Prices are set in the quote tool/);
});

test('a price buried three levels down is still found', () => {
  const found = priceFieldsIn({ a: { b: [{ c: { supplierCost: 1 } }] } });
  assert.deepEqual(found, ['a.b[0].c.supplierCost']);
});

test('margin, markup, discount and the job fee are all money', () => {
  for (const f of ['margin', 'marginPct', 'markup', 'markupPct', 'discount',
                   'jobFee', 'deposit', 'allowance']) {
    assert.ok(PRICE_FIELDS.includes(f), f + ' must be refused from an integration.');
  }
});

test('a patch with no money in it passes the price rule', () => {
  const g = guard('quote.update_draft', {
    idempotencyKey: 'k2', quoteId: 'q1',
    patch: { scope: { outletCount: 8 }, inclusions: ['Supply and install'] }
  }, { quote: QUOTE });
  assert.equal(g.ok, true, JSON.stringify(g.refusals));
});

// ── NOBODY APPROVES THEIR OWN QUOTE ──────────────────────────────────────────

test('an integration cannot hand itself an approval through a patch', () => {
  for (const field of ['approved', 'approvedBy', 'approvedAt', 'status', 'acceptance']) {
    const g = guard('quote.update_draft',
      { idempotencyKey: 'k3', quoteId: 'q1', patch: { [field]: 'yes' } },
      { quote: QUOTE });
    assert.equal(g.ok, false, field + ' should be refused.');
    assert.ok(g.refusals.some(r => r.code === 'NOT_YOURS_TO_SET' && r.field === field),
      field + ' must be refused as NOT_YOURS_TO_SET.');
  }
});

test('requesting approval is not approving: it needs no approval state and grants none', () => {
  const g = guard('quote.request_approval',
    { idempotencyKey: 'k4', quoteId: 'q1', note: 'Ready for your look.' },
    { quote: QUOTE });
  assert.equal(g.ok, true, JSON.stringify(g.refusals));
  assert.deepEqual(OPERATIONS['quote.request_approval'].returns,
    ['quoteId', 'fingerprint', 'state']);
});

// ── THE APPROVED LINK ────────────────────────────────────────────────────────

test('there is no customer link before somebody approves it', () => {
  const g = guard('quote.approved_link', { quoteId: 'q1' },
    { quote: QUOTE, approval: null, issue: { token: 'TESTTOKEN' } });
  assert.equal(g.ok, false);
  assert.ok(g.refusals.some(r => r.code === 'NOT_APPROVED'));
});

test('an approval does not travel to a quote that changed after it', () => {
  const approval = { state: 'approved', by: 'nick',
    fingerprint: offerFingerprint(QUOTE) };
  const unchanged = guard('quote.approved_link', { quoteId: 'q1' },
    { quote: QUOTE, approval, issue: { token: 'TESTTOKEN' } });
  assert.equal(unchanged.ok, true, JSON.stringify(unchanged.refusals));

  // One extra outlet. Same revision number, different offer.
  const moved = { ...QUOTE, scope: { ...QUOTE.scope, outletCount: 9 } };
  const stale = guard('quote.approved_link', { quoteId: 'q1' },
    { quote: moved, approval, issue: { token: 'TESTTOKEN' } });
  assert.equal(stale.ok, false);
  assert.ok(stale.refusals.some(r => r.code === 'APPROVAL_STALE'));
});

test('an approved quote that was never issued still has no link', () => {
  const g = guard('quote.approved_link', { quoteId: 'q1' },
    { quote: QUOTE, approval: { state: 'approved', fingerprint: offerFingerprint(QUOTE) },
      issue: null });
  assert.equal(g.ok, false);
  assert.ok(g.refusals.some(r => r.code === 'NOT_ISSUED'));
});

test('the fingerprint moves with every part of the offer that matters', () => {
  const base = offerFingerprint(QUOTE);
  const changes = [
    { revision: 3 },
    { chosenSystemId: 's2' },
    { selectedUpgradeIds: [] },
    { upgradeQuantities: { sensor: 3 } },
    { scope: { ...QUOTE.scope, zoneCount: 6 } },
    { inclusions: ['Supply and install', 'Make good'] },
    { exclusions: [] },
    { controller: { id: 'siemens_z6' } },
    { systems: [{ ...QUOTE.systems[0], priceIncGst: 12900 }] }
  ];
  for (const c of changes) {
    assert.notEqual(offerFingerprint({ ...QUOTE, ...c }), base,
      'Changing ' + Object.keys(c)[0] + ' must change the fingerprint.');
  }
  // The order upgrades were ticked in is not a change to the offer.
  assert.equal(offerFingerprint({ ...QUOTE, selectedUpgradeIds: ['at5'] }), base);
});

// ── AN ANSWERED OFFER IS FINISHED ────────────────────────────────────────────

test('an accepted quote cannot be changed by an integration', () => {
  const g = guard('quote.update_draft',
    { idempotencyKey: 'k5', quoteId: 'q1', patch: { scope: { outletCount: 9 } } },
    { quote: { ...QUOTE, status: 'accepted' } });
  assert.equal(g.ok, false);
  assert.ok(g.refusals.some(r => r.code === 'OFFER_ANSWERED'));
});

test('a declined quote cannot be changed by an integration', () => {
  const g = guard('quote.update_draft',
    { idempotencyKey: 'k6', quoteId: 'q1', patch: { scope: { outletCount: 9 } } },
    { quote: { ...QUOTE, status: 'declined' } });
  assert.equal(g.ok, false);
  assert.ok(g.refusals.some(r => r.code === 'OFFER_ANSWERED'));
});

test('a booking task is the one thing an acceptance does allow', () => {
  const accepted = { quote: { ...QUOTE, status: 'accepted' } };
  const ok = guard('booking.create_task',
    { idempotencyKey: 'k7', quoteId: 'q1', assignee: 'nick' }, accepted);
  assert.equal(ok.ok, true, JSON.stringify(ok.refusals));
});

test('a booking task before an acceptance is refused', () => {
  const g = guard('booking.create_task',
    { idempotencyKey: 'k8', quoteId: 'q1' }, { quote: QUOTE });
  assert.equal(g.ok, false);
  assert.ok(g.refusals.some(r => r.code === 'NOT_ACCEPTED'));
});

// ── RETRIES DO NOT DUPLICATE ANYTHING ────────────────────────────────────────

test('anything that changes something needs an idempotency key', () => {
  for (const [name, op] of Object.entries(OPERATIONS)) {
    if (!op.mutates) continue;
    const g = guard(name, { quoteId: 'q1' },
      { quote: { ...QUOTE, status: name === 'booking.create_task' ? 'accepted' : 'draft' } });
    assert.ok(g.refusals.some(r => r.code === 'IDEMPOTENCY_KEY_REQUIRED'),
      name + ' changes something and must require an idempotencyKey.');
  }
});

test('a read never needs an idempotency key', () => {
  for (const [name, op] of Object.entries(OPERATIONS)) {
    if (op.mutates) continue;
    const g = guard(name, { quoteId: 'q1' }, { quote: QUOTE });
    assert.ok(!g.refusals.some(r => r.code === 'IDEMPOTENCY_KEY_REQUIRED'),
      name + ' only reads and must not demand a key.');
  }
});

test('a retry returns the first result instead of doing the work twice', () => {
  const body = { idempotencyKey: 'abc-123', jobId: 'j1', assignee: 'nick' };
  const hash = requestHash('booking.create_task', body);
  const store = { 'abc-123': { operation: 'booking.create_task', requestHash: hash,
    result: { taskId: 'task-1', created: true }, at: '2026-11-04T09:00:00Z' } };

  const again = replayOf('abc-123', 'booking.create_task', hash, store);
  assert.equal(again.replay, true);
  assert.deepEqual(again.result, { taskId: 'task-1', created: true },
    'The same key must return the same task, not open a second one.');
});

test('the same key on a different request is refused, not quietly answered', () => {
  const hash = requestHash('booking.create_task', { idempotencyKey: 'k', jobId: 'j1' });
  const store = { k: { operation: 'booking.create_task', requestHash: hash,
    result: { taskId: 'task-1' } } };
  const other = requestHash('booking.create_task', { idempotencyKey: 'k', jobId: 'j2' });
  const r = replayOf('k', 'booking.create_task', other, store);
  assert.equal(r.replay, false);
  assert.equal(r.conflict, true);
});

test('a key never seen before is not a replay', () => {
  assert.deepEqual(replayOf('fresh', 'quote.create_draft', 'h', {}), { replay: false });
});

test('the request hash ignores the key itself but nothing else', () => {
  const a = requestHash('quote.create_draft', { idempotencyKey: 'one', jobId: 'j1' });
  const b = requestHash('quote.create_draft', { idempotencyKey: 'two', jobId: 'j1' });
  const c = requestHash('quote.create_draft', { idempotencyKey: 'one', jobId: 'j2' });
  assert.equal(a, b, 'A different key for the same request is the same request.');
  assert.notEqual(a, c, 'A different job is a different request.');
});

// ── FINDING A CUSTOMER WITHOUT MERGING TWO HOUSEHOLDS ────────────────────────

const CUSTOMERS = [
  { id: 'c1', name: 'Jane Smith', phone: '0400 111 222', email: 'jane@example.com',
    address: '12 Example Street, Example QLD 4000' },
  { id: 'c2', name: 'Jane Smith', phone: '0400 333 444', email: 'jane.s@example.com',
    address: '98 Other Road, Elsewhere QLD 4001' }
];

test('a phone number matches however it was typed', () => {
  for (const phone of ['0400111222', '0400 111 222', '+61 400 111 222', '61400111222']) {
    const m = matchCustomer({ name: 'J Smith', phone }, CUSTOMERS);
    assert.equal(m.customer?.id, 'c1', phone + ' should match c1.');
    assert.equal(m.matchedOn, 'phone');
  }
});

test('an email address matches when there is no phone number', () => {
  const m = matchCustomer({ name: '', email: 'JANE.S@Example.com' }, CUSTOMERS);
  assert.equal(m.customer?.id, 'c2');
  assert.equal(m.matchedOn, 'email');
});

test('the same name at a different address is a different customer', () => {
  const m = matchCustomer({ name: 'Jane Smith', siteAddress: '5 New Street, Example QLD' },
    CUSTOMERS);
  assert.equal(m.customer, null,
    'Matching a name alone merges two households. It must not match.');
});

test('the same name at the same address is the same customer', () => {
  const m = matchCustomer({ name: 'jane  smith',
    siteAddress: '12 Example Street, Example QLD  4000' }, CUSTOMERS);
  assert.equal(m.customer?.id, 'c1');
  assert.equal(m.matchedOn, 'name_and_address');
});

test('a short or empty phone number never matches on its own', () => {
  assert.equal(matchCustomer({ name: 'Nobody', phone: '' }, CUSTOMERS).customer, null);
  assert.equal(matchCustomer({ name: 'Nobody', phone: '12' }, CUSTOMERS).customer, null);
});
