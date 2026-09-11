// Every button on every designer tab must have a real click handler.
//
// Detection is via CDP DOMDebugger.getEventListeners, NOT btn.onclick: the app
// binds with addEventListener, so .onclick is always null and a naive check
// reports 100% of buttons dead. Exits non-zero if any button does nothing.

import { chromium } from 'playwright';
import { signInContext } from './signin.mjs';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
const ctx=await b.newContext({viewport:{width:1400,height:1000}});
await signInContext(ctx);
const p=await ctx.newPage();
const cdp=await ctx.newCDPSession(p);
await p.route('**/rest/v1/**', r=>r.fulfill({status:200,contentType:'application/json',body:'[]'}));
await p.goto('http://127.0.0.1:8777/designer.html',{waitUntil:'load'}); await p.waitForTimeout(1200);
await p.locator('button',{hasText:'Load the sample builder plan'}).first().click(); await p.waitForTimeout(2500);
await p.locator('button.tab',{hasText:'Rooms'}).first().click(); await p.waitForTimeout(600);
const va=p.locator('button',{hasText:'Verify all'}); if(await va.count()) await va.last().click();
await p.waitForTimeout(1800);

async function auditTab(name){
  await p.locator('button.tab',{hasText:name}).first().click(); await p.waitForTimeout(500);
  const {result}=await cdp.send('Runtime.evaluate',{
    expression:`Array.from(document.querySelectorAll('.main button, .plan-tools button'))`,
    returnByValue:false});
  const {result:props}=await cdp.send('Runtime.getProperties',{objectId:result.objectId, ownProperties:true});
  const dead=[]; let n=0;
  for (const pr of props){
    if(!/^\d+$/.test(pr.name)) continue;
    n++;
    const oid=pr.value.objectId;
    const {listeners}=await cdp.send('DOMDebugger.getEventListeners',{objectId:oid});
    const hasClick=(listeners||[]).some(l=>l.type==='click'||l.type==='pointerdown');
    if(!hasClick){
      const {result:lbl}=await cdp.send('Runtime.callFunctionOn',{objectId:oid,
        functionDeclaration:'function(){return this.textContent.trim().slice(0,30)}',returnByValue:true});
      dead.push(lbl.value);
    }
  }
  return {n, dead};
}
const TABS=['Overview','Plan','Rooms','Sizing','Equipment','Airflow','Outlets','Ductwork','Return','Zones','Materials','Financials','Warnings'];
let total=0, deadTotal=0;
for(const t of TABS){
  const {n,dead}=await auditTab(t);
  total+=n; deadTotal+=dead.length;
  console.log(`${t.padEnd(12)} ${String(n).padStart(3)} buttons  ${dead.length?('NO HANDLER: '+dead.join(' | ')):'all wired'}`);
}
console.log(`\nTOTAL ${total} buttons, ${deadTotal} with no click handler`);
await b.close(); process.exit(deadTotal?1:0);
