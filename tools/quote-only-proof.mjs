// ─────────────────────────────────────────────────────────────────────────────
// THE TEST QUOTE, FOR NICK TO LOOK AT
//
// Nick, 16 October 2026: "Create a clearly labelled test quote. Do not use the
// Kauri Crescent job and do not use any real client contact details... Provide
// the finished result for my visual review before production deployment or
// sending any real customer quote."
//
// This builds that quote through the REAL path — the quote draft, the real
// gates, the real content (NAC's own photographs and NAC's own approved Google
// reviews), the real presentation builder and the real renderer — and
// photographs the result on a laptop, an iPad and a phone.
//
// Nothing here is a mock-up. The only things that differ from a quote going to
// a customer are that the customer is openly a test, the page says TEST QUOTE
// across the top of every surface, and the images are inlined because this
// runs without the storage bucket behind it.
//
//   node tools/quote-only-proof.mjs [outDir]
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { quoteOnlyDraft, quoteOnlyContent, UPGRADES, SETTINGS }
  from '../tests/fixtures/quote-only.mjs';
import { draftToQuoteSource, draftSelectedOptions, quoteDraftGate }
  from '../designer/engines/quote-draft.mjs';
import { buildPresentation } from '../designer/engines/presentation.mjs';
import { renderPresentationHtml } from '../designer/ui/presentation-html.mjs';
import { presentationPrintHtml, pdfOptions } from '../designer/ui/presentation-pdf.mjs';
import { loadNacImages } from './import-nac-photos.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const OUT = process.argv[2] || resolve(ROOT, 'proof');
mkdirSync(OUT, { recursive: true });

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PLAYWRIGHT = '/opt/node-tools/node_modules/playwright/index.js';

const SIZES = [
  ['laptop', 1440, 1000],
  ['ipad', 820, 1180],
  ['phone', 390, 844]
];

/** NAC's own logo, as the content library holds it. */
function nacLogo() {
  try {
    return 'data:image/jpeg;base64,'
      + readFileSync(resolve(ROOT, 'nac-logo.jpg')).toString('base64');
  } catch { return null; }
}

/**
 * @param {object} extraContent library fields to lay over NAC's own, so a
 *   caller can prove something that needs content this fixture does not carry
 *   — a manufacturer brochure, say. Everything else stays NAC's real content.
 * @param {object} draftOver draft fields to lay over the fixture's, for the
 *   same reason: a check that needs a zone control paired with a picture, say.
 *   Shallow, so a replaced section is replaced whole.
 */
export function buildTestQuote(extraContent = {}, draftOver = {}) {
  const draft = quoteOnlyDraft({ testQuote: true, ...draftOver });

  // NAC's nine photographs, imported through tools/import-nac-photos.mjs:
  // re-encoded in Chromium and verified clean by scanMetadata().
  const lib = loadNacImages({ inline: true });
  const images = lib.images.map(i => ({
    ...i, src: i.derivatives[0].ref,
    width: i.derivatives[0].width, height: i.derivatives[0].height
  }));

  // NAC's real Google reviews — the three that do not name Nick. The nine
  // that do are withheld on his instruction and are not loaded here at all.
  const reviewFile = JSON.parse(
    readFileSync(resolve(ROOT, 'designer/content/google-reviews.json'), 'utf8'));
  const reviews = reviewFile.reviews.map(r => ({ ...r, approved: true }));

  const content = quoteOnlyContent({ logo: nacLogo(), images, reviews,
    ...extraContent });
  const gate = quoteDraftGate(draft, { upgrades: UPGRADES });
  const src = draftToQuoteSource(draft, { upgrades: UPGRADES });

  const built = buildPresentation({
    design: src,
    customer: draft.customer,
    job: { siteAddress: draft.siteAddress },
    content, settings: SETTINGS,
    proposalNumber: draft.proposalNumber,
    revision: 1, status: 'issued',
    preparedAt: '2026-10-16T00:00:00Z',
    expiresAt: '2026-11-15T00:00:00Z',
    systemOptions: src.systemOptions,
    chosenSystemId: src.chosenSystemId,
    selectedOptionIds: draftSelectedOptions(draft, { upgrades: UPGRADES }),
    intro: draft.intro,
    testQuote: true
  });

  return { draft, content, gate, built, reviewCount: reviews.length,
           imageCount: images.length,
           ownCount: images.filter(i => i.ownWork === true).length };
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const { draft, gate, built, reviewCount, imageCount, ownCount } = buildTestQuote();

  console.log('draft gate: ' + (gate.ok ? 'passes' : 'BLOCKED'));
  for (const b of gate.blockers) console.log('   BLOCK ' + b.code + ' — ' + b.message);
  for (const w of gate.warnings) console.log('   note  ' + w.code);
  if (!built.ok) {
    for (const b of built.blockers) console.log('   BLOCK ' + b.code + ' — ' + b.message);
    process.exit(1);
  }

  const p = built.presentation;
  const html = renderPresentationHtml(p, { token: 'TESTQUOTE' });
  const file = resolve(OUT, 'test-quote.html');
  writeFileSync(file, html);

  console.log('\n  customer   ' + p.hero.customerName);
  console.log('  property   ' + p.hero.siteAddress);
  console.log('  proposal   ' + p.hero.proposalNumber + ', revision ' + p.revision);
  console.log('  system     ' + p.system.brand + ' ' + p.system.capacityKw + ' kW');
  console.log('  total      $' + p.investment.totalIncGst.toFixed(2) + ' including GST');
  console.log('  of which   $' + p.investment.totalGst.toFixed(2) + ' GST');
  console.log('  deposit    $' + p.investment.deposit.amount.toFixed(2)
    + ' (' + p.investment.deposit.percent + '%)');
  // "16 of NAC's own" was true when the library held only NAC's own work and
  // false the moment manufacturer product images were added to it. The split
  // is reported, because the difference is the whole basis of the gallery.
  console.log('  photos     ' + imageCount + ' in the library ('
    + ownCount + ' of NAC’s own work, ' + (imageCount - ownCount) + ' supplied), '
    + (p.system.image ? 'one matched to the Daikin' : 'none matched'));
  console.log('  zone ctrl  ' + (p.zones && p.zones.controllerImage
    ? 'picture paired by hand' : 'no picture — none is paired with this kit'));
  console.log('  reviews    ' + reviewCount + ' approved, '
    + p.reviews.filter(r => r.rating === null).length + ' with no star rating recorded');
  console.log('  labelled   ' + (p.testQuote ? 'TEST QUOTE' : 'NOT LABELLED'));
  console.log('\n  wrote ' + file + '  (' + Math.round(html.length / 1024) + ' kB)');

  const pw = await import(PLAYWRIGHT);
  const chromium = pw.chromium || pw.default.chromium;
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  for (const [name, width, height] of SIZES) {
    const page = await browser.newPage({ viewport: { width, height },
                                         deviceScaleFactor: 2 });
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto('file://' + file, { waitUntil: 'load' });
    await page.waitForTimeout(600);
    const shot = resolve(OUT, 'test-quote-' + name + '.png');
    await page.screenshot({ path: shot, fullPage: true });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1);
    const tall = await page.evaluate(() => document.documentElement.scrollHeight);
    console.log('  ' + name.padEnd(7) + width + '×' + height
      + '   page ' + tall + 'px'
      + '   sideways scroll: ' + (overflow ? 'YES — a defect' : 'none')
      + (errs.length ? '   ERRORS: ' + errs.join(' | ') : '   no js errors'));
    await page.close();
  }

  // ── THE PRINTABLE VERSION, FROM THE SAME OFFER ────────────────────────
  //
  // Nick, 4 November 2026: "Provide a clean printable or PDF version using the
  // same offer data." The same presentation object the web page was rendered
  // from, so the paper copy cannot be a different offer — and it is produced
  // here so it can be LOOKED AT rather than assumed.
  const printFile = resolve(OUT, 'test-quote-print.html');
  writeFileSync(printFile, presentationPrintHtml(p));
  const pp = await browser.newPage({ viewport: { width: 1240, height: 1754 } });
  await pp.goto('file://' + printFile, { waitUntil: 'load' });
  await pp.emulateMedia({ media: 'print' });
  await pp.waitForTimeout(400);
  const pdfFile = resolve(OUT, 'test-quote.pdf');
  const pdf = await pp.pdf(pdfOptions(p));
  writeFileSync(pdfFile, pdf);
  await pp.screenshot({ path: resolve(OUT, 'test-quote-print.png'), fullPage: true });

  // What must NOT be on paper: the interactive furniture, and anything
  // internal. The leak sweep in tests/ checks the figures; this checks the
  // document a customer would actually hold.
  const printed = presentationPrintHtml(p);
  const strays = ['data-print', 'class="nav"', 'class="sticky"', 'id="acceptBtn"',
                  'supplierCost', 'markupPct', 'marginPct', 'grossProfit', 'MMEM']
    .filter(x => printed.includes(x));
  console.log('\n  printable  ' + printFile);
  console.log('  pdf        ' + pdfFile + '  ('
    + Math.round(pdf.length / 1024) + ' kB)');
  console.log('  clean      ' + (strays.length
    ? 'NO — found ' + strays.join(', ') : 'yes — no controls and nothing internal'));
  await pp.close();
  await browser.close();
}
