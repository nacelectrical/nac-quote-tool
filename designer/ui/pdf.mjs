// NAC AI HVAC DESIGNER — PDF plans.
//
// Builder plans arrive as PDFs, so this is the first thing an estimator does
// and it has to work on site. pdf.js is fetched on demand from whichever CDN
// answers first, rather than as one eager <script> that kills the upload path
// the moment a network blocks it.
//
// A plan set is usually several pages and the floor plan is rarely page 1, so
// the page count comes back with the render and the estimator can switch pages.

const VERSION = '3.11.174';

// Our own copy first — a plan has to open on a site with bad reception, behind
// a network that blocks CDNs, or with an ad blocker eating third-party
// scripts. The CDNs are only there in case the vendored files go missing.
const SOURCES = [
  { name: 'this site',  lib: '/designer/vendor/pdf.min.js',
    worker: '/designer/vendor/pdf.worker.min.js', timeout: 20000 },
  { name: 'cdnjs',      lib: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/' + VERSION + '/pdf.min.js',
    worker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/' + VERSION + '/pdf.worker.min.js' },
  { name: 'jsDelivr',   lib: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@' + VERSION + '/build/pdf.min.js',
    worker: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@' + VERSION + '/build/pdf.worker.min.js' },
  { name: 'unpkg',      lib: 'https://unpkg.com/pdfjs-dist@' + VERSION + '/build/pdf.min.js',
    worker: 'https://unpkg.com/pdfjs-dist@' + VERSION + '/build/pdf.worker.min.js' }
];

let loading = null;

function loadScript(src, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    let done = false;
    const finish = (fn, arg) => { if (!done) { done = true; clearTimeout(t); fn(arg); } };
    const t = setTimeout(() => { el.remove(); finish(reject, new Error('timed out')); }, timeoutMs);
    el.src = src;
    el.async = true;
    el.onload = () => finish(resolve);
    el.onerror = () => { el.remove(); finish(reject, new Error('blocked or unreachable')); };
    document.head.appendChild(el);
  });
}

/**
 * Load pdf.js once, trying each source in turn.
 * @param {(msg:string)=>void} [onProgress] told which source is being tried,
 *        so the estimator sees something rather than a frozen panel.
 */
export function ensurePdfJs(onProgress) {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (loading) return loading;

  loading = (async () => {
    const tried = [];
    for (const src of SOURCES) {
      try {
        onProgress?.(tried.length ? 'Loading the PDF reader from ' + src.name + '…' : 'Loading the PDF reader…');
        await loadScript(src.lib, src.timeout);
        if (!window.pdfjsLib) throw new Error('loaded but exported nothing');
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = src.worker;
        return window.pdfjsLib;
      } catch (e) {
        tried.push(src.name + ' (' + e.message + ')');
      }
    }
    loading = null;   // let a later attempt retry, e.g. once back on signal
    throw new Error('the PDF reader would not load — tried ' + tried.join(', '));
  })();

  return loading;
}

function toBytes(dataUrl) {
  const raw = atob(String(dataUrl).split(',')[1] || '');
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/**
 * Render one page of a PDF to a PNG data URL.
 *
 * Plans are read zoomed in, so this renders large — but capped, because a
 * 36 × 24 inch A1 sheet at 3× would exceed the canvas limit on an iPad and
 * come back blank.
 */
export async function renderPdfPage(dataUrl, pageNumber = 1, { maxPixels = 24e6, targetWidth = 3000, onProgress } = {}) {
  const pdfjs = await ensurePdfJs(onProgress);
  onProgress?.('Rendering page ' + pageNumber + '…');
  const doc = await pdfjs.getDocument({ data: toBytes(dataUrl) }).promise;
  const pageCount = doc.numPages;
  const n = Math.min(Math.max(1, Math.round(pageNumber)), pageCount);
  const page = await doc.getPage(n);

  const base = page.getViewport({ scale: 1 });
  let scale = Math.min(targetWidth / base.width, 4);
  if (base.width * scale * base.height * scale > maxPixels) {
    scale = Math.sqrt(maxPixels / (base.width * base.height));
  }
  scale = Math.max(scale, 1);

  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext('2d');
  // Plans are line drawings on white; without this the page renders on
  // transparent black and the drawing disappears.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;

  let url;
  try { url = canvas.toDataURL('image/png'); }
  catch (e) { throw new Error('The rendered page was too large for this device. Try a smaller PDF or export the page as an image.'); }

  return { dataUrl: url, pageNumber: n, pageCount, widthPx: canvas.width, heightPx: canvas.height };
}

/** How many pages a PDF has, without rendering any of them. */
export async function pdfPageCount(dataUrl) {
  const pdfjs = await ensurePdfJs();
  const doc = await pdfjs.getDocument({ data: toBytes(dataUrl) }).promise;
  return doc.numPages;
}
