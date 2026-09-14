// /setup.html — the one-run production setup, and /db-selftest.html which now
// shares its checks. Driven against a stubbed database so every branch can be
// exercised: the SQL not applied, the SQL applied, and the migration.
//
//   node tools/serve.mjs &   node tools/browser-tests/setup-page.mjs
import { chromium } from 'playwright';
import { signInContext } from './signin.mjs';

const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
let fail = 0;
const say = (n, c, x) => { console.log(`  ${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  — ' + x : ''}`); if (!c) fail++; };

/** A stubbed Supabase. `mode` decides whether the setup SQL has been applied. */
function makeDb(mode) {
  const t = {
    nac_settings: new Map(), nac_quotes: new Map(), nac_designs: new Map(),
    nac_customers: new Map(), nac_jobs: new Map()
  };
  t.nac_quotes.set('NAC-EXISTING-1', { id: 'NAC-EXISTING-1', client: 'Jane Existing',
    job_desc: 'Ducted AC Supply & Install', line_items: '[]', accepted: false });
  t.nac_designs.set('D-EXISTING-1', { id: 'D-EXISTING-1', customer_name: 'Jane Existing',
    customer_address: '5 Real St, Buderim', quote_id: null, job_id: null, status: 'draft',
    design: JSON.stringify({ customer: { name: 'Jane Existing', address: '5 Real St, Buderim',
      phone: '0400 555 111' }, job: { description: 'Ducted' } }), updated_at: '2026-09-01T00:00:00Z' });
  return { t, mode };
}

async function route(p, db) {
  await p.route('**/rest/v1/**', async r => {
    const req = r.request(), url = req.url();
    const table = (/rest\/v1\/([a-z_]+)/.exec(url) || [])[1];
    const json = (o, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
    const missing = () => r.fulfill({ status: 404, contentType: 'application/json',
      body: JSON.stringify({ message: 'relation "public.' + table + '" does not exist' }) });

    // Before the SQL is run: no CRM tables, and no new columns anywhere.
    if (db.mode === 'no-sql') {
      if (table === 'nac_customers' || table === 'nac_jobs') return missing();
      if (/customer_id|job_ref|servicem8_status/.test(url)) {
        return r.fulfill({ status: 400, contentType: 'application/json',
          body: JSON.stringify({ message: 'column "customer_id" does not exist' }) });
      }
    }
    if (!db.t[table]) return json([]);
    const key = table === 'nac_settings' ? 'key' : 'id';

    if (req.method() === 'POST') {
      const body = JSON.parse(req.postData() || '{}');
      db.t[table].set(body[key], { ...(db.t[table].get(body[key]) || {}), ...body });
      return json([], 201);
    }
    if (req.method() === 'PATCH') {
      const m = new RegExp(key + '=eq\\.([^&]+)').exec(url);
      const id = m ? decodeURIComponent(m[1]) : null;
      if (id && db.t[table].has(id)) db.t[table].set(id, { ...db.t[table].get(id), ...JSON.parse(req.postData() || '{}') });
      return r.fulfill({ status: 204, body: '' });
    }
    if (req.method() === 'DELETE') {
      const m = new RegExp(key + '=eq\\.([^&]+)').exec(url);
      if (m) db.t[table].delete(decodeURIComponent(m[1]));
      return r.fulfill({ status: 204, body: '' });
    }
    const m = new RegExp(key + '=eq\\.([^&]+)').exec(url);
    if (m) { const row = db.t[table].get(decodeURIComponent(m[1])); return json(row ? [row] : []); }
    let rows = [...db.t[table].values()];
    const cm = /customer_id=eq\.([^&]+)/.exec(url);
    if (cm) rows = rows.filter(x => x.customer_id === decodeURIComponent(cm[1]));
    if (/customer_id=not\.is\.null/.test(url)) rows = rows.filter(x => x.customer_id);
    return json(rows);
  });
  // The ServiceM8 self test endpoint, as the deployed function would answer.
  await p.route('**/api/servicem8-selftest', r => {
    // Staff-only, exactly as the deployed function is.
    const auth = r.request().headers()['authorization'] || '';
    if (!/^Bearer\s+\S/.test(auth)) {
      return r.fulfill({ status: 401, contentType: 'application/json',
        body: JSON.stringify({ error: 'NAC staff sign-in required.' }) });
    }
    return r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ready: false, summary: 'NOT READY. 1 check(s) failed.',
        checks: [{ name: 'SERVICEM8_API_KEY is set on the server', result: 'FAIL',
                   detail: 'It is not. Accepting a quote cannot create a job until it is set.' }] }) });
  });
}

async function run(mode, { answerMigration = 'confirm' } = {}) {
  const ctx = await b.newContext({ viewport: { width: 1180, height: 900 } });
  await signInContext(ctx);
  const db = makeDb(mode);
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message.slice(0, 140)));
  await route(p, db);
  await p.goto('http://127.0.0.1:8777/setup.html', { waitUntil: 'load' });
  await p.waitForTimeout(1200);

  const answering = (async () => {
    for (let i = 0; i < 4; i++) {
      try { await p.locator('.dlg-host').waitFor({ state: 'visible', timeout: 6000 }); }
      catch (e) { return; }
      const text = await p.locator('.dlg-panel').innerText();
      const btn = answerMigration === 'cancel' && /Write these customer/i.test(text)
        ? '.dlg-btn.ghost' : '.dlg-btn.primary';
      await p.locator(btn).first().click();
      await p.waitForTimeout(250);
    }
  })();

  await p.locator('#run').click();
  await answering;
  await p.locator('#verdict.on').waitFor({ timeout: 30000 });
  const report = await p.locator('#log').inputValue();
  const verdict = await p.locator('#verdict').innerText();
  const steps = await p.evaluate(() => [...document.querySelectorAll('.step')]
    .map(e => ({ t: e.querySelector('.t').textContent, cls: e.className.replace('step', '').trim() })));
  await ctx.close();
  return { db, report, verdict, steps, errs };
}

console.log('\n[A] The SQL has NOT been run yet');
{
  const r = await run('no-sql');
  say('no page errors', r.errs.length === 0, r.errs.join(' | ') || 'clean');
  say('it says the tables do not exist', /nac_customers does not exist/.test(r.report));
  say('it says the link columns are missing', /customer_id is missing|job_ref is missing/.test(r.report));
  say('it does NOT attempt the migration', /Migration skipped/.test(r.report));
  say('the verdict is a failure', /CHECK\(S\) FAILED/.test(r.verdict), r.verdict.slice(0, 60));
  say('the SQL step is marked bad', r.steps[0].cls === 'bad', JSON.stringify(r.steps[0]));
  say('it still ran the database round trip', /nac_settings/.test(r.report) && /INSERT accepted/.test(r.report));
}

console.log('\n[B] The SQL HAS been run — full setup, migration confirmed');
{
  const r = await run('ready');
  say('no page errors', r.errs.length === 0, r.errs.join(' | ') || 'clean');
  say('it confirms both new tables exist', /nac_customers exists/.test(r.report) && /nac_jobs exists/.test(r.report));
  say('it confirms the link columns exist', /nac_quotes\.customer_id exists/.test(r.report));
  say('the database round trip passes', /READ BACK returns the whole design intact/.test(r.report));
  say('the customer signing path is checked', /customer CAN open their own quote/.test(r.report));
  say('the migration ran and wrote records',
    /Migration applied/.test(r.report), (/Migration applied[^\n]*/.exec(r.report) || [''])[0]);
  say('a customer record really exists now', r.db.t.nac_customers.size >= 1,
    [...r.db.t.nac_customers.values()].map(c => c.name).join(', '));
  say('a job record really exists now', r.db.t.nac_jobs.size >= 1,
    [...r.db.t.nac_jobs.values()].map(j => j.site_address || j.id).join(', '));
  say('the quote is linked to the customer',
    !!r.db.t.nac_quotes.get('NAC-EXISTING-1')?.customer_id,
    r.db.t.nac_quotes.get('NAC-EXISTING-1')?.customer_id || 'not linked');
  say('the chain resolves on the live rows', /chain resolves on live data/.test(r.report),
    (/chain resolves on live data[^\n]*/.exec(r.report) || [''])[0].slice(0, 90));
  say('it proves no quote was destroyed', /Every existing quote is still there/.test(r.report));
  say('ServiceM8 is reported as not ready', /SERVICEM8_API_KEY/.test(r.report));
  say('the ServiceM8 check sent the staff token, not an anonymous request',
    !/refused the sign-in/.test(r.report));
  say('the report is copyable', r.report.length > 400, r.report.length + ' chars');
}

console.log('\n[C] The migration is shown first and can be declined');
{
  const r = await run('ready', { answerMigration: 'cancel' });
  say('declining writes NOTHING', r.db.t.nac_customers.size === 0, r.db.t.nac_customers.size + ' customer(s)');
  say('and it says so rather than claiming success', /not applied — you chose not to/.test(r.report));
}

console.log('\n[D] db-selftest.html still works from the shared module');
{
  const ctx = await b.newContext({ viewport: { width: 1180, height: 900 } });
  await signInContext(ctx);
  const db = makeDb('ready');
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message.slice(0, 140)));
  await route(p, db);
  await p.goto('http://127.0.0.1:8777/db-selftest.html', { waitUntil: 'load' });
  await p.waitForTimeout(900);
  await p.locator('#run').click();
  await p.locator('#verdict.on').waitFor({ timeout: 30000 });
  const report = await p.locator('#log').inputValue().catch(() => '');
  const verdict = await p.locator('#verdict').innerText();
  say('no page errors', errs.length === 0, errs.join(' | ') || 'clean');
  say('it runs the same checks', /nac_settings/.test(verdict + report) || /ALL CHECKS PASSED/.test(verdict), verdict.slice(0, 70));
  say('it records who it ran as', /signed in as/.test(report), (/signed in as[^\n]*/.exec(report) || [''])[0]);
  await ctx.close();
}

console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
await b.close();
process.exit(fail ? 1 : 0);
