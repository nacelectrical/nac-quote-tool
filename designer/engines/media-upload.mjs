// ─────────────────────────────────────────────────────────────────────────────
// STORING ONE IMAGE, WITHOUT THE HTTP
//
// The order of operations here is the whole point, so it lives in a module that
// can be tested rather than inside an endpoint that can only be tested by
// deploying it:
//
//   1. decode and measure REAL bytes, not the length of a base64 string
//   2. scan every web copy for metadata — on the bytes the server received,
//      because the browser is on the other side of the wire
//   3. refuse the whole upload if any copy is dirty, having written nothing
//   4. write the derivatives, then the original
//   5. if any write fails, delete everything already written
//
// Step 5 matters more than it looks. A half-written asset leaves a customer's
// photograph sitting in a bucket with no record pointing at it, which means
// nobody knows it is there and nobody ever deletes it.
//
// The transport is injected, so the same code serves the endpoint and the test.
// ─────────────────────────────────────────────────────────────────────────────

import {
  MEDIA_BUCKETS, newAssetId, objectPath, publicUrl, validateUpload, imageRecord
} from './media-store.mjs';
import { scanMetadata } from './image-privacy.mjs';

/** Base64 (with or without a data: prefix) to bytes. */
export function decodeBase64(data) {
  const s = String(data || '').replace(/^data:[^,]*,/, '');
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(s, 'base64'));
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * @param {object} req  `{ alt, tags, focalPoint, derivatives:[{width,height,contentType,data}],
 *                        original:{contentType,width,height,data} | {tooLarge:true,...} | null }`
 * @param {object} io   `{ put(bucket, path, bytes, contentType), del(bucket, path) }`
 * @returns {Promise<{ok:boolean, status:number, asset?, error?, detail?, reasons?, dirty?}>}
 */
export async function storeImage(req = {}, io) {
  if (!io || typeof io.put !== 'function') throw new Error('storeImage needs a put transport');
  const del = typeof io.del === 'function' ? io.del : async () => {};

  const derivatives = (Array.isArray(req.derivatives) ? req.derivatives : []).map(d => {
    const bytes = decodeBase64(d.data);
    return { ...d, bytes: bytes.length, buffer: bytes };
  });

  const origIn = req.original || null;
  const original = (origIn && origIn.data && !origIn.tooLarge)
    ? (() => { const b = decodeBase64(origIn.data); return { ...origIn, bytes: b.length, buffer: b }; })()
    : null;

  const check = validateUpload({ derivatives, original });
  if (!check.ok) {
    return { ok: false, status: 400, error: 'rejected', reasons: check.reasons };
  }

  // ── The authoritative scan ────────────────────────────────────────────────
  const dirty = [];
  for (const d of derivatives) {
    const scan = scanMetadata(d.buffer);
    if (!scan.clean) dirty.push({ width: d.width, markers: scan.markers });
  }
  if (dirty.length) {
    return {
      ok: false, status: 422, error: 'metadata_present', dirty,
      detail: 'These web copies still carry metadata and were not stored: '
        + dirty.map(x => x.width + 'px (' + x.markers.join(', ') + ')').join('; ')
        + '. Nothing was written.'
    };
  }

  const assetId = newAssetId();
  const written = [];
  const stored = [];

  try {
    for (const d of derivatives) {
      const path = objectPath(assetId, 'derivative', d.contentType, d.width);
      await io.put(MEDIA_BUCKETS.public, path, d.buffer, d.contentType);
      written.push({ bucket: MEDIA_BUCKETS.public, path });
      stored.push({ url: publicUrl(path), width: d.width, height: d.height,
                    bytes: d.bytes, contentType: d.contentType });
    }

    let originalRec = null;
    if (original) {
      const path = objectPath(assetId, 'original', original.contentType);
      await io.put(MEDIA_BUCKETS.private, path, original.buffer, original.contentType);
      written.push({ bucket: MEDIA_BUCKETS.private, path });
      originalRec = { bucket: MEDIA_BUCKETS.private, path, width: original.width,
                      height: original.height, bytes: original.bytes, retained: true };
    } else if (origIn && origIn.tooLarge) {
      // Recorded rather than silently absent, so nobody later assumes there is
      // a higher-resolution copy to go back to.
      originalRec = { bucket: MEDIA_BUCKETS.private, path: null,
                      width: origIn.width || 0, height: origIn.height || 0,
                      bytes: origIn.bytes || 0, retained: false,
                      note: 'Original exceeded the upload limit and was not retained. The '
                          + 'largest web copy is the highest resolution on file.' };
    }

    return {
      ok: true, status: 200,
      asset: imageRecord({ assetId, alt: req.alt, tags: req.tags,
        focalPoint: req.focalPoint, stored, original: originalRec, scanClean: true })
    };
  } catch (e) {
    for (const o of written) { try { await del(o.bucket, o.path); } catch { /* best effort */ } }
    const missing = e && e.code === 'bucket_missing';
    return {
      ok: false,
      status: missing ? 503 : 502,
      error: missing ? 'bucket_missing' : 'storage_write_failed',
      detail: missing
        ? 'Storage bucket "' + (e.bucket || '') + '" does not exist. Apply '
          + 'designer/quote-media-buckets.sql, then try again.'
        : 'The image could not be stored, and nothing was left behind.',
      rolledBack: written.length
    };
  }
}

/** Delete every object one asset owns. Returns how many were removed. */
export async function removeImage(asset, io) {
  const { assetObjects } = await import('./media-store.mjs');
  const objects = assetObjects(asset);
  let removed = 0;
  for (const o of objects) {
    if (!o.path) continue;
    try { await io.del(o.bucket, o.path); removed++; } catch { /* best effort */ }
  }
  return removed;
}
