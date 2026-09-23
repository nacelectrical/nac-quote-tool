// ─────────────────────────────────────────────────────────────────────────────
// WHERE THE PHOTOGRAPHS LIVE
//
// The content library used to carry images as data URIs inside its own JSON
// document. That is fine for a logo and four placeholder rectangles and falls
// over the moment somebody loads a real photo library: every quote render, every
// admin save and every API response would carry every megabyte of every picture,
// base64-inflated by a third.
//
// So pictures move to object storage, and the library keeps URLs.
//
// Two buckets, and the split is the whole point:
//
//   PUBLIC   the re-encoded web derivatives. A customer quote link is opened by
//            somebody who is not logged in, so these have to be readable without
//            a credential. They are re-encoded copies with the metadata already
//            gone, at unguessable paths.
//
//   PRIVATE  the originals. Straight off a phone, EXIF and GPS intact, which is
//            exactly why they are never served to anybody. They are kept so a
//            photo can be re-cropped or re-exported later without asking the
//            customer for it again.
//
// This module is pure: paths, limits, URL shapes and record building. Every HTTP
// call lives in the endpoint, so the rules can be tested without a network.
// ─────────────────────────────────────────────────────────────────────────────

export const SUPA_URL = 'https://icnznjhwybryizbdqrgx.supabase.co';

export const MEDIA_BUCKETS = Object.freeze({
  /** Re-encoded, metadata-free, world-readable. */
  public: 'nac-quote-media',
  /** Originals. Service role only. Never linked from a customer page. */
  private: 'nac-quote-originals'
});

/** What a browser may hand us. Anything else is refused by name. */
export const ALLOWED_TYPES = Object.freeze([
  'image/jpeg', 'image/png', 'image/webp', 'image/avif'
]);

export const LIMITS = Object.freeze({
  /** One web derivative. A 1600 px JPEG at quality .82 is ~250 KB. */
  derivativeBytes: 3 * 1024 * 1024,
  /** A phone original. Beyond this the archive copy is kept instead. */
  originalBytes: 20 * 1024 * 1024,
  /** Total across one upload request, so a function invocation stays bounded. */
  requestBytes: 24 * 1024 * 1024,
  derivativesPerAsset: 6,
  /** The whole library document, now that it holds URLs rather than pictures. */
  libraryBytes: 2 * 1024 * 1024
});

const EXT = Object.freeze({
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif'
});

export function extensionFor(contentType) {
  return EXT[String(contentType || '').toLowerCase()] || null;
}

const str = (v) => (v === null || v === undefined) ? '' : String(v);

/**
 * An asset id that is also a storage path segment.
 *
 * Unguessable on purpose: the public bucket is world-readable, so the path is
 * the only thing standing between a customer's installation photograph and
 * anyone who felt like enumerating a directory.
 */
export function newAssetId() {
  const bytes = new Uint8Array(16);
  const c = (typeof globalThis !== 'undefined' && globalThis.crypto) || null;
  if (!c || typeof c.getRandomValues !== 'function') {
    throw new Error('No cryptographic random source — cannot allocate a media path.');
  }
  c.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return 'img_' + out;
}

/** Storage paths are derived, never taken from a filename. */
export function objectPath(assetId, kind, contentType, width = null) {
  const id = str(assetId);
  if (!/^img_[0-9a-f]{32}$/.test(id)) throw new Error('bad asset id');
  const ext = extensionFor(contentType);
  if (!ext) throw new Error('unsupported content type: ' + contentType);
  if (kind === 'original') return id + '/original.' + ext;
  if (kind === 'archive') return id + '/archive.' + ext;
  const w = Number(width);
  if (!Number.isFinite(w) || w < 16 || w > 6000) throw new Error('bad derivative width');
  return id + '/w' + Math.round(w) + '.' + ext;
}

export function publicUrl(path, { base = SUPA_URL, bucket = MEDIA_BUCKETS.public } = {}) {
  return base + '/storage/v1/object/public/' + bucket + '/' + path;
}

export function storageObjectUrl(bucket, path, { base = SUPA_URL } = {}) {
  return base + '/storage/v1/object/' + bucket + '/' + path;
}

/** True when a ref points at our own public bucket. */
export function isStoredRef(ref) {
  const s = str(ref);
  return s.startsWith(SUPA_URL + '/storage/v1/object/public/' + MEDIA_BUCKETS.public + '/');
}

export function isDataUriRef(ref) {
  return /^data:image\//i.test(str(ref));
}

/**
 * Validate one uploaded part before a single byte is written.
 *
 * Returns reasons rather than throwing, so an upload of six derivatives can
 * report all six problems at once instead of one per round trip.
 */
export function validatePart(part, { kind = 'derivative' } = {}) {
  const reasons = [];
  const type = str(part?.contentType).toLowerCase();
  const bytes = Number(part?.bytes);

  if (!ALLOWED_TYPES.includes(type)) {
    reasons.push('Unsupported image type "' + (type || 'none') + '". '
      + 'Allowed: ' + ALLOWED_TYPES.join(', ') + '.');
  }
  if (!Number.isFinite(bytes) || bytes <= 0) {
    reasons.push('Empty file.');
  } else {
    const cap = kind === 'derivative' ? LIMITS.derivativeBytes : LIMITS.originalBytes;
    if (bytes > cap) {
      reasons.push('File is ' + mb(bytes) + ' — the limit for a ' + kind + ' is ' + mb(cap) + '.');
    }
  }
  if (kind === 'derivative') {
    const w = Number(part?.width);
    if (!Number.isFinite(w) || w < 16) reasons.push('Derivative has no usable width.');
  }
  return { ok: reasons.length === 0, reasons };
}

function mb(n) {
  return (n / (1024 * 1024)).toFixed(1) + ' MB';
}

/**
 * Validate a whole upload request.
 *
 * The total matters as much as each part: a serverless function has a body
 * limit and a memory ceiling, and finding that out by being killed halfway
 * through writing the third derivative leaves orphaned objects behind.
 */
export function validateUpload({ derivatives = [], original = null } = {}) {
  const reasons = [];
  if (!Array.isArray(derivatives) || derivatives.length === 0) {
    reasons.push('No web derivatives were supplied.');
  } else if (derivatives.length > LIMITS.derivativesPerAsset) {
    reasons.push('Too many derivatives (' + derivatives.length + ').');
  }
  let total = 0;
  for (const d of derivatives || []) {
    const v = validatePart(d, { kind: 'derivative' });
    if (!v.ok) reasons.push(...v.reasons);
    total += Number(d?.bytes) || 0;
  }
  if (original) {
    const v = validatePart(original, { kind: 'original' });
    if (!v.ok) reasons.push(...v.reasons);
    total += Number(original.bytes) || 0;
  }
  if (total > LIMITS.requestBytes) {
    reasons.push('Upload totals ' + mb(total) + ', over the ' + mb(LIMITS.requestBytes)
      + ' request limit. Try one image at a time.');
  }
  return { ok: reasons.length === 0, reasons, totalBytes: total };
}

/**
 * Build the content-library image record from what was actually stored.
 *
 * `exifStripped` and `gpsRemoved` come from `scanClean`, which the SERVER works
 * out by scanning the bytes it received. The browser's own scan is a courtesy
 * to the person uploading; it is not what the record is built from, because a
 * browser is on the other side of the wire.
 */
export function imageRecord({ assetId, alt = '', tags = [], focalPoint = null,
                              stored = [], original = null, scanClean = false }) {
  const derivatives = (stored || [])
    .filter(s => s && s.url && Number(s.width) > 0)
    .map(s => ({ ref: s.url, width: Math.round(Number(s.width)),
                 height: Math.round(Number(s.height) || 0),
                 format: extensionFor(s.contentType) || 'jpg',
                 bytes: Math.round(Number(s.bytes) || 0) }))
    .sort((a, b) => a.width - b.width);

  return {
    id: assetId,
    alt: str(alt),
    tags: Array.isArray(tags) ? tags : [],
    focalPoint: focalPoint && Number.isFinite(Number(focalPoint.x))
      ? { x: Number(focalPoint.x), y: Number(focalPoint.y) } : { x: 0.5, y: 0.5 },
    // Approval is a human act and never comes back true from an upload.
    approved: false,
    // The private side. `path` and never a URL: there is no URL that serves
    // this, and writing one into the record would invite somebody to try.
    original: original ? {
      bucket: MEDIA_BUCKETS.private,
      // An unretained original has no path. Empty string would read as "there
      // is an object at ''" to anything walking the record to delete objects.
      path: original.path ? str(original.path) : null,
      width: Math.round(Number(original.width) || 0),
      height: Math.round(Number(original.height) || 0),
      bytes: Math.round(Number(original.bytes) || 0),
      retained: original.retained !== false,
      note: original.note || null
    } : null,
    derivatives,
    exifStripped: scanClean === true,
    gpsRemoved: scanClean === true
  };
}

/** Every storage object one asset owns, for deleting it cleanly. */
export function assetObjects(asset) {
  const out = [];
  for (const d of asset?.derivatives || []) {
    const ref = str(d.ref);
    const marker = '/storage/v1/object/public/' + MEDIA_BUCKETS.public + '/';
    const at = ref.indexOf(marker);
    if (at >= 0) out.push({ bucket: MEDIA_BUCKETS.public, path: ref.slice(at + marker.length) });
  }
  if (asset?.original?.path) {
    out.push({ bucket: asset.original.bucket || MEDIA_BUCKETS.private, path: asset.original.path });
  }
  return out;
}

/**
 * Which library images are still carrying their pixels inside the document.
 *
 * Used by the migration: the old data-URI records keep working — a data URI is
 * still a valid image source — so nothing breaks while they are moved, and this
 * says how much is left to move.
 */
export function legacyAssets(images = []) {
  return (images || []).filter(a =>
    (a?.derivatives || []).some(d => isDataUriRef(d.ref)));
}

export function librarySizeReport(content) {
  const json = JSON.stringify(content || {});
  const bytes = json.length;
  const images = (content?.images || []);
  const legacy = legacyAssets(images);
  const inlineBytes = legacy.reduce((n, a) =>
    n + (a.derivatives || []).reduce((m, d) =>
      m + (isDataUriRef(d.ref) ? String(d.ref).length : 0), 0), 0);
  return {
    bytes, limit: LIMITS.libraryBytes,
    overLimit: bytes > LIMITS.libraryBytes,
    imageCount: images.length,
    legacyCount: legacy.length,
    inlineBytes
  };
}
