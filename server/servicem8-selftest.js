// NAC — does ServiceM8 actually work?
//
// READ ONLY. This creates nothing. It answers one question honestly: can the
// deployed application reach ServiceM8, is the key accepted, and can it read
// the records it would need to create a job from.
//
//   GET /api/servicem8-selftest
//
// It is the check to run before believing that accepting a quote creates a job,
// and the first thing to run when one does not appear.

const API = 'https://api.servicem8.com/api_1.0/';
const SUPA_URL = 'https://icnznjhwybryizbdqrgx.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imljbnpuamh3eWJyeWl6YmRxcmd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2NjIxMDksImV4cCI6MjA5ODIzODEwOX0.Y1URSkilExecDYF1ux2q7Xnk0I5ooDjREK0DD9Ae9nw';
const TIMEOUT_MS = 12000;

async function call(url, headers) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const started = Date.now();
  try {
    const r = await fetch(url, { headers, signal: ctrl.signal });
    return { ok: r.ok, status: r.status, ms: Date.now() - started,
             text: await r.text().catch(() => '') };
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - started,
             text: e.name === 'AbortError'
               ? 'no answer within ' + (TIMEOUT_MS / 1000) + ' seconds'
               : e.message };
  } finally { clearTimeout(timer); }
}

/**
 * NAC staff only.
 *
 * This reports the state of NAC's integrations — which keys are configured and
 * what the ServiceM8 account answers. That is not something to leave open to
 * the internet, so the caller has to present the access token of a signed-in
 * NAC user and Supabase has to agree it is valid.
 */
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

  const KEY = process.env.SERVICEM8_API_KEY;
  const checks = [];
  const add = (name, pass, detail) => checks.push({ name, result: pass ? 'PASS' : 'FAIL', detail });

  if (!KEY) {
    // The likeliest cause once someone has "set the key" is that it is set
    // under a different NAME. Listing the names that ARE present (never the
    // values) turns a mystery into a rename.
    const similar = Object.keys(process.env)
      .filter(k => /SERVICE ?M8|SM8/i.test(k) && k !== 'SERVICEM8_API_KEY');
    add('SERVICEM8_API_KEY is set on the server', false,
      similar.length
        ? 'It is not — but these ARE set: ' + similar.join(', ') + '. The application reads ' +
          'SERVICEM8_API_KEY exactly. Rename it in the Vercel project and redeploy.'
        : 'It is not. Add SERVICEM8_API_KEY to the Vercel project environment variables ' +
          '(all environments), then redeploy — a variable added after a deploy does not reach ' +
          'the running functions until the next one.');
    return res.status(200).json({ ready: false, checks });
  }
  add('SERVICEM8_API_KEY is set on the server', true, 'Present (' + KEY.length + ' characters).');

  const H = { 'X-Api-Key': KEY, Accept: 'application/json' };

  // 1. Reachable, and the key accepted.
  const company = await call(API + 'company.json?$top=1', H);
  if (company.status === 0) {
    add('ServiceM8 answers', false, company.text);
    return res.status(200).json({ ready: false, checks });
  }
  add('ServiceM8 answers', true, 'HTTP ' + company.status + ' in ' + company.ms + ' ms.');
  add('The API key is accepted', company.ok,
    company.ok ? 'Companies can be read.'
      : 'HTTP ' + company.status + ' — ' + (company.text.slice(0, 160) || 'no detail') +
        (company.status === 401 || company.status === 403
          ? '. The key is wrong, expired, or lacks permission.' : ''));

  // 2. The endpoints creating a job actually uses.
  for (const [label, path] of [['Jobs can be read', 'job.json?$top=1'],
                               ['Contacts can be read', 'companycontact.json?$top=1']]) {
    const r = await call(API + path, H);
    add(label, r.ok, r.ok ? 'HTTP 200 in ' + r.ms + ' ms.'
      : 'HTTP ' + r.status + ' — ' + (r.text.slice(0, 160) || 'no detail'));
  }

  // 3. The shape the code depends on. A job without generated_job_id would
  //    mean /api/servicem8 could never find a job NAC had just created.
  const jobs = await call(API + 'job.json?$top=1', H);
  let shapeOk = false, shapeDetail = 'No jobs in the account to check against — not a fault.';
  if (jobs.ok) {
    try {
      const parsed = JSON.parse(jobs.text);
      if (Array.isArray(parsed) && parsed.length) {
        shapeOk = 'generated_job_id' in parsed[0] && 'company_uuid' in parsed[0];
        shapeDetail = shapeOk
          ? 'A job carries generated_job_id and company_uuid, which is what NAC reads.'
          : 'A job did NOT carry generated_job_id and company_uuid. Fields seen: ' +
            Object.keys(parsed[0]).slice(0, 12).join(', ');
      } else shapeOk = true;            // an empty account is not a failure
    } catch (e) { shapeDetail = 'The answer was not JSON: ' + jobs.text.slice(0, 120); }
  }
  add('A job has the fields NAC reads', shapeOk, shapeDetail);

  // 4. Where the outcome of a real attempt gets written.
  add('SUPABASE_KEY is set, so job outcomes can be recorded',
    !!process.env.SUPABASE_KEY,
    process.env.SUPABASE_KEY
      ? 'Present. A failed job creation will be written onto the quote row.'
      : 'Not set. A job that fails to create would not be recorded anywhere.');

  const ready = checks.every(c => c.result === 'PASS');
  return res.status(200).json({
    ready,
    summary: ready
      ? 'ServiceM8 is reachable and the key works. Accepting a quote should create a job — ' +
        'confirm with one real acceptance and check the job appears.'
      : 'NOT READY. ' + checks.filter(c => c.result === 'FAIL').length +
        ' check(s) failed; see below. Until they pass, accepting a quote will NOT create a job.',
    checks,
    note: 'This is read-only. It creates no company, contact or job.'
  });
}
