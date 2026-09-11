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

export default async function handler(req, res) {
  const KEY = process.env.SERVICEM8_API_KEY;
  const checks = [];
  const add = (name, pass, detail) => checks.push({ name, result: pass ? 'PASS' : 'FAIL', detail });

  if (!KEY) {
    add('SERVICEM8_API_KEY is set on the server', false,
      'It is not. Accepting a quote cannot create a job until it is set in the ' +
      'Vercel project environment variables.');
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
