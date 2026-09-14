import { chromium } from 'playwright';
import { signInContext } from './signin.mjs';
const EXE='/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
const ctx=await b.newContext();
await signInContext(ctx);
const settings=new Map(), designs=new Map();
let failures=0; const say=(n,c)=>{console.log((c?'PASS  ':'FAIL  ')+n); if(!c) failures++;};

async function newPage(){
  const p=await ctx.newPage();
  p.on('pageerror',e=>console.log('  [pageerror]',e.message.slice(0,140)));
  await p.route('**/rest/v1/nac_settings**', async r=>{
    const q=r.request();
    if(q.method()==='POST'){const b=JSON.parse(q.postData()||'{}');settings.set(b.key,b.value);
      return r.fulfill({status:201,contentType:'application/json',body:'[]'});}
    const m=/key=eq\.([^&]+)/.exec(q.url());
    const v=m?settings.get(decodeURIComponent(m[1])):undefined;
    return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(v!==undefined?[{value:v}]:[])});
  });
  await p.route('**/rest/v1/nac_designs**', async r=>{
    const q=r.request();
    if(q.method()==='POST'){const b=JSON.parse(q.postData()||'{}');designs.set(b.id,b);
      return r.fulfill({status:201,contentType:'application/json',body:'[]'});}
    const m=/id=eq\.([^&]+)/.exec(q.url());
    if(m){const d=designs.get(decodeURIComponent(m[1]));
      return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(d?[d]:[])});}
    return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify([...designs.values()])});
  });
  return p;
}

console.log('== designer: create -> save -> reload -> load ==');
let p=await newPage();
await p.goto('http://127.0.0.1:8777/designer.html',{waitUntil:'load'}); await p.waitForTimeout(1500);
// Build a real design through the app's own sample loader, then save it.
await p.locator('button',{hasText:'Load the sample builder plan'}).first().click();
await p.waitForTimeout(2500);
const designId = await p.evaluate(()=>window.__nacApp?.design?.id || document.querySelector('.sub')?.textContent||'');
await p.locator('button',{hasText:'Save'}).first().click();
await p.waitForTimeout(1500);
const saveToast = await p.evaluate(()=>[...document.querySelectorAll('.toast,.toasts,[class*=toast]')].map(e=>e.textContent).join(' | '));
console.log('  design id:', String(designId).slice(0,60));
console.log('  save toast:', saveToast.slice(0,120) || '(none captured)');
say('a design row reached the database', designs.size>0 || [...settings.keys()].some(k=>k.startsWith('nac_design_')));
const storedKey = designs.size ? [...designs.keys()][0] : [...settings.keys()].find(k=>k.startsWith('nac_design_'));
console.log('  stored as:', storedKey);
say('save did NOT warn about local-only', !/DEVICE ONLY|locally only/i.test(saveToast));
await p.close();

// Wipe localStorage so ONLY the database can supply the design back.
p=await newPage();
await p.goto('http://127.0.0.1:8777/designer.html',{waitUntil:'load'});
await p.evaluate(()=>localStorage.clear());
await p.reload({waitUntil:'load'}); await p.waitForTimeout(1500);
const loaded = await p.evaluate(async (id)=>{
  const S = await import('/designer/engines/store.mjs');
  const list = await S.listDesigns();
  const d = list.length ? await S.loadDesign(list[0].id) : null;
  return { count:list.length, id:d?.id||null, rooms:(d?.rooms||[]).length, customer:d?.customer?.name||null };
}, storedKey);
console.log('  after localStorage.clear ->', JSON.stringify(loaded));
say('design list comes from the database', loaded.count>0);
say('design loads back with its rooms', loaded.rooms>0);
await p.close();

console.log(failures? `\n${failures} FAILED` : '\nALL PASSED');
await b.close();
process.exit(failures?1:0);
