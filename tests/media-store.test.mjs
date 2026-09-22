// ─────────────────────────────────────────────────────────────────────────────
// IMAGE STORAGE
//
// The failures worth testing for here are not "does an upload work". They are:
// a customer's photograph left orphaned in a bucket, an original with EXIF
// served to the public, a path somebody could guess, and a library document
// quietly filling up with pixels again.
// ─────────────────────────────────────────────────────────────────────────────

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MEDIA_BUCKETS, ALLOWED_TYPES, LIMITS, SUPA_URL,
  newAssetId, objectPath, publicUrl, extensionFor,
  validatePart, validateUpload, imageRecord, assetObjects,
  isStoredRef, isDataUriRef, legacyAssets, librarySizeReport
} from '../designer/engines/media-store.mjs';
import { storeImage, removeImage, decodeBase64 } from '../designer/engines/media-upload.mjs';
import { normaliseImageAsset, imagePublishable, allowedRef }
  from '../designer/engines/presentation-content.mjs';
import * as scannerModule from '../designer/engines/image-privacy.mjs';

// ── a real, clean, minimal JPEG and a dirty one ─────────────────────────────
const CLEAN_JPEG = Buffer.from([
  0xFF, 0xD8,
  0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00,
  0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
  0xFF, 0xDA, 0x00, 0x02, 0xFF, 0xD9
]).toString('base64');

const EXIF_JPEG = Buffer.from([
  0xFF, 0xD8,
  0xFF, 0xE1, 0x00, 0x10,
  0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
  0x4D, 0x4D, 0x00, 0x2A, 0x00, 0x00, 0x00, 0x08,
  0xFF, 0xDA, 0x00, 0x02, 0xFF, 0xD9
]).toString('base64');

const deriv = (width, data = CLEAN_JPEG) =>
  ({ width, height: Math.round(width * 0.75), contentType: 'image/jpeg', data });

/** A transport that records what it was asked to do. */
function fakeIo({ failOn = null } = {}) {
  const puts = [], dels = [];
  return {
    puts, dels,
    async put(bucket, path, bytes, contentType) {
      if (failOn && path.includes(failOn)) {
        const e = new Error('nope');
        if (failOn === 'MISSING') e.code = 'bucket_missing';
        throw e;
      }
      puts.push({ bucket, path, bytes: bytes.length, contentType });
    },
    async del(bucket, path) { dels.push({ bucket, path }); }
  };
}

// ─────────────────────────────────────────────────────────────────────────────

test('an asset id is unguessable and safe as a path segment', () => {
  const ids = new Set();
  for (let i = 0; i < 500; i++) ids.add(newAssetId());
  assert.equal(ids.size, 500, 'ids must not collide');
  for (const id of ids) {
    assert.match(id, /^img_[0-9a-f]{32}$/);
    assert.ok(!id.includes('/') && !id.includes('..'));
  }
  // 128 bits. The public bucket is world-readable, so the path is the only
  // thing between a customer's photograph and anyone enumerating.
  assert.equal(newAssetId().length, 4 + 32);
});

test('an object path is derived, never taken from a filename', () => {
  const id = newAssetId();
  assert.equal(objectPath(id, 'derivative', 'image/jpeg', 960), id + '/w960.jpg');
  assert.equal(objectPath(id, 'original', 'image/png'), id + '/original.png');
  assert.equal(objectPath(id, 'archive', 'image/webp'), id + '/archive.webp');

  // A caller cannot escape the asset's own folder or invent a type.
  assert.throws(() => objectPath('../../etc/passwd', 'original', 'image/jpeg'), /bad asset id/);
  assert.throws(() => objectPath(id, 'original', 'text/html'), /unsupported content type/);
  assert.throws(() => objectPath(id, 'original', 'image/svg+xml'), /unsupported content type/);
  assert.throws(() => objectPath(id, 'derivative', 'image/jpeg', 0), /bad derivative width/);
});

test('only web copies get a public URL, and it points at the public bucket', () => {
  const id = newAssetId();
  const url = publicUrl(objectPath(id, 'derivative', 'image/jpeg', 1600));
  assert.ok(url.startsWith(SUPA_URL + '/storage/v1/object/public/' + MEDIA_BUCKETS.public + '/'));
  assert.ok(isStoredRef(url));
  // There is no function that builds a public URL for the private bucket.
  assert.ok(!url.includes(MEDIA_BUCKETS.private));
  assert.notEqual(MEDIA_BUCKETS.public, MEDIA_BUCKETS.private);
});

test('uploads of the wrong type, size or shape are refused by name', () => {
  assert.equal(validatePart({ contentType: 'image/svg+xml', bytes: 10, width: 800 }).ok, false,
    'an SVG can carry script and is never an allowed upload');
  assert.equal(validatePart({ contentType: 'application/pdf', bytes: 10, width: 800 }).ok, false);
  assert.equal(validatePart({ contentType: 'image/jpeg', bytes: 0, width: 800 }).ok, false);

  const big = validatePart({ contentType: 'image/jpeg', bytes: LIMITS.derivativeBytes + 1, width: 800 });
  assert.equal(big.ok, false);
  assert.match(big.reasons.join(' '), /limit for a derivative/);

  for (const t of ALLOWED_TYPES) {
    assert.equal(validatePart({ contentType: t, bytes: 1000, width: 800 }).ok, true, t);
    assert.ok(extensionFor(t));
  }

  assert.equal(validateUpload({ derivatives: [] }).ok, false, 'no derivatives is not an upload');
  assert.equal(validateUpload({
    derivatives: Array.from({ length: LIMITS.derivativesPerAsset + 1 },
      () => ({ contentType: 'image/jpeg', bytes: 10, width: 400 }))
  }).ok, false);

  // Two derivatives at the per-file cap plus a full-size original is the shape
  // that busts the request budget, not one small derivative plus an original.
  const overRequest = validateUpload({
    derivatives: [
      { contentType: 'image/jpeg', bytes: LIMITS.derivativeBytes, width: 1600 },
      { contentType: 'image/jpeg', bytes: LIMITS.derivativeBytes, width: 960 }
    ],
    original: { contentType: 'image/jpeg', bytes: LIMITS.originalBytes }
  });
  assert.equal(overRequest.ok, false);
  assert.match(overRequest.reasons.join(' '), /request limit/);
});

test('a stored image is never approved by the act of uploading it', async () => {
  const io = fakeIo();
  const out = await storeImage({
    alt: 'Outlets in a living area',
    derivatives: [deriv(480), deriv(960), deriv(1600)],
    original: { contentType: 'image/jpeg', width: 4000, height: 3000, data: CLEAN_JPEG }
  }, io);

  assert.equal(out.ok, true);
  assert.equal(out.asset.approved, false, 'approval is a human act');
  assert.equal(out.asset.exifStripped, true);
  assert.equal(out.asset.gpsRemoved, true);
  assert.equal(out.asset.derivatives.length, 3);
  assert.deepEqual(out.asset.derivatives.map(d => d.width), [480, 960, 1600],
    'derivatives come back smallest first for srcset');
  assert.ok(out.asset.derivatives.every(d => isStoredRef(d.ref)));

  // The original went to the private bucket and has a path, not a URL.
  assert.equal(out.asset.original.bucket, MEDIA_BUCKETS.private);
  assert.ok(out.asset.original.path.endsWith('/original.jpg'));
  assert.equal(out.asset.original.retained, true);
  assert.ok(!JSON.stringify(out.asset.original).includes('/object/public/'),
    'nothing in the record offers a way to fetch the original');

  // Four writes: three public, one private.
  assert.equal(io.puts.length, 4);
  assert.equal(io.puts.filter(p => p.bucket === MEDIA_BUCKETS.public).length, 3);
  assert.equal(io.puts.filter(p => p.bucket === MEDIA_BUCKETS.private).length, 1);
  assert.equal(io.dels.length, 0);
});

test('a web copy that still carries metadata stops the whole upload', async () => {
  const io = fakeIo();
  const out = await storeImage({
    derivatives: [deriv(480), deriv(960, EXIF_JPEG), deriv(1600)],
    original: { contentType: 'image/jpeg', width: 4000, height: 3000, data: CLEAN_JPEG }
  }, io);

  assert.equal(out.ok, false);
  assert.equal(out.status, 422);
  assert.equal(out.error, 'metadata_present');
  assert.ok(out.dirty.some(d => d.width === 960 && d.markers.includes('EXIF')));
  assert.equal(io.puts.length, 0, 'nothing is written when any copy is dirty');
  assert.match(out.detail, /Nothing was written/);
});

test('the scan is the server\'s, not the browser\'s', async () => {
  // The caller insists everything is clean. It is not, and the server says so.
  const io = fakeIo();
  const out = await storeImage({
    exifStripped: true, gpsRemoved: true, scanClean: true,
    derivatives: [deriv(800, EXIF_JPEG)]
  }, io);
  assert.equal(out.ok, false);
  assert.equal(out.error, 'metadata_present');
  assert.equal(io.puts.length, 0);
});

test('a failed write rolls back everything already written', async () => {
  // The private original fails after three public copies have landed.
  const io = fakeIo({ failOn: 'original' });
  const out = await storeImage({
    derivatives: [deriv(480), deriv(960), deriv(1600)],
    original: { contentType: 'image/jpeg', width: 4000, height: 3000, data: CLEAN_JPEG }
  }, io);

  assert.equal(out.ok, false);
  assert.equal(out.error, 'storage_write_failed');
  assert.equal(out.rolledBack, 3);
  assert.equal(io.dels.length, 3, 'every object already written is removed');
  assert.deepEqual(io.dels.map(d => d.bucket), Array(3).fill(MEDIA_BUCKETS.public));
  assert.match(out.detail, /nothing was left behind/i);
});

test('a missing bucket is reported as a setup step, not a mystery', async () => {
  const io = fakeIo({ failOn: 'MISSING' });
  // failOn matches on path, so make the first derivative path contain it.
  const out = await storeImage({ derivatives: [deriv(480)] }, {
    ...io,
    async put() { const e = new Error('x'); e.code = 'bucket_missing';
      e.bucket = MEDIA_BUCKETS.public; throw e; }
  });
  assert.equal(out.ok, false);
  assert.equal(out.status, 503);
  assert.equal(out.error, 'bucket_missing');
  assert.match(out.detail, /quote-media-buckets\.sql/);
});

test('an original too large to keep is recorded, not silently absent', async () => {
  const io = fakeIo();
  const out = await storeImage({
    derivatives: [deriv(1600)],
    original: { tooLarge: true, width: 8000, height: 6000, bytes: 48 * 1024 * 1024 }
  }, io);

  assert.equal(out.ok, true);
  assert.equal(out.asset.original.retained, false);
  assert.equal(out.asset.original.path, null);
  assert.match(out.asset.original.note, /not retained/i);
  assert.equal(io.puts.length, 1, 'only the web copy was written');
});

test('deleting an asset removes its private original too', async () => {
  const io = fakeIo();
  const { asset } = await storeImage({
    derivatives: [deriv(480), deriv(1600)],
    original: { contentType: 'image/jpeg', width: 4000, height: 3000, data: CLEAN_JPEG }
  }, io);

  const objects = assetObjects(asset);
  assert.equal(objects.length, 3);
  assert.equal(objects.filter(o => o.bucket === MEDIA_BUCKETS.private).length, 1);

  const io2 = fakeIo();
  const removed = await removeImage(asset, io2);
  assert.equal(removed, 3);
  assert.ok(io2.dels.some(d => d.bucket === MEDIA_BUCKETS.private),
    'the original is deleted, not left in the bucket');
});

test('the storage pointer survives a save and reload of the library', async () => {
  const io = fakeIo();
  const { asset } = await storeImage({
    alt: 'A photo', derivatives: [deriv(960)],
    original: { contentType: 'image/jpeg', width: 4000, height: 3000, data: CLEAN_JPEG }
  }, io);

  // This is the round trip the content endpoint performs on every save. If it
  // drops bucket/path, deleting the image later would orphan the original.
  const roundTripped = normaliseImageAsset(JSON.parse(JSON.stringify(asset)));
  assert.equal(roundTripped.original.bucket, asset.original.bucket);
  assert.equal(roundTripped.original.path, asset.original.path);
  assert.equal(roundTripped.original.retained, true);
  assert.equal(assetObjects(roundTripped).length, 2);
  assert.deepEqual(roundTripped.derivatives.map(d => d.ref), asset.derivatives.map(d => d.ref));
});

test('the library will only point at our own storage or an inline image', () => {
  assert.equal(allowedRef('https://icnznjhwybryizbdqrgx.supabase.co/x.jpg'), true);
  assert.equal(allowedRef('data:image/jpeg;base64,AAAA'), true);
  assert.equal(allowedRef('http://example.invalid/x.jpg'), false, 'plain http is refused');
  assert.equal(allowedRef('//example.invalid/x.jpg'), false, 'protocol-relative is refused');
  assert.equal(allowedRef('javascript:alert(1)'), false);
  assert.equal(allowedRef('data:image/svg+xml;base64,AAAA'), false, 'an SVG can carry script');
  assert.equal(allowedRef(''), false);

  // And a record carrying a bad ref loses it rather than storing it.
  const rec = normaliseImageAsset({ id: 'img_' + '0'.repeat(32), alt: 'x', approved: true,
    exifStripped: true, gpsRemoved: true,
    derivatives: [{ ref: 'http://evil.invalid/x.jpg', width: 800 },
                  { ref: 'https://icnznjhwybryizbdqrgx.supabase.co/ok.jpg', width: 900 }] });
  assert.equal(rec.derivatives.length, 1);
  assert.ok(rec.derivatives[0].ref.startsWith('https://'));
});

test('an image with no web copy is not publishable however approved it is', () => {
  const rec = normaliseImageAsset({ id: 'img_' + '1'.repeat(32), alt: 'x', approved: true,
    exifStripped: true, gpsRemoved: true, derivatives: [] });
  const v = imagePublishable(rec);
  assert.equal(v.ok, false);
  assert.ok(v.reasons.some(r => /derivative/i.test(r)));
});

test('the library reports when pictures are still inside the document', () => {
  const inline = { id: 'a', derivatives: [{ ref: 'data:image/jpeg;base64,' + 'A'.repeat(4000), width: 800 }] };
  const stored = { id: 'b', derivatives: [{ ref: publicUrl('img_' + '2'.repeat(32) + '/w800.jpg'), width: 800 }] };

  assert.equal(isDataUriRef(inline.derivatives[0].ref), true);
  assert.equal(isDataUriRef(stored.derivatives[0].ref), false);
  assert.deepEqual(legacyAssets([inline, stored]).map(a => a.id), ['a']);

  const report = librarySizeReport({ images: [inline, stored] });
  assert.equal(report.imageCount, 2);
  assert.equal(report.legacyCount, 1);
  assert.ok(report.inlineBytes > 4000);
  assert.equal(report.limit, LIMITS.libraryBytes);
  assert.equal(report.overLimit, false);

  // Twelve of those and the document is over the limit — which is the whole
  // reason the pictures moved out of it.
  const many = { images: Array.from({ length: 600 }, (_, i) => ({ ...inline, id: 'x' + i })) };
  assert.equal(librarySizeReport(many).overLimit, true);
});

test('base64 decoding handles a bare payload and a data URI alike', () => {
  const bare = decodeBase64(CLEAN_JPEG);
  const withPrefix = decodeBase64('data:image/jpeg;base64,' + CLEAN_JPEG);
  assert.deepEqual([...bare], [...withPrefix]);
  assert.equal(bare[0], 0xFF);
  assert.equal(bare[1], 0xD8);
  assert.equal(decodeBase64('').length, 0);
});

test('imageRecord keeps the sizes a responsive page needs', () => {
  const id = newAssetId();
  const rec = imageRecord({
    assetId: id, alt: 'x',
    stored: [
      { url: publicUrl(id + '/w1600.jpg'), width: 1600, height: 1200, bytes: 240000, contentType: 'image/jpeg' },
      { url: publicUrl(id + '/w480.jpg'), width: 480, height: 360, bytes: 30000, contentType: 'image/jpeg' }
    ],
    scanClean: true
  });
  assert.deepEqual(rec.derivatives.map(d => d.width), [480, 1600]);
  assert.equal(rec.derivatives[0].format, 'jpg');
  assert.equal(rec.original, null);
  assert.equal(rec.exifStripped, true);
});

test('a browser-encoded JPEG is clean even though it carries an ICC profile', () => {
  // This is the exact segment shape Chromium's canvas.toBlob('image/jpeg')
  // produces: a bare JFIF header, then an ICC colour profile in APP2.
  //
  // Treating every APPn segment as metadata rejected every single real upload —
  // the whole feature was unusable and the unit tests were all green, because
  // the hand-built fixtures had no ICC profile. An ICC profile is colour
  // management: no camera, no timestamp, no GPS, no serial number. Stripping it
  // would make photographs render wrong on a wide-gamut screen.
  const seg = (marker, payload) => {
    const len = payload.length + 2;
    return Buffer.concat([Buffer.from([0xFF, marker, (len >> 8) & 0xFF, len & 0xFF]), payload]);
  };
  const jfif = seg(0xE0, Buffer.concat([
    Buffer.from('JFIF\0', 'ascii'),
    Buffer.from([0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00])   // no thumbnail
  ]));
  const icc = seg(0xE2, Buffer.concat([
    Buffer.from('ICC_PROFILE\0', 'ascii'), Buffer.alloc(120, 7)
  ]));
  const browserJpeg = Buffer.concat([
    Buffer.from([0xFF, 0xD8]), jfif, icc,
    Buffer.from([0xFF, 0xDA, 0x00, 0x02, 0xFF, 0xD9])
  ]);

  const { scanMetadata } = requireScanner();
  const scan = scanMetadata(new Uint8Array(browserJpeg));
  assert.equal(scan.clean, true, 'markers found: ' + scan.markers.join(', '));
  assert.deepEqual(scan.markers, []);
  assert.ok(scan.benign.includes('ICC_PROFILE'), 'the profile is reported, not ignored');
  assert.ok(scan.benign.includes('JFIF'));

  // The Adobe colour-transform marker is benign for the same reason.
  const adobe = Buffer.concat([
    Buffer.from([0xFF, 0xD8]), jfif,
    seg(0xEE, Buffer.concat([Buffer.from('Adobe', 'ascii'), Buffer.alloc(9)])),
    Buffer.from([0xFF, 0xDA, 0x00, 0x02, 0xFF, 0xD9])
  ]);
  assert.equal(scanMetadata(new Uint8Array(adobe)).clean, true);

  // But a thumbnail, a maker note and a comment are all still caught.
  const thumb = Buffer.concat([
    Buffer.from([0xFF, 0xD8]),
    seg(0xE0, Buffer.concat([Buffer.from('JFIF\0', 'ascii'),
      Buffer.from([0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x02, 0x02])])),  // 2x2 thumb
    Buffer.from([0xFF, 0xDA, 0x00, 0x02, 0xFF, 0xD9])
  ]);
  assert.equal(scanMetadata(new Uint8Array(thumb)).clean, false);
  assert.ok(scanMetadata(new Uint8Array(thumb)).markers.includes('JFIF_THUMBNAIL'));

  const maker = Buffer.concat([
    Buffer.from([0xFF, 0xD8]), jfif, seg(0xE5, Buffer.alloc(20, 3)),
    Buffer.from([0xFF, 0xDA, 0x00, 0x02, 0xFF, 0xD9])
  ]);
  assert.equal(scanMetadata(new Uint8Array(maker)).clean, false,
    'APP5 is camera-maker territory and can carry a serial or a GPS copy');

  const comment = Buffer.concat([
    Buffer.from([0xFF, 0xD8]), jfif, seg(0xFE, Buffer.from('taken at home', 'ascii')),
    Buffer.from([0xFF, 0xDA, 0x00, 0x02, 0xFF, 0xD9])
  ]);
  assert.equal(scanMetadata(new Uint8Array(comment)).clean, false);
});

/** Imported lazily so the fixture above reads top-down. */
function requireScanner() {
  return scannerModule;
}
