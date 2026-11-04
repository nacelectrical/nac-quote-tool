// ─────────────────────────────────────────────────────────────────────────────
// THE PRINTABLE PROPOSAL
//
// Nick, 4 November 2026: "Rebuild the customer presentation inside the existing
// application... Make the actual customer URL work. Do not substitute a
// standalone Claude artifact or screenshot for the functioning proposal...
// Provide a clean printable or PDF version using the same offer data. Keep
// supplier costs, margins, internal fees and internal estimating notes out of
// the customer document."
//
// THE SAME OFFER DATA means the same presentation object, rendered twice by
// one renderer — not a second document built from a second source. Two
// renderings that can disagree is precisely the failure that put a static
// artifact in front of a customer in September, so these tests are mostly
// about the two agreeing.
// ─────────────────────────────────────────────────────────────────────────────

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderPresentationHtml } from '../designer/ui/presentation-html.mjs';
import { presentationPrintHtml, pdfOptions } from '../designer/ui/presentation-pdf.mjs';
import { buildTestQuote } from '../tools/quote-only-proof.mjs';

const { built } = buildTestQuote();
assert.ok(built.ok, 'the test quote must build before anything here means anything');
const P = built.presentation;

const WEB = renderPresentationHtml(P, { token: 'TESTQUOTE' });
const PRINT = presentationPrintHtml(P);

/** Which sections a rendering actually contains. */
const sectionsIn = (html) =>
  [...html.matchAll(/<section class="sec" id="([a-z]+)"/g)].map(m => m[1]);

// ── ONE OFFER, TWO RENDERINGS, NO DISAGREEMENT ──────────────────────────────

test('the printable version is built from the same presentation object', () => {
  // Not a claim about the output — a claim about the input. presentationPrintHtml
  // takes the presentation and nothing else, so there is no second source for
  // it to drift from.
  assert.equal(presentationPrintHtml.length, 1,
    'the print renderer must take the presentation and nothing else');
  assert.equal(PRINT, renderPresentationHtml(P, { mode: 'print' }),
    'the printable version is the same renderer in print mode');
});

test('every section of the offer is in both renderings', () => {
  const web = sectionsIn(WEB);
  const print = sectionsIn(PRINT);
  // The interactive-only sections are the exception, and they are named here
  // so that adding a third one has to be a decision rather than an accident.
  const INTERACTIVE_ONLY = ['options', 'accept'];
  const missing = web.filter(id => !print.includes(id) && !INTERACTIVE_ONLY.includes(id));
  assert.deepEqual(missing, [],
    'these sections are on the screen and not on paper: ' + missing.join(', '));
  const extra = print.filter(id => !web.includes(id));
  assert.deepEqual(extra, [], 'the printed version invented a section: ' + extra.join(', '));
});

test('the system chooser is on paper too, showing both prices', () => {
  // It is the one "interactive" block worth having printed: a customer
  // comparing two systems on paper needs both of them and the prices.
  assert.ok(sectionsIn(PRINT).includes('choose'));
  assert.ok(PRINT.includes('16,027') && PRINT.includes('14,553'));
});

test('the money is the same money on paper', () => {
  const total = '$' + Math.round(P.investment.totalIncGst).toLocaleString('en-AU');
  assert.ok(WEB.includes(total), 'the web page does not show ' + total);
  assert.ok(PRINT.includes(total), 'the printed page does not show ' + total);
  for (const figure of [P.investment.totalExGst, P.investment.totalGst,
                        P.investment.deposit && P.investment.deposit.amount]) {
    if (figure === null || figure === undefined) continue;
    const money = '$' + figure.toLocaleString('en-AU',
      { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    assert.equal(WEB.includes(money), PRINT.includes(money),
      money + ' is on one of the two documents and not the other');
  }
});

test('which promise the price is appears on both', () => {
  assert.ok(P.investment.firmness, 'a quote-only proposal states its firmness');
  const label = P.investment.firmness.label + '.';
  assert.ok(WEB.includes(label), 'the web page does not say "' + label + '"');
  assert.ok(PRINT.includes(label), 'the printed page does not say "' + label + '"');
});

// ── NOTHING TO PRESS ON PAPER ───────────────────────────────────────────────

test('the printed version carries no controls at all', () => {
  for (const control of ['<input', '<button', '<script', 'class="nav"',
                         'class="sticky"', 'data-print', 'id="acceptBtn"',
                         'id="lightbox"']) {
    assert.ok(!PRINT.includes(control),
      '"' + control + '" is on a document somebody is going to print');
  }
});

test('the web page offers a way to take a copy away', () => {
  assert.ok(WEB.includes('data-print'), 'there is no print control on the customer page');
  assert.ok(WEB.includes('Save or print a copy'));
  // And printing the web page drops what cannot be pressed on paper.
  assert.match(WEB, /@media print\{[\s\S]*\.nav,\.sticky,\.accept,\.printbar/,
    'printing the web page does not drop the interactive furniture');
});

test('the PDF footer names the proposal and numbers the pages', () => {
  const o = pdfOptions(P, { brandName: 'NAC Electrical Air & Refrigeration' });
  assert.equal(o.format, 'A4');
  assert.equal(o.printBackground, true);
  assert.ok(o.footerTemplate.includes('pageNumber'));
  assert.ok(o.footerTemplate.includes('totalPages'),
    '"Page 3 of 9" needs the total, which no CSS counter provides');
  assert.ok(o.footerTemplate.includes(P.hero.proposalNumber));
});

// ── NOTHING INTERNAL, ON EITHER ─────────────────────────────────────────────

test('no supplier cost, margin, markup, fee or internal note is on either document', () => {
  for (const [name, doc] of [['the web page', WEB], ['the printed page', PRINT]]) {
    for (const leak of ['supplierCost', 'supplier cost', 'markupPct', 'marginPct',
                        'grossProfit', 'jobFee', 'job fee', 'MMEM',
                        'Trade Price List', 'placeholder rate', 'priceBasis',
                        'feeBaseExGst', 'totalJobCost']) {
      assert.ok(!doc.includes(leak), '"' + leak + '" is on ' + name);
    }
  }
});

test('a test quote says so on both, because it is indistinguishable otherwise', () => {
  assert.ok(P.testQuote, 'the proof fixture is a test quote');
  assert.ok(WEB.includes('TEST QUOTE'), 'the web page is not labelled');
  assert.ok(PRINT.includes('TEST QUOTE'), 'the printed page is not labelled');
});

// ── THE CUSTOMER PAGE IS THE APPLICATION'S, NOT A STATIC FILE ───────────────

test('the customer page is served by the application and reads its token from the fragment', async () => {
  // Nick: "Make the actual customer URL work. Do not substitute a standalone
  // Claude artifact or screenshot for the functioning proposal." So quote.html
  // has to be a real page that fetches a real endpoint, not a saved document.
  const src = await (await import('node:fs/promises')).readFile(
    new URL('../quote.html', import.meta.url), 'utf8');
  assert.ok(src.includes('/api/quote-view'),
    'the customer page must ask the server for the proposal');
  assert.ok(src.includes('location.hash'),
    'the token belongs in the fragment, so it never reaches an access log');
  // And it carries no offer of its own. It reads figures OUT of the server's
  // answer — that is what `investment.totalIncGst` is doing in there — but no
  // price, model or brand is written into the file.
  for (const leak of ['Daikin', 'Braemar', 'Mitsubishi', '$1', 'FDYAN', 'kW']) {
    assert.ok(!src.includes(leak),
      '"' + leak + '" is baked into the customer page — it must come from the server');
  }
  assert.ok(!/renderPresentationHtml\(\s*\{/.test(src),
    'the page must render the server\u2019s view model, never one of its own');
});
