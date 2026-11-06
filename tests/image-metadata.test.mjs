// ─────────────────────────────────────────────────────────────────────────────
// METADATA IS REMOVED, NOT COMPLAINED ABOUT
//
// Nick, 6 November 2026, trying to put NAC's logo on the Branding tab:
//
//     That image still carried metadata after re-encoding and was not
//     uploaded. Try exporting it from Photos first.
//
// Re-encoding through a canvas is what normally strips metadata, and on most
// browsers it does. Where it does not — and a browser is free to write its own
// segments into an export — the upload was refused and a person was sent off
// to re-export the file on their phone to work around their browser. That is
// the application asking somebody to do by hand something it can do exactly,
// on bytes it is already holding.
//
// The rule has not softened: nothing carrying metadata is uploaded. It is met
// by doing the work.
//
// These run against NAC's REAL photographs, which carry real EXIF, real IPTC
// and a real Apple APP10 block — not fixtures built to pass.
// ─────────────────────────────────────────────────────────────────────────────

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { scanMetadata, stripMetadata } from '../designer/engines/image-privacy.mjs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const PHOTOS = ROOT + '/designer/content/photos';
const bytes = (p) => new Uint8Array(readFileSync(p));

/** The frame header: where a JPEG states its own width and height. */
function jpegFrameSize(b) {
  let i = 2;
  while (i < b.length - 9) {
    if (b[i] !== 0xFF) { i++; continue; }
    const m = b[i + 1];
    if (m === 0xFF || m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { i += 2; continue; }
    if (m === 0xDA || m === 0xD9) break;
    const len = (b[i + 2] << 8) | b[i + 3];
    // SOF0..SOF15, skipping the four that are not frame headers.
    if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
      return { height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8] };
    }
    i += 2 + len;
  }
  return null;
}

/** Everything from the start of scan to the end: the picture itself. */
function scanData(b) {
  let i = 2;
  while (i < b.length - 3) {
    if (b[i] !== 0xFF) { i++; continue; }
    const m = b[i + 1];
    if (m === 0xFF || m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { i += 2; continue; }
    if (m === 0xDA) return b.slice(i);
    if (m === 0xD9) break;
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2) break;
    i += 2 + len;
  }
  return null;
}

const jpegs = readdirSync(PHOTOS).filter(f => /\.jpe?g$/i.test(f));

test('NAC’s own photographs really do carry metadata', () => {
  // If this ever reads zero, the rest of this file is testing nothing.
  const dirty = jpegs.filter(f => !scanMetadata(bytes(PHOTOS + '/' + f)).clean);
  assert.ok(dirty.length >= 5, 'only ' + dirty.length + ' of ' + jpegs.length
    + ' carry metadata — these tests need real examples');
  const seen = new Set();
  for (const f of dirty) for (const m of scanMetadata(bytes(PHOTOS + '/' + f)).markers) seen.add(m);
  // EXIF, IPTC and Apple's APP10 block, all off real cameras and phones.
  assert.ok(seen.has('EXIF'), 'no EXIF anywhere: ' + [...seen]);
});

test('every one of them comes out clean', () => {
  for (const f of jpegs) {
    const out = stripMetadata(bytes(PHOTOS + '/' + f));
    const after = scanMetadata(out);
    assert.equal(after.clean, true,
      f + ' still carries ' + after.markers.join(', ') + ' after stripping');
  }
});

test('AND THE PICTURE IS BYTE-FOR-BYTE THE SAME PICTURE', () => {
  // The whole point. A stripper that quietly damages a photograph is worse
  // than one that refuses it, because nobody finds out until a customer is
  // looking at the proposal.
  for (const f of jpegs) {
    const before = bytes(PHOTOS + '/' + f);
    const after = stripMetadata(before);

    const sizeBefore = jpegFrameSize(before), sizeAfter = jpegFrameSize(after);
    assert.ok(sizeBefore, f + ': no frame header in the original');
    assert.deepEqual(sizeAfter, sizeBefore, f + ' changed size');

    // The compressed image data is copied verbatim, never re-encoded.
    const dataBefore = scanData(before), dataAfter = scanData(after);
    assert.ok(dataBefore, f + ': no scan data in the original');
    assert.equal(dataAfter.length, dataBefore.length, f + ': the scan data changed length');
    assert.ok(Buffer.from(dataAfter).equals(Buffer.from(dataBefore)),
      f + ': the picture itself was altered');

    assert.ok(after.length <= before.length, f + ' grew');
  }
});

test('colour management survives, because dropping it changes how it looks', () => {
  // Chromium writes an ICC profile into every canvas export. It is colour
  // management, not a camera record, and a photograph stripped of it renders
  // wrong on a wide-gamut screen.
  const withIcc = jpegs.filter(f => scanMetadata(bytes(PHOTOS + '/' + f)).benign.includes('ICC_PROFILE'));
  assert.ok(withIcc.length, 'no photograph here carries an ICC profile to test with');
  for (const f of withIcc) {
    const after = scanMetadata(stripMetadata(bytes(PHOTOS + '/' + f)));
    assert.ok(after.benign.includes('ICC_PROFILE'), f + ' lost its colour profile');
  }
});

test('an image with nothing to remove is returned untouched', () => {
  // Not re-encoded, not rebuilt: the same bytes.
  for (const f of jpegs) {
    const before = bytes(PHOTOS + '/' + f);
    if (!scanMetadata(before).clean) continue;
    assert.ok(Buffer.from(stripMetadata(before)).equals(Buffer.from(before)), f + ' was rewritten');
  }
  // And one built to be clean.
  const clean = stripMetadata(new Uint8Array([0xFF, 0xD8, 0xFF, 0xD9]));
  assert.deepEqual([...clean], [0xFF, 0xD8, 0xFF, 0xD9]);
});

test('a PNG loses its text chunks and keeps everything else', () => {
  const png = (chunks) => {
    const sig = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    const out = [...sig];
    for (const [type, body] of chunks) {
      const len = body.length;
      out.push((len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255);
      for (const c of type) out.push(c.charCodeAt(0));
      out.push(...body);
      out.push(0, 0, 0, 0);                       // CRC, not checked here
    }
    return new Uint8Array(out);
  };
  const before = png([
    ['IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]],
    ['tEXt', [...'Comment\0NAC'].map(c => c.charCodeAt(0))],
    ['iCCP', [1, 2, 3]],
    ['IDAT', [9, 9, 9, 9]],
    ['IEND', []]
  ]);
  assert.deepEqual(scanMetadata(before).markers, ['TEXT']);

  const after = stripMetadata(before);
  const scanned = scanMetadata(after);
  assert.equal(scanned.clean, true);
  assert.ok(scanned.benign.includes('ICC_PROFILE'), 'the colour profile was dropped');
  assert.ok(after.length < before.length, 'nothing was removed');
  // The pixels are still there.
  assert.ok(Buffer.from(after).includes(Buffer.from([9, 9, 9, 9])), 'the image data was dropped');
});

test('a format it cannot rebuild is handed back rather than mangled', () => {
  const webp = new Uint8Array([...'RIFF\0\0\0\0WEBPVP8 '].map(c => c.charCodeAt(0)));
  assert.ok(Buffer.from(stripMetadata(webp)).equals(Buffer.from(webp)));
});
