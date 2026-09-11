// The real designer buttons, driven the way Nick would, at iPad landscape.
import { chromium } from 'playwright';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
let fail = 0;
const say = (n, c, x) => { console.log(`  ${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  — ' + x : ''}`); if (!c) fail++; };
const ctx = await b.newContext({ viewport: { width: 1180, height: 820 } });
const designs = [
  { id: 'D-OLD', customer_name: 'Smith', status: 'draft', quote_id: null, updated_at: '2026-09-01T00:00:00Z' },
  { id: 'D-NEW', customer_name: 'Jones', status: 'quoted', quote_id: 'Q-2', updated_at: '2026-09-10T00:00:00Z' }
];
// Playwright matches the most recently added route FIRST, so the catch-all has
// to be registered before the specific one or it swallows everything.
await ctx.route('**/rest/v1/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
await ctx.route('**/rest/v1/nac_designs**', r => r.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify(designs) }));
const p = await ctx.newPage();
p.on('pageerror', e => console.log('   [pageerror]', e.message.slice(0, 140)));
const native = []; p.on('dialog', async d => { native.push(d.type()); await d.dismiss(); });
await p.goto('http://127.0.0.1:8777/designer.html');
await p.evaluate(() => localStorage.setItem('nac_session_v1', JSON.stringify({
  access_token: 'T', expires_at: Math.floor(Date.now()/1000)+3600, user: { email: 'n@nac' } })));
await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(2200);

await p.locator('button', { hasText: 'Designs' }).first().click();
await p.waitForTimeout(700);
say('the Designs button opens a real dialog', await p.locator('.dlg-host').count() === 1);
const dl = await p.locator('.dlg-body').innerText();
say('it lists the saved designs by customer, newest first',
  await p.locator('.dlg-option').count() === 2 && /Jones[\s\S]*Smith/.test(dl),
  dl.replace(/\n/g, ' | ').slice(0, 80));
await p.keyboard.press('Escape'); await p.waitForTimeout(300);

await p.locator('button', { hasText: 'Reports' }).first().click();
await p.waitForTimeout(500);
const rt = await p.locator('.dlg-body').innerText();
say('the Reports button offers both reports', /Internal HVAC Design Sheet/.test(rt) && /Customer HVAC Design Summary/.test(rt));
say('it says what the customer one leaves out', /No costs/.test(rt));
await p.keyboard.press('Escape'); await p.waitForTimeout(300);

await p.locator('button', { hasText: 'Revisions' }).first().click();
await p.waitForTimeout(500);
say('Revisions with none saved says so rather than opening an empty box',
  await p.locator('.dlg-host').count() === 0 && (await p.evaluate(() => document.body.innerText)).includes('No saved revisions'));

// Add a room by hand through the real button, all the way into the design.
await p.locator('button.tab', { hasText: 'Rooms' }).first().click(); await p.waitForTimeout(500);
await p.locator('button', { hasText: 'Add room manually' }).first().click(); await p.waitForTimeout(500);
say('Add room manually opens the form', await p.locator('.dlg-field').count() >= 3);
await p.fill('#dlgf-label', 'Rumpus'); await p.fill('#dlgf-width', '4.2'); await p.fill('#dlgf-length', '3.6');
await p.locator('.dlg-btn.primary').click(); await p.waitForTimeout(700);
const room = await p.evaluate(() => (window.nacDesigner.design.rooms || [])
  .map(r => ({ label: r.label, area: r.areaSqM })).slice(-1)[0]);
say('the room really lands in the design', room && room.label === 'Rumpus' && Math.abs(room.area - 15.12) < 0.05,
  JSON.stringify(room));
say('and it is on the page', (await p.evaluate(() => document.querySelector('.main').innerText)).includes('Rumpus'));

say('no native dialog appeared', native.length === 0, native.join(',') || 'none');
console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
await b.close(); process.exit(fail ? 1 : 0);
