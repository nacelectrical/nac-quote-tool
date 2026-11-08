// ─────────────────────────────────────────────────────────────────────────────
// GET /api/whoami — WHAT THIS SIGNED-IN USER MAY DO
//
// The screens need this because they have to show a technician something
// coherent rather than a pricing panel full of blanks. It exists so the UI can
// be HONEST, not so the UI can be the control: every answer here is also
// enforced on the server that holds the data, and the figures themselves are
// closed at the database by designer/roles-rls.sql.
//
// A page that asked "am I an owner?" and believed its own answer would be
// trivially defeated by editing a variable in the console. That is fine,
// because believing it gains nothing — the console can also just call
// PostgREST, and the policy is what says no.
//
// WHAT IT RETURNS: the caller's own role and capability list, and whether the
// deployment has been configured with an owner at all.
//
// WHAT IT NEVER RETURNS: the allowlist, anybody else's role, the number of
// owners, any key, or any pricing figure.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const { whoIs } = require('./roles.js');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const who = await whoIs(req);

  // 200 either way. "You are not signed in" is an answer, not a failure, and a
  // 401 here would make every page's first call look like an error in the log.
  return res.status(200).json({
    ok: true,
    signedIn: who.signedIn,
    email: who.email,
    role: who.role,
    capabilities: who.capabilities,
    /** False means no owner exists yet — see the note. A deployment action. */
    rolesConfigured: who.configured,
    note: who.note || null,
    /**
     * WHICH rule decided, so a surprise is diagnosable without a support call.
     * It names the mechanism (`NAC_OWNER_EMAILS`, `nac_staff_roles`,
     * `supabase_app_metadata`) and never its contents.
     */
    decidedBy: who.source
  });
};
