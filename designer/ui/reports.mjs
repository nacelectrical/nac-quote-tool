// NAC AI HVAC DESIGNER — PART 26: the two documents.
//
//   INTERNAL HVAC DESIGN SHEET     — everything, costing included. NAC only.
//   CUSTOMER HVAC DESIGN SUMMARY   — the system and what is included. No costs,
//                                    no margins, no internal engineering notes.
//
// Both come out of one document model (designer/engines/report-doc.mjs) and are
// rendered two ways: a print page, and a real PDF file written by
// designer/ui/report-pdf.mjs. There is no second copy of the content, so a
// supplier cost cannot find its way into a customer document by drifting.
//
// Two ways out, because one of them can always be blocked:
//   DOWNLOAD … PDF   builds the file in the page and saves it.
//   Save as PDF      the browser's own print path, for when a download is
//                    blocked or the estimator wants the OS print dialogue.

import { internalReportDoc, customerReportDoc, REPORT_KIND, docText } from '../engines/report-doc.mjs';
import { reportPageHtml } from './report-html.mjs';
import { renderReportPdf, reportFileName } from './report-pdf.mjs';
import { alertDialog } from './modal.mjs';
import { setPdfFonts, pdfFontsEmbedded } from './pdf-writer.mjs';
import { FONT_FILES } from './pdf-fonts.mjs';

export { internalReportDoc, customerReportDoc, REPORT_KIND, docText };

/**
 * FETCH THE TWO FACES SO THE PDF CAN CARRY THEM.
 *
 * `buildReportPdf` is synchronous — it is called from a click handler and from
 * tests — so it cannot wait for a font. This is the one place that does the
 * waiting, and it is idempotent: call it at boot and again before generating,
 * and the second call resolves from the same promise.
 *
 * If either face fails to load the writer stays on base-14 Helvetica. A
 * document that looks less good is better than a document that does not exist,
 * and `pdfFontsEmbedded()` says which one came out.
 */
let fontLoad = null;
export function loadPdfFonts() {
  if (fontLoad) return fontLoad;
  const get = (file) => fetch('/designer/vendor/fonts/' + file)
    .then(r => r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status + ' ' + file)))
    .then(b => new Uint8Array(b));
  fontLoad = Promise.all([get(FONT_FILES.regular), get(FONT_FILES.bold)])
    .then(([regular, bold]) => { setPdfFonts({ regular, bold }); return true; })
    .catch(() => { fontLoad = null; return false; });    // let a later call retry
  return fontLoad;
}
export { pdfFontsEmbedded };

/** PART 26 — INTERNAL HVAC DESIGN SHEET, as a print page. */
export function internalReportHtml(design, { logo = null, planSnapshot = null,
                                             planPlate = null, planLegend = null,
                                             equipmentInset = null } = {}) {
  return reportPageHtml(
    internalReportDoc(design, { planSnapshot, planPlate, planLegend, equipmentInset }),
    { logo });
}

/** PART 26 — CUSTOMER HVAC DESIGN SUMMARY, as a print page. */
export function customerReportHtml(design, { logo = null, planSnapshot = null } = {}) {
  return reportPageHtml(customerReportDoc(design, { planSnapshot }), { logo });
}

export function openReport(html, title) {
  const w = window.open('', '_blank');
  if (!w) {
    alertDialog({ title: 'The report could not open',
      message: 'This browser blocked the pop-up. Allow pop-ups for this site, then press ' +
               'Reports again to open the ' + title + '.' });
    return false;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  return true;
}

/** The PDF bytes and the name to save them under. Pure — no DOM. */
export function buildReportPdf(design, kind, { logo = null, planSnapshot = null,
                                               planPlate = null, planLegend = null,
                                               equipmentInset = null } = {}) {
  // The customer summary gets the plan and nothing else. The equipment inset is
  // an installer's drawing — collars, plenum faces, which main leaves which
  // spigot — and putting it in front of a customer invites questions the
  // summary is not written to answer.
  const doc = kind === REPORT_KIND.CUSTOMER
    ? customerReportDoc(design, { planSnapshot })
    : internalReportDoc(design, { planSnapshot, planPlate, planLegend, equipmentInset });
  return { bytes: renderReportPdf(doc, { logo }), filename: reportFileName(doc), doc };
}

/**
 * Build the PDF and save it.
 *
 * Returns { ok, filename } or { ok:false, error } — it never claims a download
 * happened that did not. If the browser refuses the save, the caller is told so
 * it can offer the print path instead.
 */
export function downloadReportPdf(design, kind, { logo = null, planSnapshot = null,
                                                  planPlate = null, planLegend = null,
                                                  equipmentInset = null } = {}) {
  let built;
  try {
    built = buildReportPdf(design, kind,
                           { logo, planSnapshot, planPlate, planLegend, equipmentInset });
  } catch (e) {
    return { ok: false, error: 'The PDF could not be built: ' + (e.message || e) };
  }
  try {
    const blob = new Blob([built.bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = built.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoked late: Safari reads the blob after the click returns.
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return { ok: true, filename: built.filename, bytes: built.bytes.length };
  } catch (e) {
    return { ok: false, error: 'The browser would not save the file: ' + (e.message || e) };
  }
}
