// NAC AI HVAC DESIGNER — image preparation for the plan reader.
//
// The plan on screen is rendered large (a PDF page comes in around 3000 px
// wide) so the estimator can zoom into dimension text. That is far more than
// the reader needs, and more than a serverless request body will carry, so the
// copy sent for reading is downscaled.
//
// Everything the reader returns is in the pixels of the image it was given, so
// the scale factor is returned with it and every box must be scaled back to the
// full-resolution page before it is used on the canvas.

/** Longest edge, in pixels, of the copy sent to the plan reader. */
export const READ_MAX_EDGE = 1600;

/**
 * Downscale a data URL so its longest edge is at most `maxEdge`.
 * Returns the image unchanged (scale 1) when it is already small enough.
 *
 * @returns {Promise<{dataUrl:string, width:number, height:number, scale:number}>}
 *          `scale` multiplies a returned coordinate back to the original image.
 */
export function downscaleDataUrl(dataUrl, maxEdge = READ_MAX_EDGE, { force = false } = {}) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth, h = img.naturalHeight;
      if (!w || !h) return reject(new Error('the image has no dimensions'));
      const longest = Math.max(w, h);
      // `force` re-encodes even an image that is already small enough, which
      // is what a HEIC off an iPhone needs: the size is fine, the format is
      // one the reader will not take.
      if (longest <= maxEdge && !force) {
        return resolve({ dataUrl, width: w, height: h, scale: 1 });
      }

      const factor = Math.min(1, maxEdge / longest);
      const cw = Math.max(1, Math.round(w * factor));
      const ch = Math.max(1, Math.round(h * factor));
      const canvas = document.createElement('canvas');
      canvas.width = cw; canvas.height = ch;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      // A plan is line work on white; without this a transparent PNG reads as
      // black lines on black.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, cw, ch);
      ctx.drawImage(img, 0, 0, cw, ch);
      // JPEG at high quality: a quarter the bytes of PNG for the same legibility.
      resolve({ dataUrl: canvas.toDataURL('image/jpeg', 0.92),
                width: cw, height: ch, scale: w / cw });
    };
    img.onerror = () => reject(new Error('the image could not be decoded'));
    img.src = dataUrl;
  });
}

/** Scale one box back to the full-resolution page. */
export function scaleBox(b, scale) {
  if (!b || scale === 1) return b;
  return { x: b.x * scale, y: b.y * scale, w: b.w * scale, h: b.h * scale };
}

/**
 * Scale every box in a reader response back to the full-resolution page, so the
 * rest of the application only ever deals in page pixels.
 */
export function scaleObservations(obs, scale) {
  if (!obs || scale === 1) return obs;
  const list = (arr) => (arr || []).map(o => ({ ...o, box: scaleBox(o.box, scale) }));
  return {
    ...obs,
    detections: list(obs.detections),
    openings: list(obs.openings),
    walls: list(obs.walls),
    roomLabels: list(obs.roomLabels)
  };
}

// ── Tiling ─────────────────────────────────────────────────────────────────
//
// Dimension text on an Australian builder's plan is around 2–3 mm high. Shrink
// an A3 sheet to fit one request and those digits fall to a handful of pixels —
// the reader then guesses, and a guessed digit is a wrong room.
//
// So the plan is cut into overlapping tiles read at close to full resolution
// instead. Each tile comes back in its own pixel space and is translated to
// page pixels on arrival. The overlap means a number straddling a tile edge is
// whole in at least one tile; the duplicate it creates is merged out.

/** Longest edge of a single tile sent to the reader. */
export const TILE_MAX_EDGE = 1400;
/** How much neighbouring tiles overlap, as a fraction of the tile. */
export const TILE_OVERLAP = 0.18;

/** Positions of the tiles covering a page, in page pixels. */
export function planTileGrid(width, height, { maxEdge = TILE_MAX_EDGE, overlap = TILE_OVERLAP } = {}) {
  if (!width || !height) return [];
  // One tile when the page already fits — no seams, no duplicates to merge.
  if (Math.max(width, height) <= maxEdge) {
    return [{ col: 0, row: 0, x: 0, y: 0, w: width, h: height, scale: 1 }];
  }

  // Tiles are square-ish in page pixels and sized so each one renders at or
  // below maxEdge without being scaled down.
  const cols = Math.max(1, Math.ceil(width / maxEdge));
  const rows = Math.max(1, Math.ceil(height / maxEdge));
  const tileW = width / cols, tileH = height / rows;
  const padX = tileW * overlap, padY = tileH * overlap;

  const tiles = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = Math.max(0, Math.round(col * tileW - padX));
      const y = Math.max(0, Math.round(row * tileH - padY));
      const x2 = Math.min(width, Math.round((col + 1) * tileW + padX));
      const y2 = Math.min(height, Math.round((row + 1) * tileH + padY));
      tiles.push({ col, row, x, y, w: x2 - x, h: y2 - y, scale: 1 });
    }
  }
  return tiles;
}

/**
 * Cut a page into the tiles `planTileGrid` describes, each rendered at up to
 * `maxEdge` on its longest side. A tile's `scale` multiplies a coordinate the
 * reader returns back to tile pixels; `x`/`y` then translate it to the page.
 */
export function tilePlan(dataUrl, opts = {}) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const W = img.naturalWidth, H = img.naturalHeight;
      if (!W || !H) return reject(new Error('the image has no dimensions'));
      const maxEdge = opts.maxEdge ?? TILE_MAX_EDGE;
      const grid = planTileGrid(W, H, opts);
      const out = grid.map(t => {
        const factor = Math.min(1, maxEdge / Math.max(t.w, t.h));
        const cw = Math.max(1, Math.round(t.w * factor));
        const ch = Math.max(1, Math.round(t.h * factor));
        const canvas = document.createElement('canvas');
        canvas.width = cw; canvas.height = ch;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, cw, ch);
        ctx.drawImage(img, t.x, t.y, t.w, t.h, 0, 0, cw, ch);
        return { ...t, width: cw, height: ch, scale: t.w / cw,
                 dataUrl: canvas.toDataURL('image/jpeg', 0.92) };
      });
      resolve({ pageWidth: W, pageHeight: H, tiles: out });
    };
    img.onerror = () => reject(new Error('the image could not be decoded'));
    img.src = dataUrl;
  });
}

/** Move one box from a tile's pixels into page pixels. */
export function boxToPage(b, tile) {
  if (!b) return b;
  return { x: tile.x + b.x * tile.scale, y: tile.y + b.y * tile.scale,
           w: b.w * tile.scale, h: b.h * tile.scale };
}

function overlaps(a, b, slack = 0.5) {
  if (!a || !b) return false;
  const ax2 = a.x + a.w, ay2 = a.y + a.h, bx2 = b.x + b.w, by2 = b.y + b.h;
  const ix = Math.min(ax2, bx2) - Math.max(a.x, b.x);
  const iy = Math.min(ay2, by2) - Math.max(a.y, b.y);
  if (ix <= 0 || iy <= 0) return false;
  const inter = ix * iy;
  return inter >= slack * Math.min(a.w * a.h, b.w * b.h);
}

/**
 * Merge per-tile observations into one page-space set.
 *
 * An item seen in the overlap between two tiles appears twice, so a later item
 * is dropped when it carries the same text and covers the same place. Items
 * that overlap but disagree on the text are BOTH kept — two tiles reading the
 * same number differently is exactly the sort of thing the estimator has to see,
 * not something to silently pick a winner for.
 */
export function mergeTileObservations(results) {
  const merged = { detections: [], openings: [], walls: [], roomLabels: [],
                   scaleLabelText: null, overallDimensions: { widthText: null, depthText: null } };
  const notes = [];
  const conflicts = [];
  let n = 0;

  const push = (listName, items, tile, keyed) => {
    for (const item of items || []) {
      const box = boxToPage(item.box, tile);
      const same = merged[listName].find(e => overlaps(e.box, box));
      if (same) {
        const a = (same.text || '').trim(), b = (item.text || '').trim();
        if (!keyed || a === b) continue;                 // the same thing, seen twice
        conflicts.push({ box, a, b });                   // read differently — keep both
      }
      merged[listName].push({ ...item, id: listName[0] + (++n), box, tile: tile.col + ',' + tile.row });
    }
  };

  for (const { tile, data } of results) {
    const obs = data?.observations || {};
    push('detections', obs.detections, tile, true);
    push('roomLabels', obs.roomLabels, tile, true);
    push('openings', obs.openings, tile, false);
    push('walls', obs.walls, tile, false);
    if (!merged.scaleLabelText && obs.scaleLabelText) merged.scaleLabelText = obs.scaleLabelText;
    const od = obs.overallDimensions || {};
    if (!merged.overallDimensions.widthText && od.widthText) merged.overallDimensions.widthText = od.widthText;
    if (!merged.overallDimensions.depthText && od.depthText) merged.overallDimensions.depthText = od.depthText;
    for (const note of data?.notes || []) if (!notes.includes(note)) notes.push(note);
  }

  for (const c of conflicts) {
    notes.push('Two passes over the same spot read "' + c.a + '" and "' + c.b +
               '". Both are listed — check them against the drawing.');
  }

  const qualities = results.map(r => r.data?.quality).filter(Boolean);
  const quality = qualities.includes('poor') ? 'poor'
    : qualities.includes('fair') ? 'fair' : (qualities[0] || 'fair');

  return { observations: merged, notes, quality, conflictCount: conflicts.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// A PLAN AS THE APPLICATION CAN ACTUALLY HOLD IT
//
// A floor plan photographed on a phone arrives at 12 to 48 megapixels. Held at
// that size it is megabytes of base64 on the design record, tens of megabytes
// of decoded bitmap in memory, and — past about 16.7 million pixels — a canvas
// iOS Safari will not draw at all. The plan then "will not upload", with
// nothing on screen to say why.
//
// Nothing needs that resolution. A dimension printed on a builder's sheet is
// legible at a fraction of it, and every measurement in this application is
// taken from the calibrated scale rather than from the pixels themselves.
// ─────────────────────────────────────────────────────────────────────────────

/** The long edge a plan is held at. Generous: printed text stays readable. */
export const MAX_PLAN_EDGE_PX = 2600;

/**
 * Well under the iOS canvas ceiling (~16.7 Mpx), with room for the drawing
 * surface the viewer puts on top of it.
 */
export const MAX_PLAN_PIXELS = 8_000_000;

/** Decode a data URL, or reject with something a person can act on. */
function decode(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      if (!img.naturalWidth || !img.naturalHeight) {
        reject(new Error('the image could not be decoded — if it came off an iPhone it may ' +
                         'be a HEIC file; send it as a JPG, or set Camera → Formats to ' +
                         '"Most Compatible"'));
        return;
      }
      resolve(img);
    };
    img.onerror = () => reject(new Error('the image could not be decoded — if it came off an ' +
                                         'iPhone it may be a HEIC file; send it as a JPG'));
    img.src = src;
  });
}

/**
 * Scale a plan image down to something every device can open.
 *
 * Returns the image unchanged when it is already small enough, so nothing is
 * re-encoded — and therefore nothing is degraded — without cause.
 *
 * @returns {Promise<{dataUrl:string,width:number,height:number,
 *                    sourceWidth:number,sourceHeight:number,downscaled:boolean}>}
 */
export async function preparePlanImage(dataUrl, opts = {}) {
  const maxEdge = Number(opts.maxEdge) || MAX_PLAN_EDGE_PX;
  const maxPixels = Number(opts.maxPixels) || MAX_PLAN_PIXELS;
  const img = await decode(dataUrl);
  const w = img.naturalWidth, h = img.naturalHeight;

  const edgeScale = Math.min(1, maxEdge / Math.max(w, h));
  const areaScale = Math.min(1, Math.sqrt(maxPixels / (w * h)));
  const scale = Math.min(edgeScale, areaScale);

  if (scale >= 1) {
    return { dataUrl, width: w, height: h, sourceWidth: w, sourceHeight: h, downscaled: false };
  }

  const tw = Math.max(1, Math.round(w * scale));
  const th = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = tw; canvas.height = th;
  const ctx = canvas.getContext('2d');
  // A plan is line work; a smooth downscale keeps thin lines and printed
  // dimensions legible where a nearest-neighbour one drops them entirely.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, tw, th);

  let out;
  try {
    out = canvas.toDataURL('image/jpeg', 0.92);
  } catch (e) {
    // A tainted or over-large canvas. Better the original than nothing.
    return { dataUrl, width: w, height: h, sourceWidth: w, sourceHeight: h, downscaled: false };
  }
  return { dataUrl: out, width: tw, height: th,
           sourceWidth: w, sourceHeight: h, downscaled: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// GETTING A PLAN INTO SOMETHING THE READER CAN ACTUALLY BE SENT
//
// Nick, 5 November 2026: "The plan could not be read: Load failed."
//
// "Load failed" is Safari's words for a fetch that never completed. The quote
// builder was posting the uploaded file WHOLE, as base64 inside a JSON body —
// no downscale, none of the preparation in this very module — and base64 adds
// a third again on top. A plan photographed on a phone, or a builder's PDF, is
// several megabytes before that. A serverless request body is capped at about
// four and a half, so the request died at the edge and the browser reported a
// network failure with nothing useful in it.
//
// A PDF had a second problem of its own: iOS will not render one in an iframe
// from a data URL, which is why the plan showed as a black rectangle on Nick's
// phone. Rendering page one to an image fixes the preview and the request
// together, and pdf.js has been sitting vendored and unused in this repository
// since the designer was removed.
// ─────────────────────────────────────────────────────────────────────────────

/** Where the vendored pdf.js lives, served straight from the static site. */
const PDFJS_SRC = '/designer/vendor/pdf.min.js';
const PDFJS_WORKER = '/designer/vendor/pdf.worker.min.js';

let pdfjsPromise = null;
function loadPdfJs() {
  if (pdfjsPromise) return pdfjsPromise;
  pdfjsPromise = new Promise((resolve, reject) => {
    if (window.pdfjsLib) return resolve(window.pdfjsLib);
    const s = document.createElement('script');
    s.src = PDFJS_SRC;
    s.onload = () => {
      const lib = window.pdfjsLib;
      if (!lib) return reject(new Error('pdf.js loaded but exported nothing'));
      try { lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; } catch (e) { /* ignore */ }
      resolve(lib);
    };
    s.onerror = () => reject(new Error('pdf.js could not be loaded'));
    document.head.appendChild(s);
  }).catch((e) => { pdfjsPromise = null; throw e; });
  return pdfjsPromise;
}

const base64Of = (dataUrl) => String(dataUrl || '').split(',')[1] || '';

/**
 * Render one page of a PDF to a JPEG data URL, at most `maxEdge` across.
 *
 * @returns {Promise<{dataUrl:string,width:number,height:number,pages:number}>}
 */
export async function renderPdfPage(dataUrl, page = 1, maxEdge = READ_MAX_EDGE) {
  const lib = await loadPdfJs();
  const bytes = Uint8Array.from(atob(base64Of(dataUrl)), c => c.charCodeAt(0));
  const doc = await lib.getDocument({ data: bytes }).promise;
  const n = Math.min(Math.max(1, Math.round(page) || 1), doc.numPages);
  const pg = await doc.getPage(n);

  const base = pg.getViewport({ scale: 1 });
  // Render AT the size it will be sent, rather than rendering large and
  // shrinking: a plan is line work, and resampling thin lines twice is how
  // printed dimension text stops being legible.
  const scale = Math.min(4, maxEdge / Math.max(base.width, base.height));
  const viewport = pg.getViewport({ scale: scale > 0 ? scale : 1 });

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  const ctx = canvas.getContext('2d');
  // A PDF page is transparent where nothing is drawn. Without this the plan
  // reads as black lines on black.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await pg.render({ canvasContext: ctx, viewport }).promise;

  return { dataUrl: canvas.toDataURL('image/jpeg', 0.92),
           width: canvas.width, height: canvas.height, pages: doc.numPages };
}

/**
 * The copy of a plan that gets SENT: an image, small enough to post.
 *
 * A PDF becomes a rendered page. An image is downscaled. Anything already
 * small enough is left alone, because re-encoding a plan that did not need it
 * only costs legibility.
 *
 * @returns {Promise<{dataUrl, mediaType, width, height, pages, fromPdf, bytes}>}
 */
export async function planToReadableImage(plan, { maxEdge = READ_MAX_EDGE } = {}) {
  const src = plan && plan.src;
  if (!src) throw new Error('there is no plan to read');
  const isPdf = String(plan.mediaType || '').toLowerCase().includes('pdf')
    || /^data:application\/pdf/i.test(src);

  // HEIC is what an iPhone hands over by default and is not a format the
  // reader accepts, so it is re-encoded even when it is already small. The
  // browser can decode it — it is Apple's own device — and a canvas only ever
  // writes PNG or JPEG back out.
  const heic = /^data:image\/hei[cf]/i.test(src)
    || /hei[cf]/i.test(String(plan.mediaType || ''));
  const out = isPdf
    ? await renderPdfPage(src, plan.page || 1, maxEdge)
    : await downscaleDataUrl(src, heic ? Math.min(maxEdge, READ_MAX_EDGE) : maxEdge,
                             { force: heic });

  // The media type is read off the result rather than asserted: downscaleDataUrl
  // returns the ORIGINAL untouched when it is already small enough, and
  // claiming image/jpeg for a PNG — or worse, for the HEIC an iPhone hands
  // over, which the reader cannot accept at all — is how a request that was
  // the right size gets rejected for the wrong reason.
  const declared = (String(out.dataUrl).match(/^data:([^;,]+)/) || [])[1] || 'image/jpeg';

  return {
    dataUrl: out.dataUrl,
    mediaType: declared,
    width: out.width,
    height: out.height,
    pages: out.pages || 1,
    fromPdf: isPdf,
    // What the request body will actually weigh, so a caller can refuse
    // BEFORE the network does and say something useful about it.
    bytes: base64Of(out.dataUrl).length
  };
}
