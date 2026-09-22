// ─────────────────────────────────────────────────────────────────────────────
// IMAGE METADATA AND WEB DERIVATIVES
//
// A photograph taken on a phone at a customer's house carries the coordinates
// of that house. Publishing it in a proposal publishes the address of a past
// customer who agreed to "a photo of the job", not to that.
//
// Nick: "Strip EXIF and GPS metadata from customer-facing image derivatives."
//
// The stripping is not done by editing the metadata out of the original — that
// is fiddly, format-specific, and fails quietly on anything unusual. Instead
// the public copy is RE-ENCODED from raw pixels through a canvas, which
// produces a file that never contained metadata in the first place. The
// original is kept privately and untouched.
//
// `scanMetadata` exists so this can be proved rather than asserted: it walks
// the bytes for EXIF, GPS, XMP, IPTC and JFIF thumbnail markers, and the test
// suite runs it over the derivatives.
// ─────────────────────────────────────────────────────────────────────────────

/** The widths a customer page actually asks for. */
export const DERIVATIVE_WIDTHS = Object.freeze([480, 960, 1600]);

/** JPEG quality for the re-encoded public copies. */
export const DERIVATIVE_QUALITY = 0.82;

const u8 = (bytes) => bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);

function ascii(bytes, at, len) {
  let s = '';
  for (let i = at; i < at + len && i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

/**
 * What metadata is present in these bytes?
 *
 * Deliberately a scanner rather than a parser: it does not need to read the
 * metadata, only to prove whether any is there. Returns every marker found so a
 * failure says what leaked rather than just that something did.
 *
 * @returns {{clean:boolean, format:string|null, markers:string[]}}
 */
export function scanMetadata(bytes) {
  const b = u8(bytes);
  const markers = [];
  let format = null;

  const isJpeg = b.length > 3 && b[0] === 0xFF && b[1] === 0xD8;
  const isPng = b.length > 8 && b[0] === 0x89 && ascii(b, 1, 3) === 'PNG';

  if (isJpeg) {
    format = 'jpeg';
    // Walk the JPEG segment chain. Every APPn and COM segment is metadata.
    let i = 2;
    while (i < b.length - 3) {
      if (b[i] !== 0xFF) { i++; continue; }
      const marker = b[i + 1];
      if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { i += 2; continue; }
      if (marker === 0xDA || marker === 0xD9) break;   // start of scan / end of image
      const len = (b[i + 2] << 8) | b[i + 3];
      if (len < 2) break;
      if (marker >= 0xE0 && marker <= 0xEF) {
        const tag = ascii(b, i + 4, 6).replace(/\0.*$/, '');
        if (marker === 0xE1 && /^Exif/.test(tag)) markers.push('EXIF');
        else if (marker === 0xE1 && /^http:\/\/ns\.adobe/.test(ascii(b, i + 4, 20))) markers.push('XMP');
        else if (marker === 0xED) markers.push('IPTC');
        else if (marker === 0xE0 && /^JFIF/.test(tag)) {
          // A bare JFIF header carries density only. A JFIF *thumbnail* embeds
          // a second picture, which is metadata worth reporting.
          const tw = b[i + 16], th = b[i + 17];
          if (tw > 0 && th > 0) markers.push('JFIF_THUMBNAIL');
        } else if (marker !== 0xE0) markers.push('APP' + (marker - 0xE0));
      } else if (marker === 0xFE) {
        markers.push('COMMENT');
      }
      i += 2 + len;
    }
  } else if (isPng) {
    format = 'png';
    let i = 8;
    while (i + 8 <= b.length) {
      const len = (b[i] << 24 | b[i + 1] << 16 | b[i + 2] << 8 | b[i + 3]) >>> 0;
      const type = ascii(b, i + 4, 4);
      if (type === 'IEND') break;
      if (['tEXt', 'iTXt', 'zTXt', 'eXIf'].includes(type)) {
        markers.push(type === 'eXIf' ? 'EXIF' : 'TEXT');
      }
      i += 12 + len;
      if (len > b.length) break;
    }
  }

  // GPS tags live inside EXIF, so EXIF present means GPS may be present. The
  // scanner reports the container; the rule is that neither may survive.
  const unique = [...new Set(markers)];
  return { clean: unique.length === 0, format, markers: unique };
}

/** Convenience for the rule the content library enforces. */
export function hasPrivateMetadata(bytes) {
  return !scanMetadata(bytes).clean;
}

// ─────────────────────────────────────────────────────────────────────────────
// DERIVATIVES (browser)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Re-encode an uploaded image into the public sizes.
 *
 * Runs in the browser because that is where the upload is, and because a canvas
 * round-trip is the one transformation guaranteed to drop every metadata block
 * in every format without needing to understand any of them.
 *
 * @param {Blob|File} file
 * @param {{widths?:number[], quality?:number, type?:string}} opts
 * @returns {Promise<{width:number,height:number,derivatives:Array}>}
 */
export async function makeDerivatives(file, opts = {}) {
  const widths = opts.widths || DERIVATIVE_WIDTHS;
  const quality = opts.quality ?? DERIVATIVE_QUALITY;
  const type = opts.type || 'image/jpeg';

  const bitmap = await loadBitmap(file);
  const out = [];
  for (const w of widths) {
    // Never upscale: a 900 px photo does not become a 1600 px photo by being
    // stretched, it just becomes a bigger download.
    const width = Math.min(w, bitmap.width);
    const height = Math.round(bitmap.height * (width / bitmap.width));
    const canvas = makeCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await canvasToBlob(canvas, type, quality);
    out.push({ width, height, format: type.replace('image/', ''), bytes: blob.size, blob });
    if (width >= bitmap.width) break;   // no point producing the same size twice
  }
  return { width: bitmap.width, height: bitmap.height, derivatives: out };
}

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

async function loadBitmap(file) {
  if (typeof createImageBitmap === 'function') {
    // imageOrientation:'from-image' applies the EXIF rotation to the PIXELS, so
    // the stripped copy is still the right way up. Dropping the metadata
    // without doing this is how a portrait photo ends up sideways.
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally { URL.revokeObjectURL(url); }
}

function canvasToBlob(canvas, type, quality) {
  if (typeof canvas.convertToBlob === 'function') return canvas.convertToBlob({ type, quality });
  return new Promise(res => canvas.toBlob(res, type, quality));
}

/**
 * Turn the result of `makeDerivatives` into a content-library image record.
 *
 * `exifStripped` and `gpsRemoved` are set from a SCAN of the produced bytes,
 * not from the fact that the code ran. If a future browser starts writing
 * metadata into a canvas export, the record says so and the image stops being
 * publishable rather than quietly leaking.
 */
export async function imageRecordFrom(id, { alt = '', tags = [], focalPoint = null },
                                      original, made, store) {
  const derivatives = [];
  let clean = true;
  for (const d of made.derivatives) {
    const bytes = new Uint8Array(await d.blob.arrayBuffer());
    const scan = scanMetadata(bytes);
    if (!scan.clean) clean = false;
    const ref = await store(id, d.width, d.blob);
    derivatives.push({ ref, width: d.width, height: d.height, format: d.format, bytes: d.bytes });
  }
  return {
    id, alt, tags,
    focalPoint: focalPoint || { x: 0.5, y: 0.5 },
    approved: false,                       // approval is always a human act
    original: original || null,
    derivatives,
    exifStripped: clean,
    gpsRemoved: clean
  };
}
