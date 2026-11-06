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
  const markers = [];   // privacy-bearing, and the reason `clean` goes false
  const benign = [];    // present, harmless, reported so nobody wonders
  let format = null;

  const isJpeg = b.length > 3 && b[0] === 0xFF && b[1] === 0xD8;
  const isPng = b.length > 8 && b[0] === 0x89 && ascii(b, 1, 3) === 'PNG';

  if (isJpeg) {
    format = 'jpeg';
    // ── WHICH APPLICATION SEGMENTS ACTUALLY MATTER ──────────────────────────
    //
    // Not every APPn block is metadata worth removing. Treating them all as
    // suspect rejected every image a browser had just re-encoded, because
    // Chromium writes an ICC colour profile into APP2 — that is colour
    // management, not a camera serial number, and dropping it would make
    // photographs render wrong on a wide-gamut screen.
    //
    // So the segments are classified:
    //
    //   PRIVACY   EXIF (camera, timestamp, GPS), XMP (creator, location),
    //             IPTC (contact details), a JFIF thumbnail (a second picture),
    //             MPF (embedded images), any camera-maker segment, and free
    //             text comments.
    //   BENIGN    the bare JFIF header, an ICC profile, the Adobe colour
    //             transform marker.
    //
    // `clean` is about the first list only. The second is reported so a person
    // looking at the result can see what IS there.
    let i = 2;
    while (i < b.length - 3) {
      if (b[i] !== 0xFF) { i++; continue; }
      const marker = b[i + 1];
      if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { i += 2; continue; }
      if (marker === 0xDA || marker === 0xD9) break;   // start of scan / end of image
      const len = (b[i + 2] << 8) | b[i + 3];
      if (len < 2) break;
      const tag = ascii(b, i + 4, 12);

      if (marker === 0xE0) {
        // APP0. A bare JFIF header carries pixel density. A JFIF THUMBNAIL
        // embeds a whole second picture, which is worth removing.
        if (/^JFIF\0/.test(tag)) {
          const tw = b[i + 16], th = b[i + 17];
          if (tw > 0 && th > 0) markers.push('JFIF_THUMBNAIL'); else benign.push('JFIF');
        } else if (/^JFXX/.test(tag)) {
          markers.push('JFIF_THUMBNAIL');
        } else {
          benign.push('APP0');
        }
      } else if (marker === 0xE1) {
        if (/^Exif/.test(tag)) markers.push('EXIF');
        else if (/^http:\/\/ns\.adobe/.test(ascii(b, i + 4, 24))) markers.push('XMP');
        else markers.push('APP1');
      } else if (marker === 0xE2) {
        if (/^ICC_PROFILE/.test(tag)) benign.push('ICC_PROFILE');
        else if (/^MPF/.test(tag)) markers.push('MPF');       // embedded images
        else markers.push('APP2');
      } else if (marker === 0xED) {
        markers.push('IPTC');
      } else if (marker === 0xEE) {
        // APP14 "Adobe" is the colour-transform flag. Removing it turns some
        // CMYK and YCCK JPEGs inside out.
        if (/^Adobe/.test(tag)) benign.push('ADOBE_COLOUR'); else markers.push('APP14');
      } else if (marker >= 0xE3 && marker <= 0xEC) {
        // APP3–APP12 are camera-maker territory: serial numbers, focus data,
        // sometimes a second copy of the GPS block.
        markers.push('APP' + (marker - 0xE0));
      } else if (marker === 0xEF) {
        markers.push('APP15');
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
      } else if (type === 'iCCP') {
        benign.push('ICC_PROFILE');   // colour management, not a camera record
      }
      i += 12 + len;
      if (len > b.length) break;
    }
  }

  // GPS tags live inside EXIF, so EXIF present means GPS may be present. The
  // scanner reports the container; the rule is that neither may survive.
  const unique = [...new Set(markers)];
  return { clean: unique.length === 0, format, markers: unique,
           benign: [...new Set(benign)] };
}

/**
 * REMOVE what scanMetadata() objects to, rather than refusing the image.
 *
 * Nick, 6 November 2026, trying to put NAC's logo on the Branding tab:
 * "That image still carried metadata after re-encoding and was not uploaded.
 * Try exporting it from Photos first."
 *
 * Re-encoding through a canvas is what normally strips metadata, and on most
 * browsers it does. Where it does not — and a browser is free to write its own
 * segments into an export — the upload was simply refused, and the person was
 * sent off to re-export the file on their phone to work around their browser.
 *
 * That is the application asking a person to do something it can do exactly.
 * These are bytes we hold, in formats whose structure is not in doubt: the
 * offending segments are removed here and the result is scanned again. The
 * rule has not softened — nothing with metadata is uploaded — but it is met by
 * doing the work instead of by handing it back.
 *
 * Returns the bytes unchanged when there is nothing to remove.
 *
 * IT DOES NOT TOUCH PIXELS, and that is a contract the caller has to keep.
 * EXIF carries the orientation flag, so stripping it off a camera original
 * would leave a portrait photograph rendering on its side. Give it bytes whose
 * orientation is already applied — anything that has been through a canvas,
 * which is every derivative this module makes, because loadBitmap() decodes
 * with imageOrientation: 'from-image'. Never a file straight off a phone.
 */
export function stripMetadata(bytes) {
  const b = u8(bytes);
  const before = scanMetadata(b);
  if (before.clean) return b;

  if (before.format === 'jpeg') return stripJpeg(b);
  if (before.format === 'png') return stripPng(b);
  return b;                               // a format this cannot rebuild
}

/** Keep the frame, the scan and the colour information. Drop the rest. */
function stripJpeg(b) {
  const keep = [0xFF, 0xD8];              // SOI
  let i = 2;
  while (i < b.length - 3) {
    if (b[i] !== 0xFF) { i++; continue; }
    const marker = b[i + 1];
    // Padding and standalone markers carry nothing and have no length.
    if (marker === 0xFF || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) {
      i += 2; continue;
    }
    // From the start of scan to the end of the file is image data. It is
    // copied verbatim: nothing in it is metadata, and rewriting any of it
    // would change the picture.
    if (marker === 0xDA) { for (let k = i; k < b.length; k++) keep.push(b[k]); break; }
    if (marker === 0xD9) break;
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2 || i + 2 + len > b.length) break;

    const tag = ascii(b, i + 4, 12);
    let drop = false;
    if (marker === 0xE0) {
      // A JFIF header with a thumbnail embeds a whole second picture. The
      // header itself is density information and stays — but its thumbnail
      // fields are zeroed rather than the segment being dropped, because
      // some decoders expect APP0 to be there.
      if (/^JFIF\0/.test(tag) && (b[i + 16] > 0 && b[i + 17] > 0)) drop = true;
      else if (/^JFXX/.test(tag)) drop = true;
    } else if (marker === 0xE1) {
      drop = true;                        // EXIF, XMP, or an APP1 we cannot vouch for
    } else if (marker === 0xE2) {
      drop = !/^ICC_PROFILE/.test(tag);   // colour management stays
    } else if (marker === 0xEE) {
      drop = !/^Adobe/.test(tag);         // the colour-transform flag stays
    } else if (marker === 0xED || marker === 0xEF || marker === 0xFE
               || (marker >= 0xE3 && marker <= 0xEC)) {
      drop = true;                        // IPTC, APP15, comments, camera-maker blocks
    }

    if (!drop) for (let k = i; k < i + 2 + len; k++) keep.push(b[k]);
    i += 2 + len;
  }
  return Uint8Array.from(keep);
}

/** PNG chunks are self-contained, so an unwanted one is simply not copied. */
function stripPng(b) {
  const keep = [];
  for (let k = 0; k < 8; k++) keep.push(b[k]);          // signature
  let i = 8;
  while (i + 8 <= b.length) {
    const len = (b[i] << 24 | b[i + 1] << 16 | b[i + 2] << 8 | b[i + 3]) >>> 0;
    const type = ascii(b, i + 4, 4);
    const end = i + 12 + len;
    if (len > b.length || end > b.length) break;
    const drop = ['tEXt', 'iTXt', 'zTXt', 'eXIf'].includes(type);
    // Each chunk carries its own CRC, so dropping a whole chunk leaves every
    // other chunk valid. Nothing is rewritten.
    if (!drop) for (let k = i; k < end; k++) keep.push(b[k]);
    if (type === 'IEND') break;
    i = end;
  }
  return Uint8Array.from(keep);
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
