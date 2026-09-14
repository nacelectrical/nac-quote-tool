// NAC — can the SERVER still write quotes once row level security is on?
//
// READ ONLY. It creates nothing and it never returns a key.
//
//   GET /api/server-key-selftest
//
// /api/intake-submit and /api/savequote write to nac_quotes with the Vercel
// variable SUPABASE_KEY. Once designer/production-setup.sql is applied, an
// INSERT is refused for the `anon` role — verified against a real PostgreSQL,
// not assumed. So if SUPABASE_KEY holds the anon key rather than the SERVICE
// ROLE key, the intake form silently stops creating quotes the moment the
// security is applied, and the first anyone knows is a customer saying they
// filled the form in and never heard back.
//
// This answers that before it happens, by reading the role claim out of the
// key's own JWT payload and then confirming it against the live database.

const SUPA_URL = 'https://icnznjhwybryizbdqrgx.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imljbnpuamh3eWJyeWl6YmRxcmd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2NjIxMDksImV4cCI6MjA5ODIzODEwOX0.Y1URSkilExecDYF1ux2q7Xnk0I5ooDjREK0DD9Ae9nw';

/** The `role` claim, and nothing else. The key itself never leaves the server. */
function roleOf(jwt) {
  try {
    const payload = String(jwt).split('.')[1];
    if (!payload) return null;
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const claims = JSON.parse(json);
    return typeof claims.role === 'string' ? claims.role : null;
  } catch (e) {
    return null;
  }
}

/** NAC staff only — this reports how the server is configured. */
async function signedInStaff(req) {
  const auth = req.headers?.authorization || req.headers?.Authorization || '';
  const token = /^Bearer\s+(.+)$/i.exec(auth)?.[1];
  if (!token) return false;
  try {
    const r = await fetch(SUPA_URL + '/auth/v1/user', {
      headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + token }
    });
    if (!r.ok) return false;
    const user = await r.json().catch(() => null);
    return !!user?.id;
  } catch (e) {
    return false;
  }
}

export default async function handler(req, res) {
  if (!await signedInStaff(req)) {
    return res.status(401).json({
      error: 'NAC staff sign-in required. Open /setup.html and sign in — it calls this for you.'
    });
  }

  const KEY = process.env.SUPABASE_KEY;
  const checks = [];
  const add = (name, pass, detail) => checks.push({ name, result: pass ? 'PASS' : 'FAIL', detail });

  if (!KEY) {
    add('SUPABASE_KEY is set on the server', false,
      'It is not. /api/intake-submit and /api/savequote cannot write a quote at all. ' +
      'Add SUPABASE_KEY to the Vercel project (all environments) and redeploy — a variable ' +
      'added after a deploy does not reach the running functions until the next one.');
    return res.status(200).json({ ready: false, checks });
  }

  const role = roleOf(KEY);
  add('SUPABASE_KEY is set on the server', true,
    'Present (' + KEY.length + ' characters). The key itself is never returned by this check.');

  if (role === 'service_role') {
    add('It is the SERVICE ROLE key', true,
      'Correct. The service role bypasses row level security, so the intake form and the splits ' +
      'quote builder keep creating quotes after the security is applied.');
  } else if (role === 'anon') {
    add('It is the SERVICE ROLE key', false,
      'It is the ANON key. Once designer/production-setup.sql is applied, an anon INSERT into ' +
      'nac_quotes is refused, so the intake form and /api/savequote will stop creating quotes. ' +
      'Fix: copy the service_role key from Supabase → Project Settings → API into the Vercel ' +
      'variable SUPABASE_KEY, then redeploy. It is only ever used server-side and is never sent ' +
      'to a browser.');
  } else {
    add('It is the SERVICE ROLE key', false,
      'The role could not be read from the key' + (role ? ' (it says "' + role + '")' : '') +
      '. Check SUPABASE_KEY is a Supabase API key and not something else.');
  }

  // Confirm it against the live database rather than trusting the claim. Once
  // the security is applied, nac_settings is staff-only: the service role still
  // reads it, the anon key reads nothing. Before it is applied both can read,
  // so this confirms rather than decides.
  let probe = { ok: false, status: 0, rows: null, error: null };
  try {
    const r = await fetch(SUPA_URL + '/rest/v1/nac_settings?select=key&limit=1',
      { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } });
    probe = { ok: r.ok, status: r.status, rows: (await r.json().catch(() => null))?.length ?? null, error: null };
  } catch (e) {
    probe.error = e.message;
  }
  add('The server key can read nac_settings (staff-only after the SQL)',
    probe.ok && probe.rows > 0,
    probe.error ? 'Could not reach the database: ' + probe.error
      : 'HTTP ' + probe.status + ', ' + (probe.rows === null ? 'no rows field' : probe.rows + ' row(s)') +
        (probe.ok && probe.rows > 0
          ? '. The server key has staff-level access.'
          : '. If the SQL has been applied, this is the anon key and server writes are already failing.'));

  // Named separately because it is the one that costs NAC a job.
  const willWrite = role === 'service_role';
  const ready = checks.every(c => c.result === 'PASS');
  return res.status(200).json({
    ready,
    willWrite,
    summary: ready
      ? 'The server writes quotes with the service role key. Applying the security SQL will not ' +
        'stop the intake form or the splits quote builder.'
      : 'NOT READY. ' + (role === 'anon'
          ? 'SUPABASE_KEY is the anon key. Applying the security SQL WILL stop the intake form ' +
            'creating quotes until it is changed to the service role key and redeployed.'
          : 'See the failed check(s) below.'),
    checks,
    note: 'Read-only. No quote, customer or job is created, and no key is returned.'
  });
}
