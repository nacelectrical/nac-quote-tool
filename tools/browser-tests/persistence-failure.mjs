import { chromium } from 'playwright';
import { signInContext } from './signin.mjs';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
let failures=0; const say=(n,c)=>{console.log((c?'PASS  ':'FAIL  ')+n); if(!c) failures++;};

for (const [label, status] of [['database rejects (403)', 403], ['database unreachable', null]]) {
  const ctx=await b.newContext(); await signInContext(ctx); const p=await ctx.newPage();
  p.on('pageerror',e=>console.log('  [pageerror]',e.message.slice(0,120)));
  await p.route('**/rest/v1/**', r => status===null ? r.abort('connectionfailed')
    : r.fulfill({status, contentType:'application/json', body:'{"message":"no"}'}));
  await p.goto('http://127.0.0.1:8777/designer.html',{waitUntil:'load'}); await p.waitForTimeout(1200);
  await p.locator('button',{hasText:'Load the sample builder plan'}).first().click();
  await p.waitForTimeout(2500);
  await p.locator('button',{hasText:'Save'}).first().click();
  await p.waitForTimeout(1500);
  const toast=await p.evaluate(()=>[...document.querySelectorAll('[class*=toast]')].map(e=>e.textContent).join(' | '));
  const dirty=await p.evaluate(()=>{
    const btns=[...document.querySelectorAll('button')].filter(x=>/^Save/.test(x.textContent.trim()));
    return btns.map(x=>x.textContent.trim());
  });
  console.log(`\n${label}`);
  console.log('  toast:', (toast||'(none)').slice(0,190));
  say('  warns it is device-only', /DEVICE ONLY/i.test(toast));
  say('  names the reason',       /database|reach/i.test(toast));
  await ctx.close();
}
console.log(failures? `\n${failures} FAILED` : '\nALL PASSED');
await b.close(); process.exit(failures?1:0);
