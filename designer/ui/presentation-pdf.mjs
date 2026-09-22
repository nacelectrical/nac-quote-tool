// ─────────────────────────────────────────────────────────────────────────────
// THE PRINTED PROPOSAL
//
// Nick: "The HTML presentation and PDF must use the same quote revision and
// must not disagree."
//
// The strongest way to guarantee that is not to compare two documents but to
// refuse to build a second one. So there is no PDF renderer here: this produces
// the SAME document from the SAME view model, with the web-only furniture
// removed, and the PDF is that document paginated. A number can only differ
// between the web page and the PDF if the view model changed underneath both,
// which is exactly when they SHOULD differ.
//
// What is dropped for print: the sticky total bar, the section navigation, the
// lightbox, the option checkboxes and the acceptance form. What is kept: every
// figure, the equipment, the inclusions, the zones, the room coverage, the
// selected options and the total.
// ─────────────────────────────────────────────────────────────────────────────

import { renderPresentationHtml } from './presentation-html.mjs';
import { esc } from './presentation-html.mjs';

/** The print document. Identical renderer, print mode. */
export function presentationPrintHtml(presentation) {
  return renderPresentationHtml(presentation, { mode: 'print' });
}

/**
 * Chromium page options for an A4 proposal.
 *
 * The footer is Chromium's, not CSS's, because "Page 3 of 9" needs the total
 * page count and no browser implements the CSS counter for it. Margins leave
 * room for that footer; the document's own `@page` rule sets the rest.
 */
export function pdfOptions(presentation, { brandName = '' } = {}) {
  const name = brandName || presentation?.brand?.name || '';
  const ref = [presentation?.hero?.proposalNumber, 'revision ' + presentation?.revision]
    .filter(Boolean).join(' · ');
  const foot =
    '<div style="width:100%;font-family:Helvetica,Arial,sans-serif;font-size:7.5pt;'
  + 'color:#6B7285;padding:0 12mm;display:flex;justify-content:space-between;">'
  + '<span>' + esc(name) + (ref ? ' &middot; ' + esc(ref) : '') + '</span>'
  + '<span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>'
  + '</div>';
  return {
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: foot,
    // Bottom margin clears the footer. The document's own @page rule supplies
    // the side margins; a second CSS footer on top of this one is what produced
    // overlapping text last time, so there is deliberately only the one.
    margin: { top: '12mm', bottom: '16mm', left: '0mm', right: '0mm' }
  };
}

/**
 * Render the proposal to PDF bytes with an already-open Playwright browser.
 *
 * Kept as a function taking a browser rather than launching one, so the same
 * code serves the test suite, the acceptance tooling and any future server
 * endpoint without three different launch policies.
 */
export async function renderPresentationPdf(browser, presentation, opts = {}) {
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    await page.setContent(presentationPrintHtml(presentation), { waitUntil: 'load' });
    // Give lazy images and web fonts a moment; print does not wait for them.
    await page.emulateMedia({ media: 'print' });
    await page.waitForTimeout(250);
    return await page.pdf(pdfOptions(presentation, opts));
  } finally {
    await ctx.close();
  }
}
