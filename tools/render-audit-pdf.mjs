// Renders an audit document to A4 PDF with its print styles applied.
//   node tools/render-audit-pdf.mjs [name] [footer title]
// The name is the docs/ stem, default readiness-audit; the PDF lands next to it
// as docs/NAC-<name>.pdf. Colours are the information in these documents, so
// printBackground stays on.

const NAME = process.argv[2] || 'readiness-audit';
const TITLE = process.argv[3] || 'NAC Tool Readiness Audit';
const STAMP = new Date().toLocaleDateString('en-AU',
  { day: '2-digit', month: 'short', year: 'numeric' });

import { chromium } from 'playwright';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
const p=await b.newPage();
p.on('pageerror',e=>console.log('[pageerror]',e.message));
await p.emulateMedia({media:'print', colorScheme:'light'});
await p.goto('file://' + process.cwd() + '/docs/' + NAME + '.html',{waitUntil:'networkidle'});
await p.waitForTimeout(1200);
const rows=await p.evaluate(()=>({total:document.querySelectorAll('#rows tr').length,
  hidden:[...document.querySelectorAll('#rows tr')].filter(t=>getComputedStyle(t).display==='none').length}));
console.log('rows:', JSON.stringify(rows));
await p.pdf({path:'docs/NAC-' + NAME + '.pdf', format:'A4', printBackground:true,
  margin:{top:'14mm',bottom:'14mm',left:'12mm',right:'12mm'},
  displayHeaderFooter:true,
  headerTemplate:'<div></div>',
  footerTemplate:'<div style="font:8px Helvetica,sans-serif;color:#8A90A2;width:100%;padding:0 12mm;display:flex;justify-content:space-between;align-items:center"><span>' + TITLE + ' &nbsp;&middot;&nbsp; ' + STAMP + '</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>'});
await b.close();
