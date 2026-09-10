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
export function downscaleDataUrl(dataUrl, maxEdge = READ_MAX_EDGE) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth, h = img.naturalHeight;
      if (!w || !h) return reject(new Error('the image has no dimensions'));
      const longest = Math.max(w, h);
      if (longest <= maxEdge) return resolve({ dataUrl, width: w, height: h, scale: 1 });

      const factor = maxEdge / longest;
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
