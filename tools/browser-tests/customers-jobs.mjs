// P7 — CUSTOMER → JOB → HVAC DESIGN → QUOTE.
//
// Drives the real designer against a stubbed database and checks the chain is
// actually written: the customer and job rows, the links on the design and
// quote rows, that a second design for the same person REUSES the record rather
// than making another, and that NAC's existing customer detail survives.
//
//   node tools/serve.mjs &   node tools/browser-tests/customers-jobs.mjs
import { chromium } from 'playwright';
import { signInContext } from './signin.mjs';

const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
let fail = 0;
const say = (n, c, x) => { console.log(`  ${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  — ' + x : ''}`); if (!c) fail++; };

// ── The stubbed database: real tables, real rows, kept between page loads ──
const db = { nac_customers: new Map(), nac_jobs: new Map(), nac_designs: new Map(),
             nac_quotes: new Map(), nac_settings: new Map() };

async function newPage(ctx) {
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('   [pageerror]', e.message.slice(0, 150)));
  // Catch-all FIRST — Playwright matches the most recently added route first.
  await p.route('**/rest/v1/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  for (const table of Object.keys(db)) {
    await p.route('**/rest/v1/' + table + '**', async route => {
      const req = route.request();
      const url = req.url();
      const key = table === 'nac_settings' ? 'key' : 'id';
      const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });

      if (req.method() === 'POST') {
        const body = JSON.parse(req.postData() || '{}');
        const id = body[key];
        const prev = db[table].get(id) || {};
        db[table].set(id, { ...prev, ...body });        // upsert, as merge-duplicates does
        return route.fulfill({ status: 201, contentType: 'application/json', body: '[]' });
      }
      if (req.method() === 'PATCH') {
        const m = new RegExp(key + '=eq\\.([^&]+)').exec(url);
        const id = m ? decodeURIComponent(m[1]) : null;
        if (id && db[table].has(id)) db[table].set(id, { ...db[table].get(id), ...JSON.parse(req.postData() || '{}') });
        return route.fulfill({ status: 204, body: '' });
      }
      const m = new RegExp(key + '=eq\\.([^&]+)').exec(url);
      if (m) {
        const row = db[table].get(decodeURIComponent(m[1]));
        return json(row ? [row] : []);
      }
      const cm = /customer_id=eq\.([^&]+)/.exec(url);
      let rows = [...db[table].values()];
      if (cm) rows = rows.filter(r => r.customer_id === decodeURIComponent(cm[1]));
      return json(rows);
    });
  }
  return p;
}

/** Build a design in the designer for a given customer, and save it. */
async function designFor(ctx, customer, jobDescription) {
  const p = await newPage(ctx);
  await p.goto('http://127.0.0.1:8777/designer.html', { waitUntil: 'load' });
  await p.waitForTimeout(1500);
  // save() may raise a dialog when the design disagrees with the customer
  // record, and it waits for an answer — so answer it, and record what it said.
  const dialogs = [];
  const answer = (async () => {
    for (let i = 0; i < 3; i++) {
      try { await p.locator('.dlg-host').waitFor({ state: 'visible', timeout: 4000 }); }
      catch (e) { return; }
      dialogs.push(await p.locator('.dlg-panel').innerText());
      await p.locator('.dlg-btn.primary').first().click();
      await p.waitForTimeout(300);
    }
  })();
  await p.evaluate(async ({ customer, jobDescription }) => {
    const app = window.nacDesigner;
    app.design.customer = { ...customer };
    app.design.job = { description: jobDescription };
    await app.save('browser test');
  }, { customer, jobDescription });
  await answer;
  await p.waitForTimeout(800);
  const designId = await p.evaluate(() => ({
    id: window.nacDesigner.design.id,
    customerRef: window.nacDesigner.design.customerRef || null,
    jobRef: window.nacDesigner.design.jobRef || null
  }));
  await p.close();
  return { ...designId, dialogs };
}

const ctx = await b.newContext({ viewport: { width: 1180, height: 820 } });
await signInContext(ctx);

console.log('\n[1] A design for a new customer creates the customer and the job');
const NICK = { name: 'John Smith', phone: '0400 111 222', email: 'john@example.com',
               address: '14 Wattlebird Drive, Springfield Lakes QLD 4300' };
const d1 = await designFor(ctx, NICK, 'Ducted AC Supply & Install');
say('a customer record was written', db.nac_customers.size === 1,
  [...db.nac_customers.keys()].join(', ') || 'none');
say('a job record was written', db.nac_jobs.size === 1, [...db.nac_jobs.keys()].join(', ') || 'none');
const cust = [...db.nac_customers.values()][0];
const job = [...db.nac_jobs.values()][0];
say('the customer carries what the estimator typed',
  cust && cust.name === 'John Smith' && cust.phone === '0400 111 222' && cust.email === 'john@example.com',
  cust ? JSON.stringify({ n: cust.name, p: cust.phone, e: cust.email }) : 'none');
say('the job belongs to that customer', job && job.customer_id === cust.id, job && job.customer_id);
say('the job carries the site address', job && /Wattlebird/.test(job.site_address || ''), job && job.site_address);
say('the design row is linked to both',
  d1.customerRef === cust.id && d1.jobRef === job.id,
  JSON.stringify({ c: d1.customerRef, j: d1.jobRef }));
const designRow = db.nac_designs.get(d1.id);
say('and the link is on the saved row, not just in memory',
  designRow && designRow.customer_id === cust.id && designRow.job_ref === job.id,
  designRow ? JSON.stringify({ c: designRow.customer_id, j: designRow.job_ref }) : 'no row');

console.log('\n[2] A second design for the same customer REUSES the record');
const d2 = await designFor(ctx, { ...NICK, phone: '' }, 'Add a second system');
say('no second customer was created', db.nac_customers.size === 1, db.nac_customers.size + ' customer(s)');
say('a different job description does NOT interrupt the estimator', d2.dialogs.length === 0,
  d2.dialogs.join(' | ').slice(0, 80) || 'no dialog');
say('the second design points at the same customer', d2.customerRef === cust.id, d2.customerRef);
say('the same site is the same job', d2.jobRef === job.id,
  d2.jobRef + ' vs ' + job.id + ' (' + db.nac_jobs.size + ' job(s))');

console.log('\n[3] The same customer at a DIFFERENT site gets a second job');
const d3 = await designFor(ctx, { ...NICK, address: '7 Other Street, Buderim QLD' }, 'Investment property');
say('still one customer', db.nac_customers.size === 1, db.nac_customers.size + '');
say('but now two jobs', db.nac_jobs.size === 2, db.nac_jobs.size + '');
say('the new design is on the new job', d3.jobRef !== job.id && !!d3.jobRef, d3.jobRef);
say('a second property is not reported as a customer problem', d3.dialogs.length === 0,
  d3.dialogs.join(' | ').replace(/\n/g, ' ').slice(0, 90) || 'no dialog');

console.log('\n[4] A DIFFERENT person with the same name is not merged in');
const d4 = await designFor(ctx, { name: 'John Smith', email: 'other.john@example.com',
                                   address: '99 Elsewhere Road, Caloundra QLD' }, 'Ducted');
say('a second John Smith gets his own record', db.nac_customers.size === 2, db.nac_customers.size + '');
say('and his own job', d4.customerRef !== cust.id, d4.customerRef);

console.log('\n[5] Saving a design NEVER overwrites what the customer record already holds');
const before = { ...db.nac_customers.get(cust.id) };
// A phone number that disagrees with the record IS worth stopping for.
const d5 = await designFor(ctx, { name: 'John Smith', phone: '0499 888 777',
                        email: 'john@example.com',
                        address: '14 Wattlebird Drive, Springfield Lakes QLD 4300' }, 'Ducted');
const after = db.nac_customers.get(cust.id);
say('the phone NAC had is not replaced', after.phone === before.phone,
  'was "' + before.phone + '", now "' + after.phone + '"');
say('the address NAC had is still there', after.address === before.address, after.address);
say('the email NAC had is still there', after.email === before.email, after.email);
say('and the estimator WAS told about the difference',
  d5.dialogs.some(t => /differs from the customer record/i.test(t) && /0499 888 777/.test(t)),
  d5.dialogs.join(' | ').replace(/\n/g, ' ').slice(0, 130) || 'no dialog');

console.log('\n[6] The quote carries the same customer and job');
const p = await newPage(ctx);
await p.goto('http://127.0.0.1:8777/designer.html', { waitUntil: 'load' });
await p.waitForTimeout(1500);
const quote = await p.evaluate(async () => {
  const app = window.nacDesigner;
  const Store = await import('/designer/engines/store.mjs');
  app.design.customer = { name: 'John Smith', phone: '0400 111 222', email: 'john@example.com',
                          address: '14 Wattlebird Drive, Springfield Lakes QLD 4300' };
  app.design.job = { description: 'Ducted AC Supply & Install' };
  app.design.quoteLineItems = [{ label: 'Ducted system', price: 17016.54 }];
  await app.save('browser test');
  return await Store.pushDesignToQuote(app.design);
});
await p.waitForTimeout(600);
const quoteRow = db.nac_quotes.get(quote.quoteId);
say('the quote row was written', !!quoteRow, quote.quoteId);
say('the quote is linked to the customer', quoteRow && quoteRow.customer_id === cust.id, quoteRow?.customer_id);
say('the quote is linked to the job', quoteRow && quoteRow.job_ref === job.id, quoteRow?.job_ref);
say('the quote still carries everything it always did',
  quoteRow && quoteRow.client === 'John Smith' && !!quoteRow.line_items && quoteRow.accepted === false,
  quoteRow ? quoteRow.client + ', accepted=' + quoteRow.accepted : '');

console.log('\n[7] The whole chain joins up');
const chain = (() => {
  const q = db.nac_quotes.get(quote.quoteId);
  const c = db.nac_customers.get(q?.customer_id);
  const j = db.nac_jobs.get(q?.job_ref);
  const designs = [...db.nac_designs.values()].filter(d => d.customer_id === c?.id);
  return { customer: c?.name, job: j?.site_address, jobsCustomer: j?.customer_id, designs: designs.length };
})();
say('quote → customer → job → designs all resolve',
  chain.customer === 'John Smith' && !!chain.job && chain.jobsCustomer === cust.id && chain.designs >= 3,
  JSON.stringify(chain));

await p.close();
console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
await b.close();
process.exit(fail ? 1 : 0);
