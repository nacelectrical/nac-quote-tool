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

export { internalReportDoc, customerReportDoc, REPORT_KIND, docText };

/** PART 26 — INTERNAL HVAC DESIGN SHEET, as a print page. */
export function internalReportHtml(design, { logo = null, planSnapshot = null } = {}) {
  return reportPageHtml(internalReportDoc(design, { planSnapshot }), { logo });
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
export function buildReportPdf(design, kind, { logo = null, planSnapshot = null } = {}) {
  const doc = kind === REPORT_KIND.CUSTOMER
    ? customerReportDoc(design, { planSnapshot })
    : internalReportDoc(design, { planSnapshot });
  return { bytes: renderReportPdf(doc, { logo }), filename: reportFileName(doc), doc };
}

/**
 * Build the PDF and save it.
 *
 * Returns { ok, filename } or { ok:false, error } — it never claims a download
 * happened that did not. If the browser refuses the save, the caller is told so
 * it can offer the print path instead.
 */
export function downloadReportPdf(design, kind, { logo = null, planSnapshot = null } = {}) {
  let built;
  try {
    built = buildReportPdf(design, kind, { logo, planSnapshot });
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
