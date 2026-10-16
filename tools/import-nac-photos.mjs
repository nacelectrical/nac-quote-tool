// ─────────────────────────────────────────────────────────────────────────────
// IMPORT NAC'S OWN PHOTOGRAPHS INTO THE CONTENT LIBRARY
//
// `designer/content/nac-photos.json` holds the nine photographs Nick supplied
// on 15 and 16 October 2026 — NAC's own work, on NAC's own jobs. What it holds
// is a FILE and a DESCRIPTION. What the presentation needs is an image RECORD:
// a web derivative, proof the metadata is gone, and a human's approval.
//
// Those three are facts, not flags, so this tool produces them rather than
// asserting them:
//
//   THE DERIVATIVE  Each photograph is re-drawn onto a canvas in Chromium and
//                   re-encoded as JPEG. A canvas has no metadata to carry, so
//                   the encode is what strips EXIF — not a field somebody set.
//                   They are also portrait originals, and the page wants them
//                   at a sane width, so they are resized on the way through.
//
//   THE PROOF       The re-encoded bytes go through the repository's own
//                   scanMetadata(), and a photograph whose derivative does not
//                   come back clean is REFUSED, not imported with a flag on.
//
//   THE APPROVAL    Nick supplied these photographs for this purpose and said
//                   which equipment each belongs beside ("Just use brands. Put
//                   one of the Daikin ones next to a Daikin, Fujitsu next to
//                   Fujitsu"). That is the approval, and the record says so in
//                   `approvedBy` rather than carrying a bare true.
//
// An INSTALLATION photograph needs more than this before it reaches the
// gallery: a suburb and the customer's consent to show their house. Nobody has
// recorded those, so none of these is imported as an installation and the tool
// says so rather than quietly promoting them.
//
//   node tools/import-nac-photos.mjs                  → writes the library
//   node tools/import-nac-photos.mjs --check          → reports, writes nothing
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanMetadata } from '../designer/engines/image-privacy.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTENT = resolve(HERE, '../designer/content');
const SOURCE = resolve(CONTENT, 'nac-photos.json');
const OUT = resolve(CONTENT, 'nac-images.json');
/**
 * The stripped derivatives are written as FILES, not inlined into the JSON.
 * Nine portrait photographs come to a couple of megabytes, and base64 in a
 * manifest is a third bigger again, unreadable in a diff, and re-downloaded in
 * full every time one caption changes. The deployment uploads these files to
 * storage; a local preview inlines them with loadNacImages({ inline: true }).
 */
const DERIVED = resolve(CONTENT, 'images');

/** The widest derivative the page ever needs. Portrait originals are tall. */
const MAX_EDGE = 1400;
const QUALITY = 0.86;

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PLAYWRIGHT = '/opt/node-tools/node_modules/playwright/index.js';

function slug(file) {
  return String(file).replace(/^.*\//, '').replace(/\.[a-z]+$/i, '');
}

export async function importPhotos({ check = false } = {}) {
  const manifest = JSON.parse(readFileSync(SOURCE, 'utf8'));
  const photos = manifest.photos || [];
  const pw = await import(PLAYWRIGHT);
  const chromium = pw.chromium || pw.default.chromium;
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await browser.newPage();

  const images = [];
  const refused = [];
  const notes = [];

  for (const p of photos) {
    const bytes = readFileSync(resolve(CONTENT, p.file));
    const before = scanMetadata(bytes);
    const dataUri = 'data:image/jpeg;base64,' + bytes.toString('base64');

    // ── RE-ENCODE IN THE BROWSER, EXACTLY AS THE IMAGES PANEL DOES ─────────
    const encoded = await page.evaluate(async ({ uri, maxEdge, quality }) => {
      const img = new Image();
      await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = uri; });
      const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * scale);
      const h = Math.round(img.naturalHeight * scale);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      return { uri: c.toDataURL('image/jpeg', quality), width: w, height: h,
               sourceWidth: img.naturalWidth, sourceHeight: img.naturalHeight };
    }, { uri: dataUri, maxEdge: MAX_EDGE, quality: QUALITY });

    const outBytes = Buffer.from(encoded.uri.split(',')[1], 'base64');
    const after = scanMetadata(outBytes);

    if (!after.clean) {
      // Not imported with a flag turned off: not imported.
      refused.push({ file: p.file, reasons: after.markers });
      continue;
    }

    images.push({
      id: slug(p.file),
      role: p.role || 'equipment',
      alt: p.alt || '',
      tags: p.tags || [],
      equipmentBrand: p.equipmentBrand || '',
      equipmentModels: p.equipmentModels || [],
      // The approval is a person's, and the record says whose and why.
      approved: true,
      approvedBy: 'nick@nacelectrical.com.au',
      approvalNote: 'NAC’s own photographs of NAC’s own work, supplied by Nick '
        + 'on 15–16 October 2026 for use on customer proposals.',
      // Measured on the re-encoded bytes by scanMetadata(), not asserted.
      exifStripped: true,
      gpsRemoved: true,
      metadataBefore: before.markers,
      metadataAfter: after.markers,
      derivatives: [{ file: 'images/' + slug(p.file) + '.jpg',
                      width: encoded.width, height: encoded.height,
                      format: 'jpg', bytes: outBytes.length }],
      bytes: outBytes,
      sourceFile: p.file,
      sourceSize: { width: encoded.sourceWidth, height: encoded.sourceHeight },
      seen: p.seen || ''
    });
  }

  await browser.close();

  // ── WHAT IS STILL MISSING, SAID PLAINLY ──────────────────────────────────
  const installs = images.filter(i => i.role === 'installation');
  if (!installs.length) {
    notes.push('No INSTALLATION photographs are publishable. A photograph of a '
      + 'customer’s house needs their suburb and their consent recorded against it '
      + 'before it goes on a proposal, and none of these has either. The gallery is '
      + 'left out rather than filled with equipment shots.');
  }
  if (!images.some(i => i.role === 'hero')) {
    notes.push('There is no COVER photograph. Every one of these is portrait, and a '
      + 'cover wants a landscape shot of a finished job. The cover falls back to the '
      + 'brand panel until one is supplied.');
  }
  const noModel = images.filter(i => !(i.equipmentModels || []).length);
  if (noModel.length) {
    notes.push(noModel.length + ' of ' + images.length + ' photographs carry a brand but '
      + 'no model number — the compliance plate is not legible. They are matched to a '
      + 'quote by brand, which is what Nick asked for; a model number recorded later only '
      + 'makes the match sharper.');
  }

  const library = {
    _source: manifest._source,
    _generated: 'tools/import-nac-photos.mjs — re-encoded in Chromium and verified '
      + 'with scanMetadata(). Do not hand-edit; re-run the tool.',
    _notes: notes,
    images,
    refused
  };

  if (!check) {
    mkdirSync(DERIVED, { recursive: true });
    for (const i of images) writeFileSync(resolve(CONTENT, i.derivatives[0].file), i.bytes);
    for (const i of images) delete i.bytes;
    writeFileSync(OUT, JSON.stringify(library, null, 2) + '\n');
  } else {
    for (const i of images) delete i.bytes;
  }
  return library;
}

/**
 * Load the imported library.
 *
 * `inline: true` reads each derivative off disk and gives it a data: URI, for
 * a local preview that has to render without a storage bucket behind it. The
 * deployed application uploads the same files and carries https refs instead;
 * either way the presentation only ever sees `src`, and allowedRef() permits
 * exactly those two schemes and no other.
 */
export function loadNacImages({ inline = false } = {}) {
  let lib;
  try { lib = JSON.parse(readFileSync(OUT, 'utf8')); }
  catch { return { images: [], refused: [], _notes: [] }; }
  if (!inline) return lib;
  for (const i of lib.images) {
    for (const d of i.derivatives) {
      if (!d.file) continue;
      d.ref = 'data:image/jpeg;base64,'
        + readFileSync(resolve(CONTENT, d.file)).toString('base64');
    }
  }
  return lib;
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const check = process.argv.includes('--check');
  const lib = await importPhotos({ check });
  for (const i of lib.images) {
    console.log('  ok   ' + i.id.padEnd(36) + i.derivatives[0].width + '×'
      + i.derivatives[0].height + '  ' + Math.round(i.derivatives[0].bytes / 1024) + ' kB'
      + '  was: ' + (i.metadataBefore.length ? i.metadataBefore.join(',') : 'clean'));
  }
  for (const r of lib.refused) console.log('  REFUSED ' + r.file + ' — ' + r.reasons.join(', '));
  console.log('\n' + lib.images.length + ' imported, ' + lib.refused.length + ' refused'
    + (check ? '  (--check: nothing written)' : '  → designer/content/nac-images.json'));
  for (const note of lib._notes) console.log('\n  • ' + note);
}
