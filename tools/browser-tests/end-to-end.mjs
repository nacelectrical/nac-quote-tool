import { chromium } from 'playwright';
import { signInContext } from './signin.mjs';
const EXE='/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
const ctx=await b.newContext({viewport:{width:1400,height:1000}});
await signInContext(ctx);
const settings=new Map(), designs=new Map(), quotes=new Map();
let failures=0, step=0;
const say=(n,c)=>{console.log(`  ${c?'PASS':'FAIL'}  ${n}`); if(!c)failures++;};
const STEP=n=>console.log(`\n[${++step}] ${n}`);

async function page(){
  const p=await ctx.newPage();
  p.on('pageerror',e=>console.log('   [pageerror]',e.message.slice(0,140)));
  await p.route('**/rest/v1/nac_settings**', async r=>{const q=r.request();
    if(q.method()==='POST'){const x=JSON.parse(q.postData()||'{}');settings.set(x.key,x.value);
      return r.fulfill({status:201,contentType:'application/json',body:'[]'});}
    const m=/key=eq\.([^&]+)/.exec(q.url()); const v=m?settings.get(decodeURIComponent(m[1])):undefined;
    return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(v!==undefined?[{value:v}]:[])});});
  await p.route('**/rest/v1/nac_designs**', async r=>{const q=r.request();
    if(q.method()==='POST'){const x=JSON.parse(q.postData()||'{}');designs.set(x.id,x);
      return r.fulfill({status:201,contentType:'application/json',body:'[]'});}
    const m=/id=eq\.([^&]+)/.exec(q.url());
    if(m){const d=designs.get(decodeURIComponent(m[1]));
      return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(d?[d]:[])});}
    return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify([...designs.values()])});});
  await p.route('**/rest/v1/nac_quotes**', async r=>{const q=r.request();
    if(q.method()==='POST'){const x=JSON.parse(q.postData()||'{}');quotes.set(x.id,x);
      return r.fulfill({status:201,contentType:'application/json',body:'[]'});}
    const m=/id=eq\.([^&]+)/.exec(q.url());
    const row=m?quotes.get(decodeURIComponent(m[1])):null;
    return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(row?[row]:[])});});
  return p;
}
const tab=async(p,name)=>{await p.locator('button.tab',{hasText:name}).first().click(); await p.waitForTimeout(700);};
const txt=async(p)=>await p.evaluate(()=>document.querySelector('.main')?.innerText||'');

let p=await page();
STEP('Open the designer');
await p.goto('http://127.0.0.1:8777/designer.html',{waitUntil:'load'}); await p.waitForTimeout(1200);
say('designer loads', (await p.title()).includes('NAC'));

STEP('Create the job (load a plan)');
await p.locator('button',{hasText:'Load the sample builder plan'}).first().click(); await p.waitForTimeout(2500);
const planTxt=await txt(p);
say('plan is loaded and calibrated', /CALIBRATION DISTANCE|CALCULATED SCALE/.test(planTxt));
say('dimensions were read', /dimensions read|length\(s\) read/i.test(planTxt));

STEP('Verify rooms');
await tab(p,'Rooms');
const va=p.locator('button',{hasText:'Verify all'}); if(await va.count()) await va.last().click();
await p.waitForTimeout(1800);
const roomsTxt=await txt(p);
const roomRows=await p.evaluate(()=>document.querySelectorAll('.main table tbody tr').length);
say('rooms are listed', roomRows>0);
say('no room left unverified blocking sizing', !/must be verified/i.test(await txt(p)));

STEP('HVAC load');
await tab(p,'Sizing');
const sizing=await txt(p);
const kw=(/DESIGN COOLING\s*\n\s*([\d.]+)\s*kW/.exec(sizing)||[])[1];  // not RAW, which is pre-diversity
say('a design load is calculated', !!kw && Number(kw)>0);
console.log('     design load:', kw, 'kW');

STEP('Equipment');
await tab(p,'Equipment');
const eq=await txt(p);
say('a unit is selected', /Daikin|Fujitsu|Mitsubishi|Panasonic|Samsung|Gree|Braemar|Haier|Toshiba|Carrier|Actron/.test(eq));

STEP('Airflow / Outlets / Ductwork / Return / Zones');
for (const t of ['Airflow','Outlets','Ductwork','Return','Zones']) {
  await tab(p,t);
  const s=await txt(p);
  say(`${t} tab produces figures`, s.length>120 && !/must be verified/i.test(s));
}

STEP('Materials (BOM)');
await tab(p,'Materials');
const mat=await txt(p);
const lines=(/LINES\s*\n\s*(\d+)/.exec(mat)||[])[1];
const cost=(/TOTAL COST\s*\n\s*\$([\d,\.]+)/.exec(mat)||[])[1];
say('a BOM is generated', Number(lines)>0);
console.log('     BOM lines:', lines, '| total cost $'+cost);

STEP('Financials');
await tab(p,'Financials');
const fin=await txt(p);
const sell=(/SELL PRICE \(INC GST\)\s*\n\s*\$([\d,\.]+)/.exec(fin)||[])[1];
say('a sell price is produced', !!sell);
console.log('     sell inc GST: $'+sell);

STEP('Save the design');
await p.locator('button',{hasText:'Save'}).first().click(); await p.waitForTimeout(1500);
say('design reached the database', designs.size>0 || [...settings.keys()].some(k=>k.startsWith('nac_design_')));
const designId=[...designs.keys()][0]||[...settings.keys()].find(k=>k.startsWith('nac_design_'));
console.log('     design id:', designId);

STEP('Refresh the page and reopen the design');
await p.close(); p=await page();
await p.goto('http://127.0.0.1:8777/designer.html',{waitUntil:'load'});
await p.evaluate(()=>localStorage.clear());
await p.reload({waitUntil:'load'}); await p.waitForTimeout(1500);
const reopened=await p.evaluate(async()=>{
  const S=await import('/designer/engines/store.mjs');
  const l=await S.listDesigns(); const d=l.length?await S.loadDesign(l[0].id):null;
  return { count:l.length, rooms:(d?.rooms||[]).length, kw:d?.systemLoad?.designKw,
           sell:d?.commercials?.sellPriceIncGst, bom:d?.bom?.lineCount };
});
console.log('     reopened:', JSON.stringify(reopened));
say('the design survives a refresh, from the DATABASE', reopened.count>0 && reopened.rooms>0);
say('its sizing survived', reopened.kw>0);
say('its price survived', reopened.sell>0);

STEP('Push to quote');
const pushed=await p.evaluate(async()=>{
  const S=await import('/designer/engines/store.mjs');
  const l=await S.listDesigns(); const d=await S.loadDesign(l[0].id);
  try { const r=await S.pushDesignToQuote(d); return {ok:true, ...r}; }
  catch(e){ return {ok:false, error:e.message}; }
});
console.log('     ', JSON.stringify(pushed).slice(0,150));
say('quote created', pushed.ok===true && !!pushed.quoteId);
say('quote row exists in the database', quotes.size===1);
if (quotes.size) {
  const q=[...quotes.values()][0];
  say('quote carries line items', JSON.parse(q.line_items||'[]').length>0);
  say('quote carries the design summary', /NAC AI HVAC DESIGNER/.test(q.notes||''));
}

STEP('Open the customer sign page for that quote');
if (pushed.quoteId) {
  const sp=await page();
  await sp.goto('http://127.0.0.1:8777/sign.html?q='+encodeURIComponent(pushed.quoteId),{waitUntil:'load'});
  await sp.waitForTimeout(1800);
  const s=await sp.evaluate(()=>document.body.innerText);
  console.log('     sign page:', s.replace(/\n+/g,' | ').slice(0,180));
  say('sign page renders the quote (not an error)', !/Error loading|No quote ID/.test(s));
  await sp.close();
}

STEP('Report generation (PDF path)');
await tab(p,'Overview');
const reportBtns=await p.evaluate(()=>[...document.querySelectorAll('button')].map(b=>b.textContent.trim()).filter(t=>/report|pdf|print/i.test(t)));
console.log('     report buttons:', JSON.stringify(reportBtns));
say('report actions exist', reportBtns.length>0);

console.log(failures?`\n${failures} STEP(S) FAILED`:'\nEND-TO-END: ALL PASSED');
await b.close(); process.exit(failures?1:0);
