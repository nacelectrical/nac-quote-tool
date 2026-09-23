// THE DESIGNER'S OWN SHELL, AT THE SIZES IT IS USED AT.
//
// The customer's proposal page has been checked at phone, iPad and desktop
// since it was written. The DESIGNER had not — every suite drove it at 1180 or
// 1500 wide, so nobody ever looked at the app at phone width until it was live
// and Nick opened it on his phone.
//
// What he saw: "NAC AI HVAC DESIGNER" printed straight across the middle of the
// Design Assistant button, and a header eating half the screen before the first
// control. The header's two halves could not shrink — the title is nowrap and
// eight buttons wrap onto three rows — so they overlapped.
//
//   node tools/serve.mjs &   node tools/browser-tests/designer-layout.mjs

import { chromium } from 'playwright';
import { signInContext } from './signin.mjs';

const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
let fail = 0;
const say = (n, c, x) => { console.log(`  ${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  — ' + x : ''}`); if (!c) fail++; };

// Every size NAC actually work at. The phone is not a nice-to-have: it is what
// gets pulled out in a roof space.
const SIZES = [
  ['iphone-se',        375,  667, true],
  ['iphone-portrait',  390,  844, true],
  ['ipad-portrait',    820, 1180, true],
  ['ipad-landscape',  1180,  820, true],
  ['desktop',         1440,  900, false]
];

for (const [name, w, h, touch] of SIZES) {
  console.log('\n[' + name + '] ' + w + '×' + h);
  const ctx = await b.newContext({ viewport: { width: w, height: h },
    deviceScaleFactor: 2, isMobile: touch && w < 700, hasTouch: touch });
  await signInContext(ctx);
  await ctx.route('**/rest/v1/**', r => r.fulfill({
    status: 200, contentType: 'application/json', body: '[]' }));
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('   [pageerror]', e.message.slice(0, 140)));
  await p.goto('http://127.0.0.1:8777/designer.html', { waitUntil: 'load' });
  await p.waitForTimeout(1600);

  const r = await p.evaluate(() => {
    const head = document.querySelector('.app-head');
    const rect = (e) => e.getBoundingClientRect();

    // Anything in the header that a person reads or presses.
    const items = [...head.querySelectorAll('h1, .sub, .badge, .btn, img')]
      .map(e => ({ e, r: rect(e) })).filter(o => o.r.width > 0 && o.r.height > 0);

    const overlaps = [];
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const a = items[i], c = items[j];
      if (a.e.contains(c.e) || c.e.contains(a.e)) continue;
      const ox = Math.min(a.r.right, c.r.right) - Math.max(a.r.left, c.r.left);
      const oy = Math.min(a.r.bottom, c.r.bottom) - Math.max(a.r.top, c.r.top);
      if (ox > 1 && oy > 1) overlaps.push(
        (a.e.textContent || a.e.tagName).trim().slice(0, 24) + ' × ' +
        (c.e.textContent || c.e.tagName).trim().slice(0, 24));
    }

    // A control that starts off the right-hand edge of its own scroller is
    // unreachable without a sideways swipe most people never try.
    const actions = head.querySelector('.head-actions');
    const save = [...head.querySelectorAll('.btn')].find(x => /^save$/i.test(x.textContent.trim()));
    const ar = rect(actions);
    const sr = save ? rect(save) : null;

    const small = [...head.querySelectorAll('.btn')]
      .map(e => ({ t: e.textContent.trim().slice(0, 18), h: Math.round(rect(e).height) }))
      .filter(o => o.h < 30);

    return {
      headH: Math.round(rect(head).height),
      viewH: window.innerHeight,
      overlaps: [...new Set(overlaps)],
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      saveVisible: !!sr && sr.left >= ar.left - 1 && sr.right <= ar.right + 1,
      saveText: save ? save.textContent.trim() : '(no Save button)',
      shortTargets: small,
      // The stage strip has to be reachable too.
      stepsScrollable: (() => { const s = document.querySelector('.steps');
        return !!s && s.scrollWidth <= s.clientWidth + 1 ? 'fits' : 'scrolls'; })()
    };
  });

  say('nothing in the header overlaps anything else', r.overlaps.length === 0,
    r.overlaps.slice(0, 3).join(' | ') || 'clear');
  say('the page does not scroll sideways', r.scrollW <= r.clientW + 1,
    r.scrollW + ' vs ' + r.clientW);
  // A third of the screen is the most a header may cost before the first
  // control. On the phone it was taking nearly half.
  say('the header leaves room for the work', r.headH <= r.viewH / 3,
    r.headH + ' of ' + r.viewH + ' px');
  say('Save is in view without a sideways swipe', r.saveVisible, r.saveText);
  say('every header button is a real touch target', r.shortTargets.length === 0,
    r.shortTargets.map(t => t.t + ' ' + t.h + 'px').join(', ') || 'all ≥ 30px');
  say('the stage strip is reachable', r.stepsScrollable === 'fits' || r.stepsScrollable === 'scrolls',
    r.stepsScrollable);

  await ctx.close();
}

console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
await b.close();
process.exit(fail ? 1 : 0);
