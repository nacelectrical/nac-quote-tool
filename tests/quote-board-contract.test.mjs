// ─────────────────────────────────────────────────────────────────────────────
// quote.board — THE CONTRACT THE OPS ASSISTANT IS BEING BUILT AGAINST
//
// Nick, 8 November 2026: "The assistant is implementing the current quote.board
// interface now. Preserve its existing request and response contract. Prefer
// backward-compatible additions."
//
// So this suite is in two halves and the first one matters more:
//
//   1. WHAT MUST NOT MOVE. The two stages the assistant has already been
//      given, field for field, and the three money keys. If a rename slips in,
//      this fails here rather than in the assistant's briefing next week.
//
//   2. WHAT WAS ADDED. Enquiries, drafts, awaiting-approval and handovers, in
//      the same panel shape — and what they are NOT allowed to carry: no
//      internal costs, no margins, no supplier prices, no customer contact
//      details, and no blocker prose with a dollar figure in it.
//
// Run against a real database, because the whole value of the board is which
// sources answered and a stubbed source always answers.
// ─────────────────────────────────────────────────────────────────────────────

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { startRest, reset, sql } from './helpers/pg-rest.mjs';
import { SCOPES } from '../designer/engines/ops-api.mjs';
import { enquiryFromIntake, toRow } from '../designer/engines/enquiry.mjs';

const HAVE_PG = existsSync('/usr/lib/postgresql/16/bin/psql');

const SECRET = 'test-board-secret-000000000000';
const KEYED = { Authorization: 'Bearer ' + SECRET };
const READ_ONLY_KEY = [{ id: 'test-assistant', name: 'Test assistant (local only)',
                         secret: SECRET, scopes: [SCOPES.QUOTE_READ] }];
const NO_READ_KEY = [{ id: 'test-delivery', name: 'Delivery only (local)',
                       secret: SECRET, scopes: [SCOPES.DELIVERY_READ] }];

/** Phone and email that must never appear in a board response. */
const PHONE = '0400 000 111';
const EMAIL = 'test.enquiry@example.invalid';

function call(handler, { method = 'POST', query = {}, body = null, headers = {} } = {}) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200, headers: {},
      setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; },
      status(c) { this.statusCode = c; return this; },
      json(o) { resolve({ status: this.statusCode, body: o }); return this; },
      send(o) { return this.json(o); },
      end(o) { return this.json(o ?? null); }
    };
    Promise.resolve(handler({ method, query, body, headers }, res)).catch((e) => {
      resolve({ status: 500, body: { error: 'threw', message: String(e && e.message),
                                     stack: String(e && e.stack) } });
    });
  });
}

async function setup({ keys = READ_ONLY_KEY } = {}) {
  reset();
  process.env.SUPABASE_KEY = 'test-service-key';
  process.env.NAC_OPS_KEYS = JSON.stringify(keys);
  sql("insert into public.nac_presentation_content (key, data, updated_at) values "
    + "('library', $j${\"upgrades\":[]}$j$::jsonb, now())");
  return (await import('../server/ops.js')).default;
}

const board = (h, body = {}) =>
  call(h, { headers: KEYED, body: { operation: 'quote.board', ...body } });

// ── FIXTURES ───────────────────────────────────────────────────────────────

function issue({ token, revision = 1, status = 'issued', accepted = false,
                 total = 15716, designId = null } = {}) {
  const data = {
    token, quoteRevision: revision, designId,
    customer: { name: 'TEST CUSTOMER (do not contact)', phone: PHONE, email: EMAIL },
    job: { siteAddress: '7 Example Court, Testville QLD 4000' },
    offer: { schema: 'nac.offer.v1' },
    totalIncGst: total, viewCount: 0, offerFingerprint: 'fp-1',
    ...(accepted ? { acceptance: { customerName: 'TEST CUSTOMER',
      acceptedAt: '2026-11-08T01:00:00.000Z', totalIncGst: total,
      selectedOptionIds: [], signature: 'x' } } : {})
  };
  sql("insert into public.nac_quote_issues (token, design_id, quote_rev, status, "
    + "issued_at, data) values ('" + token + "', "
    + (designId ? "'" + designId + "'" : 'null') + ", " + revision + ", '" + status
    + "', now(), $j$" + JSON.stringify(data) + "$j$::jsonb)");
}

/**
 * A draft that the gate refuses, so the blocker path is exercised. The real
 * blocker messages carry money — "worth $1,240.00 of placeholder rates" — and
 * that is exactly what must not leave this endpoint.
 */
function draft(id, { approved = false } = {}) {
  const d = {
    schema: 'nac.quote.draft.v1', quoteOnly: true, id,
    customer: { name: 'TEST DRAFT CUSTOMER', phone: PHONE, email: EMAIL },
    siteAddress: '9 Example Street, Testville QLD 4000',
    systems: [{ id: 'sys-1', brand: 'Daikin', model: 'FDYAN100AV1',
                supplierCost: 4800, priceIncGst: approved ? 17500 : null }],
    scope: { conditionedRooms: [{ label: 'Living' }] },
    ...(approved ? { approvedBy: 'owner@example.invalid' } : {})
  };
  sql("insert into public.nac_designs (id, customer_name, status, design, updated_at) "
    + "values ('" + id + "', 'TEST DRAFT CUSTOMER', 'draft', $j$"
    + JSON.stringify(d) + "$j$, now())");
}

function enquiry(id) {
  const r = toRow(enquiryFromIntake(
    { client: 'TEST ENQUIRY (do not contact)', phone: PHONE, email: EMAIL,
      address: '11 Example Parade, Testville QLD 4000' },
    { id, pack: 'CONDITIONED_M2: 108\nCONFIDENCE: MEDIUM', now: 1 }));
  const cols = Object.keys(r);
  const vals = cols.map(k => {
    const v = r[k];
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'object') return '$j$' + JSON.stringify(v) + '$j$::jsonb';
    return "'" + String(v).replace(/'/g, "''") + "'";
  });
  sql('insert into public.nac_enquiries (' + cols.map(c => '"' + c + '"').join(',')
    + ') values (' + vals.join(',') + ')');
}

// ── 1. WHAT MUST NOT MOVE ──────────────────────────────────────────────────

test('the two stages the assistant already has keep their exact shape',
  { skip: !HAVE_PG && 'needs PostgreSQL' }, async (t) => {
  const stop = await startRest(); t.after(() => stop());
  const h = await setup();
  issue({ token: 'tok-out' });
  issue({ token: 'tok-yes', status: 'accepted', accepted: true, total: 21000 });

  const out = await board(h);
  assert.equal(out.status, 200, JSON.stringify(out.body));
  const b = out.body;

  assert.ok(typeof b.generatedAt === 'string');
  assert.ok(typeof b.source === 'string');
  assert.ok(Array.isArray(b.notYetExposed), 'notYetExposed is still an array');

  for (const key of ['awaitingResponse', 'accepted']) {
    const p = b.stages[key];
    assert.deepEqual(Object.keys(p).sort(),
      ['available', 'count', 'items', 'truncated'],
      key + ' changed shape — the assistant is built against this');
    assert.equal(p.available, true);
    assert.equal(p.count, 1);
    assert.equal(p.truncated, false);
    assert.deepEqual(Object.keys(p.items[0]).sort(),
      ['action', 'ageDays', 'name', 'ref', 'site', 'stage', 'totalIncGst', 'totalSource'],
      key + ' item fields changed');
  }

  assert.equal(b.stages.awaitingResponse.items[0].ref, 'tok-out');
  assert.equal(b.stages.awaitingResponse.items[0].totalIncGst, 15716);
  assert.equal(b.stages.awaitingResponse.items[0].totalSource, 'issued revision');
  assert.equal(b.stages.accepted.items[0].totalSource, 'acceptance record');

  assert.deepEqual(Object.keys(b.money).sort(),
    ['acceptedIncGst', 'awaitingResponseIncGst', 'note']);
  assert.equal(b.money.awaitingResponseIncGst, 15716);
  assert.equal(b.money.acceptedIncGst, 21000);
});

test('money still counts only issued revisions and acceptances',
  { skip: !HAVE_PG && 'needs PostgreSQL' }, async (t) => {
  const stop = await startRest(); t.after(() => stop());
  const h = await setup();
  issue({ token: 'tok-a', total: 10000 });
  draft('Q-DRAFT-BIG');          // a draft with a price nobody has approved

  const b = (await board(h)).body;
  assert.equal(b.money.awaitingResponseIncGst, 10000,
    'a draft total is a number somebody is still typing and is not pipeline value');
  assert.match(b.money.note, /Drafts are not counted/);
});

test('it needs the quote:read scope and nothing else opens it',
  { skip: !HAVE_PG && 'needs PostgreSQL' }, async (t) => {
  const stop = await startRest(); t.after(() => stop());
  const h = await setup({ keys: NO_READ_KEY });
  const out = await board(h);
  assert.equal(out.status, 403);
  assert.match(JSON.stringify(out.body), /scope/i);
});

test('the board is read-only — there is no write anywhere in it',
  { skip: !HAVE_PG && 'needs PostgreSQL' }, async (t) => {
  const stop = await startRest(); t.after(() => stop());
  const h = await setup();
  issue({ token: 'tok-ro' });
  const before = sql('select count(*) from public.nac_quote_issues').trim();
  await board(h);
  assert.equal(sql('select count(*) from public.nac_quote_issues').trim(), before);
  assert.equal(sql('select count(*) from public.nac_handovers').trim(), '0');
});

// ── 2. WHAT WAS ADDED ──────────────────────────────────────────────────────

test('enquiries, drafts, approvals and handovers are exposed in the same shape',
  { skip: !HAVE_PG && 'needs PostgreSQL' }, async (t) => {
  const stop = await startRest(); t.after(() => stop());
  const h = await setup();
  enquiry('NAC-TESTENQ-1');
  draft('Q-PREPARING');
  draft('Q-FORAPPROVAL', { approved: true });
  issue({ token: 'tok-i' });

  const b = (await board(h)).body;

  for (const key of ['enquiries', 'draftsInProgress', 'awaitingOwnerApproval', 'handovers']) {
    const p = b.stages[key];
    assert.ok(p, key + ' is missing');
    assert.ok(['available', 'count', 'items', 'truncated'].every(f => f in p),
      key + ' does not have the panel shape');
  }

  assert.equal(b.stages.enquiries.available, true);
  assert.equal(b.stages.enquiries.count, 1);
  assert.equal(b.stages.enquiries.items[0].ref, 'NAC-TESTENQ-1');

  // The gate decides which of the two draft stages a draft is in — this does
  // not re-implement it.
  const drafts = b.stages.draftsInProgress;
  const approvals = b.stages.awaitingOwnerApproval;
  assert.equal(drafts.count + approvals.count, 2, JSON.stringify({ drafts, approvals }));
  assert.ok(approvals.count >= 1, 'the approved draft should be waiting on Nick');

  // notYetExposed named these four. It is now empty and still an array.
  assert.deepEqual(b.notYetExposed, []);

  // Which sources answered, said plainly.
  assert.deepEqual(b.sources,
    { issued: 'ok', drafts: 'ok', enquiries: 'ok', handovers: 'ok' });
});

test('a draft carries blocker CODES and never the message, which has money in it',
  { skip: !HAVE_PG && 'needs PostgreSQL' }, async (t) => {
  const stop = await startRest(); t.after(() => stop());
  const h = await setup();
  draft('Q-BLOCKED');

  const b = (await board(h)).body;
  const rows = [...b.stages.draftsInProgress.items, ...b.stages.awaitingOwnerApproval.items];
  assert.ok(rows.length >= 1);
  const row = rows[0];
  assert.ok(Array.isArray(row.blockers), 'the codes');
  assert.ok(typeof row.blockerCount === 'number');
  for (const code of row.blockers) {
    assert.match(code, /^[A-Z_]+$/,
      'a blocker must be a code, not prose: ' + JSON.stringify(code));
  }
  assert.ok(!JSON.stringify(b).includes('$'),
    'the response carries a dollar sign, so a blocker message got through');
});

test('a handover is reported with its stage and never as synced without a job id',
  { skip: !HAVE_PG && 'needs PostgreSQL' }, async (t) => {
  const stop = await startRest(); t.after(() => stop());
  const h = await setup();
  issue({ token: 'tok-h', status: 'accepted', accepted: true });
  sql("insert into public.nac_handovers (id, quote_token, revision, state, sync_state, "
    + "ready_to_book, prepared_at, data) values ('tok-h:1', 'tok-h', 1, 'prepared', "
    + "'prepared', false, now(), $j$" + JSON.stringify({
        id: 'tok-h:1', quoteToken: 'tok-h', revision: 1,
        customer: { name: 'TEST CUSTOMER' },
        property: { siteAddress: '7 Example Court' },
        deposit: { state: 'unknown' }, equipment: { state: 'unknown' },
        scheduling: { state: 'unknown' }, outstanding: ['Deposit received — not checked'],
        readyToBook: false,
        // A row that LIES about being synced. The board must not repeat it.
        sync: { state: 'synced', externalId: null }
      }) + "$j$::jsonb)");

  const b = (await board(h)).body;
  const p = b.stages.handovers;
  assert.equal(p.available, true);
  assert.equal(p.count, 1);
  const row = p.items[0];
  assert.equal(row.ref, 'tok-h:1');
  assert.notEqual(row.stage, 'synced',
    'Nick: "Never display it as successfully synced." There is no job id.');
  assert.equal(row.externalId, null);
  assert.equal(row.deposit, 'unknown');
  assert.equal(row.outstandingCount, 1);
});

// ── 3. THE RULES THAT HOLD ACROSS EVERY STAGE ──────────────────────────────

test('count is the true total and limit truncates only the list',
  { skip: !HAVE_PG && 'needs PostgreSQL' }, async (t) => {
  const stop = await startRest(); t.after(() => stop());
  const h = await setup();
  for (let i = 0; i < 5; i++) issue({ token: 'tok-' + i });

  const b = (await board(h, { limit: 2 })).body;
  const p = b.stages.awaitingResponse;
  assert.equal(p.count, 5, 'a briefing that says "2 waiting" because the page size '
    + 'was 2 under-reports the week');
  assert.equal(p.items.length, 2);
  assert.equal(p.truncated, true);
});

test('an unreadable source is unavailable with a null count, never zero',
  { skip: !HAVE_PG && 'needs PostgreSQL' }, async (t) => {
  const stop = await startRest(); t.after(() => stop());
  const h = await setup();
  issue({ token: 'tok-ok' });
  // The enquiry reader asks for a column that is no longer there, which is the
  // real shape of the nac_designs `design`/`data` bug.
  sql('alter table public.nac_enquiries rename column site_address to site_address_x');
  t.after(() => sql('alter table public.nac_enquiries '
    + 'rename column site_address_x to site_address'));

  const b = (await board(h)).body;
  assert.equal(b.stages.enquiries.available, false);
  assert.equal(b.stages.enquiries.count, null, 'null, not 0');
  assert.deepEqual(b.stages.enquiries.items, []);
  assert.equal(b.sources.enquiries, 'unreadable');
  // And one bad source does not take the rest of the board down.
  assert.equal(b.stages.awaitingResponse.available, true);
  assert.equal(b.stages.awaitingResponse.count, 1);
});

test('a handover table that has not been created yet reads not_created, not none',
  { skip: !HAVE_PG && 'needs PostgreSQL' }, async (t) => {
  const stop = await startRest(); t.after(() => stop());
  const h = await setup();
  sql('drop table public.nac_handovers');
  t.after(() => sql("create table if not exists public.nac_handovers (id text primary key, "
    + "quote_token text not null, revision integer not null default 1, design_id text, "
    + "state text not null default 'prepared', sync_state text not null default 'prepared', "
    + "external_id text, ready_to_book boolean not null default false, prepared_by text, "
    + "prepared_at timestamptz not null default now(), "
    + "updated_at timestamptz not null default now(), data jsonb not null, "
    + "constraint nac_handovers_one_per_revision unique (quote_token, revision), "
    + "constraint nac_handovers_synced_needs_id check (sync_state <> 'synced' or "
    + "(external_id is not null and length(external_id) > 0)))"));

  const b = (await board(h)).body;
  assert.equal(b.stages.handovers.available, false);
  assert.equal(b.stages.handovers.count, null);
  assert.equal(b.sources.handovers, 'not_created');
});

test('no customer contact detail leaves this endpoint, at any stage',
  { skip: !HAVE_PG && 'needs PostgreSQL' }, async (t) => {
  const stop = await startRest(); t.after(() => stop());
  const h = await setup();
  enquiry('NAC-TESTENQ-2');
  draft('Q-D1');
  issue({ token: 'tok-c' });
  issue({ token: 'tok-acc', status: 'accepted', accepted: true });

  const text = JSON.stringify((await board(h)).body);
  // The assistant reaches customers through Podium and ServiceM8, where their
  // details already are.
  assert.ok(!text.includes(PHONE), 'a phone number reached the integration');
  assert.ok(!text.includes(EMAIL), 'an email address reached the integration');
  assert.ok(!/0400/.test(text), 'something phone-shaped reached the integration');
});

test('no internal cost, margin or supplier price leaves this endpoint',
  { skip: !HAVE_PG && 'needs PostgreSQL' }, async (t) => {
  const stop = await startRest(); t.after(() => stop());
  const h = await setup();
  draft('Q-COSTS');            // carries supplierCost: 4800
  issue({ token: 'tok-m' });

  const body = (await board(h)).body;
  const text = JSON.stringify(body);
  assert.ok(!text.includes('4800'), 'a supplier cost reached the integration');
  for (const word of ['supplierCost', 'costExGst', 'feeExGst', 'jobFee', 'margin',
                      'pricedBy', 'proposalAllowance']) {
    assert.ok(!text.includes(word), word + ' reached the integration');
  }
  // The only money is the customer-facing total, and it names its source.
  for (const row of body.stages.awaitingResponse.items) {
    if (row.totalIncGst !== null) assert.ok(row.totalSource, 'a figure with no source');
  }
});

test('the operation still refuses every money field on the way IN',
  { skip: !HAVE_PG && 'needs PostgreSQL' }, async (t) => {
  const stop = await startRest(); t.after(() => stop());
  const h = await setup();
  // The board takes `limit` and nothing else. A price sent to it must not be
  // quietly ignored either — ops.js refuses money by name, every time.
  const out = await board(h, { priceIncGst: 1 });
  assert.ok([200, 400, 422].includes(out.status));
  if (out.status === 200) {
    assert.ok(!JSON.stringify(out.body).includes('"priceIncGst"'));
  } else {
    assert.match(JSON.stringify(out.body), /price|money|refus/i);
  }
});
