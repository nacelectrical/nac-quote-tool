// P4 — the estimator must be told, in the page, that the static pressure check
// did not happen. Silence is not a pass.
//
//   node tools/serve.mjs &   node tools/browser-tests/static-pressure-gate.mjs
import { chromium } from 'playwright';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
let fail = 0;
const say = (n, c, x) => { console.log(`  ${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  — ' + x : ''}`); if (!c) fail++; };

const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 } });
await ctx.route('**/rest/v1/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
const p = await ctx.newPage();
p.on('pageerror', e => console.log('   [pageerror]', e.message.slice(0, 140)));
await p.goto('http://127.0.0.1:8777/designer.html');
await p.evaluate(() => localStorage.setItem('nac_session_v1', JSON.stringify({
  access_token: 'T', expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { email: 'nick@nacelectrical.com.au' } })));
await p.reload({ waitUntil: 'load' });
await p.waitForTimeout(2000);

// Drive the engines directly and render the Ductwork tab, once on a unit with
// no ESP on file and once on a unit that has one.
const run = async (availableStaticPa) => p.evaluate(async (esp) => {
  const app = window.nacDesigner;
  const R = '/designer/engines/';
  const { calculateAirflow } = await import(R + 'airflow.mjs');
  const { designOutlets } = await import(R + 'outlets.mjs');
  const { buildDuctNetwork } = await import(R + 'ducts.mjs');
  const { estimateStaticPressure } = await import(R + 'pressure.mjs');
  const { designReturnAir } = await import(R + 'returnair.mjs');
  const rooms = [
    { roomId: 'r1', label: 'Living', areaSqM: 30, coolingLoadKw: 4, conditioned: true },
    { roomId: 'r2', label: 'Bed 1',  areaSqM: 14, coolingLoadKw: 2, conditioned: true }
  ];
  const load = { designKw: 6, rooms };
  const a = calculateAirflow(load);
  const o = designOutlets(rooms, a.rows);
  const net = buildDuctNetwork({ airflow: a, outlets: o, mainRoute: { lengthMm: 4000 } });
  const pressure = estimateStaticPressure({ network: net, outlets: o,
    selectedUnit: { model: 'TESTUNIT', availableStaticPa: esp } });
  const ret = designReturnAir({ totalAirflowLs: a.allocatedAirflowLs });
  app.design = { ...(app.design || {}), stage: 'complete', rooms, systemLoad: load,
    airflow: a, outlets: o, network: net, pressure, returnDesign: ret };
  app.setTab('return');
  await new Promise(r => setTimeout(r, 400));
  return { status: pressure.status, text: document.querySelector('.main')?.innerText || '' };
}, availableStaticPa);

const none = await run(null);
say('engine reports not_completed with no ESP on file', none.status === 'not_completed', none.status);
say('the page says the check was NOT COMPLETED',
  /STATIC PRESSURE CHECK NOT COMPLETED/.test(none.text));
say('the page says manufacturer data is required',
  /MANUFACTURER DATA REQUIRED/.test(none.text));
say('the not-completed notice is a banner, not buried in a list',
  await p.evaluate(() => [...document.querySelectorAll('.banner')]
    .some(el => /NOT COMPLETED/.test(el.innerText))));
say('the page never claims it passed', !/check passed/i.test(none.text));

const ok = await run(250);
say('with ESP on file the check completes', ok.status === 'pass', ok.status);
say('and the page says so', /Static pressure check passed/.test(ok.text));

const bad = await run(10);
say('an over-pressure design is reported FAILED', bad.status === 'fail', bad.status);
say('and the page says FAILED', /STATIC PRESSURE CHECK FAILED/.test(bad.text));

// iPad landscape — the banner must still be readable, not clipped.
await p.setViewportSize({ width: 1180, height: 820 });
await run(null);
const box = await p.evaluate(() => {
  const el = [...document.querySelectorAll('.banner')].find(e => /NOT COMPLETED/.test(e.innerText));
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { visible: r.width > 200 && r.height > 10, right: r.right, vw: innerWidth };
});
say('the notice is readable at iPad landscape', !!box && box.visible && box.right <= box.vw + 1,
  box ? box.right + ' / ' + box.vw : 'not found');

console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
await b.close();
process.exit(fail ? 1 : 0);
