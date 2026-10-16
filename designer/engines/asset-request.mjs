// ─────────────────────────────────────────────────────────────────────────────
// WHAT NAC STILL HAS TO SUPPLY
//
// The brief: "If genuine assets are missing, deliver the functioning upload
// flow and an exact asset request list specifying what Nicholas must provide,
// required associations and where each item will appear."
//
// So this is not a checklist somebody typed. It reads the actual content
// library and the actual quote, and says what is missing, what it is for, and
// which section of the customer's page goes dark without it.
//
// TWO KINDS OF MISSING, and they are not the same conversation:
//
//   ESSENTIAL   the proposal cannot go to a customer without it. A quote with
//               no logo and no terms is not a NAC quote.
//   OPTIONAL    the section hides cleanly. The proposal is still sendable; it
//               is just thinner than it could be. Nick: never show an empty
//               card or a broken image as though it were finished.
//
// Nothing here invents a photograph, a review, a warranty or a credential. It
// says what is absent and leaves the supplying to the people who have it.
// ─────────────────────────────────────────────────────────────────────────────

import { normaliseImageAsset, imagePublishable, reviewPublishable,
         installationPublishable, IMAGE_ROLES, equipmentImagesFor,
         seedTermsAndConditions } from './presentation-content.mjs';

const list = (v) => Array.isArray(v) ? v : [];
const trimmed = (v) => (v === null || v === undefined) ? '' : String(v).trim();

export const NEED = Object.freeze({ ESSENTIAL: 'essential', OPTIONAL: 'optional' });

function item(level, id, what, why, where, howMany, association = null) {
  return { level, id, what, why, where, howMany, association };
}

/**
 * @param {object} content the content library as stored
 * @param {object} [job]   { unit } — the equipment on the quote, when there is one
 */
export function assetRequest(content = {}, job = {}) {
  const c = content || {};
  const images = list(c.images).map(normaliseImageAsset);
  const approved = images.filter(i => imagePublishable(i).ok);
  const byRole = (role) => approved.filter(i => i.role === role);

  const needs = [];

  // ── BRANDING ───────────────────────────────────────────────────────────
  if (!trimmed(c.logo)) {
    needs.push(item(NEED.ESSENTIAL, 'logo', 'The NAC logo',
      'Every proposal opens with it. Without one the cover carries NAC\'s name as '
      + 'plain text, which does not read as a company quote.',
      'Cover, top left, and the footer of every printed page', 1,
      'Upload at /quote-presentation.html → Branding'));
  }
  if (!c.heroImage || !trimmed(c.heroImage.src)) {
    needs.push(item(NEED.OPTIONAL, 'hero', 'One wide cover photograph',
      'A finished installation that looks good across the top of the page. '
      + 'Landscape, at least 1600 px wide.',
      'Cover, right-hand side — currently a flat colour', 1,
      'Upload at /quote-presentation.html → Branding → Hero image'));
  }

  // ── EQUIPMENT ──────────────────────────────────────────────────────────
  const unit = job.unit || null;
  const equipShots = byRole(IMAGE_ROLES.EQUIPMENT);
  const unitBrand = trimmed(unit && (unit.brandName ?? unit.brand ?? unit.brandId));
  if (unit && (trimmed(unit.model) || unitBrand)) {
    const matched = equipmentImagesFor(images, unit);
    if (!matched.length) {
      // Matching is on the brand where no photograph names the model, so what
      // is missing is a photograph of THIS BRAND — not of this exact model.
      // Asking for the model would send Nick looking for a compliance plate
      // when a photograph of the machine would do.
      const label = unitBrand || [unit.model, unit.outdoorModel].map(trimmed)
        .filter(Boolean).join(' and ');
      needs.push(item(NEED.OPTIONAL, 'equipment:' + (unitBrand || trimmed(unit.model)),
        'A photograph of a ' + label + ' unit',
        'There is no approved ' + label + ' photograph in the library, so the system '
        + 'card renders the plain branded panel rather than somebody else\'s machine.',
        'Your recommended system — beside the specification table', 1,
        'Upload at /quote-presentation.html → Images, set Role to "equipment" and '
        + 'Brand shown to "' + label + '". The model is optional — it only makes the '
        + 'match sharper.'));
    }
  } else if (!equipShots.length) {
    needs.push(item(NEED.OPTIONAL, 'equipment', 'Photographs of the units NAC fits',
      'One or two per model — the indoor unit, the outdoor unit and the controller.',
      'Your recommended system', 2,
      'Each one has to name the model it shows, or it is never offered as a '
      + 'photograph of that model.'));
  }

  // ── PAST WORK ──────────────────────────────────────────────────────────
  const installs = list(c.installations)
    .filter(i => installationPublishable(i, Object.fromEntries(images.map(x => [x.id, x]))).ok);
  const installShots = byRole(IMAGE_ROLES.INSTALLATION);
  if (installs.length < 3) {
    needs.push(item(NEED.OPTIONAL, 'installations',
      (3 - installs.length) + ' more past installation' + (3 - installs.length === 1 ? '' : 's'),
      'Three reads as a track record; one reads as the only job that photographed '
      + 'well. Below three the gallery does not go thin, it is hidden.',
      'Recent NAC installations', 3 - installs.length,
      'Each needs a suburb, a brand, the system type and consent ticked. No street '
      + 'address goes out.'));
  }
  if (installShots.length < 6) {
    needs.push(item(NEED.OPTIONAL, 'installation-photos',
      (6 - installShots.length) + ' more installation photograph'
        + (6 - installShots.length === 1 ? '' : 's'),
      'Outlets in a ceiling, a tidy outdoor unit on its base, a return air grille, '
      + 'a controller on a wall. Landscape, at least 800 px wide.',
      'Recent NAC installations', 6 - installShots.length,
      'Role "installation", attached to the job it came from. Uploads are '
      + 're-encoded, which is what strips the EXIF and GPS off the copy customers get.'));
  }

  // ── REVIEWS ────────────────────────────────────────────────────────────
  const reviews = list(c.reviews);
  const publishable = reviews.filter(r => reviewPublishable(r).ok);
  if (publishable.length < 3) {
    const unrated = reviews.filter(r =>
      reviewPublishable(r).reasons.some(x => /Star rating/.test(x)));
    needs.push(item(NEED.OPTIONAL, 'reviews',
      unrated.length
        ? 'The star ratings for ' + unrated.length + ' review'
          + (unrated.length === 1 ? '' : 's') + ' already on file'
        : (3 - publishable.length) + ' more approved review'
          + (3 - publishable.length === 1 ? '' : 's'),
      unrated.length
        ? 'Google\'s notification emails render the stars as an image with no alt '
          + 'text, so the rating is not in them and has not been guessed. Until the '
          + 'real figures are entered these cannot be published.'
        : 'Below three the section is hidden rather than shown thin.',
      'What our customers say', Math.max(1, 3 - publishable.length),
      unrated.length
        ? 'Read them off the Google Business Profile dashboard and enter them at '
          + '/quote-presentation.html → Reviews, then tick Approved.'
        : 'Import at /quote-presentation.html → Reviews → Import Google reviews.'));
  }

  // ── WORDS NAC IS BOUND BY ──────────────────────────────────────────────
  //
  // Both of these were being reported missing, and both were already on file.
  //
  // THE TERMS are seeded by seedTermsAndConditions() from NAC_TERMS_BODY —
  // NAC's own Terms and Conditions of Trade — so a proposal issued before
  // anybody opens the content library still shows the customer the terms they
  // are accepting. This looked at a bare `content.termsAndConditions`, which
  // is blank until somebody edits them, and called that nothing.
  //
  // THE WARRANTY is not a `content.warranty` object; there has never been one.
  // The wording lives on the TRUST record as workmanshipWarranty and
  // manufacturerWarranty, both taken from clauses of the Terms themselves, and
  // both already filled in.
  //
  // Asking for something that has been supplied is worse than a wrong line in
  // a list: it teaches whoever reads it that the list is not to be trusted.
  const terms = seedTermsAndConditions(c.termsAndConditions);
  if (!trimmed(terms)) {
    needs.push(item(NEED.ESSENTIAL, 'terms', 'NAC\'s terms and conditions of trade',
      'They print on every proposal and the customer ticks to accept them. A quote '
      + 'accepted against no terms is an agreement with nothing behind it.',
      'Accept your proposal — above the signature', 1,
      '/quote-presentation.html → Terms'));
  } else if (!trimmed(c.termsAndConditions)) {
    // Present, but nobody in the library has confirmed they are the current
    // version. That is a read-and-confirm job, not a write-them-from-scratch
    // one, and saying so is the difference between five minutes and an hour.
    needs.push(item(NEED.OPTIONAL, 'terms:confirm',
      'Confirm the terms on file are the current version',
      'The proposal is carrying NAC\'s Terms and Conditions of Trade as they were '
      + 'entered into this project. Nothing has been changed, and nobody has '
      + 'confirmed since that they are still the version NAC trades on.',
      'Accept your proposal — above the signature', 1,
      'Read them at /quote-presentation.html → Terms and save, which records that '
      + 'they were checked.'));
  }

  const t0 = c.trust || {};
  if (!trimmed(t0.workmanshipWarranty) && !trimmed(t0.manufacturerWarranty)) {
    needs.push(item(NEED.ESSENTIAL, 'warranty', 'The warranty wording',
      'What the manufacturer covers and for how long, and what NAC covers on the '
      + 'installation. This is never written by the program — a warranty it made up '
      + 'would be a promise nobody has made.',
      'Warranty and aftercare', 1, '/quote-presentation.html → About NAC'));
  } else if (!trimmed(t0.workmanshipWarranty) || !trimmed(t0.manufacturerWarranty)) {
    needs.push(item(NEED.OPTIONAL, 'warranty:half',
      'The other half of the warranty wording',
      trimmed(t0.workmanshipWarranty)
        ? 'The workmanship warranty is on file and the manufacturer one is not.'
        : 'The manufacturer warranty is on file and NAC\'s own workmanship one is not.',
      'Warranty and aftercare', 1, '/quote-presentation.html → About NAC'));
  }
  const a = c.aftercare || {};  // this one IS a content field — see drawAftercare
  if (!trimmed(a.servicing) && !trimmed(a.filterCare) && !trimmed(a.support)) {
    needs.push(item(NEED.OPTIONAL, 'aftercare', 'The aftercare wording',
      'Filter care, servicing intervals and how a customer reaches NAC afterwards.',
      'Warranty and aftercare', 1, '/quote-presentation.html → Warranty'));
  }
  // ── THE FIELDS ARE THE ONES THE LIBRARY ACTUALLY HAS ───────────────────
  //
  // This asked for `licenceNumber`, `arcticLicence` and `arcLicence`. The
  // library has `electricalLicence` and `arcAuthorisation`, and has never had
  // any of the other three. So the check could not see a licence that WAS on
  // file and reported both as missing — which is how it came to be asking Nick
  // for an ARC number the project had already been given.
  //
  // A request list that asks for something already supplied teaches the person
  // reading it to ignore the list, which costs more than the one wrong line.
  //
  // They are asked for SEPARATELY now, because they are two different
  // registrations held by two different authorities, and "licence numbers" as
  // one item cannot say that one of them has arrived.
  const t = c.trust || {};
  if (!trimmed(t.electricalLicence)) {
    needs.push(item(NEED.ESSENTIAL, 'licence:electrical',
      'NAC\'s electrical contractor licence number',
      'It prints in the trust panel on every proposal. It is never invented — a '
      + 'wrong licence number on a quote is a serious thing to put in writing, and a '
      + 'plausible-looking default is a fabricated licence.',
      'Why choose NAC — the trust panel', 1, '/quote-presentation.html → About NAC'));
  }
  if (!trimmed(t.arcAuthorisation)) {
    needs.push(item(NEED.ESSENTIAL, 'licence:arc',
      'NAC\'s ARC refrigerant handling authorisation',
      'Required on the proposal for refrigerant work, and never invented for the '
      + 'same reason as the electrical licence.',
      'Why choose NAC — the trust panel', 1, '/quote-presentation.html → About NAC'));
  }

  const essential = needs.filter(x => x.level === NEED.ESSENTIAL);
  return {
    ok: essential.length === 0,
    /** Can a proposal go to a real customer at all? */
    canIssue: essential.length === 0,
    essential,
    optional: needs.filter(x => x.level === NEED.OPTIONAL),
    needs,
    have: {
      logo: !!trimmed(c.logo),
      heroImage: !!(c.heroImage && trimmed(c.heroImage.src)),
      approvedImages: approved.length,
      equipmentPhotos: equipShots.length,
      installationPhotos: installShots.length,
      publishableInstallations: installs.length,
      publishableReviews: publishable.length,
      terms: !!trimmed(terms),
      termsConfirmedInLibrary: !!trimmed(c.termsAndConditions),
      workmanshipWarranty: !!trimmed(t0.workmanshipWarranty),
      manufacturerWarranty: !!trimmed(t0.manufacturerWarranty),
      electricalLicence: trimmed(t.electricalLicence) || false,
      arcAuthorisation: trimmed(t.arcAuthorisation) || false
    }
  };
}

export default { NEED, assetRequest };
