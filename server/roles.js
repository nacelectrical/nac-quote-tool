// ─────────────────────────────────────────────────────────────────────────────
// THE SERVER-SIDE HALF OF OWNER / TECHNICIAN
//
// designer/engines/roles.mjs decides WHAT a role may do. This decides WHICH
// role is on the other end of the request, and refuses the request when the
// answer is not good enough.
//
// Three things it will not do:
//
//   · it will not read a role out of the request. A header, a body field or a
//     query parameter saying `role=owner` is ignored, because anybody can send
//     one. The role comes from the verified Supabase user and from
//     server-side configuration, and from nowhere else.
//   · it will not treat an unconfigured deployment as "everybody is an owner".
//     With no owner configured, nobody sees costs. That is the whole point.
//   · it will not report the allowlist. A refusal says what is needed, not who
//     else has it.
//
// IT IS NOT THE ONLY CONTROL AND IT CANNOT BE. `nac_settings` is read straight
// out of the browser over PostgREST with the user's own token, so the lock that
// matters is the row-level policy in designer/roles-rls.sql. This layer closes
// the endpoints; that layer closes the table. Both, or neither counts.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const https = require('https');
const { signedInUser } = require('./staff-auth.js');

const SUPA_HOST = 'icnznjhwybryizbdqrgx.supabase.co';
const ROLES_TABLE = 'nac_staff_roles';

/** The engine, loaded once. It is an ES module and this file is CommonJS. */
let enginePromise = null;
function engine() {
  if (!enginePromise) enginePromise = import('../designer/engines/roles.mjs');
  return enginePromise;
}

function supa(path, key) {
  return new Promise((resolve) => {
    const r = https.request({
      hostname: SUPA_HOST, path, method: 'GET',
      headers: { apikey: key, Authorization: 'Bearer ' + key, Accept: 'application/json' }
    }, (resp) => {
      let data = '';
      resp.on('data', c => { data += c; });
      resp.on('end', () => {
        let parsed = null;
        try { parsed = data ? JSON.parse(data) : null; } catch (e) { parsed = null; }
        resolve({ status: resp.statusCode, body: parsed });
      });
    });
    r.on('error', () => resolve({ status: 0, body: null }));
    r.end();
  });
}

/**
 * The rows of `nac_staff_roles`.
 *
 * The table is OPTIONAL. A deployment that has not applied
 * designer/roles-schema.sql gets an empty list and the allowlist decides —
 * which is exactly the state a first deployment is in, and it must not be an
 * error. A read that FAILS for any other reason is also an empty list here,
 * and `resolveRole` then falls through to the allowlist: a database wobble must
 * not promote anybody, and it must not lock out an owner named in the
 * environment either.
 */
async function roleRows(key) {
  if (!key) return [];
  const r = await supa('/rest/v1/' + ROLES_TABLE + '?select=user_email,role&limit=500', key);
  if (r.status === 404 || !Array.isArray(r.body)) return [];
  return r.body.map(row => ({ email: row.user_email, role: row.role }));
}

/**
 * Who is this, and what may they do?
 *
 * Always resolves. A caller with no token gets `{ signedIn: false }` rather
 * than an exception, because several screens ask this before they know whether
 * anybody is signed in.
 */
async function whoIs(req) {
  const mod = await engine();
  const config = {
    ownerEmails: mod.parseOwnerEmails(process.env.NAC_OWNER_EMAILS),
    roleRows: await roleRows(process.env.SUPABASE_KEY)
  };
  const user = await signedInUser(req);
  return mod.resolveRole(user, config);
}

/**
 * Refuse unless the caller holds this capability.
 *
 * @returns {Promise<object|null>} the resolved identity, or null having
 *   already sent 401 or 403.
 */
async function requireCapability(req, res, capability, what = 'this') {
  const who = await whoIs(req);

  if (!who.signedIn) {
    res.status(401).json({
      error: 'sign_in_required',
      message: 'NAC staff sign-in is required to reach ' + what + '.'
    });
    return null;
  }

  const mod = await engine();
  if (!mod.can(who.role, capability)) {
    // 403 and not 404: the caller is a known member of staff and is entitled
    // to know that the thing exists and that their role is not enough. What
    // they are not told is who does have it.
    res.status(403).json({
      error: 'role_not_permitted',
      message: who.configured
        ? 'Your NAC account is a ' + who.role + ', and ' + what + ' is restricted '
          + 'to the business owner. Ask Nick.'
        : 'No owner is configured on this deployment, so ' + what + ' is closed to '
          + 'everybody. Set NAC_OWNER_EMAILS in the server environment.',
      required: capability,
      role: who.role,
      rolesConfigured: who.configured
    });
    return null;
  }
  return who;
}

/** The common case: may this caller see what NAC pays and what NAC makes? */
async function requireOwner(req, res, what = 'this') {
  const mod = await engine();
  return requireCapability(req, res, mod.CAPABILITIES.VIEW_INTERNAL_PRICING, what);
}

module.exports = { whoIs, requireCapability, requireOwner, roleRows };
