// A SAVE THAT DID NOT REACH THE DATABASE IS NOT A SAVE.
//
// Nick: "Report success only after the database confirms it was saved."
//
// Two ways the database can let a save down — it refuses (403), or it cannot
// be reached at all — and the quote builder has to say so plainly in both.
// Telling an estimator their quote is saved when it is sitting in one tab is
// the one lie that loses a job.
//
// It used to drive the duct designer's "Load the sample builder plan" button
// and look for a toast. Both went with the designer; the rule did not.
//
//   node tools/serve.mjs &   node tools/browser-tests/persistence-failure.mjs
import { chromium } from 'playwright';
import { signInContext } from './signin.mjs';

const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox'] });
let failures = 0;
const say = (n, c, x) => {
  console.log((c ? 'PASS  ' : 'FAIL  ') + n + (x ? '  — ' + x : ''));
  if (!c) failures++;
};

for (const [label, status] of [['database rejects (403)', 403],
                               ['database unreachable', null]]) {
  const ctx = await b.newContext();
  await signInContext(ctx);
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('  [pageerror]', e.message.slice(0, 120)));
  await p.route('**/rest/v1/**', r => status === null
    ? r.abort('connectionfailed')
    : r.fulfill({ status, contentType: 'application/json', body: '{"message":"no"}' }));

  await p.goto('http://127.0.0.1:8777/quote-builder.html', { waitUntil: 'load' });
  await p.waitForTimeout(1200);

  // A quote worth losing. The equipment lives on a later step and the Save
  // button is always on screen, so the first step is enough: what is being
  // proved is what the screen SAYS when the write does not land, not how much
  // was typed before it.
  await p.fill('#cname', 'Test Customer — do not send');
  await p.fill('#caddr', '12 Example Street, Example QLD');

  await p.click('#save');
  await p.waitForTimeout(1800);

  const flash = (await p.evaluate(
    () => (document.querySelector('.flash') || {}).textContent || '')).trim();
  const kind = await p.evaluate(
    () => (document.querySelector('.flash') || {}).className || '');

  console.log('\n' + label);
  console.log('  said:', (flash || '(nothing)').slice(0, 190));
  say('  it does NOT claim the quote was saved', !/^Saved\b/.test(flash),
    flash.slice(0, 40));
  say('  it says the quote is on this device only',
    /this device only/i.test(flash));
  say('  it names the database as the reason',
    /database/i.test(flash), flash.slice(0, 90));
  say('  it tells the estimator not to close the tab',
    /do not close this tab/i.test(flash));
  say('  and it reads as a failure, not a note', /\bbad\b/.test(kind), kind);

  // Nothing is lost: the quote is still on the screen, and still unsaved.
  say('  the quote is still on the screen',
    (await p.inputValue('#cname')) === 'Test Customer — do not send');
  await ctx.close();
}

console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
await b.close();
process.exit(failures ? 1 : 0);
