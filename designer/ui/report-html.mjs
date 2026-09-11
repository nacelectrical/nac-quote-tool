// NAC — a report document rendered as a print page.
//
// It knows nothing about HVAC. Everything it prints came out of
// designer/engines/report-doc.mjs, which is what stops a supplier cost reaching
// a customer document by accident.

const esc = (s) => String(s === null || s === undefined ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const CSS = `
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
         color: #14142c; margin: 0; font-size: 11px; line-height: 1.45; }
  .sheet { max-width: 190mm; margin: 0 auto; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 16px;
           background: linear-gradient(135deg,#3B2D8F,#2B6CB8); color: #fff; padding: 14px 18px;
           border-radius: 8px; }
  header img { height: 42px; background: #fff; border-radius: 6px; padding: 3px 7px; }
  header h1 { margin: 0; font-size: 15px; color: #F5C200; letter-spacing: .3px; }
  header .meta { text-align: right; font-size: 10px; color: rgba(255,255,255,.85); }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .6px; color: #2B6CB8;
       border-bottom: 2px solid #F5C200; padding-bottom: 4px; margin: 18px 0 8px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 10px; font-size: 10px; }
  th { background: #eef2fb; text-align: left; padding: 5px 7px; border: 1px solid #dbe2f2;
       font-size: 9px; text-transform: uppercase; letter-spacing: .4px; color: #4a5578; }
  td { padding: 5px 7px; border: 1px solid #e6e9f2; vertical-align: top; }
  td.r, th.r { text-align: right; }
  .kv { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 10px; }
  .kv div { border: 1px solid #e6e9f2; border-radius: 6px; padding: 7px 9px; background: #fafbff; }
  .kv .l { font-size: 8.5px; text-transform: uppercase; letter-spacing: .4px; color: #6b7396; }
  .kv .v { font-size: 13px; font-weight: 700; margin-top: 2px; }
  .kv .s { font-size: 9px; color: #6b7396; }
  .note { font-size: 9.5px; color: #555f80; margin: 4px 0 10px; }
  .bullets { margin: 0 0 10px 16px; padding: 0; font-size: 10.5px; line-height: 1.7; }
  .warnbox { border-left: 3px solid #d08700; background: #fffaf0; padding: 8px 11px;
             border-radius: 0 6px 6px 0; margin-bottom: 10px; font-size: 10px; }
  .warnbox.crit { border-left-color: #c0392b; background: #fdf1f0; }
  .planimg { width: 100%; border: 1px solid #dbe2f2; border-radius: 6px; margin-bottom: 6px; }
  footer { margin-top: 18px; font-size: 9px; color: #6b7396; border-top: 1px solid #e6e9f2; padding-top: 8px; }
  .pagebreak { page-break-before: always; }
  @media print { .noprint { display: none !important; } }
  .noprint { position: fixed; top: 10px; right: 10px; display: flex; gap: 8px; }
  .noprint button { font: inherit; padding: 8px 14px; border-radius: 6px; border: none;
                    background: #2B6CB8; color: #fff; font-weight: 700; cursor: pointer; }
`;

function block(blk) {
  switch (blk.t) {
    case 'h2':        return '<h2>' + esc(blk.text) + '</h2>';
    case 'pagebreak': return '<div class="pagebreak"></div>';
    case 'note':      return '<p class="note">' + esc(blk.text) + '</p>';
    case 'flag':      return '<div class="warnbox' + (blk.level === 'crit' ? ' crit' : '') + '"><strong>' +
                             esc(blk.text) + '</strong></div>';
    case 'bullets':   return '<ul class="bullets">' + blk.items.map(i => '<li>' + esc(i) + '</li>').join('') + '</ul>';
    case 'image':     return '<img class="planimg" src="' + esc(blk.src) + '">' +
                             (blk.caption ? '<p class="note">' + esc(blk.caption) + '</p>' : '');
    case 'kv':        return '<div class="kv">' + blk.items.map(i =>
                             '<div><div class="l">' + esc(i[0]) + '</div><div class="v">' + esc(i[1]) + '</div>' +
                             (i[2] ? '<div class="s">' + esc(i[2]) + '</div>' : '') + '</div>').join('') + '</div>';
    case 'table':
      if (!blk.rows.length) return '<p class="note">None.</p>';
      return '<table><thead><tr>' +
        blk.cols.map(c => '<th' + (c.r ? ' class="r"' : '') + '>' + esc(c.label) + '</th>').join('') +
        '</tr></thead><tbody>' +
        blk.rows.map(r => '<tr>' + r.map((cell, i) =>
          '<td' + (blk.cols[i]?.r ? ' class="r"' : '') + '>' + esc(cell) + '</td>').join('') + '</tr>').join('') +
        '</tbody></table>';
    default: return '';
  }
}

/**
 * A standalone print page for the document.
 * `onDownload` is the name of a global function the Download button calls;
 * without it the page shows only Save as PDF (the browser's own print path).
 */
export function reportPageHtml(doc, { logo = null, downloadFn = null } = {}) {
  const body = doc.blocks.map(block).join('\n');
  const buttons = '<button onclick="window.print()">Save as PDF</button>' +
    (downloadFn ? '<button onclick="' + esc(downloadFn) + '()">Download PDF</button>' : '');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(doc.title)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>${CSS}</style></head><body><div class="sheet">
<header>
  ${logo ? `<img src="${esc(logo)}" alt="NAC">` : `<div><strong>${esc(doc.business)}</strong></div>`}
  <div><h1>${esc(doc.title)}</h1>
    <div style="font-size:10px;color:rgba(255,255,255,.8)">${esc(doc.jobDescription)}</div></div>
  <div class="meta">${esc(doc.designId)}<br>${esc(doc.dateText)}<br>ABN: ${esc(doc.abn)}</div>
</header>
<h2>Customer</h2>
<div class="kv">
  <div><div class="l">Customer</div><div class="v">${esc(doc.customer.name)}</div></div>
  <div><div class="l">Site address</div><div class="v">${esc(doc.customer.address)}</div></div>
  <div><div class="l">Phone</div><div class="v">${esc(doc.customer.phone)}</div></div>
  <div><div class="l">Email</div><div class="v">${esc(doc.customer.email)}</div></div>
</div>
${body}
<footer>${esc(doc.business)} &middot; ABN ${esc(doc.abn)} &middot; ${esc(doc.website)}</footer>
</div>
<div class="noprint">${buttons}</div>
</body></html>`;
}
