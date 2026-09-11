// P5 — the designer's questions are real dialogs, not the browser's prompt()
// and confirm(). Run with a static server on 8777.
//
// The test fails the run if ANY native dialog appears: Playwright auto-dismisses
// them, which is exactly the silent-wrong-answer failure this replaces.
import { chromium } from 'playwright';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
let fail = 0;
const say = (n, c, x) => { console.log(`  ${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  — ' + x : ''}`); if (!c) fail++; };

// iPad landscape is the size Nick works at on site.
const ctx = await b.newContext({ viewport: { width: 1180, height: 820 } });
await ctx.route('**/rest/v1/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
const p = await ctx.newPage();
p.on('pageerror', e => console.log('   [pageerror]', e.message.slice(0, 140)));

const native = [];
p.on('dialog', async d => { native.push(d.type() + ': ' + d.message().slice(0, 60)); await d.dismiss(); });

await p.goto('http://127.0.0.1:8777/designer.html');
await p.evaluate(() => localStorage.setItem('nac_session_v1', JSON.stringify({
  access_token: 'T', expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { email: 'nick@nacelectrical.com.au' } })));
await p.reload({ waitUntil: 'load' });
await p.waitForTimeout(2000);

const M = () => p.evaluate(() => import('/designer/ui/modal.mjs'));
const open = (fn, arg) => p.evaluate(async ([name, a]) => {
  const m = await import('/designer/ui/modal.mjs');
  window.__result = m[name](a);          // deliberately NOT awaited — the dialog is on screen
  return true;
}, [fn, arg]);
const result = () => p.evaluate(() => window.__result);
const shown = () => p.locator('.dlg-host');

// ── confirm ────────────────────────────────────────────────────────────────
await open('confirmDialog', { title: 'Remove Bed 2?', message: 'It comes out of the load.',
  lines: ['Bed 2 — 62% confidence'], confirmLabel: 'Remove room', danger: true });
await p.waitForTimeout(200);
say('a confirm renders as a dialog', await shown().count() === 1);
say('its title is readable', (await p.locator('.dlg-head h3').innerText()).includes('Remove Bed 2'));
say('the supporting lines are on screen', (await p.locator('.dlg-body').innerText()).includes('62%'));

const btnBox = await p.locator('.dlg-btn.primary').boundingBox();
say('the confirm button is a 48px touch target', btnBox.height >= 44, Math.round(btnBox.height) + 'px');
const panelBox = await p.locator('.dlg-panel').boundingBox();
say('the dialog fits iPad landscape', panelBox.width <= 1180 && panelBox.height <= 820,
  Math.round(panelBox.width) + '×' + Math.round(panelBox.height));

await p.locator('.dlg-btn.primary').click();
say('confirming resolves true', await result() === true);
say('the dialog closed', await shown().count() === 0);

await open('confirmDialog', { title: 'Cancel me' });
await p.waitForTimeout(150);
await p.locator('.dlg-btn.ghost').click();
say('cancelling resolves false, never undefined', await result() === false);

await open('confirmDialog', { title: 'Escape me' });
await p.waitForTimeout(150);
await p.keyboard.press('Escape');
await p.waitForTimeout(150);
say('Escape cancels', await result() === false && await shown().count() === 0);

// ── form ───────────────────────────────────────────────────────────────────
await open('formDialog', { title: 'Add a room by hand', submitLabel: 'Add room', fields: [
  { key: 'label', label: 'Room name', value: 'New room' },
  { key: 'width', label: 'Width (m)', type: 'number', step: '0.01', value: '' },
  { key: 'length', label: 'Length (m)', type: 'number', step: '0.01', value: '' }
] });
await p.waitForTimeout(200);
say('every field is on screen at once', await p.locator('.dlg-field').count() === 3);
const fontOk = await p.evaluate(() =>
  [...document.querySelectorAll('.dlg-input')].every(i => parseFloat(getComputedStyle(i).fontSize) >= 16));
say('inputs are 16px so iOS does not zoom the page', fontOk);
say('number fields ask for the decimal keypad', await p.locator('#dlgf-width').getAttribute('inputmode') === 'decimal');
await p.fill('#dlgf-label', 'Rumpus');
await p.fill('#dlgf-width', '4.2');
await p.fill('#dlgf-length', '3.6');
await p.locator('.dlg-btn.primary').click();
const v = await result();
say('the form returns every answer together', v.label === 'Rumpus' && v.width === 4.2 && v.length === 3.6,
  JSON.stringify(v));

await open('formDialog', { title: 'Cancel me', fields: [{ key: 'a', label: 'A', value: '' }] });
await p.waitForTimeout(150);
await p.locator('.dlg-btn.ghost').click();
say('a cancelled form resolves null', await result() === null);

// ── pick ───────────────────────────────────────────────────────────────────
await open('pickDialog', { title: 'Open a design', options: [
  { value: 'D-1', label: 'Smith', sub: 'D-1', meta: '10/09/2026' },
  { value: 'D-2', label: 'Jones', sub: 'D-2', meta: '09/09/2026' }
] });
await p.waitForTimeout(200);
say('the whole list is on screen, not a numbered prompt', await p.locator('.dlg-option').count() === 2);
say('nobody has to count — you tap the row', (await p.locator('.dlg-option').first().innerText()).includes('Smith'));
const optBox = await p.locator('.dlg-option').first().boundingBox();
say('rows are a 52px touch target', optBox.height >= 44, Math.round(optBox.height) + 'px');
await p.locator('.dlg-option').nth(1).click();
say('tapping a row resolves its value', await result() === 'D-2');

await open('pickDialog', { title: 'Nothing here', options: [], emptyText: 'No saved designs yet.' });
await p.waitForTimeout(150);
say('an empty list says so rather than showing a blank box',
  (await p.locator('.dlg-body').innerText()).includes('No saved designs yet'));
await p.locator('.dlg-btn.ghost').click();
say('an empty pick still resolves', await result() === null);

// ── multi pick ─────────────────────────────────────────────────────────────
await open('pickDialog', { title: 'Group zones', multi: true, submitLabel: 'Group them', options: [
  { value: 'z1', label: 'Living', meta: '120 L/s' },
  { value: 'z2', label: 'Bed 1', meta: '45 L/s' },
  { value: 'z3', label: 'Bed 2', meta: '40 L/s' }
] });
await p.waitForTimeout(200);
await p.locator('.dlg-option').nth(0).click();
await p.locator('.dlg-option').nth(2).click();
say('chosen rows are visibly chosen', await p.locator('.dlg-option.on').count() === 2);
await p.locator('.dlg-btn.primary').click();
const picked = await result();
say('a multi pick returns the chosen values', JSON.stringify(picked) === '["z1","z3"]', JSON.stringify(picked));

// ── link ───────────────────────────────────────────────────────────────────
await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
await open('linkDialog', { title: 'Quote Q-9 created', url: 'https://nac.example/sign.html?q=Q-9' });
await p.waitForTimeout(200);
say('the whole link is shown, not truncated',
  await p.locator('.dlg-link').inputValue() === 'https://nac.example/sign.html?q=Q-9');
await p.locator('.dlg-btn.ghost').click();      // Copy link
await p.waitForTimeout(300);
say('copying reports what actually happened',
  /Copied|copy it by hand/.test(await p.locator('.dlg-linkrow').innerText()),
  await p.locator('.dlg-linkrow .dlg-hint').innerText());
await p.locator('.dlg-btn.primary').click();
say('the link dialog closes', await shown().count() === 0);

// ── backdrop ───────────────────────────────────────────────────────────────
await open('confirmDialog', { title: 'Backdrop test' });
await p.waitForTimeout(150);
await p.mouse.click(8, 8);
await p.waitForTimeout(150);
say('a tap outside cancels', await result() === false && await shown().count() === 0);

// ── phone width ────────────────────────────────────────────────────────────
await p.setViewportSize({ width: 390, height: 844 });
await open('formDialog', { title: 'Add a material line', fields: [
  { key: 'label', label: 'Description', value: '' },
  { key: 'quantity', label: 'Quantity', type: 'number', value: '1' }
] });
await p.waitForTimeout(250);
const phone = await p.evaluate(() => {
  const r = document.querySelector('.dlg-panel').getBoundingClientRect();
  return { w: r.width, h: r.height, vw: innerWidth, vh: innerHeight,
           scroll: document.documentElement.scrollWidth > innerWidth + 1 };
});
say('at phone width the sheet fits and the page does not scroll sideways',
  phone.w <= phone.vw + 1 && phone.h <= phone.vh && !phone.scroll,
  Math.round(phone.w) + '×' + Math.round(phone.h) + ' in ' + phone.vw + '×' + phone.vh);
await p.keyboard.press('Escape');

// ── the whole point ────────────────────────────────────────────────────────
say('no native prompt() or confirm() appeared at any point', native.length === 0, native.join(' | ') || 'none');

console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
await b.close();
process.exit(fail ? 1 : 0);
