// ─────────────────────────────────────────────────────────────────────────────
// IS THIS NAC?
//
// One sign-in check, in one place, for every endpoint that runs with the
// service-role key.
//
// It is here because two of them had no check at all. /api/presentation-content
// and /api/presentation-media both ran as the service role and asked nothing of
// the caller, so anyone on the internet could:
//
//   • GET the whole content library — the trust copy, the payment terms with
//     their deposit instructions, and every review on file, approved or not,
//     with the customer names and suburbs attached to them;
//   • PUT it back changed, including the terms and conditions that are printed
//     on every customer quote;
//   • upload to, or delete from, NAC's storage buckets.
//
// Nick: "An unauthenticated user attempting to open an NAC internal page should
// not gain access to customer, pricing or design information."
//
// The token is the Supabase session's access token, which the admin screens
// already hold. It is verified against Supabase's own /auth/v1/user — this
// never decides for itself whether a token is good.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const SUPA_URL = 'https://icnznjhwybryizbdqrgx.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imljbnpuamh3eWJyeWl6YmRxcmd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2NjIxMDksImV4cCI6MjA5ODIzODEwOX0.Y1URSkilExecDYF1ux2q7Xnk0I5ooDjREK0DD9Ae9nw';

/**
 * @param {object} req
 * @returns {Promise<string|null>} the signed-in staff member, or null
 */
async function signedInStaff(req) {
  const headers = req && req.headers ? req.headers : {};
  const auth = headers.authorization || headers.Authorization || '';
  const token = /^Bearer\s+(.+)$/i.exec(auth);
  if (!token) return null;
  // The anon key is not a sign-in. It is in the page source of every public
  // page, so accepting it here would be the same as having no check at all.
  if (token[1].trim() === ANON_KEY) return null;
  try {
    const r = await fetch(SUPA_URL + '/auth/v1/user', {
      headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + token[1].trim() }
    });
    if (!r.ok) return null;
    const user = await r.json().catch(() => null);
    return user && user.id ? (user.email || user.id) : null;
  } catch (e) {
    return null;
  }
}

/**
 * Refuse the request unless NAC is signed in. Returns the staff identity, or
 * null having already sent the 401.
 */
async function requireStaff(req, res, what = 'this') {
  const who = await signedInStaff(req);
  if (who) return who;
  res.status(401).json({
    error: 'sign_in_required',
    message: 'NAC staff sign-in is required to reach ' + what + '.'
  });
  return null;
}

module.exports = { signedInStaff, requireStaff, ANON_KEY };
