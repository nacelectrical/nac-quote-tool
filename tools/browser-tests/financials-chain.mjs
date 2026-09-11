import { chromium } from 'playwright';
import { signInContext } from './signin.mjs';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
const ctx=await b.newContext(); const p=await ctx.newPage();
await signInContext(ctx);
p.on('pageerror',e=>console.log('[pageerror]',e.message.slice(0,140)));
await p.route('**/rest/v1/**', r=>r.fulfill({status:200,contentType:'application/json',body:'[]'}));
await p.goto('http://127.0.0.1:8777/designer.html',{waitUntil:'load'}); await p.waitForTimeout(1200);
await p.locator('button',{hasText:'Load the sample builder plan'}).first().click();
await p.waitForTimeout(2500);
await p.locator('button.tab',{hasText:'Financials'}).first().click(); await p.waitForTimeout(1000);

const read = async () => await p.evaluate(()=>{
  const stats={};
  document.querySelectorAll('.main .stat, .main [class*=stat]').forEach(s=>{
    const t=s.innerText.split('\n').map(x=>x.trim()).filter(Boolean);
    if(t.length>=2) stats[t[0]]=t[1];
  });
  return stats;
});
console.log('TAB TEXT:', (await p.evaluate(()=>document.querySelector('.main')?.innerText||'')).slice(0,400));
// Verify the rooms first — the tab is gated on that.
await p.locator('button.tab',{hasText:'Rooms'}).first().click(); await p.waitForTimeout(700);
const va=p.locator('button',{hasText:'Verify all'}); if(await va.count()) await va.last().click();
await p.waitForTimeout(1800);
await p.locator('button.tab',{hasText:'Financials'}).first().click(); await p.waitForTimeout(1200);
const before = await read();
console.log('BEFORE:', JSON.stringify(before, null, 1).slice(0,700));

// Type a subcontractor cost and an "other" cost.
const sub = p.locator('input[type=number]').nth(0);
const inputs = await p.evaluate(()=>[...document.querySelectorAll('.main .field')].map(f=>f.querySelector('label')?.textContent.trim()));
console.log('\nnumber fields on the tab:', JSON.stringify(inputs.filter(Boolean)));
const subField = p.locator('.main .field', {hasText:'Subcontractor cost'}).locator('input');
const othField = p.locator('.main .field', {hasText:'Other cost'}).locator('input');
await subField.fill('1200'); await subField.evaluate(e=>e.blur()); await p.waitForTimeout(700);
await othField.fill('300');  await othField.evaluate(e=>e.blur()); await p.waitForTimeout(900);
const after = await read();
console.log('\nAFTER :', JSON.stringify(after, null, 1).slice(0,600));

const num = s => Number(String(s||'').replace(/[^0-9.\-]/g,''))||0;
let fail=0; const say=(n,c)=>{console.log((c?'PASS  ':'FAIL  ')+n); if(!c)fail++;};
console.log();
const costKey = Object.keys(after).find(k=>/job cost/i.test(k));
const gpKey   = Object.keys(after).find(k=>/gross profit/i.test(k));
say('job cost rose by exactly 1500', Math.abs((num(after[costKey])-num(before[costKey])) - 1500) < 0.02);
say('gross profit unchanged (fee basis)', Math.abs(num(after[gpKey])-num(before[gpKey])) < 0.02);
say('subcontractor stat shows 1200', num(after['SUBCONTRACTOR'] ?? after['Subcontractor'])===1200);
say('other stat shows 300', num(after['OTHER'] ?? after['Other'])===300);
console.log(fail?`\n${fail} FAILED`:'\nALL PASSED');
await b.close(); process.exit(fail?1:0);
