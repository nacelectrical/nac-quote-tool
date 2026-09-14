// NAC — a PDF writer.
//
// WHY THIS IS HERE RATHER THAN A LIBRARY
//
// The NAC tool has no build step and no package.json; everything is loaded as
// plain modules from the static site. A PDF library pulled off a CDN would put
// the customer's quote documents behind somebody else's uptime, and the two
// documents this produces are text, rules and tables — the part of PDF that is
// genuinely small.
//
// It writes PDF 1.4 using the base-14 fonts (Helvetica and Helvetica-Bold), so
// nothing is embedded and the file stays a few tens of kilobytes. A JPEG plan
// snapshot goes in as DCTDecode, which is the JPEG bytes verbatim — no
// re-encoding, no quality loss.
//
// Text is encoded as WinAnsi. Characters NAC actually uses that are not ASCII
// — the em dash, ², °, · and the curly quotes — are mapped to their WinAnsi
// bytes; anything else falls back to a plain ASCII stand-in rather than
// producing a broken glyph.

// ── Glyph widths, units per 1000 ────────────────────────────────────────────
// The published Adobe AFM widths for the two base-14 fonts used here. They are
// what makes line breaking land inside the margin; the renderer measures every
// line against them before it is written.
// Four digits per glyph for codes 32..126, in order. Written as fixed-width
// fields because a variable-width list is exactly the sort of thing that goes
// wrong silently — '@' is 1015, four digits, where every other glyph is three.
const W_REG =
  '02780278035505560556088906670191033303330389058402780333027802780556055605560556' +
  '05560556055605560556055602780278058405840584055610150667066707220722066706110778' +
  '07220278050006670556083307220778066707780722066706110722066709440667066706110278' +
  '02780278046905560333055605560500055605560278055605560222022205000222083305560556' +
  '055605560333050002780556050007220500050005000334026003340584';
const W_BOLD =
  '02780333047405560556088907220238033303330389058402780333027802780556055605560556' +
  '05560556055605560556055603330333058405840584061109750722072207220722066706110778' +
  '07220278055607220611083307220778066707780722066706110722066709440667066706110333' +
  '02780333058405560333055606110556061105560333061106110278027805560278088906110611' +
  '061106110389055603330611055607780556055605000389028003890584';

const FIRST_CODE = 32, LAST_CODE = 126;

function parseWidths(spec) {
  const expected = (LAST_CODE - FIRST_CODE + 1) * 4;
  if (spec.length !== expected) {
    throw new Error('PDF font width table is ' + spec.length + ' characters, expected ' + expected);
  }
  const out = new Array(256).fill(556);
  for (let c = FIRST_CODE; c <= LAST_CODE; c++) {
    out[c] = Number(spec.substr((c - FIRST_CODE) * 4, 4));
  }
  return out;
}
const WIDTHS = { regular: parseWidths(W_REG), bold: parseWidths(W_BOLD) };

// The non-ASCII characters the NAC documents actually contain, with their
// WinAnsi byte and width. Anything not listed falls back to an ASCII stand-in.
const WINANSI = {
  '—': [0x97, 1000, 1000], '–': [0x96, 556, 556], '·': [0xB7, 278, 278],
  '²': [0xB2, 333, 333], '³': [0xB3, 333, 333], '°': [0xB0, 400, 400],
  '…': [0x85, 1000, 1000], '‘': [0x91, 222, 238], '’': [0x92, 222, 238],
  '“': [0x93, 333, 500], '”': [0x94, 333, 500], '×': [0xD7, 584, 584],
  '±': [0xB1, 584, 584], '£': [0xA3, 556, 556], '©': [0xA9, 737, 737],
  '½': [0xBD, 834, 834], '¼': [0xBC, 834, 834], 'é': [0xE9, 556, 556],
  'Δ': null, 'Ω': null                              // no WinAnsi byte — spelled out below
};
const ASCII_FALLBACK = { 'Δ': 'd', 'Ω': 'ohm', '→': '->', '≤': '<=', '≥': '>=', '≈': '~', ' ': ' ' };

/** Width of `text` at `size` points in the given face. */
export function textWidth(text, size, bold = false) {
  const w = WIDTHS[bold ? 'bold' : 'regular'];
  let total = 0;
  for (const ch of String(text)) {
    const code = ch.codePointAt(0);
    if (code < 256 && code >= 32) { total += w[code]; continue; }
    const win = WINANSI[ch];
    if (win) { total += win[bold ? 2 : 1]; continue; }
    const alt = ASCII_FALLBACK[ch];
    if (alt) { total += textWidth(alt, 1000, bold); continue; }   // already in 1/1000 units
    total += w[63];                                  // '?' — an unknown glyph still takes room
  }
  return total * size / 1000;
}

/** Encode one string as a WinAnsi PDF literal, escaping what PDF requires. */
function pdfString(text) {
  let out = '';
  for (const ch of String(text)) {
    const code = ch.codePointAt(0);
    let byte = null;
    if (code >= 32 && code < 127) {
      if (ch === '(' || ch === ')' || ch === '\\') out += '\\' + ch;
      else out += ch;
      continue;
    }
    if (code >= 160 && code < 256) byte = code;      // Latin-1 overlaps WinAnsi here
    else if (WINANSI[ch]) byte = WINANSI[ch][0];
    else {
      const alt = ASCII_FALLBACK[ch];
      if (alt !== undefined) { out += pdfString(alt); continue; }
      out += '?'; continue;
    }
    out += '\\' + byte.toString(8).padStart(3, '0');
  }
  return out;
}

/** Break `text` into lines no wider than `maxWidth`. Long words are split. */
export function wrapText(text, maxWidth, size, bold = false) {
  const lines = [];
  for (const para of String(text ?? '').split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const trial = line ? line + ' ' + word : word;
      if (textWidth(trial, size, bold) <= maxWidth) { line = trial; continue; }
      if (line) { lines.push(line); line = ''; }
      if (textWidth(word, size, bold) <= maxWidth) { line = word; continue; }
      // A single word wider than the column — a long part code or a URL.
      let chunk = '';
      for (const ch of word) {
        if (textWidth(chunk + ch, size, bold) > maxWidth && chunk) { lines.push(chunk); chunk = ''; }
        chunk += ch;
      }
      line = chunk;
    }
    lines.push(line);
  }
  return lines.length ? lines : [''];
}

const enc = new TextEncoder();

/** Read a JPEG's size and colour channels. Returns null if it is not a JPEG. */
export function jpegInfo(bytes) {
  if (!bytes || bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) return null;
  let i = 2;
  while (i < bytes.length - 1) {
    if (bytes[i] !== 0xFF) { i++; continue; }
    const marker = bytes[i + 1];
    if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { i += 2; continue; }
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    // SOF0..SOF15, excluding the DHT/JPG/DAC markers that share the range.
    if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
      return { height: (bytes[i + 5] << 8) | bytes[i + 6],
               width:  (bytes[i + 7] << 8) | bytes[i + 8],
               channels: bytes[i + 9] };
    }
    i += 2 + len;
  }
  return null;
}

/**
 * A PDF being written. Points, origin bottom-left, as PDF itself uses.
 *
 *   const pdf = new PdfDoc({ title: '…' });
 *   pdf.addPage(); pdf.text('Hello', 40, 800, { size: 11, bold: true });
 *   pdf.bytes();
 */
export class PdfDoc {
  constructor({ width = 595.28, height = 841.89, title = '', author = '', subject = '' } = {}) {
    this.width = width;
    this.height = height;
    this.meta = { title, author, subject };
    this.pages = [];
    this.images = [];                                 // { name, bytes, width, height, channels }
    this.current = null;
  }

  addPage() {
    this.current = { ops: [], images: [] };
    this.pages.push(this.current);
    return this.current;
  }

  /** Draw text with its BASELINE at (x, y). */
  text(str, x, y, { size = 10, bold = false, colour = [0, 0, 0] } = {}) {
    const [r, g, b] = colour;
    this.current.ops.push(
      'BT /' + (bold ? 'F2' : 'F1') + ' ' + size.toFixed(2) + ' Tf ' +
      r.toFixed(3) + ' ' + g.toFixed(3) + ' ' + b.toFixed(3) + ' rg ' +
      x.toFixed(2) + ' ' + y.toFixed(2) + ' Td (' + pdfString(str) + ') Tj ET');
    return this;
  }

  rect(x, y, w, h, { fill = null, stroke = null, lineWidth = 0.5 } = {}) {
    let op = '';
    if (fill) op += fill.map(c => c.toFixed(3)).join(' ') + ' rg ';
    if (stroke) op += stroke.map(c => c.toFixed(3)).join(' ') + ' RG ' + lineWidth.toFixed(2) + ' w ';
    op += x.toFixed(2) + ' ' + y.toFixed(2) + ' ' + w.toFixed(2) + ' ' + h.toFixed(2) + ' re ';
    op += fill && stroke ? 'B' : fill ? 'f' : 'S';
    this.current.ops.push(op);
    return this;
  }

  line(x1, y1, x2, y2, { colour = [0, 0, 0], lineWidth = 0.5 } = {}) {
    this.current.ops.push(colour.map(c => c.toFixed(3)).join(' ') + ' RG ' + lineWidth.toFixed(2) + ' w ' +
      x1.toFixed(2) + ' ' + y1.toFixed(2) + ' m ' + x2.toFixed(2) + ' ' + y2.toFixed(2) + ' l S');
    return this;
  }

  /** Place a JPEG. `bytes` is a Uint8Array of the file itself. */
  image(bytes, x, y, w, h) {
    const info = jpegInfo(bytes);
    if (!info) return false;                          // not a JPEG — the caller decides what to say
    const name = 'Im' + (this.images.length + 1);
    this.images.push({ name, bytes, ...info });
    this.current.images.push(name);
    this.current.ops.push('q ' + w.toFixed(2) + ' 0 0 ' + h.toFixed(2) + ' ' +
      x.toFixed(2) + ' ' + y.toFixed(2) + ' cm /' + name + ' Do Q');
    return true;
  }

  /** The finished file. */
  bytes() {
    const chunks = [];
    const offsets = [0];
    let length = 0;
    const push = (data) => {
      const arr = typeof data === 'string' ? enc.encode(data) : data;
      chunks.push(arr); length += arr.length;
    };
    const startObj = (n) => { offsets[n] = length; push(n + ' 0 obj\n'); };
    const endObj = () => push('endobj\n');

    push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

    // 1 catalog, 2 pages, 3 font regular, 4 font bold, 5 info, then images,
    // then one content stream + one page object per page.
    const imgFirst = 6;
    const pageFirst = imgFirst + this.images.length;
    const pageIds = this.pages.map((_, i) => pageFirst + i * 2);        // page object
    const contentIds = this.pages.map((_, i) => pageFirst + i * 2 + 1); // its content

    startObj(1);
    push('<< /Type /Catalog /Pages 2 0 R >>\n'); endObj();

    startObj(2);
    push('<< /Type /Pages /Count ' + this.pages.length + ' /Kids [' +
      pageIds.map(id => id + ' 0 R').join(' ') + '] >>\n'); endObj();

    startObj(3);
    push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\n'); endObj();
    startObj(4);
    push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\n'); endObj();

    startObj(5);
    push('<< /Title (' + pdfString(this.meta.title) + ') /Author (' + pdfString(this.meta.author) +
      ') /Subject (' + pdfString(this.meta.subject) + ') /Producer (NAC AI HVAC Designer) >>\n'); endObj();

    this.images.forEach((im, i) => {
      startObj(imgFirst + i);
      push('<< /Type /XObject /Subtype /Image /Width ' + im.width + ' /Height ' + im.height +
        ' /ColorSpace ' + (im.channels === 1 ? '/DeviceGray' : im.channels === 4 ? '/DeviceCMYK' : '/DeviceRGB') +
        ' /BitsPerComponent 8 /Filter /DCTDecode /Length ' + im.bytes.length + ' >>\nstream\n');
      push(im.bytes);
      push('\nendstream\n'); endObj();
    });

    this.pages.forEach((page, i) => {
      const content = page.ops.join('\n');
      startObj(contentIds[i]);
      push('<< /Length ' + enc.encode(content).length + ' >>\nstream\n' + content + '\nendstream\n');
      endObj();

      startObj(pageIds[i]);
      const xo = page.images.length
        ? ' /XObject << ' + page.images.map(n => '/' + n + ' ' +
            (imgFirst + this.images.findIndex(im => im.name === n)) + ' 0 R').join(' ') + ' >>'
        : '';
      push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + this.width.toFixed(2) + ' ' +
        this.height.toFixed(2) + '] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>' + xo +
        ' >> /Contents ' + contentIds[i] + ' 0 R >>\n');
      endObj();
    });

    const maxId = pageFirst + this.pages.length * 2;
    const xrefAt = length;
    push('xref\n0 ' + maxId + '\n0000000000 65535 f \n');
    for (let n = 1; n < maxId; n++) {
      push(String(offsets[n] || 0).padStart(10, '0') + ' 00000 n \n');
    }
    push('trailer\n<< /Size ' + maxId + ' /Root 1 0 R /Info 5 0 R >>\nstartxref\n' + xrefAt + '\n%%EOF\n');

    const out = new Uint8Array(length);
    let at = 0;
    for (const c of chunks) { out.set(c, at); at += c.length; }
    return out;
  }
}
