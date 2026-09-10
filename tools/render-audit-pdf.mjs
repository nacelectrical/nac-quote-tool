// Renders docs/readiness-audit.html to A4 PDF with its print styles applied.
//   node tools/render-audit-pdf.mjs
// Colours are the information in that document, so printBackground stays on.

import { chromium } from 'playwright';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
const p=await b.newPage();
p.on('pageerror',e=>console.log('[pageerror]',e.message));
await p.emulateMedia({media:'print', colorScheme:'light'});
await p.goto('file://' + process.cwd() + '/docs/readiness-audit.html',{waitUntil:'networkidle'});
await p.waitForTimeout(1200);
const rows=await p.evaluate(()=>({total:document.querySelectorAll('#rows tr').length,
  hidden:[...document.querySelectorAll('#rows tr')].filter(t=>getComputedStyle(t).display==='none').length}));
console.log('rows:', JSON.stringify(rows));
await p.pdf({path:'docs/NAC-readiness-audit.pdf', format:'A4', printBackground:true,
  margin:{top:'14mm',bottom:'14mm',left:'12mm',right:'12mm'},
  displayHeaderFooter:true,
  headerTemplate:'<div></div>',
  footerTemplate:'<div style="font:8px Helvetica,sans-serif;color:#8A90A2;width:100%;padding:0 12mm;display:flex;justify-content:space-between;align-items:center"><span>NAC Tool Readiness Audit &nbsp;&middot;&nbsp; 10 Sep 2026</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>'});
await b.close();
