// P7 — CUSTOMER → JOB → QUOTE.
//
// Drives the real QUOTE BUILDER against a stubbed database and checks the
// chain is actually written: the customer and job rows, the link on the quote
// row, that a second quote for the same person REUSES the record rather than
// making another, and that NAC's existing customer detail survives.
//
// It used to drive the duct designer's `window.nacDesigner.save()`, which went
// with the designer — so this suite crashed on a global that no longer exists,
// against a chain that is still very much live. The builder links the same two
// records now, by the same rule /api/ops uses, so one house has one identity
// whichever path opened the quote.
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

/**
 * Fill the builder in for a customer and press Save, the way an estimator does.
 *
 * Through the REAL controls — not by poking the draft — so what this proves is
 * the path a person actually takes.
 */
async function quoteFor(ctx, customer, note) {
  const p = await newPage(ctx);
  await p.goto('http://127.0.0.1:8777/quote-builder.html', { waitUntil: 'load' });
  await p.waitForTimeout(1200);

  await p.fill('#cname', customer.name || '');
  await p.fill('#cphone', customer.phone || '');
  await p.fill('#cemail', customer.email || '');
  await p.fill('#caddr', customer.address || '');
  await p.fill('#pnum', note || '');

  await p.click('#save');
  await p.waitForTimeout(900);

  const out = await p.evaluate(() => ({
    id: (window.__lastSavedId || ''),
    flash: (document.querySelector('.flash') || {}).textContent || ''
  }));
  // The saved row is the authority, not anything still in the page.
  const row = [...db.nac_designs.values()].pop() || null;
  await p.close();
  return { id: row ? row.id : null, customerRef: row ? row.customer_id : null,
           jobRef: row ? row.job_ref : null, flash: out.flash };
}

const ctx = await b.newContext({ viewport: { width: 1180, height: 820 } });
await signInContext(ctx);

console.log('\n[1] A quote for a new customer creates the customer and the job');
const NICK = { name: 'John Smith', phone: '0400 111 222', email: 'john@example.com',
               address: '14 Wattlebird Drive, Springfield Lakes QLD 4300' };
const d1 = await quoteFor(ctx, NICK, 'NAC-TEST-0001');
say('a customer record was written', db.nac_customers.size === 1,
  [...db.nac_customers.keys()].join(', ') || 'none');
say('a job record was written', db.nac_jobs.size === 1,
  [...db.nac_jobs.keys()].join(', ') || 'none');
const cust = [...db.nac_customers.values()][0];
const job = [...db.nac_jobs.values()][0];
say('the customer carries what the estimator typed',
  cust && cust.name === 'John Smith' && cust.phone === '0400 111 222'
    && cust.email === 'john@example.com',
  cust ? JSON.stringify({ n: cust.name, p: cust.phone, e: cust.email }) : 'none');
say('the job belongs to that customer', job && job.customer_id === cust.id,
  job && job.customer_id);
say('the job carries the site address',
  job && /Wattlebird/.test(job.site_address || ''), job && job.site_address);
say('the quote row is linked to both',
  d1.customerRef === cust.id && d1.jobRef === job.id,
  JSON.stringify({ c: d1.customerRef, j: d1.jobRef }));

console.log('\n[2] A second quote for the same customer REUSES the record');
const d2 = await quoteFor(ctx, { ...NICK, phone: '' }, 'NAC-TEST-0002');
say('no second customer was created', db.nac_customers.size === 1,
  db.nac_customers.size + ' customer(s)');
say('the second quote points at the same customer', d2.customerRef === cust.id,
  d2.customerRef);
say('the same site is the same job', d2.jobRef === job.id,
  d2.jobRef + ' vs ' + job.id + ' (' + db.nac_jobs.size + ' job(s))');
say('nothing interrupted the estimator', !/disagree/i.test(d2.flash),
  d2.flash.slice(0, 80) || 'no notice');

console.log('\n[3] The same customer at a DIFFERENT site gets a second job');
const d3 = await quoteFor(ctx, { ...NICK, address: '7 Other Street, Buderim QLD' },
  'NAC-TEST-0003');
say('still one customer', db.nac_customers.size === 1, db.nac_customers.size + '');
say('but now two jobs', db.nac_jobs.size === 2, db.nac_jobs.size + '');
say('the new quote is on the new job', d3.jobRef !== job.id && !!d3.jobRef, d3.jobRef);

console.log('\n[4] A DIFFERENT person with the same name is not merged in');
const d4 = await quoteFor(ctx, { name: 'John Smith', email: 'other.john@example.com',
  address: '99 Elsewhere Road, Caloundra QLD' }, 'NAC-TEST-0004');
say('a second John Smith gets his own record', db.nac_customers.size === 2,
  db.nac_customers.size + '');
say('and his own job', d4.customerRef !== cust.id, d4.customerRef);

console.log('\n[5] Saving a quote NEVER overwrites what the customer record holds');
const before = { ...db.nac_customers.get(cust.id) };
const d5 = await quoteFor(ctx, { name: 'John Smith', phone: '0499 888 777',
  email: 'john@example.com',
  address: '14 Wattlebird Drive, Springfield Lakes QLD 4300' }, 'NAC-TEST-0005');
const after = db.nac_customers.get(cust.id);
say('the phone NAC had is not replaced', after.phone === before.phone,
  'was "' + before.phone + '", now "' + after.phone + '"');
say('the address NAC had is still there', after.address === before.address, after.address);
say('the email NAC had is still there', after.email === before.email, after.email);
say('and the estimator WAS told about the difference',
  /disagree/i.test(d5.flash) && /0499 888 777/.test(d5.flash),
  d5.flash.replace(/\s+/g, ' ').slice(0, 140) || 'no notice');
say('but was not BLOCKED by it — the quote saved',
  /^Saved/.test(d5.flash.trim()), d5.flash.trim().slice(0, 40));

console.log(fail ? '\n' + fail + ' FAILED' : '\nALL PASSED');
await b.close();
process.exit(fail ? 1 : 0);
