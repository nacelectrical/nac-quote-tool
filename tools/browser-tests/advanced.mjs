// QUICK QUOTE MODE is the designer's default, and it deliberately hides the
// thirteen engineering tabs — that is the whole point of it.
//
// These suites test those engineering screens, so they have to ask for them the
// same way an estimator would: press ADVANCED DESIGN. Anything that reaches for
// `button.tab` without this is testing a screen the default user never sees.

/** Switch the designer into ADVANCED DESIGN if it is not already there. */
export async function ensureAdvanced(page) {
  if (await page.locator('button.tab').count()) return;
  const btn = page.locator('button', { hasText: 'ADVANCED DESIGN' }).first();
  if (await btn.count()) {
    await btn.click();
    await page.waitForTimeout(400);
  }
}
