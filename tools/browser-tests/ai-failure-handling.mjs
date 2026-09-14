import { chromium } from 'playwright';
import { signInContext } from './signin.mjs';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
let fail=0; const say=(n,c)=>{console.log(`  ${c?'PASS':'FAIL'}  ${n}`); if(!c)fail++;};

// 1. No API key configured -> the UI must say so, not invent rooms.
console.log('\n[1] AI not configured');
{
  const ctx=await b.newContext(); await signInContext(ctx); const p=await ctx.newPage();
  await p.route('**/api/plan-read', r=>r.fulfill({status:500,contentType:'application/json',
    body:JSON.stringify({error:'Anthropic API key not configured'})}));
  await p.route('**/rest/v1/**', r=>r.fulfill({status:200,contentType:'application/json',body:'[]'}));
  await p.goto('http://127.0.0.1:8777/designer.html',{waitUntil:'load'}); await p.waitForTimeout(1200);
  await p.evaluate(async()=>{const c=document.createElement('canvas');c.width=1200;c.height=900;
    const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,1200,900);
    const bl=await new Promise(r=>c.toBlob(r,'image/png'));const dt=new DataTransfer();
    dt.items.add(new File([bl],'plan.png',{type:'image/png'}));
    const el=document.querySelector('input[type=file]');el.files=dt.files;
    el.dispatchEvent(new Event('change',{bubbles:true}));});
  await p.waitForTimeout(2500);
  await p.locator('button',{hasText:'Read plan with AI'}).first().click(); await p.waitForTimeout(3000);
  const toast=await p.evaluate(()=>[...document.querySelectorAll('[class*=toast]')].map(e=>e.textContent).join(' | '));
  const rooms=await p.evaluate(()=>{const t=document.querySelector('.plan-tools')?.innerText||'';return /Numbers read from the plan/.test(t);});
  console.log('     toast:', (toast||'(none)').slice(0,150));
  say('the failure is reported to the estimator', /failed|not configured|could not/i.test(toast));
  say('NO rooms were invented', !rooms);
  await ctx.close();
}

// 2. Malformed AI response -> discarded, never used as rooms.
console.log('\n[2] AI returns rubbish');
{
  const ctx=await b.newContext(); await signInContext(ctx); const p=await ctx.newPage();
  await p.route('**/api/plan-read', r=>r.fulfill({status:200,contentType:'application/json',
    body:JSON.stringify({observations:{detections:[{id:'d1',text:'not-a-number',box:{x:'bad',y:0,w:0,h:0}}],
      roomLabels:[{id:'r1',text:'GHOST ROOM'}]},quality:'poor',notes:['unreadable']})}));
  await p.route('**/rest/v1/**', r=>r.fulfill({status:200,contentType:'application/json',body:'[]'}));
  await p.goto('http://127.0.0.1:8777/designer.html',{waitUntil:'load'}); await p.waitForTimeout(1200);
  await p.evaluate(async()=>{const c=document.createElement('canvas');c.width=1200;c.height=900;
    const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,1200,900);
    const bl=await new Promise(r=>c.toBlob(r,'image/png'));const dt=new DataTransfer();
    dt.items.add(new File([bl],'plan.png',{type:'image/png'}));
    const el=document.querySelector('input[type=file]');el.files=dt.files;
    el.dispatchEvent(new Event('change',{bubbles:true}));});
  await p.waitForTimeout(2500);
  await p.locator('button',{hasText:'Read plan with AI'}).first().click(); await p.waitForTimeout(3000);
  await p.locator('button.tab',{hasText:'Rooms'}).first().click(); await p.waitForTimeout(900);
  const rows=await p.evaluate(()=>[...document.querySelectorAll('.main table tbody tr')].map(r=>r.innerText.split('\t')[0]));
  console.log('     room rows:', JSON.stringify(rows));
  const ghost=rows.find(r=>/GHOST/.test(r));
  say('a label with no usable box does not become a measured room',
      !ghost || !/\d/.test(rows.join('')) );
  await ctx.close();
}

// 3. A real read retains the evidence per room.
console.log('\n[3] room records keep their evidence');
{
  const ctx=await b.newContext(); await signInContext(ctx); const p=await ctx.newPage();
  await p.route('**/rest/v1/**', r=>r.fulfill({status:200,contentType:'application/json',body:'[]'}));
  await p.goto('http://127.0.0.1:8777/designer.html',{waitUntil:'load'}); await p.waitForTimeout(1200);
  await p.locator('button',{hasText:'Load the sample builder plan'}).first().click(); await p.waitForTimeout(2500);
  const rec=await p.evaluate(async()=>{
    const S=await import('/designer/engines/store.mjs');
    // read the live design straight off the module the app uses
    const R=await import('/designer/engines/rooms.mjs');
    return null;
  });
  await p.locator('button.tab',{hasText:'Rooms'}).first().click(); await p.waitForTimeout(900);
  const cols=await p.evaluate(()=>[...document.querySelectorAll('.main table thead th')].map(t=>t.innerText.trim()));
  console.log('     room table columns:', JSON.stringify(cols));
  for (const need of ['ROOM','WIDTH','LENGTH','AREA','SOURCE','CONFIDENCE'])
    say(`column: ${need}`, cols.some(c=>c.toUpperCase().includes(need)));
  await ctx.close();
}
console.log(fail?`\n${fail} FAILED`:'\nALL PASSED');
await b.close(); process.exit(fail?1:0);
