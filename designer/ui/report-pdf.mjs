// NAC — a report document laid out as a real PDF file.
//
// Same document model as the print page, so the two cannot drift apart, and
// the same rule applies: this renderer only prints what report-doc.mjs put in
// the document. It cannot reach into the design for a figure of its own.
//
// A4, 40pt margins, Helvetica. Tables repeat their heading row when they run
// over a page. Every page is numbered "Page n of m" and carries the NAC footer,
// because a customer document that loses a page should say so.

import { PdfDoc, textWidth, wrapText, jpegInfo } from './pdf-writer.mjs';

const A4 = { width: 595.28, height: 841.89 };
const M = 40;                                  // margin, points

const INK      = [0.078, 0.078, 0.173];
const MUTED    = [0.42, 0.45, 0.59];
const BLUE     = [0.169, 0.424, 0.722];
const PURPLE   = [0.231, 0.176, 0.561];
const YELLOW   = [0.961, 0.761, 0.000];
const RULE     = [0.90, 0.914, 0.949];
const HEADFILL = [0.933, 0.949, 0.984];
const WARNFILL = [1.0, 0.98, 0.94];
const CRITFILL = [0.992, 0.945, 0.941];
const WARNEDGE = [0.816, 0.529, 0.0];
const CRITEDGE = [0.753, 0.227, 0.169];
const WHITE    = [1, 1, 1];

/** Strip a data: URL down to its bytes. Returns null for anything else. */
function dataUrlBytes(src) {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(String(src || ''));
  if (!m) return null;
  try {
    const bin = atob(m[2]);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return { mime: m[1], bytes: out };
  } catch (e) { return null; }
}

class Layout {
  constructor(doc, { logo = null }) {
    this.doc = doc;
    this.logo = logo;
    this.pdf = new PdfDoc({ ...A4, title: doc.title + ' — ' + doc.designId,
      author: doc.business, subject: doc.jobDescription || doc.title });
    this.contentW = A4.width - M * 2;
    this.y = 0;
    this.pageCount = 0;
    this.pending = null;                        // a heading waiting for its content
    this.newPage();
  }

  get bottom() { return M + 26; }               // room for the footer

  newPage() {
    this.pdf.addPage();
    this.pageCount++;
    this.y = A4.height - M;
    if (this.pageCount === 1) this.banner();
    return this;
  }

  /** Enough room for `h` points? If not, start a page. */
  need(h) { if (this.y - h < this.bottom) this.newPage(); return this; }

  banner() {
    const h = 62;
    const top = this.y;
    this.pdf.rect(M, top - h, this.contentW, h, { fill: PURPLE });
    // The logo is a JPEG in the page; if it is anything else the name is used.
    let x = M + 14;
    const img = this.logo ? dataUrlBytes(this.logo) : null;
    if (img && img.mime === 'image/jpeg' && this.pdf.image(img.bytes, M + 12, top - h + 14, 78, 34)) {
      x = M + 12 + 78 + 14;
    } else {
      this.pdf.text(this.doc.business, x, top - 24, { size: 10, bold: true, colour: WHITE });
      x = M + 14;
    }
    this.pdf.text(this.doc.title, x, top - (img ? 30 : 40), { size: 13, bold: true, colour: YELLOW });
    if (this.doc.jobDescription) {
      this.pdf.text(this.doc.jobDescription.slice(0, 70), x, top - (img ? 44 : 53),
        { size: 8.5, colour: [0.85, 0.87, 0.95] });
    }
    const right = M + this.contentW - 12;
    [this.doc.designId, this.doc.dateText, 'ABN: ' + this.doc.abn].forEach((line, i) => {
      this.pdf.text(line, right - textWidth(line, 8, false), top - 22 - i * 11,
        { size: 8, colour: [0.85, 0.87, 0.95] });
    });
    this.y = top - h - 16;
  }

  /**
   * Headings are held back, not drawn straight away.
   *
   * A heading drawn the moment it arrives can end up alone at the foot of a
   * page while the thing it names starts the next one. Holding it until the
   * first piece of its content is about to be drawn means the page-break
   * decision is made for the pair together.
   */
  heading(text) {
    this.flushHeading(0);                      // an empty section still gets its heading
    this.pending = text;
  }

  /** Draw any held heading, making room for `minContent` points beneath it. */
  flushHeading(minContent = 0) {
    if (!this.pending) { if (minContent) this.need(minContent); return; }
    const text = this.pending;
    this.pending = null;
    this.need(26 + minContent);
    this.pdf.text(text.toUpperCase(), M, this.y - 11, { size: 9.5, bold: true, colour: BLUE });
    this.pdf.line(M, this.y - 16, M + this.contentW, this.y - 16, { colour: YELLOW, lineWidth: 1.4 });
    this.y -= 26;
  }

  paragraph(text, { size = 8.5, colour = MUTED, bold = false, gap = 8 } = {}) {
    this.flushHeading(size + 3);
    for (const line of wrapText(text, this.contentW, size, bold)) {
      this.need(size + 3);
      this.pdf.text(line, M, this.y - size, { size, bold, colour });
      this.y -= size + 3;
    }
    this.y -= gap;
  }

  bullets(items) {
    this.flushHeading(13);
    for (const item of items) {
      const lines = wrapText(item, this.contentW - 14, 9, false);
      lines.forEach((line, i) => {
        this.need(13);
        if (i === 0) this.pdf.text('•', M + 3, this.y - 9, { size: 9, colour: BLUE });
        this.pdf.text(line, M + 14, this.y - 9, { size: 9, colour: INK });
        this.y -= 12;
      });
    }
    this.y -= 6;
  }

  flag(level, text) {
    const size = 8.5;
    const lines = wrapText(text, this.contentW - 24, size, true);
    const h = lines.length * (size + 3) + 12;
    this.flushHeading(h + 8);
    this.need(h + 8);
    const top = this.y;
    this.pdf.rect(M, top - h, this.contentW, h, { fill: level === 'crit' ? CRITFILL : WARNFILL });
    this.pdf.rect(M, top - h, 3, h, { fill: level === 'crit' ? CRITEDGE : WARNEDGE });
    lines.forEach((line, i) => this.pdf.text(line, M + 12, top - 14 - i * (size + 3),
      { size, bold: true, colour: level === 'crit' ? CRITEDGE : [0.35, 0.24, 0.0] }));
    this.y = top - h - 10;
  }

  /** Four boxes across, as on the print page. */
  kv(items) {
    const cols = 4, gap = 6;
    const w = (this.contentW - gap * (cols - 1)) / cols;
    this.flushHeading(items.some(it => it[2]) ? 46 : 37);
    for (let i = 0; i < items.length; i += cols) {
      const row = items.slice(i, i + cols);
      const h = row.some(it => it[2]) ? 40 : 31;
      this.need(h + 6);
      const top = this.y;
      row.forEach((it, c) => {
        const x = M + c * (w + gap);
        this.pdf.rect(x, top - h, w, h, { fill: [0.98, 0.984, 1], stroke: RULE, lineWidth: 0.5 });
        this.pdf.text(clip(it[0], w - 12, 6.5, false), x + 6, top - 12, { size: 6.5, colour: MUTED });
        // A model code is the point of the box it sits in, so the value shrinks
        // to fit before it is ever shortened with an ellipsis.
        const fit = fitSize(it[1], w - 12, 10, 6.5, true);
        this.pdf.text(clip(it[1], w - 12, fit, true), x + 6, top - 24, { size: fit, bold: true, colour: INK });
        if (it[2]) this.pdf.text(clip(it[2], w - 12, 6.5, false), x + 6, top - 34, { size: 6.5, colour: MUTED });
      });
      this.y = top - h - gap;
    }
    this.y -= 4;
  }

  table(cols, rows) {
    if (!rows.length) { this.paragraph('None.'); return; }
    const size = 7.5, pad = 4, lead = size + 2.5;
    // Never strand a heading above a table that starts on the next page.
    this.flushHeading(14 + lead + pad + 4);

    // Column widths: the declared weight, or 1, scaled to the content width.
    const weights = cols.map(c => c.w || 1);
    const total = weights.reduce((a, b) => a + b, 0);
    const widths = weights.map(w => (this.contentW * w) / total);

    // Wrap every cell up front so a row's height is known before it is drawn.
    const wrapped = rows.map(r => r.map((cell, i) => wrapText(cell, widths[i] - pad * 2, size, false)));

    const headerRow = () => {
      const h = 14;
      this.need(h + lead + 4);
      const top = this.y;
      this.pdf.rect(M, top - h, this.contentW, h, { fill: HEADFILL, stroke: RULE, lineWidth: 0.4 });
      let x = M;
      cols.forEach((c, i) => {
        const label = clip(c.label.toUpperCase(), widths[i] - pad * 2, 6.5, true);
        const tx = c.r ? x + widths[i] - pad - textWidth(label, 6.5, true) : x + pad;
        this.pdf.text(label, tx, top - 9.5, { size: 6.5, bold: true, colour: [0.29, 0.33, 0.47] });
        x += widths[i];
      });
      this.y = top - h;
    };

    headerRow();
    for (let r = 0; r < wrapped.length; r++) {
      const cells = wrapped[r];
      const h = Math.max(...cells.map(c => c.length)) * lead + pad;
      if (this.y - h < this.bottom) { this.newPage(); headerRow(); }
      const top = this.y;
      if (r % 2 === 1) this.pdf.rect(M, top - h, this.contentW, h, { fill: [0.976, 0.98, 0.992] });
      let x = M;
      cells.forEach((lines, i) => {
        lines.forEach((line, li) => {
          const tx = cols[i].r ? x + widths[i] - pad - textWidth(line, size, false) : x + pad;
          this.pdf.text(line, tx, top - pad - size - li * lead, { size, colour: INK });
        });
        x += widths[i];
      });
      this.pdf.line(M, top - h, M + this.contentW, top - h, { colour: RULE, lineWidth: 0.4 });
      this.y = top - h;
    }
    this.y -= 10;
  }

  image(src, caption) {
    const img = dataUrlBytes(src);
    if (!img || img.mime !== 'image/jpeg') {
      // No invented placeholder: the document says the picture is not here.
      this.paragraph(img ? 'The plan snapshot could not be included in the PDF (it is a ' +
        img.mime + ', and this document embeds JPEG). Use Save as PDF from the print view to include it.'
        : 'No plan snapshot was captured for this document.');
      return;
    }
    // Fit the width, cap the height at most of a page.
    const meta = probeJpeg(img.bytes);
    if (!meta) { this.paragraph('The plan snapshot could not be read as an image.'); return; }
    const w = this.contentW;
    const natural = Math.min(w * meta.height / meta.width, A4.height - M * 2 - 90);
    // Rather than push a big picture to its own page and leave the rest of this
    // one empty, shrink it into the space that is actually left — but only down
    // to a size a plan is still readable at.
    const roomHere = this.y - this.bottom - 26 - 14;
    const h = (roomHere >= 240 && roomHere < natural) ? roomHere : natural;
    const drawW = h * meta.width / meta.height;
    // The heading comes with it, or the reader gets a blank half-page under a
    // title and assumes the picture failed to print.
    this.flushHeading(h + 14);
    this.pdf.image(img.bytes, M + (this.contentW - drawW) / 2, this.y - h, drawW, h);
    this.y -= h + 6;
    if (caption) this.paragraph(caption);
    else this.y -= 6;
  }

  /** Footer and page numbers, written once the page count is known. */
  finish() {
    this.flushHeading(0);                       // a heading with nothing after it still prints
    for (let i = 0; i < this.pdf.pages.length; i++) {
      this.pdf.current = this.pdf.pages[i];
      this.pdf.line(M, M + 20, M + this.contentW, M + 20, { colour: RULE, lineWidth: 0.5 });
      const left = this.doc.business + '  ·  ABN ' + this.doc.abn + '  ·  ' + this.doc.website;
      this.pdf.text(left, M, M + 9, { size: 7, colour: MUTED });
      const right = 'Page ' + (i + 1) + ' of ' + this.pdf.pages.length;
      this.pdf.text(right, M + this.contentW - textWidth(right, 7, false), M + 9, { size: 7, colour: MUTED });
    }
    return this.pdf.bytes();
  }
}

function probeJpeg(bytes) { return jpegInfo(bytes); }

/** The largest size between `size` and `min` at which `text` fits `maxWidth`. */
function fitSize(text, maxWidth, size, min, bold) {
  let s = size;
  while (s > min && textWidth(text, s, bold) > maxWidth) s -= 0.25;
  return s;
}

function clip(text, maxWidth, size, bold) {
  const s = String(text ?? '');
  if (textWidth(s, size, bold) <= maxWidth) return s;
  let out = '';
  for (const ch of s) {
    if (textWidth(out + ch + '…', size, bold) > maxWidth) break;
    out += ch;
  }
  return out + '…';
}

/** Render a report document to PDF bytes. */
export function renderReportPdf(doc, { logo = null } = {}) {
  const L = new Layout(doc, { logo });

  L.heading('Customer');
  L.kv([
    ['Customer', doc.customer.name, ''],
    ['Site address', doc.customer.address, ''],
    ['Phone', doc.customer.phone, ''],
    ['Email', doc.customer.email, '']
  ]);

  for (const blk of doc.blocks) {
    switch (blk.t) {
      case 'h2':        L.heading(blk.text); break;
      case 'pagebreak': if (L.y < A4.height - M - 80) L.newPage(); break;
      case 'note':      L.paragraph(blk.text); break;
      case 'flag':      L.flag(blk.level, blk.text); break;
      case 'bullets':   L.bullets(blk.items); break;
      case 'kv':        L.kv(blk.items); break;
      case 'table':     L.table(blk.cols, blk.rows); break;
      case 'image':     L.image(blk.src, blk.caption); break;
      default: break;
    }
  }
  return L.finish();
}

/** A filename a person can find again in their downloads. */
export function reportFileName(doc) {
  const who = (doc.customer.name || 'customer').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const what = doc.kind === 'customer' ? 'HVAC-Design-Summary' : 'Internal-HVAC-Design-Sheet';
  const when = new Date().toISOString().slice(0, 10);
  return ['NAC', what, who || 'customer', doc.designId || when].filter(Boolean).join('-') + '.pdf';
}
