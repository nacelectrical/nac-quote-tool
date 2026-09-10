import { chromium } from 'playwright';
const EXE='/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
const ctx=await b.newContext();          // one context = one "browser session"
const store=new Map();                   // survives reloads, like a real table
const designs=new Map();

async function newPage(){
  const p=await ctx.newPage();
  p.on('pageerror',e=>console.log('  [pageerror]',e.message.slice(0,120)));
  await p.route('**/rest/v1/nac_settings**', async route=>{
    const req=route.request();
    if(req.method()==='POST'){ const b=JSON.parse(req.postData()||'{}'); store.set(b.key,b.value);
      return route.fulfill({status:201,contentType:'application/json',body:'[]'}); }
    if(req.method()==='DELETE'){ const m=/key=eq\.([^&]+)/.exec(req.url()); store.delete(decodeURIComponent(m[1]));
      return route.fulfill({status:204,body:''}); }
    const m=/key=eq\.([^&]+)/.exec(req.url());
    if(m){ const v=store.get(decodeURIComponent(m[1]));
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(v!==undefined?[{value:v}]:[])}); }
    return route.fulfill({status:200,contentType:'application/json',
      body:JSON.stringify([...store.keys()].map(k=>({key:k})))});
  });
  await p.route('**/rest/v1/nac_designs**', async route=>{
    const req=route.request();
    if(req.method()==='POST'){ const b=JSON.parse(req.postData()||'{}'); designs.set(b.id,b);
      return route.fulfill({status:201,contentType:'application/json',body:'[]'}); }
    const m=/id=eq\.([^&]+)/.exec(req.url());
    if(m){ const d=designs.get(decodeURIComponent(m[1]));
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(d?[d]:[])}); }
    return route.fulfill({status:200,contentType:'application/json',
      body:JSON.stringify([...designs.values()])});
  });
  return p;
}

const say=(n,c)=>{console.log((c?'PASS  ':'FAIL  ')+n); if(!c) failures++;};
let failures=0;

// ── 1. Settings: create -> reload -> read -> update -> reload -> read ───────
console.log('\n== nac_settings round trip ==');
let p=await newPage();
await p.goto('http://127.0.0.1:8777/index.html',{waitUntil:'load'}); await p.waitForTimeout(1000);
const w1=await p.evaluate(async()=>await window.storage.set('crud_customer', JSON.stringify({name:'Test Customer',address:'1 Test St'})));
say('create write synced', w1.synced===true);
await p.close();

p=await newPage();  // a genuinely fresh page load
await p.goto('http://127.0.0.1:8777/index.html',{waitUntil:'load'}); await p.waitForTimeout(1000);
const read1=await p.evaluate(async()=>(await window.storage.get('crud_customer'))?.value);
say('survives a reload', JSON.parse(read1||'{}').name==='Test Customer');
const w2=await p.evaluate(async()=>await window.storage.set('crud_customer', JSON.stringify({name:'Test Customer EDITED',address:'2 New Rd'})));
say('update write synced', w2.synced===true);
await p.close();

p=await newPage();
await p.goto('http://127.0.0.1:8777/index.html',{waitUntil:'load'}); await p.waitForTimeout(1000);
const read2=await p.evaluate(async()=>(await window.storage.get('crud_customer'))?.value);
const parsed=JSON.parse(read2||'{}');
say('EDIT survives a reload', parsed.name==='Test Customer EDITED' && parsed.address==='2 New Rd');
const del=await p.evaluate(async()=>await window.storage.delete('crud_customer'));
say('delete reports synced', del.synced===true);
await p.close();

p=await newPage();
await p.goto('http://127.0.0.1:8777/index.html',{waitUntil:'load'}); await p.waitForTimeout(1000);
const read3=await p.evaluate(async()=>(await window.storage.get('crud_customer'))?.value);
say('delete survives a reload', !read3);
say('database really holds it (not just localStorage)', !store.has('crud_customer'));
await p.close();

console.log(failures? `\n${failures} FAILED` : '\nALL PASSED');
await b.close();
process.exit(failures?1:0);
