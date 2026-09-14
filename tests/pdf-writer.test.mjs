// The PDF writer. These check the parts a broken file would fail on: the
// structure, the cross-reference table, the text encoding, and — the one that
// decides whether a customer document looks right — that line breaking keeps
// every line inside the column it was given.
//
// tools/browser-tests/report-pdf.mjs then opens real generated documents with
// pdf.js and reads them back, which is the check that matters most.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PdfDoc, textWidth, wrapText, jpegInfo } from '../designer/ui/pdf-writer.mjs';

const asText = (bytes) => Buffer.from(bytes).toString('latin1');

test('a document is a well-formed PDF file', () => {
  const d = new PdfDoc({ title: 'Test sheet' });
  d.addPage();
  d.text('Hello', 40, 800, { size: 11 });
  const out = asText(d.bytes());

  assert.ok(out.startsWith('%PDF-1.4'), 'it declares its version');
  assert.ok(out.trimEnd().endsWith('%%EOF'), 'it is terminated');
  assert.match(out, /\/Type \/Catalog/);
  assert.match(out, /\/Type \/Pages \/Count 1/);
  assert.match(out, /\/Type \/Page /);
  assert.match(out, /\/BaseFont \/Helvetica\b/);
  assert.match(out, /\/BaseFont \/Helvetica-Bold\b/);
  assert.match(out, /\/Title \(Test sheet\)/);
  assert.match(out, /startxref/);
});

test('the cross-reference table points at the objects it claims', () => {
  const d = new PdfDoc();
  d.addPage(); d.text('one', 40, 800);
  d.addPage(); d.text('two', 40, 800);
  const bytes = d.bytes();
  const out = asText(bytes);

  const xrefAt = Number(/startxref\s+(\d+)/.exec(out)[1]);
  assert.equal(out.slice(xrefAt, xrefAt + 4), 'xref', 'startxref lands on the table');

  const size = Number(/\/Size (\d+)/.exec(out)[1]);
  const table = out.slice(xrefAt);
  const entries = [...table.matchAll(/^(\d{10}) (\d{5}) ([nf]) $/gm)];
  assert.equal(entries.length, size, 'one entry per object, free entry included');

  // Every in-use entry must sit on "<n> 0 obj".
  entries.forEach((e, i) => {
    if (e[3] !== 'n') return;
    const at = Number(e[1]);
    assert.match(out.slice(at, at + 12), new RegExp('^' + i + ' 0 obj'),
      'object ' + i + ' is where the table says');
  });
});

test('two pages produce two page objects', () => {
  const d = new PdfDoc();
  d.addPage(); d.addPage(); d.addPage();
  const out = asText(d.bytes());
  assert.equal((out.match(/\/Type \/Page[^s]/g) || []).length, 3);
  assert.match(out, /\/Count 3/);
});

test('brackets and backslashes in text are escaped, not left to break the file', () => {
  const d = new PdfDoc();
  d.addPage();
  d.text('Bed 1 (main) \\ Ensuite', 40, 800);
  const out = asText(d.bytes());
  assert.match(out, /\(Bed 1 \\\(main\\\) \\\\ Ensuite\) Tj/);
});

test('the characters NAC actually uses survive as WinAnsi bytes', () => {
  const d = new PdfDoc();
  d.addPage();
  d.text('25 m² — 20° · “quoted”', 40, 800);
  const out = asText(d.bytes());
  assert.match(out, /\\262/, 'the superscript two');
  assert.match(out, /\\227/, 'the em dash');
  assert.match(out, /\\260/, 'the degree sign');
  assert.match(out, /\\267/, 'the middle dot');
  assert.match(out, /\\223/, 'the opening quote');
});

test('a character with no WinAnsi byte degrades to something readable', () => {
  const d = new PdfDoc();
  d.addPage();
  d.text('Δp 40 Pa', 40, 800);
  const out = asText(d.bytes());
  assert.match(out, /\(dp 40 Pa\) Tj/, 'delta becomes d rather than a broken glyph');
});

test('text width follows the published Helvetica widths', () => {
  // Known values: at 1000pt, "i" is 222 and "m" is 833 in Helvetica.
  assert.equal(Math.round(textWidth('i', 1000)), 222);
  assert.equal(Math.round(textWidth('m', 1000)), 833);
  assert.equal(Math.round(textWidth('m', 1000, true)), 889, 'bold is wider');
  assert.ok(textWidth('Hello world', 10, true) > textWidth('Hello world', 10, false));
  assert.equal(textWidth('', 10), 0);
});

test('every wrapped line fits the width it was given', () => {
  const text = 'Insulated flexible duct R1.0 150 mm supplied and installed throughout the ' +
               'roof space, including all supports and balancing dampers.';
  for (const width of [60, 120, 240, 500]) {
    for (const bold of [false, true]) {
      for (const line of wrapText(text, width, 8, bold)) {
        assert.ok(textWidth(line, 8, bold) <= width + 0.01,
          'a line overflowed at width ' + width + ': "' + line + '"');
      }
    }
  }
});

test('a word wider than the column is split rather than overflowing', () => {
  const lines = wrapText('MMABRAKCHV125D1B-EXTREMELY-LONG-SUPPLIER-PART-CODE', 40, 8);
  assert.ok(lines.length > 1);
  for (const line of lines) assert.ok(textWidth(line, 8) <= 40.01, line);
});

test('wrapping never loses or invents text', () => {
  const text = 'Living Bed 1 Bed 2 Study Rumpus';
  assert.equal(wrapText(text, 50, 8).join(' ').replace(/\s+/g, ' '), text);
});

test('an empty string still produces one line, so a table row keeps its height', () => {
  assert.deepEqual(wrapText('', 100, 8), ['']);
  assert.deepEqual(wrapText(null, 100, 8), ['']);
});

test('a JPEG is recognised and its size read; anything else is refused', () => {
  // A minimal JPEG: SOI, SOF0 declaring 40×25 in 3 channels, EOI.
  const jpeg = new Uint8Array([
    0xFF, 0xD8,
    0xFF, 0xC0, 0x00, 0x11, 0x08, 0x00, 0x19, 0x00, 0x28, 0x03,
    0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    0xFF, 0xD9
  ]);
  const info = jpegInfo(jpeg);
  assert.deepEqual({ w: info.width, h: info.height, c: info.channels }, { w: 40, h: 25, c: 3 });

  assert.equal(jpegInfo(new Uint8Array([0x89, 0x50, 0x4E, 0x47])), null, 'a PNG is not a JPEG');
  assert.equal(jpegInfo(new Uint8Array([])), null);
  assert.equal(jpegInfo(null), null);

  const d = new PdfDoc();
  d.addPage();
  assert.equal(d.image(jpeg, 10, 10, 100, 60), true, 'a JPEG is placed');
  assert.equal(d.image(new Uint8Array([0x89, 0x50]), 10, 10, 10, 10), false,
    'a non-JPEG is refused rather than written as rubbish');

  const out = asText(d.bytes());
  assert.match(out, /\/Filter \/DCTDecode/);
  assert.match(out, /\/Width 40 \/Height 25/);
  assert.match(out, /\/ColorSpace \/DeviceRGB/);
  assert.match(out, /\/XObject << \/Im1/);
});

test('a greyscale JPEG is declared as greyscale, not forced to RGB', () => {
  const grey = new Uint8Array([0xFF, 0xD8, 0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x10, 0x00, 0x10, 0x01,
                               0x01, 0x11, 0x00, 0xFF, 0xD9]);
  const d = new PdfDoc();
  d.addPage();
  d.image(grey, 0, 0, 10, 10);
  assert.match(asText(d.bytes()), /\/ColorSpace \/DeviceGray/);
});
