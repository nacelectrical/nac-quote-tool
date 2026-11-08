// ─────────────────────────────────────────────────────────────────────────────
// OWNER AND TECHNICIAN
//
// The finding: every signed-in user could see NAC's cost prices, the job fee —
// which IS the margin on NAC's method — and the installation allowances.
// designer/rls.sql said so outright: "Any authenticated user is treated as NAC
// staff; there is no second tier."
//
// This suite holds the rules of the second tier. The part it CANNOT hold is
// the row-level policy that actually stops the read, because that is SQL and
// lives in designer/roles-rls.sql — so the last test in this file reads that
// file and checks it is the policy it claims to be.
// ─────────────────────────────────────────────────────────────────────────────

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ROLE, CAPABILITIES, INTERNAL_PRICING_FIELDS, can, capabilitiesOf, isRole,
  parseOwnerEmails, resolveRole, isConfigured, withoutInternalPricing
} from '../designer/engines/roles.mjs';
import { DEFAULT_SETTINGS } from '../designer/engines/settings.mjs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const USER = { id: 'u1', email: 'Nick@Example.Invalid' };

// ── THE DEFAULT IS CLOSED ──────────────────────────────────────────────────

test('with nothing configured, a signed-in user is a technician and not an owner', () => {
  // The bug this file fixes is a permission layer whose unconfigured state is
  // "everybody". If this ever returns owner, the fix has been undone.
  const who = resolveRole(USER, {});
  assert.equal(who.signedIn, true);
  assert.equal(who.role, ROLE.TECHNICIAN);
  assert.equal(who.configured, false);
  assert.equal(who.source, 'roles_not_configured');
  assert.equal(can(who.role, CAPABILITIES.VIEW_INTERNAL_PRICING), false);
  assert.match(who.note, /NAC_OWNER_EMAILS/,
    'an unconfigured deployment has to say what to set');
});

test('no token at all is not signed in, and holds nothing', () => {
  const who = resolveRole(null, { ownerEmails: ['nick@example.invalid'] });
  assert.equal(who.signedIn, false);
  assert.deepEqual(who.capabilities, []);
  assert.equal(who.role, null);
});

// ── WHERE A ROLE COMES FROM ────────────────────────────────────────────────

test('the owner allowlist is read case-insensitively', () => {
  const who = resolveRole(USER, { ownerEmails: parseOwnerEmails('NICK@example.invalid') });
  assert.equal(who.role, ROLE.OWNER);
  assert.equal(who.source, 'NAC_OWNER_EMAILS');
  assert.equal(who.configured, true);
});

test('the allowlist parser takes commas, spaces and semicolons and ignores junk', () => {
  assert.deepEqual(parseOwnerEmails('a@b.c, d@e.f;  g@h.i\nnotanemail'),
    ['a@b.c', 'd@e.f', 'g@h.i']);
  assert.deepEqual(parseOwnerEmails(''), []);
  assert.deepEqual(parseOwnerEmails(undefined), []);
});

test('the roles table decides when the allowlist does not name them', () => {
  const who = resolveRole(USER, {
    roleRows: [{ email: 'nick@example.invalid', role: 'admin' }]
  });
  assert.equal(who.role, ROLE.ADMIN);
  assert.equal(who.source, 'nac_staff_roles');
});

test('Supabase app_metadata wins, and user_metadata is ignored entirely', () => {
  // app_metadata can only be written by a Supabase admin. user_metadata is
  // writable BY THE USER, so reading a role out of it would let any account
  // promote itself.
  const admin = resolveRole({ ...USER, app_metadata: { nac_role: 'owner' } }, {});
  assert.equal(admin.role, ROLE.OWNER);
  assert.equal(admin.source, 'supabase_app_metadata');

  const selfPromoted = resolveRole({ ...USER, user_metadata: { nac_role: 'owner' } }, {});
  assert.equal(selfPromoted.role, ROLE.TECHNICIAN,
    'a role in user_metadata must not promote anybody');
});

test('a role word the application does not know promotes nobody', () => {
  for (const claimed of ['superuser', 'root', '', null, 'service_role', 'postgres']) {
    const who = resolveRole({ ...USER, app_metadata: { nac_role: claimed } }, {});
    assert.equal(who.role, ROLE.TECHNICIAN, 'claimed: ' + JSON.stringify(claimed));
  }
  assert.equal(isRole('owner'), true);
  assert.equal(isRole('nope'), false);
});

test('a role word is normalised for case and stray whitespace', () => {
  // app_metadata is typed into the Supabase dashboard by hand, so ' Owner ' is
  // a likely entry and refusing it would look like the role had not applied.
  // Normalising a KNOWN word is not the same as accepting an unknown one.
  for (const claimed of ['Owner', 'OWNER ', ' owner', 'Admin']) {
    const who = resolveRole({ ...USER, app_metadata: { nac_role: claimed } }, {});
    assert.ok([ROLE.OWNER, ROLE.ADMIN].includes(who.role),
      JSON.stringify(claimed) + ' should normalise to a known role');
  }
});

test('a roles table of technicians alone still counts as configured', () => {
  // Otherwise a deployment that had deliberately made everybody a technician
  // would read as "nobody has set this up" and the screens would say so.
  assert.equal(isConfigured({ roleRows: [{ email: 'a@b.c', role: 'technician' }] }), true);
  assert.equal(isConfigured({ roleRows: [{ email: 'junk', role: 'owner' }] }), false);
  assert.equal(isConfigured({}), false);
});

// ── WHAT EACH ROLE MAY DO ──────────────────────────────────────────────────

test('an owner may price, issue and confirm a deposit', () => {
  for (const cap of Object.values(CAPABILITIES)) {
    assert.equal(can(ROLE.OWNER, cap), true, 'owner should hold ' + cap);
    assert.equal(can(ROLE.ADMIN, cap), true, 'admin should hold ' + cap);
  }
});

test('a technician may do the work and may not see the money', () => {
  const allowed = [CAPABILITIES.ASSESS, CAPABILITIES.VIEW_QUOTE_STATUS,
                   CAPABILITIES.PREPARE_HANDOVER, CAPABILITIES.CONFIRM_SITE_FACTS];
  const refused = [CAPABILITIES.VIEW_INTERNAL_PRICING, CAPABILITIES.EDIT_PRICING_SETTINGS,
                   CAPABILITIES.ISSUE_QUOTE, CAPABILITIES.CONFIRM_DEPOSIT];
  for (const cap of allowed) {
    assert.equal(can(ROLE.TECHNICIAN, cap), true, 'a technician must still be able to ' + cap);
  }
  for (const cap of refused) {
    assert.equal(can(ROLE.TECHNICIAN, cap), false, 'a technician must not ' + cap);
  }
});

test('a technician is never blocked from the assessment work', () => {
  // A permission model that stops the crew working gets switched off within a
  // week, and then there is no permission model.
  assert.equal(can(ROLE.TECHNICIAN, CAPABILITIES.ASSESS), true);
  assert.equal(can(ROLE.TECHNICIAN, CAPABILITIES.PREPARE_HANDOVER), true);
});

test('an unknown role may do nothing at all', () => {
  assert.deepEqual(capabilitiesOf('auditor'), []);
  assert.deepEqual(capabilitiesOf(null), []);
  assert.equal(can('auditor', CAPABILITIES.ASSESS), false);
});

// ── STRIPPING THE FIGURES OUT OF A RESPONSE ────────────────────────────────

test('internal pricing is stripped from deep inside a settings record', () => {
  const stripped = withoutInternalPricing(DEFAULT_SETTINGS);
  assert.equal(stripped.commercial.jobFee, undefined);
  assert.equal(stripped.commercial.proposalAllowance, undefined);
  // And what is left is still a usable record, not an empty object.
  assert.ok(stripped.commercial.gstRate !== undefined,
    'the GST rate is on every customer invoice and is not a secret');
  assert.ok(stripped.load, 'the design settings survive');
});

test('the strip reaches into arrays and nested objects', () => {
  const out = withoutInternalPricing({
    systems: [{ model: 'X', supplierCost: 4200, priceIncGst: 15400 }],
    deep: { deeper: { margin: 0.3, keep: 'yes' } }
  });
  assert.equal(out.systems[0].supplierCost, undefined);
  assert.equal(out.systems[0].priceIncGst, 15400,
    'the price the customer is shown is not an internal figure');
  assert.equal(out.deep.deeper.margin, undefined);
  assert.equal(out.deep.deeper.keep, 'yes');
});

test('every commercial pricing field in the real settings record is named in the strip list', () => {
  // If somebody adds a field to settings.mjs and forgets this list, that is a
  // leak. This fails instead.
  const c = DEFAULT_SETTINGS.commercial;
  const suspicious = Object.keys(c).filter(k => /fee|cost|margin|allowance|rate/i.test(k))
    // gstRate is on the customer's own invoice. labour* hours are a method,
    // not a price, and labourRatePerHour IS in the list.
    .filter(k => !['gstRate', 'labourMode', 'pricingMode'].includes(k))
    .filter(k => !/^labourHours/.test(k));
  for (const k of suspicious) {
    assert.ok(INTERNAL_PRICING_FIELDS.includes(k),
      'settings.commercial.' + k + ' looks like an internal figure and is not in '
      + 'INTERNAL_PRICING_FIELDS, so it would be returned to a technician');
  }
});

// ── THE CONTROL THAT IS NOT IN JAVASCRIPT ──────────────────────────────────

test('the migration closes nac_settings to anybody who is not an owner', () => {
  // The browser reads nac_settings DIRECTLY over PostgREST with the user's own
  // token, so this policy is the only thing that actually stops a technician
  // reading the cost prices. Everything in this file above is the courtesy of
  // being told why.
  const sql = readFileSync(ROOT + '/designer/roles-rls.sql', 'utf8');
  assert.match(sql, /drop policy if exists nac_settings_staff_all/,
    'the October policy that gave every authenticated user access has to be dropped');
  assert.match(sql, /create policy nac_settings_owner_all[\s\S]*using \(public\.nac_is_owner\(\)\)/,
    'nac_settings needs a policy gated on nac_is_owner()');
  assert.match(sql, /with check \(public\.nac_is_owner\(\)\)/,
    'a technician must not be able to WRITE the cost prices either');
  // And it must refuse to run before an owner exists, or it locks everybody out.
  assert.match(sql, /No owner is named in nac_staff_roles/,
    'the guard that stops this being applied before an owner is named');
});

test('the roles migration does not seed an owner, because that is not mine to decide', () => {
  const sql = readFileSync(ROOT + '/designer/roles-schema.sql', 'utf8');
  const liveInserts = sql.split('\n')
    .filter(line => /^\s*insert\s+into\s+public\.nac_staff_roles/i.test(line));
  assert.deepEqual(liveInserts, [],
    'the owner INSERT must stay commented out — who is an owner is NAC’s call');
  assert.match(sql, /app_metadata/,
    'nac_is_owner has to read app_metadata, not user_metadata');
  assert.ok(!/user_metadata/.test(sql.replace(/--[^\n]*/g, '')),
    'user_metadata is user-writable and must never grant a role');
  assert.match(sql, /set search_path = public, pg_temp/,
    'a SECURITY DEFINER function without a pinned search_path can be redirected');
});

// ── THE ENDPOINTS THAT ENFORCE IT ──────────────────────────────────────────

/** A request/response pair shaped like the platform's. */
function call(handler, { method = 'POST', body = null, token = null } = {}) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      setHeader() { return this; },
      status(c) { this.statusCode = c; return this; },
      json(o) { resolve({ status: this.statusCode, body: o }); return this; },
      send(o) { return this.json(o); },
      end(o) { return this.json(o ?? null); }
    };
    const headers = token ? { authorization: 'Bearer ' + token } : {};
    Promise.resolve(handler({ method, query: {}, body, headers }, res))
      .catch((e) => resolve({ status: 500, body: { error: 'threw', message: e.message } }));
  });
}

function withAuth(users) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const auth = String((opts && opts.headers && opts.headers.Authorization) || '');
    if (!String(url).includes('/auth/v1/user')) {
      return { ok: false, status: 404, json: async () => ({}) };
    }
    const hit = users.find(u => auth === 'Bearer ' + u.token);
    return hit ? { ok: true, json: async () => ({ id: hit.id, email: hit.email }) }
               : { ok: false, status: 401, json: async () => ({}) };
  };
  return () => { globalThis.fetch = real; };
}

const OWNER = { token: 'tok-owner', id: 'u-o', email: 'owner@example.invalid' };
const TECH = { token: 'tok-tech', id: 'u-t', email: 'tech@example.invalid' };

test('a technician cannot issue a customer quote, and is told why', async () => {
  // Nick: "Enforce access server-side ... not merely by hiding UI." The
  // builder can hide the Issue button; this is the thing that refuses the
  // request when somebody calls the endpoint anyway.
  const restore = withAuth([OWNER, TECH]);
  const before = process.env.NAC_OWNER_EMAILS;
  process.env.NAC_OWNER_EMAILS = OWNER.email;
  process.env.SUPABASE_KEY = 'test-service-key';
  try {
    const issue = (await import('../server/quote-issue.js')).default;
    const out = await call(issue,
      { body: { designId: 'Q-1', approvedBy: 'someone' }, token: TECH.token });
    assert.equal(out.status, 403);
    assert.equal(out.body.error, 'role_not_permitted');
    assert.equal(out.body.required, CAPABILITIES.ISSUE_QUOTE);
    assert.equal(out.body.role, ROLE.TECHNICIAN);
    assert.match(out.body.message, /restricted to the business owner/);
    // And it does not name who does have it.
    assert.ok(!JSON.stringify(out.body).includes(OWNER.email));
  } finally {
    restore();
    if (before === undefined) delete process.env.NAC_OWNER_EMAILS;
    else process.env.NAC_OWNER_EMAILS = before;
  }
});

test('an unsigned request to issue a quote is a 401, not a 403', async () => {
  const restore = withAuth([OWNER]);
  try {
    const issue = (await import('../server/quote-issue.js')).default;
    const out = await call(issue, { body: { designId: 'Q-1' } });
    assert.equal(out.status, 401);
    assert.equal(out.body.error, 'sign_in_required');
  } finally { restore(); }
});

test('with no owner configured, issuing is closed to everybody and says so', async () => {
  // The unconfigured state fails CLOSED. It is a deployment step and the
  // refusal names the one variable that fixes it, rather than letting the
  // first signed-in account commit NAC to a price.
  const restore = withAuth([OWNER]);
  const before = process.env.NAC_OWNER_EMAILS;
  delete process.env.NAC_OWNER_EMAILS;
  try {
    const issue = (await import('../server/quote-issue.js')).default;
    const out = await call(issue,
      { body: { designId: 'Q-1', approvedBy: 'x' }, token: OWNER.token });
    assert.equal(out.status, 403);
    assert.equal(out.body.rolesConfigured, false);
    assert.match(out.body.message, /NAC_OWNER_EMAILS/);
  } finally {
    restore();
    if (before !== undefined) process.env.NAC_OWNER_EMAILS = before;
  }
});
