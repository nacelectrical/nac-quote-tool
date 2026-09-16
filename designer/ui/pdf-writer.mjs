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
// It writes PDF 1.4. The two text faces are EMBEDDED as TrueType — Liberation
// Sans Regular and Bold, which are metric-compatible with Arial and Helvetica
// and SIL OFL licensed — so the glyphs travel inside the file and no reader has
// to substitute anything. That costs about 800 KB and buys a document that
// looks the same everywhere; referencing base-14 Helvetica instead was free and
// came back from other people's readers with the letters spaced out and the
// words run together. Base-14 remains the fallback when the faces have not
// loaded, so a document is never blocked on a font.
//
// A JPEG plan snapshot goes in as DCTDecode, which is the JPEG bytes verbatim —
// no re-encoding, no quality loss.

import { FONT_METRICS, FONT_FIRST_CODE, FONT_NAMES } from './pdf-fonts.mjs';
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


/**
 * THE FONT THE DOCUMENT CARRIES WITH IT.
 *
 * Declaring the widths was not enough. A base-14 /BaseFont /Helvetica is a
 * REFERENCE: the reader is told which font to use and supplies the glyphs
 * itself. A reader that has no Helvetica substitutes something else, draws that
 * font's shapes, and advances by the widths this document declares — so narrow
 * glyphs sit in wide slots and the text comes back with gaps between the
 * letters and words running into one another. It is correct in one reader and
 * wrong in the next, which is not a property a document sent to a customer can
 * have.
 *
 * So the faces travel inside the file. Liberation Sans is metric-compatible
 * with Arial and Helvetica and is SIL OFL licensed, so it can be embedded in a
 * document NAC sends out. Once it is embedded the reader has no choice left to
 * make: the shapes and the advances are the same font's.
 *
 * The bytes are fetched asynchronously and cached here. Nothing waits on them —
 * a document built before they arrive falls back to base-14 Helvetica rather
 * than failing, and says so through `pdfFontsEmbedded()`.
 */
let EMBEDDED = null;

/** Hand the writer the two TrueType faces. `null` returns it to base-14. */
export function setPdfFonts(faces) {
  EMBEDDED = (faces && faces.regular?.length && faces.bold?.length)
    ? { regular: faces.regular, bold: faces.bold } : null;
}
export function pdfFontsEmbedded() { return !!EMBEDDED; }

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

/**
 * THE DOCUMENT DECLARES THE WIDTHS IT WAS LAID OUT WITH.
 *
 * A base-14 font needs no /Widths array — a reader is entitled to use its own
 * metrics for Helvetica. That is precisely the problem: when a reader has no
 * Helvetica it substitutes something else, lays the line out on THAT font's
 * widths, and the result is letters spaced too far apart or words running into
 * one another, because every glyph lands where a different font would have put
 * it. It renders correctly in one viewer and badly in the next, which is how a
 * document can look fine here and wrong on the estimator's iPad.
 *
 * Writing the array removes the choice. The widths below are the same AFM
 * numbers `textWidth` measures with, so what the layout assumed and what the
 * reader is told are the same thing by construction.
 */
function widthsEntry(bold) {
  const first = 32, last = 255;
  if (EMBEDDED) {
    // Straight out of the embedded face, which is also what `textWidth` reads.
    return ' /FirstChar ' + first + ' /LastChar ' + last +
           ' /Widths [' + FONT_METRICS[bold ? 'bold' : 'regular'].widths.join(' ') + ']';
  }
  const base = WIDTHS[bold ? 'bold' : 'regular'];
  const w = base.slice();
  // The high range is WinAnsi, not Latin-1 metrics, so the glyphs this document
  // actually uses up there are set from the same table `textWidth` reads.
  for (const [ch, spec] of Object.entries(WINANSI)) {
    if (!spec) continue;
    w[spec[0]] = spec[bold ? 2 : 1];
  }
  return ' /FirstChar ' + first + ' /LastChar ' + last +
         ' /Widths [' + w.slice(first, last + 1).join(' ') + ']';
}

// The non-ASCII characters the NAC documents actually contain, with their
// WinAnsi byte and width. Anything not listed falls back to an ASCII stand-in.
const WINANSI = {
  // THE BULLET WAS MISSING AND IT PRINTED AS A QUESTION MARK.
  //
  // Every bulleted list in the internal sheet opened with `?`. U+2022 is not in
  // Latin-1, so the `code >= 160` shortcut never saw it, and with no entry here
  // it fell through to the unknown-glyph fallback. WinAnsi has it at 0x95.
  '•': [0x95, 350, 350],
  '—': [0x97, 1000, 1000], '–': [0x96, 556, 556], '·': [0xB7, 278, 278],
  '²': [0xB2, 333, 333], '³': [0xB3, 333, 333], '°': [0xB0, 400, 400],
  '…': [0x85, 1000, 1000], '‘': [0x91, 222, 238], '’': [0x92, 222, 238],
  '“': [0x93, 333, 500], '”': [0x94, 333, 500], '×': [0xD7, 584, 584],
  '±': [0xB1, 584, 584], '£': [0xA3, 556, 556], '©': [0xA9, 737, 737],
  '½': [0xBD, 834, 834], '¼': [0xBC, 834, 834], 'é': [0xE9, 556, 556],
  // The diameter sign is on every duct label in the document. It reached the
  // page through the Latin-1 shortcut but was MEASURED at the fallback 556 in
  // both faces, where Helvetica-Bold's oslash is 611 — so every bold line
  // carrying a size was laid out fractionally narrow.
  'ø': [0xF8, 556, 611], 'Ø': [0xD8, 778, 778],
  // `Supply plenum → Main A` is on the ductwork table, and `Settings → Material
  // rates` is in three warnings. WinAnsi has no arrow, and folding it to `->`
  // put what looks like a typing accident in the middle of a schedule. The
  // right-pointing guillemet is a real glyph in this encoding and reads as the
  // same thing: a direction of travel.
  '→': [0xBB, 556, 556],
  'Δ': null, 'Ω': null                              // no WinAnsi byte — spelled out below
};
const ASCII_FALLBACK = { 'Δ': 'd', 'Ω': 'ohm', '→': '>', '≤': '<=', '≥': '>=', '≈': '~', ' ': ' ' };

/**
 * The width table the page will actually be drawn with.
 *
 * When a face is embedded the measurement has to come from THAT face, not from
 * the Helvetica AFM it resembles. Liberation Sans matches Helvetica on almost
 * every glyph, but not on all of them — its oslash is 611 where Helvetica's is
 * 556, and its periodcentered is 333 where Helvetica's is 278 — and those two
 * are in every duct label on the sheet.
 */
function faceWidths(bold) {
  if (EMBEDDED) {
    const m = FONT_METRICS[bold ? 'bold' : 'regular'];
    return { table: m.widths, first: FONT_FIRST_CODE };
  }
  return { table: WIDTHS[bold ? 'bold' : 'regular'], first: 0 };
}

/**
 * Width of one WinAnsi byte in the face that will be drawn, in 1/1000 em.
 *
 * With a face embedded the table is complete and authoritative — it was read
 * out of that very font file — so the byte is all that is needed. Falling back
 * to base-14 there are two sources: the AFM table, which is real only for
 * 32..126, and the named-glyph list for the handful above it that this document
 * uses. `named` carries the second so a middot is not measured at the 556
 * fallback the AFM array is padded with.
 */
function byteWidth(code, bold, named = null) {
  if (EMBEDDED) {
    const t = FONT_METRICS[bold ? 'bold' : 'regular'].widths;
    const i = code - FONT_FIRST_CODE;
    return (i >= 0 && i < t.length) ? t[i] : 556;
  }
  if (named) return named[bold ? 2 : 1];
  const t = WIDTHS[bold ? 'bold' : 'regular'];
  return (code >= 32 && code <= LAST_CODE) ? t[code] : 556;
}

/** Width of `text` at `size` points in the given face. */
export function textWidth(text, size, bold = false) {
  let total = 0;
  for (const ch of String(text)) {
    const code = ch.codePointAt(0);
    // THE NAMED GLYPHS ARE CONSULTED FIRST, AND THAT ORDER IS THE WHOLE POINT.
    //
    // A `code < 256` shortcut used to come first and read the Helvetica table,
    // which only holds real widths for 32..126 — everything above it was the
    // 556 fallback. So every glyph in the high range was measured at 556
    // whatever it really is. The middot is the one that mattered: it appears in
    // every duct label, every BTO spec and every page footer, and every line
    // carrying one was laid out against a width that was not its own.
    const win = WINANSI[ch];
    if (win) { total += byteWidth(win[0], bold, win); continue; }
    if (code >= 32 && code < 256) { total += byteWidth(code, bold); continue; }
    const alt = ASCII_FALLBACK[ch];
    if (alt) { total += textWidth(alt, 1000, bold); continue; }   // already in 1/1000 units
    total += byteWidth(63, bold);                    // '?' — an unknown glyph still takes room
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

  /**
   * A page, optionally at its own size.
   *
   * A PDF carries a MediaBox per PAGE, not per document, so a landscape plan
   * sheet can sit in the middle of a portrait report — which is the only way a
   * floor plan gets printed at a size an installer can read. Pages with no size
   * of their own take the document's.
   */
  addPage({ width = null, height = null } = {}) {
    this.current = { ops: [], images: [],
                     width: width ?? this.width, height: height ?? this.height };
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

    // 1 catalog, 2 pages, 3 font regular, 4 font bold, 5 info; then — when the
    // faces are embedded — a descriptor and a font file for each; then images;
    // then one content stream + one page object per page.
    const descFirst = 6;                              // 6,7 descriptors, 8,9 files
    const imgFirst = EMBEDDED ? 10 : 6;
    const pageFirst = imgFirst + this.images.length;
    const pageIds = this.pages.map((_, i) => pageFirst + i * 2);        // page object
    const contentIds = this.pages.map((_, i) => pageFirst + i * 2 + 1); // its content

    startObj(1);
    push('<< /Type /Catalog /Pages 2 0 R >>\n'); endObj();

    startObj(2);
    push('<< /Type /Pages /Count ' + this.pages.length + ' /Kids [' +
      pageIds.map(id => id + ' 0 R').join(' ') + '] >>\n'); endObj();

    // ── THE TWO FACES ─────────────────────────────────────────────────────
    //
    // Embedded, the font is a TrueType whose glyphs travel in the file, so no
    // reader has anything left to choose. Not embedded, it falls back to
    // base-14 Helvetica — still with its widths declared, because that at least
    // stops a substituted face being laid out on ITS own metrics.
    const fontObj = (bold, id, descId) => {
      startObj(id);
      if (EMBEDDED) {
        push('<< /Type /Font /Subtype /TrueType /BaseFont /' +
             FONT_NAMES[bold ? 'bold' : 'regular'] +
             ' /Encoding /WinAnsiEncoding' + widthsEntry(bold) +
             ' /FontDescriptor ' + descId + ' 0 R >>\n');
      } else {
        push('<< /Type /Font /Subtype /Type1 /BaseFont /' +
             (bold ? 'Helvetica-Bold' : 'Helvetica') +
             ' /Encoding /WinAnsiEncoding' + widthsEntry(bold) + ' >>\n');
      }
      endObj();
    };
    fontObj(false, 3, descFirst);
    fontObj(true, 4, descFirst + 1);

    if (EMBEDDED) {
      const descriptor = (bold, id, fileId) => {
        const m = FONT_METRICS[bold ? 'bold' : 'regular'];
        startObj(id);
        push('<< /Type /FontDescriptor /FontName /' + FONT_NAMES[bold ? 'bold' : 'regular'] +
             // 32 = nonsymbolic: a text face using the standard Latin set.
             ' /Flags 32 /FontBBox [' + m.bbox.join(' ') + ']' +
             ' /ItalicAngle ' + m.italicAngle + ' /Ascent ' + m.ascent +
             ' /Descent ' + m.descent + ' /CapHeight ' + m.capHeight +
             ' /StemV ' + m.stemV + ' /FontFile2 ' + fileId + ' 0 R >>\n');
        endObj();
      };
      const fontFile = (bytes, id) => {
        startObj(id);
        // Length1 is the uncompressed TrueType length; the stream is the file
        // itself, unfiltered, because a reader wants the font verbatim.
        push('<< /Length ' + bytes.length + ' /Length1 ' + bytes.length + ' >>\nstream\n');
        push(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
        push('\nendstream\n');
        endObj();
      };
      descriptor(false, descFirst, descFirst + 2);
      descriptor(true, descFirst + 1, descFirst + 3);
      fontFile(EMBEDDED.regular, descFirst + 2);
      fontFile(EMBEDDED.bold, descFirst + 3);
    }

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
      push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' +
        (page.width ?? this.width).toFixed(2) + ' ' +
        (page.height ?? this.height).toFixed(2) + '] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>' + xo +
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
