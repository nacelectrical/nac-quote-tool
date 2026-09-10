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
