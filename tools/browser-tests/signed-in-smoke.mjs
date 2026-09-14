import { chromium } from 'playwright';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
let fail=0; const say=(n,c,x)=>{console.log(`  ${c?'PASS':'FAIL'}  ${n}${x?'  — '+x:''}`); if(!c)fail++;};
for (const page of ['index.html','admin.html','designer.html']) {
  const ctx=await b.newContext({viewport:{width:1400,height:1000}});
  await ctx.route('**/rest/v1/**', r=>r.fulfill({status:200,contentType:'application/json',body:'[]'}));
  const p=await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(e.message.slice(0,120)));
  await p.goto('http://127.0.0.1:8777/'+page);
  await p.evaluate(()=>localStorage.setItem('nac_session_v1',JSON.stringify({
    access_token:'T',expires_at:Math.floor(Date.now()/1000)+3600,user:{email:'nick@nacelectrical.com.au'}})));
  await p.reload({waitUntil:'load'}); await p.waitForTimeout(2500);
  const len=await p.evaluate(()=>(document.body.innerText||'').trim().length);
  const vis=await p.evaluate(()=>getComputedStyle(document.documentElement).visibility);
  say(page+' renders signed in', len>150 && vis!=='hidden', len+' chars, visibility:'+vis);
  say(page+' has no page errors', errs.length===0, errs.join(' | ')||'clean');
  await ctx.close();
}
console.log(fail?`\n${fail} FAILED`:'\nALL PASSED');
await b.close(); process.exit(fail?1:0);
