// ─────────────────────────────────────────────────────────────────────────────
// ENQUIRIES AND HANDOVERS, AGAINST A REAL DATABASE
//
// The two things that had no store, now stored — and tested the way the
// `nac_designs.design` / `.data` bug should have been. That bug was three
// endpoints asking PostgREST for a column that existed in neither schema file,
// and it survived for weeks because EVERY test stubbed the REST call. So these
// run the real endpoints, unmodified, against PostgreSQL carrying the real
// migration.
//
// Needs PostgreSQL. Skipped with a reason when there is not one.
// ─────────────────────────────────────────────────────────────────────────────

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { startRest, reset, sql } from './helpers/pg-rest.mjs';
import { enquiryFromIntake, toRow, ENQUIRY_STATE } from '../designer/engines/enquiry.mjs';
import { CONFIRMATION, HANDOVER_STAGE } from '../designer/engines/handover.mjs';
import { buildRoom, manualMeasurement } from '../designer/engines/rooms.mjs';
import { DEFAULT_SETTINGS } from '../designer/engines/settings.mjs';

const HAVE_PG = existsSync('/usr/lib/postgresql/16/bin/psql');

/** Two accounts, clearly labelled. Nobody real. */
const OWNER = { token: 'test-owner-token', id: 'u-owner',
                email: 'owner@example.invalid' };
const TECH = { token: 'test-tech-token', id: 'u-tech',
               email: 'tech@example.invalid' };

const PACK = [
  'SIZE:            15.7 kW  (conditioned area 108 m2 x 145)',
  'CONDITIONED_M2: 108',
  'CONFIDENCE:      MEDIUM',
  'ACTION:          NEEDS REVIEW',
  'FLAGS:           None',
  'ROOMS COUNTED:   Living 32, Bed 1 12',
  'NOT COUNTED:     Double garage, Laundry'
].join('\n');

function call(handler, { method = 'GET', query = {}, body = null, as = null } = {}) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200, headers: {},
      setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; },
      status(c) { this.statusCode = c; return this; },
      json(o) { resolve({ status: this.statusCode, body: o }); return this; },
      send(o) { return this.json(o); },
      end(o) { return this.json(o ?? null); }
    };
    const headers = as ? { authorization: 'Bearer ' + as.token } : {};
    Promise.resolve(handler({ method, query, body, headers }, res)).catch((e) => {
      resolve({ status: 500, body: { error: 'threw', message: String(e && e.message),
                                     stack: String(e && e.stack) } });
    });
  });
}

/**
 * The sign-in check, stubbed for TWO named tokens and nothing else.
 *
 * A stub that said yes to anything would let the whole permission layer pass
 * its own test while refusing nobody.
 */
function stubAuth() {
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const auth = String((opts && opts.headers && opts.headers.Authorization) || '');
    if (!String(url).includes('/auth/v1/user')) {
      return { ok: false, status: 404, json: async () => ({}) };
    }
    for (const who of [OWNER, TECH]) {
      if (auth === 'Bearer ' + who.token) {
        return { ok: true, json: async () => ({ id: who.id, email: who.email }) };
      }
    }
    return { ok: false, status: 401, json: async () => ({}) };
  };
  return () => { globalThis.fetch = real; };
}

async function harness() {
  const stop = await startRest();
  const unauth = stubAuth();
  process.env.SUPABASE_KEY = 'test-service-key';
  // The owner is named in the deployment allowlist. Nobody else is.
  process.env.NAC_OWNER_EMAILS = OWNER.email;
  reset();
  const enquiries = (await import('../server/enquiries.js')).default;
  const handover = (await import('../server/handover.js')).default;
  const whoami = (await import('../server/whoami.js')).default;
  return {
    enquiries, handover, whoami,
    done() { unauth(); stop(); }
  };
}

// ── WHO AM I ───────────────────────────────────────────────────────────────

test('whoami reports a real role and never the allowlist', { skip: !HAVE_PG }, async () => {
  const h = await harness();
  try {
    const owner = await call(h.whoami, { as: OWNER });
    assert.equal(owner.body.role, 'owner');
    assert.equal(owner.body.rolesConfigured, true);
    assert.equal(owner.body.decidedBy, 'NAC_OWNER_EMAILS');
    assert.ok(owner.body.capabilities.includes('view_internal_pricing'));

    const tech = await call(h.whoami, { as: TECH });
    assert.equal(tech.body.role, 'technician');
    assert.ok(!tech.body.capabilities.includes('view_internal_pricing'));
    assert.ok(tech.body.capabilities.includes('assess'),
      'a technician must still be able to do the assessment');

    // Not the allowlist, not a count of owners, not anybody else's email.
    const text = JSON.stringify(tech.body);
    assert.ok(!text.includes(OWNER.email), 'whoami leaked another account');

    const out = await call(h.whoami);
    assert.equal(out.body.signedIn, false);
    assert.equal(out.status, 200, 'not signed in is an answer, not a failure');
  } finally { h.done(); }
});

// ── ENQUIRIES ──────────────────────────────────────────────────────────────

test('an empty database is a real zero, not an unknown', { skip: !HAVE_PG }, async () => {
  const h = await harness();
  try {
    const out = await call(h.enquiries, { as: TECH });
    assert.equal(out.status, 200);
    assert.equal(out.body.available, true);
    assert.equal(out.body.count, 0, 'a successful read of nothing IS zero');
    assert.deepEqual(out.body.enquiries, []);
  } finally { h.done(); }
});

test('a pre-table enquiry is read out of the quote notes', { skip: !HAVE_PG }, async () => {
  const h = await harness();
  try {
    sql("insert into public.nac_quotes (id, client, notes, accepted) values "
      + "('NAC-OLDCUST-1', 'TEST OLD ENQUIRY', 'INTAKE DRAFT | 0400 000 111 | "
      + "7 Example Court\n\n" + PACK.replace(/'/g, "''")
      + "\n\nPHOTOS:\nhttps://x.invalid/plan-a.pdf\nhttps://x.invalid/photo-1.jpg', false)");
    // A normal quote, which is NOT an enquiry and must not appear.
    sql("insert into public.nac_quotes (id, client, notes) values "
      + "('NAC-NORMAL-1', 'Not an enquiry', 'Just a quote')");

    const out = await call(h.enquiries, { as: TECH });
    assert.equal(out.body.available, true);
    assert.equal(out.body.count, 1, 'only the INTAKE DRAFT row is an enquiry');
    const e = out.body.enquiries[0];
    assert.equal(e.id, 'NAC-OLDCUST-1');
    assert.equal(e.source, 'legacy_quote_notes');
    assert.equal(e.customer.phone, '0400 000 111');
    assert.equal(e.assessment.conditionedAreaSqM, 108);
    assert.equal(e.planUrl, 'https://x.invalid/plan-a.pdf');
    assert.ok(/not been created yet|^$/.test(out.body.note || ''),
      'the note explains which source answered');
  } finally { h.done(); }
});

test('the real table wins over the legacy row for the same id', { skip: !HAVE_PG }, async () => {
  const h = await harness();
  try {
    sql("insert into public.nac_quotes (id, client, notes) values "
      + "('E-DUP', 'Old copy', 'INTAKE DRAFT | 0400 | Somewhere')");
    const e = enquiryFromIntake({ client: 'New copy', phone: '0400 999 888',
      address: '9 Example St' }, { id: 'E-DUP', pack: PACK, now: 1 });
    insertEnquiry(e);

    const out = await call(h.enquiries, { as: TECH });
    assert.equal(out.body.count, 1, 'one enquiry, not two');
    assert.equal(out.body.enquiries[0].source, 'intake_form');
    assert.equal(out.body.enquiries[0].customer.phone, '0400 999 888');
  } finally { h.done(); }
});

test('an unreadable source is unavailable with a NULL count', { skip: !HAVE_PG }, async () => {
  const h = await harness();
  try {
    // A column the reader asks for, gone. This is the real shape of the
    // nac_designs bug: the request reaches Postgres and comes back 400.
    sql('alter table public.nac_enquiries rename column customer_name to customer_name_x');
    const out = await call(h.enquiries, { as: TECH });
    assert.equal(out.status, 502);
    assert.equal(out.body.available, false);
    assert.equal(out.body.count, null, 'unknown is null, never 0');
    assert.equal(out.body.enquiries, null, 'and never an empty list');
    assert.match(out.body.note, /unknown rather than zero/);
  } finally {
    sql('alter table public.nac_enquiries rename column customer_name_x to customer_name');
    h.done();
  }
});

test('a missing enquiry table is not the same as a failed read', { skip: !HAVE_PG }, async () => {
  const h = await harness();
  try {
    sql("insert into public.nac_quotes (id, client, notes) values "
      + "('E-LEG', 'Legacy only', 'INTAKE DRAFT | 0400 | Somewhere')");
    sql('drop table public.nac_enquiries');
    const out = await call(h.enquiries, { as: TECH });
    assert.equal(out.status, 200, 'a table that has not been created yet is a '
      + 'deployment step, not a failure');
    assert.equal(out.body.available, true);
    assert.equal(out.body.count, 1);
    assert.match(out.body.note, /enquiries-handovers-schema\.sql/);
  } finally {
    sql('create table if not exists public.nac_enquiries (id text primary key, '
      + 'received_at timestamptz, source text, customer_name text, phone text, '
      + 'email text, site_address text, property_type text, existing_ac text, '
      + 'preferred_brand text, comments text, plan_url text, photo_urls jsonb, '
      + 'assessment jsonb, state text, closed_reason text, design_id text, '
      + 'quote_id text, issued_token text, legacy_quote_id text, updated_at timestamptz)');
    h.done();
  }
});

test('linking an enquiry to its assessment, and refusing to overwrite one',
  { skip: !HAVE_PG }, async () => {
  const h = await harness();
  try {
    insertEnquiry(enquiryFromIntake({ client: 'Linkable', phone: '0400 1',
      address: '1 Example St' }, { id: 'E-LINK', pack: PACK, now: 1 }));

    const linked = await call(h.enquiries,
      { method: 'POST', as: TECH, body: { id: 'E-LINK', link: { designId: 'Q-1' } } });
    assert.equal(linked.status, 200);
    assert.equal(linked.body.state, ENQUIRY_STATE.ASSESSING);
    assert.equal(linked.body.links.designId, 'Q-1');

    // It is in the database, not only in the response.
    assert.equal(sql("select design_id from public.nac_enquiries where id = 'E-LINK'").trim(),
      'Q-1');

    // The builder calls this on every save. A repeat has to be quiet.
    const again = await call(h.enquiries,
      { method: 'POST', as: TECH, body: { id: 'E-LINK', link: { designId: 'Q-1' } } });
    assert.equal(again.status, 200);

    // A DIFFERENT design is a conflict, and nothing is changed.
    const clash = await call(h.enquiries,
      { method: 'POST', as: TECH, body: { id: 'E-LINK', link: { designId: 'Q-2' } } });
    assert.equal(clash.status, 409);
    assert.equal(clash.body.error, 'link_conflict');
    assert.equal(sql("select design_id from public.nac_enquiries where id = 'E-LINK'").trim(),
      'Q-1', 'the first link survived the attempt');

    const missing = await call(h.enquiries,
      { method: 'POST', as: TECH, body: { id: 'E-NOPE', link: { designId: 'Q-9' } } });
    assert.equal(missing.status, 404);
  } finally { h.done(); }
});

test('an enquiry needs a sign-in', { skip: !HAVE_PG }, async () => {
  const h = await harness();
  try {
    const out = await call(h.enquiries, {});
    assert.equal(out.status, 401);
    assert.equal(out.body.error, 'sign_in_required');
  } finally { h.done(); }
});

// ── HANDOVERS ──────────────────────────────────────────────────────────────

function insertEnquiry(e) {
  const r = toRow(e);
  const cols = Object.keys(r);
  const vals = cols.map(k => {
    const v = r[k];
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'object') return "$j$" + JSON.stringify(v) + "$j$::jsonb";
    return "'" + String(v).replace(/'/g, "''") + "'";
  });
  sql('insert into public.nac_enquiries (' + cols.map(c => '"' + c + '"').join(',')
    + ') values (' + vals.join(',') + ')');
}

/** An issued revision in the database, accepted or not. */
function insertIssue({ token = 'tok-1', revision = 1, status = 'issued',
                       accepted = false, designId = 'Q-D1' } = {}) {
  const data = {
    token, quoteRevision: revision, designId, proposalNumber: 'NAC-TEST-1',
    offerFingerprint: 'fp-test',
    customer: { name: 'TEST CUSTOMER (do not contact)', phone: '0400 000 111' },
    job: { siteAddress: '7 Example Court, Testville QLD 4000' },
    offer: { inclusions: ['Supply and install'], exclusions: ['Switchboard upgrade'],
             scopeOfWork: { summary: 'Ducted, six outlets' } },
    totalIncGst: 15716,
    ...(accepted ? { acceptance: { customerName: 'TEST CUSTOMER',
        acceptedAt: '2026-11-08T01:00:00.000Z', totalIncGst: 15716,
        chosenSystemId: 'sys-2', selectedOptionIds: ['opt-wifi'],
        signature: 'data:image/png;base64,xx' } } : {})
  };
  sql("insert into public.nac_quote_issues (token, design_id, quote_rev, status, "
    + "issued_at, data) values ('" + token + "', '" + designId + "', " + revision
    + ", '" + status + "', now(), $j$" + JSON.stringify(data) + "$j$::jsonb)");
  return data;
}

/** A stored design whose sizing raises a site check. */
function insertDesign(id = 'Q-D1') {
  const design = {
    schema: 'nac.quote.draft.v1', id,
    customer: { name: 'TEST CUSTOMER (do not contact)' },
    siteAddress: '7 Example Court',
    // Built with the real room engine, not by hand: a hand-written room is not
    // a room record and `sizableRooms` rightly refuses it, which made this
    // fixture raise NO_ROOMS_SIZED instead of the per-room check it is for.
    rooms: [
      buildRoom({ id: 'r1', label: 'Living',
                  measurement: manualMeasurement(5000, 6400, 'Tape on site') },
                { settings: DEFAULT_SETTINGS }),
      // No dimension. This is what has to reach the crew.
      buildRoom({ id: 'r2', label: 'Bed 3' }, { settings: DEFAULT_SETTINGS })
    ]
  };
  // `design` is a TEXT column holding the draft as a JSON STRING — that is
  // what store.mjs writes and what server/design-row.js reads. Stringifying it
  // twice stores a quoted string, parseDesign gets a string back rather than
  // an object, and the row reads as holding nothing.
  sql("insert into public.nac_designs (id, customer_name, status, design, updated_at) "
    + "values ('" + id + "', 'TEST CUSTOMER', 'draft', $j$"
    + JSON.stringify(design) + "$j$, now())");
  return design;
}

test('a handover cannot be prepared for a quote nobody accepted',
  { skip: !HAVE_PG }, async () => {
  const h = await harness();
  try {
    insertIssue({ token: 'tok-open', status: 'issued', accepted: false });
    const out = await call(h.handover,
      { method: 'POST', as: OWNER, body: { action: 'prepare', token: 'tok-open' } });
    assert.equal(out.status, 409);
    assert.equal(out.body.error, 'not_accepted');
    assert.equal(sql('select count(*) from public.nac_handovers').trim(), '0');
  } finally { h.done(); }
});

test('preparing one from an accepted revision stores it, with the site checks',
  { skip: !HAVE_PG }, async () => {
  const h = await harness();
  try {
    insertDesign('Q-D1');
    insertIssue({ token: 'tok-acc', revision: 2, status: 'accepted', accepted: true,
                  designId: 'Q-D1' });

    const out = await call(h.handover,
      { method: 'POST', as: OWNER, body: { action: 'prepare', token: 'tok-acc' } });
    assert.equal(out.status, 201, JSON.stringify(out.body));
    assert.equal(out.body.repeat, false);
    assert.equal(out.body.id, 'tok-acc:2');

    const ho = out.body.handover;
    assert.equal(ho.stage, HANDOVER_STAGE.PREPARED);
    assert.equal(ho.readyToBook, false);
    assert.equal(ho.accepted.totalIncGst, 15716);
    assert.deepEqual(ho.accepted.selectedOptionIds, ['opt-wifi']);
    assert.equal(ho.offerFingerprint, 'fp-test',
      'the handover names the exact offer that was signed for');
    assert.equal(ho.sync.externalId, null);
    assert.match(ho.sync.note, /Not sent to ServiceM8/);

    // The sizing's own readiness note, carried through to the crew.
    assert.ok(out.body.siteChecksCarriedOver >= 1,
      'the unmeasured room should raise a site check: '
      + JSON.stringify(out.body.siteChecksNote));
    assert.ok(ho.siteChecks.some(c => /Bed 3/.test(c.what)));
    assert.ok(ho.outstanding.some(o => /Site check/.test(o)));

    // And it is a row, with the stage in a column the board can read.
    const stored = sql("select state, sync_state, ready_to_book, external_id "
      + "from public.nac_handovers where id = 'tok-acc:2'").trim();
    assert.equal(stored, 'prepared|prepared|f|');
  } finally { h.done(); }
});

test('preparing it twice returns the first one, unchanged', { skip: !HAVE_PG }, async () => {
  const h = await harness();
  try {
    insertDesign('Q-D1');
    insertIssue({ token: 'tok-r', revision: 1, status: 'accepted', accepted: true });
    await call(h.handover, { method: 'POST', as: OWNER,
      body: { action: 'prepare', token: 'tok-r' } });

    // Confirm something, the way somebody would.
    await call(h.handover, { method: 'POST', as: OWNER, body: { action: 'update',
      id: 'tok-r:1', deposit: { state: 'confirmed', source: 'Xero payment PMT-1' } } });

    // Now a retry — which is what an acceptance retry looks like from here.
    const again = await call(h.handover, { method: 'POST', as: OWNER,
      body: { action: 'prepare', token: 'tok-r' } });
    assert.equal(again.status, 200);
    assert.equal(again.body.repeat, true);
    assert.equal(again.body.handover.deposit.state, CONFIRMATION.CONFIRMED,
      'a retry must never wipe a deposit somebody confirmed');
    assert.equal(again.body.handover.deposit.source, 'Xero payment PMT-1');
    assert.equal(sql('select count(*) from public.nac_handovers').trim(), '1');
  } finally { h.done(); }
});

test('the database itself refuses a second handover for one revision',
  { skip: !HAVE_PG }, async () => {
  const h = await harness();
  try {
    insertDesign('Q-D1');
    insertIssue({ token: 'tok-u', revision: 1, status: 'accepted', accepted: true });
    await call(h.handover, { method: 'POST', as: OWNER,
      body: { action: 'prepare', token: 'tok-u' } });

    // The guarantee must not depend on the endpoint winning a race with itself.
    let threw = null;
    try {
      sql("insert into public.nac_handovers (id, quote_token, revision, data) "
        + "values ('tok-u:1-other', 'tok-u', 1, '{}'::jsonb)");
    } catch (e) { threw = String(e.message); }
    assert.ok(threw && /nac_handovers_one_per_revision|duplicate key/i.test(threw),
      'the unique constraint should have refused it, got: ' + threw);
  } finally { h.done(); }
});

test('the database refuses a row that claims to be synced with no job id',
  { skip: !HAVE_PG }, async () => {
  const h = await harness();
  try {
    let threw = null;
    try {
      sql("insert into public.nac_handovers (id, quote_token, revision, sync_state, data) "
        + "values ('tok-x:1', 'tok-x', 1, 'synced', '{}'::jsonb)");
    } catch (e) { threw = String(e.message); }
    assert.ok(threw && /nac_handovers_synced_needs_id/.test(threw),
      'Nick: "Never display it as successfully synced." Got: ' + threw);
  } finally { h.done(); }
});

test('a technician may confirm the equipment and the date, and not the deposit',
  { skip: !HAVE_PG }, async () => {
  const h = await harness();
  try {
    insertDesign('Q-D1');
    insertIssue({ token: 'tok-p', revision: 1, status: 'accepted', accepted: true });
    const prepared = await call(h.handover, { method: 'POST', as: TECH,
      body: { action: 'prepare', token: 'tok-p' } });
    assert.equal(prepared.status, 201,
      'preparing a handover is a technician’s job');

    const site = await call(h.handover, { method: 'POST', as: TECH,
      body: { action: 'update', id: 'tok-p:1',
              equipment: { state: 'confirmed', source: 'On site, counted' },
              scheduling: { state: 'confirmed', source: 'Agreed with the customer' } } });
    assert.equal(site.status, 200);
    assert.equal(site.body.handover.equipment.state, CONFIRMATION.CONFIRMED);

    const money = await call(h.handover, { method: 'POST', as: TECH,
      body: { action: 'update', id: 'tok-p:1',
              deposit: { state: 'confirmed', source: 'I think it came in' } } });
    assert.equal(money.status, 403);
    assert.equal(money.body.required, 'confirm_deposit');
    assert.equal(sql("select data->'deposit'->>'state' from public.nac_handovers "
      + "where id = 'tok-p:1'").trim(), 'unknown', 'and nothing was written');
  } finally { h.done(); }
});

test('a confirmation with no source is demoted, and the response says so',
  { skip: !HAVE_PG }, async () => {
  const h = await harness();
  try {
    insertDesign('Q-D1');
    insertIssue({ token: 'tok-d', revision: 1, status: 'accepted', accepted: true });
    await call(h.handover, { method: 'POST', as: OWNER,
      body: { action: 'prepare', token: 'tok-d' } });

    const out = await call(h.handover, { method: 'POST', as: OWNER,
      body: { action: 'update', id: 'tok-d:1', deposit: { state: 'confirmed' } } });
    assert.equal(out.status, 200);
    assert.equal(out.body.handover.deposit.state, CONFIRMATION.UNKNOWN);
    assert.deepEqual(out.body.demoted, ['deposit'],
      'a demotion is easy to miss, so it is reported');
  } finally { h.done(); }
});

test('everything confirmed reads ready for scheduling, and still not synced',
  { skip: !HAVE_PG }, async () => {
  const h = await harness();
  try {
    insertIssue({ token: 'tok-ready', revision: 1, status: 'accepted', accepted: true,
                  designId: 'Q-NONE' });
    await call(h.handover, { method: 'POST', as: OWNER,
      body: { action: 'prepare', token: 'tok-ready' } });
    const out = await call(h.handover, { method: 'POST', as: OWNER,
      body: { action: 'update', id: 'tok-ready:1',
              deposit: { state: 'confirmed', source: 'Xero payment PMT-7' },
              equipment: { state: 'confirmed', source: 'MMEM order 44812' },
              scheduling: { state: 'confirmed', source: 'Booked 18 November' } } });
    assert.equal(out.body.handover.stage, HANDOVER_STAGE.READY_FOR_SCHEDULING);
    assert.equal(out.body.handover.readyToBook, true);
    assert.equal(out.body.handover.sync.state, 'prepared',
      'ready to book is not in ServiceM8');
    assert.equal(sql("select state, ready_to_book from public.nac_handovers "
      + "where id = 'tok-ready:1'").trim(), 'ready_for_scheduling|t');
  } finally { h.done(); }
});

test('a design that cannot be read carries NO site checks and says why',
  { skip: !HAVE_PG }, async () => {
  const h = await harness();
  try {
    // No design row at all for this revision.
    insertIssue({ token: 'tok-nod', revision: 1, status: 'accepted', accepted: true,
                  designId: 'Q-MISSING' });
    const out = await call(h.handover, { method: 'POST', as: OWNER,
      body: { action: 'prepare', token: 'tok-nod' } });
    assert.equal(out.status, 201);
    assert.equal(out.body.siteChecksCarriedOver, null,
      'null, not 0 — nobody looked, which is not the same as nothing to check');
    assert.match(out.body.siteChecksNote, /could not be read/);
  } finally { h.done(); }
});

test('there is no sync action on the endpoint at all', { skip: !HAVE_PG }, async () => {
  const h = await harness();
  try {
    const out = await call(h.handover, { method: 'POST', as: OWNER,
      body: { action: 'sync', id: 'tok-x:1' } });
    assert.equal(out.status, 400);
    assert.equal(out.body.error, 'unknown_action');
    assert.match(out.body.message, /ServiceM8 writes are not enabled/);
  } finally { h.done(); }
});

test('a missing handover table reports unknown, never none', { skip: !HAVE_PG }, async () => {
  const h = await harness();
  try {
    sql('drop table public.nac_handovers');
    const out = await call(h.handover, { as: OWNER });
    assert.equal(out.body.available, false);
    assert.equal(out.body.count, null);
    assert.equal(out.body.handovers, null);
    assert.match(out.body.note, /unknown rather than none/);
  } finally {
    sql("create table if not exists public.nac_handovers (id text primary key, "
      + "quote_token text not null, revision integer not null default 1, design_id text, "
      + "state text not null default 'prepared', sync_state text not null default 'prepared', "
      + "external_id text, ready_to_book boolean not null default false, prepared_by text, "
      + "prepared_at timestamptz not null default now(), "
      + "updated_at timestamptz not null default now(), data jsonb not null, "
      + "constraint nac_handovers_one_per_revision unique (quote_token, revision), "
      + "constraint nac_handovers_synced_needs_id check (sync_state <> 'synced' or "
      + "(external_id is not null and length(external_id) > 0)))");
    h.done();
  }
});
