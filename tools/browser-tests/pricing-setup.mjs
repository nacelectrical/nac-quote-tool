// ─────────────────────────────────────────────────────────────────────────────
// THE PRICING SETUP SCREEN, IN A REAL BROWSER
//
// Nick, 8 November 2026: "Inspect the installation allowances required by the
// pricing engine. Provide clear Settings fields with units, GST treatment and
// validation."
//
// The defect this screen fixes is worth stating once more, because it is the
// kind that survives a thousand passing tests: quote-pricing.mjs could price a
// job from NAC's own figures, it refused while the allowances were unset, the
// refusal was correct, it was tested, AND THERE WAS NO SCREEN WITH THE FIELDS
// ON IT. `proposalAllowance` and `jobFee` appeared in no .html file in the
// repository. So the engine priced nothing, ever, and nothing failed.
//
//   node tools/serve.mjs &   node tools/browser-tests/pricing-setup.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { chromium } from 'playwright';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const B = 'http://127.0.0.1:8777';
let fail = 0;
const step = async (n, fn) => {
  try { await fn(); console.log('  PASS  ' + n); }
  catch (e) { console.log('  FAIL  ' + n + '  — ' + e.message); fail++; }
};

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });

/**
 * @param role        'owner' | 'technician'
 * @param stored      what nac_settings already holds for nac_hvac_settings_v1
 * @param writeStatus what the database answers when the page saves
 */
async function open({ role = 'owner', stored = null, writeStatus = 201,
                      device = { width: 390, height: 844 } } = {}) {
  const ctx = await browser.newContext({ viewport: device, deviceScaleFactor: 2 });
  await ctx.addInitScript(({ role, stored, writeStatus }) => {
    localStorage.setItem('nac_session_v1', JSON.stringify({
      access_token: 't', refresh_token: 'r',
      user: { email: role === 'owner' ? 'owner@example.invalid' : 'tech@example.invalid' },
      expires_at: Math.floor(Date.now() / 1000) + 86400 }));
    window.__writes = [];
    window.__settingsReads = 0;
    const real = window.fetch;
    window.fetch = async (u, o = {}) => {
      const s = String(u);
      const J = (x, st = 200) => new Response(JSON.stringify(x),
        { status: st, headers: { 'Content-Type': 'application/json' } });

      if (s.includes('/api/whoami')) {
        const caps = role === 'owner'
          ? ['view_internal_pricing', 'edit_pricing_settings', 'issue_quote', 'assess',
             'view_quote_status', 'prepare_handover', 'confirm_site_facts', 'confirm_deposit']
          : ['assess', 'view_quote_status', 'prepare_handover', 'confirm_site_facts'];
        return J({ ok: true, signedIn: true,
                   email: role === 'owner' ? 'owner@example.invalid' : 'tech@example.invalid',
                   role, capabilities: caps, rolesConfigured: true,
                   decidedBy: 'NAC_OWNER_EMAILS', note: null });
      }
      if (s.includes('/rest/v1/nac_settings')) {
        if ((o.method || 'GET').toUpperCase() === 'POST') {
          window.__writes.push(JSON.parse(o.body));
          return new Response(writeStatus < 400 ? '[]' : 'rejected', { status: writeStatus });
        }
        window.__settingsReads++;
        return J(stored ? [{ value: JSON.stringify(stored) }] : []);
      }
      if (s.includes('/auth/v1/')) return J({ id: 'u1' });
      if (s.includes('/rest/v1/')) return J([]);
      return real(u, o);
    };
  }, { role, stored, writeStatus });

  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await page.goto(B + '/settings.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  return { ctx, page, errs };
}

const set = async (page, id, value) => {
  await page.fill('#' + id, String(value));
  await page.dispatchEvent('#' + id, 'input');
  await page.waitForTimeout(80);
};

// ── A TECHNICIAN ───────────────────────────────────────────────────────────
const tech = await open({ role: 'technician' });

await step('a technician is told why, and is not shown the figures', async () => {
  const text = await tech.page.textContent('body');
  if (!/Restricted to the business owner/i.test(text)) {
    throw new Error('no explanation: ' + text.replace(/\s+/g, ' ').slice(0, 300));
  }
  if (await tech.page.locator('#f_jobFee').count()) {
    throw new Error('the job fee field was rendered for a technician');
  }
  if (await tech.page.locator('#save').isVisible().catch(() => false)) {
    throw new Error('the save bar was shown to a technician');
  }
});

await step('and it does not even ask the database for the cost prices', async () => {
  // The row-level policy would refuse it anyway. Not asking means a technician
  // never sees a wall of failed requests either.
  const reads = await tech.page.evaluate(() => window.__settingsReads);
  if (reads !== 0) throw new Error('it read nac_settings ' + reads + ' time(s)');
});

await step('a technician is told what they CAN still do', async () => {
  const text = await tech.page.textContent('body');
  for (const want of ['floor plan', 'preliminary sizing', 'handover']) {
    if (!text.includes(want)) throw new Error('missing reassurance: ' + want);
  }
});
await tech.ctx.close();

// ── AN OWNER, NOTHING SAVED YET ────────────────────────────────────────────
const fresh = await open({ role: 'owner', stored: null });

await step('the owner gets the fields, with units and the GST treatment', async () => {
  const text = await fresh.page.textContent('body');
  for (const want of ['Ductwork', 'Return air', 'Plenums', 'Electrical', 'Refrigeration',
                      'Condensate', 'Installation labour', 'Roof access',
                      'Per supply outlet', 'Per motorised zone', 'Contingency',
                      'Job fee', 'GST rate']) {
    if (!text.includes(want)) throw new Error('no field for: ' + want);
  }
  if (!/dollars per job/.test(text)) throw new Error('the allowances carry no unit');
  if (!/percent of job cost/.test(text)) throw new Error('the contingency carries no unit');
  const basis = await fresh.page.textContent('#f_feebasis');
  if (!/Excluding GST/.test(basis) || !/Including GST/.test(basis)) {
    throw new Error('the job fee does not ask its GST treatment: ' + basis);
  }
});

await step('it names the exact input that is missing', async () => {
  const status = await fresh.page.textContent('#statusBody');
  if (!/Installation allowances/.test(status)) {
    throw new Error('it did not name the missing input: ' + status.replace(/\s+/g, ' '));
  }
  if (!/priced at a loss/.test(status)) throw new Error('it did not say why it matters');
});

await step('the shipped job fee is flagged as not NAC’s figure', async () => {
  const status = await fresh.page.textContent('#statusBody');
  if (!/shipped with the application/.test(status)) {
    throw new Error('a default was presented as a confirmed figure: '
      + status.replace(/\s+/g, ' ').slice(0, 300));
  }
});

await step('what is blocked is the suggested price, and nothing else', async () => {
  const status = await fresh.page.textContent('#statusBody');
  if (!/suggested price/i.test(status)) throw new Error('it did not say what is blocked');
  if (!/Drafts, assessments, room measurements and the sizing all save as normal/
        .test(status.replace(/\s+/g, ' '))) {
    throw new Error('it did not say what still works: ' + status.replace(/\s+/g, ' '));
  }
});

await step('entering one allowance flips it to ready, live', async () => {
  await set(fresh.page, 'f_al_ductwork', '3200');
  const status = await fresh.page.textContent('#statusBody');
  if (!/Everything the engine needs is set/.test(status)) {
    throw new Error('still not ready: ' + status.replace(/\s+/g, ' ').slice(0, 300));
  }
});

await step('an empty box is NOT SET, and is allowed', async () => {
  await set(fresh.page, 'f_al_plenums', '');
  const invalid = await fresh.page.getAttribute('#f_al_plenums', 'aria-invalid');
  if (invalid === 'true') throw new Error('an empty allowance was treated as an error');
  const status = await fresh.page.textContent('#statusBody');
  if (/Plenums.*cannot/i.test(status)) throw new Error('it complained about an empty box');
});

await step('a typed zero is a decision and is honoured as zero', async () => {
  await set(fresh.page, 'f_al_plenums', '0');
  const invalid = await fresh.page.getAttribute('#f_al_plenums', 'aria-invalid');
  if (invalid === 'true') throw new Error('zero was refused');
});

await step('a negative allowance is refused', async () => {
  await set(fresh.page, 'f_al_electrical', '-50');
  if (await fresh.page.getAttribute('#f_al_electrical', 'aria-invalid') !== 'true') {
    throw new Error('a negative allowance was accepted');
  }
  const status = await fresh.page.textContent('#statusBody');
  if (!/cannot be less than 0/.test(status)) throw new Error('no reason given');
  await set(fresh.page, 'f_al_electrical', '800');
});

await step('a contingency over 100% is refused', async () => {
  await set(fresh.page, 'f_cont', '140');
  if (await fresh.page.getAttribute('#f_cont', 'aria-invalid') !== 'true') {
    throw new Error('140% contingency was accepted');
  }
  await set(fresh.page, 'f_cont', '5');
  if (await fresh.page.getAttribute('#f_cont', 'aria-invalid') === 'true') {
    throw new Error('5% was refused');
  }
});

await step('it will not save while a field is wrong', async () => {
  await set(fresh.page, 'f_jobFee', '-1');
  await fresh.page.click('#save');
  await fresh.page.waitForTimeout(150);
  const msg = await fresh.page.textContent('#msg');
  if (!/Fix the fields marked in red/.test(msg)) throw new Error('it said: ' + msg);
  const writes = await fresh.page.evaluate(() => window.__writes.length);
  if (writes !== 0) throw new Error('it wrote anyway');
  await set(fresh.page, 'f_jobFee', '5500');
});

await step('saving writes the figures to the database, under the right key', async () => {
  await fresh.page.click('#save');
  await fresh.page.waitForTimeout(400);
  const msg = await fresh.page.textContent('#msg');
  if (!/Saved to the database/.test(msg)) throw new Error('it said: ' + msg);

  const writes = await fresh.page.evaluate(() => window.__writes);
  if (!writes.length) throw new Error('nothing was written');
  const w = writes[writes.length - 1];
  if (w.key !== 'nac_hvac_settings_v1') throw new Error('wrong key: ' + w.key);
  const saved = JSON.parse(w.value);
  if (saved.commercial.jobFee !== 5500) {
    throw new Error('the job fee was not saved: ' + JSON.stringify(saved.commercial));
  }
  if (saved.commercial.proposalAllowance.ductwork !== 3200) {
    throw new Error('the ductwork allowance was not saved');
  }
  if (saved.commercial.proposalAllowance.plenums !== 0) {
    throw new Error('a typed zero was dropped instead of saved as zero');
  }
  if (saved.commercial.proposalAllowance.contingencyPct !== 5) {
    throw new Error('the contingency was not saved');
  }
  if (saved.commercial.jobFeeExGst !== true) {
    throw new Error('the GST treatment was not saved');
  }
});

await step('after saving, the figures stop being flagged as shipped defaults', async () => {
  const status = await fresh.page.textContent('#statusBody');
  if (/Job fee is in force at/.test(status)) {
    throw new Error('the job fee is still flagged after NAC saved it');
  }
});

await step('it fits a phone with no sideways scroll', async () => {
  const over = await fresh.page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (over > 1) throw new Error(over + 'px of sideways scroll at 390px');
  const small = await fresh.page.evaluate(() =>
    [...document.querySelectorAll('input, select, button, .nav a')]
      .filter(e => e.getBoundingClientRect().height < 40).length);
  if (small) throw new Error(small + ' control(s) under 40px tall');
});

await step('no javascript errors', async () => {
  if (fresh.errs.length) throw new Error(fresh.errs.join(' | '));
});
await fresh.ctx.close();

// ── A SAVE THE DATABASE REFUSES ────────────────────────────────────────────
const rejected = await open({ role: 'owner', writeStatus: 401 });
await step('a rejected save is NOT reported as saved', async () => {
  // store.setSetting writes localStorage first so an iPad on a bad signal never
  // loses the work. A local write is not a save, and saying it is would be the
  // one lie that puts a wrong price on a quote from another device.
  await set(rejected.page, 'f_al_ductwork', '3200');
  await rejected.page.click('#save');
  await rejected.page.waitForTimeout(400);
  const msg = await rejected.page.textContent('#msg');
  if (!/NOT saved to the database/.test(msg)) throw new Error('it said: ' + msg);
  if (!/this device only/.test(msg)) throw new Error('it did not say where it went');
});
await rejected.ctx.close();

// ── ALREADY SET UP ─────────────────────────────────────────────────────────
const configured = await open({ role: 'owner', stored: {
  commercial: { gstRate: 0.1, jobFee: 7200, jobFeeExGst: false,
                proposalAllowance: { flat: 5600, perOutlet: 150 } },
  // Something else living under the same key, which this screen must not drop.
  load: { baseWattsPerM2: 145 }
} });

await step('saved figures come back into the fields', async () => {
  if (await configured.page.inputValue('#f_jobFee') !== '7200') {
    throw new Error('the saved job fee did not load');
  }
  if (await configured.page.inputValue('#f_al_flat') !== '5600') {
    throw new Error('the saved flat allowance did not load');
  }
  if (await configured.page.inputValue('#f_al_perOutlet') !== '150') {
    throw new Error('the saved per-outlet allowance did not load');
  }
  if (await configured.page.inputValue('#f_feebasis') !== 'inc') {
    throw new Error('the saved GST treatment did not load');
  }
  const status = await configured.page.textContent('#statusBody');
  if (!/Everything the engine needs is set/.test(status)) {
    throw new Error('a configured deployment reads as unready: '
      + status.replace(/\s+/g, ' ').slice(0, 200));
  }
});

await step('saving does not drop the other settings under the same key', async () => {
  await configured.page.click('#save');
  await configured.page.waitForTimeout(400);
  const writes = await configured.page.evaluate(() => window.__writes);
  const saved = JSON.parse(writes[writes.length - 1].value);
  if (saved.load?.baseWattsPerM2 !== 145) {
    throw new Error('the design settings were lost: ' + JSON.stringify(Object.keys(saved)));
  }
});
await configured.ctx.close();

await browser.close();
console.log(fail ? '\n' + fail + ' FAILED' : '\nALL PASSED');
process.exit(fail ? 1 : 0);
