// ─────────────────────────────────────────────────────────────────────────────
// THE QUOTE SCREEN AS A TECHNICIAN, IN A REAL BROWSER
//
// The control that stops a technician reading NAC's cost prices is the
// row-level policy on nac_settings, and the control that stops them issuing a
// quote is the capability check on /api/quote-issue. Both are tested where
// they live (tests/roles.test.mjs, designer/roles-rls.sql).
//
// This is about the OTHER failure: a technician who is quietly refused and not
// told. With the policy applied their browser cannot read nac_settings, so the
// settings fall back to what shipped with the application — and a price panel
// that happily worked out a figure from the APPLICATION's job fee would be
// worse than one that refuses, because the number would look like NAC's.
//
//   node tools/serve.mjs &   node tools/browser-tests/roles-ui.mjs
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

async function open({ role = 'technician', settingsReadable = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 },
                                         deviceScaleFactor: 2 });
  await ctx.addInitScript(({ role, settingsReadable }) => {
    localStorage.setItem('nac_session_v1', JSON.stringify({
      access_token: 't', user: { email: role + '@example.invalid' },
      expires_at: Math.floor(Date.now() / 1000) + 86400 }));
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
        return J({ ok: true, signedIn: true, email: role + '@example.invalid',
                   role, capabilities: caps, rolesConfigured: true });
      }
      if (s.includes('/api/presentation-content')) return J({ content: { upgrades: [] } });
      if (s.includes('/rest/v1/nac_settings')) {
        // What the row-level policy actually does to a technician: the read
        // succeeds and returns NOTHING, because no row is visible to them.
        return settingsReadable
          ? J([{ value: JSON.stringify({ commercial: { jobFee: 5500,
                   proposalAllowance: { ductwork: 3200 } } }) }])
          : J([]);
      }
      if (s.includes('/rest/v1/') || s.includes('/auth/v1/')) return J([]);
      if (s.includes('/api/')) return J({ ok: true });
      return real(u, o);
    };
  }, { role, settingsReadable });

  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await page.goto(B + '/quote-builder.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  return { ctx, page, errs };
}

// ── A TECHNICIAN ───────────────────────────────────────────────────────────
const tech = await open({ role: 'technician' });

await step('the price panel says whose job the price is, rather than inventing one', async () => {
  await tech.page.click('button.steps-tab >> nth=0').catch(() => {});
  await tech.page.evaluate(() => document.getElementById('workOutPrice')?.click());
  await tech.page.waitForTimeout(250);
  const text = await tech.page.textContent('#priceWork');
  if (!/owner’s to work out|owner's to work out/.test(text)) {
    throw new Error('it did not explain itself: ' + text.replace(/\s+/g, ' ').slice(0, 300));
  }
  // The thing that must NOT happen: a figure built from the shipped defaults.
  if (/\$\s?\d/.test(text)) {
    throw new Error('it produced a price from settings the technician cannot read: '
      + text.replace(/\s+/g, ' ').slice(0, 300));
  }
  if (!/typed into the system above still works/.test(text)) {
    throw new Error('it did not offer the manual way through');
  }
});

await step('the Issue button is disabled, and says why on hover', async () => {
  const state = await tech.page.evaluate(() => {
    const b = document.getElementById('issue');
    return b ? { disabled: b.disabled, title: b.title } : null;
  });
  if (!state) throw new Error('no issue button on the page');
  if (!state.disabled) throw new Error('a technician could press Issue');
  if (!/owner/i.test(state.title)) throw new Error('no reason given: ' + state.title);
});

await step('the assessment work is NOT blocked', async () => {
  // A permission model that stops the crew working gets switched off within a
  // week, and then there is no permission model.
  const can = await tech.page.evaluate(() => {
    const room = document.querySelector('#rooms input, #plan input, input#outlets');
    const save = document.getElementById('save');
    return { hasInputs: !!room, saveEnabled: !!save && !save.disabled };
  });
  if (!can.saveEnabled) throw new Error('a technician cannot save their work');
});

await step('no javascript errors as a technician', async () => {
  if (tech.errs.length) throw new Error(tech.errs.join(' | '));
});
await tech.ctx.close();

// ── AN OWNER, FOR THE CONTRAST ─────────────────────────────────────────────
const owner = await open({ role: 'owner', settingsReadable: true });

await step('an owner gets the real panel, built from NAC’s own figures', async () => {
  await owner.page.evaluate(() => document.getElementById('workOutPrice')?.click());
  await owner.page.waitForTimeout(250);
  const text = await owner.page.textContent('#priceWork');
  if (/owner’s to work out|owner's to work out/.test(text)) {
    throw new Error('the owner was refused their own pricing panel');
  }
  if (!/What this job costs NAC/.test(text)) {
    throw new Error('the panel did not render: ' + text.replace(/\s+/g, ' ').slice(0, 300));
  }
});

await step('no javascript errors as an owner', async () => {
  if (owner.errs.length) throw new Error(owner.errs.join(' | '));
});
await owner.ctx.close();

await browser.close();
console.log(fail ? '\n' + fail + ' FAILED' : '\nALL PASSED');
process.exit(fail ? 1 : 0);
