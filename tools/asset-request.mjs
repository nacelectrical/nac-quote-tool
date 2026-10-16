// ─────────────────────────────────────────────────────────────────────────────
// WHAT NAC STILL HAS TO SUPPLY
//
//   node tools/asset-request.mjs [outFile]
//
// Reads the content files that are actually in this repository and prints the
// exact list: what is missing, why it matters, where on the customer's page it
// appears, and how to supply it.
//
// It reads the REPOSITORY's content, not the live library — nothing here has
// the service-role key. If NAC have already uploaded something through
// /quote-presentation.html it will be in the live library and not here, so
// treat this as the floor rather than the whole truth.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { assetRequest } from '../designer/engines/asset-request.mjs';
import { NAC_TRUST } from '../designer/engines/presentation-content.mjs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const OUT = process.argv[2] || null;

const read = (p) => existsSync(ROOT + p) ? JSON.parse(readFileSync(ROOT + p, 'utf8')) : null;
const reviews = read('/designer/content/google-reviews.json');
const photos = read('/designer/content/nac-photos.json');

// The photographs Nick has supplied. They live in the repository and are one
// click from the library — "Import NAC's photographs" on the Images panel —
// so counting them as absent would ask him for things he has already sent.
// They are counted as APPROVED here only to answer "is there a photograph of
// this brand"; approval in the real library stays his.
const suppliedImages = (photos ? photos.photos : []).map((p, i) => ({
  id: 'supplied-' + i, alt: p.alt, role: p.role, tags: p.tags,
  equipmentBrand: p.equipmentBrand, equipmentModels: p.equipmentModels,
  approved: true, exifStripped: true, gpsRemoved: true,
  derivatives: [{ ref: 'https://cdn.nac.test/' + p.file, width: 1600, height: 2133,
                  format: 'jpeg', bytes: 1 }]
}));

const content = {
  // The one genuine image in the repository.
  logo: existsSync(ROOT + '/nac-logo.jpg')
    ? 'data:image/jpeg;base64,' + readFileSync(ROOT + '/nac-logo.jpg').toString('base64')
    : '',
  // NAC's own registered numbers, as Nick has given them. The ARC
  // authorisation is in here; the electrical contractor licence is not,
  // because it has not been supplied.
  trust: { ...NAC_TRUST },
  reviews: reviews ? reviews.reviews : [],
  images: suppliedImages, installations: [],
  // Whatever NAC have typed into the live library is not visible from here.
  termsAndConditions: '', warranty: {}, aftercare: {}
};

// The unit on the Kauri-shaped job, so the equipment request names real models.
const unit = { model: 'FDYAN160AV1', outdoorModel: 'RZA160C2V1', brandName: 'Daikin' };
const r = assetRequest(content, { unit });

const lines = [];
const say = (s = '') => { lines.push(s); console.log(s); };
const wrap = (t, w, pad) => {
  const words = String(t).split(/\s+/); const out = []; let line = '';
  for (const x of words) {
    if ((line + ' ' + x).trim().length > w) { out.push(pad + line.trim()); line = x; }
    else line += ' ' + x;
  }
  if (line.trim()) out.push(pad + line.trim());
  return out;
};

say('NAC AI HVAC DESIGNER — what is still needed before a real customer quote');
say('Generated from the content in this repository on ' + new Date().toISOString().slice(0, 10) + '.');
say('Anything already uploaded through /quote-presentation.html lives in the live');
say('library and is not visible from here, so this is the floor, not the whole list.');
say('');
say('Counted as supplied: ' + suppliedImages.length + ' photographs ('
  + [...new Set(suppliedImages.map(i => i.equipmentBrand).filter(Boolean))].join(', ')
  + '), in the repository and one click from the library.');
say();
say('CAN A PROPOSAL GO TO A CUSTOMER RIGHT NOW?  ' + (r.canIssue ? 'YES' : 'NO'));
say();

const block = (title, items, note) => {
  say('─'.repeat(78));
  say(title + '  (' + items.length + ')');
  if (note) { for (const l of wrap(note, 74, '  ')) say(l); }
  say();
  let i = 0;
  for (const x of items) {
    i++;
    say('  ' + i + '. ' + x.what + (x.howMany > 1 ? '   × ' + x.howMany : ''));
    for (const l of wrap('WHY: ' + x.why, 70, '       ')) say(l);
    say('       WHERE: ' + x.where);
    for (const l of wrap('HOW: ' + x.association, 70, '       ')) say(l);
    say();
  }
};

block('ESSENTIAL — a proposal cannot go out without these', r.essential,
  'Each of these is something only NAC can supply. Nothing here is written by '
  + 'the program: a warranty or a licence number it made up would be a promise '
  + 'nobody has made.');

block('OPTIONAL — the proposal sends without them, and is thinner', r.optional,
  'Each of these sections is HIDDEN while its content is missing. Nothing shows '
  + 'an empty card, a broken image or a placeholder dressed up as finished work.');

say('─'.repeat(78));
say('ALREADY ON FILE');
for (const [k, v] of Object.entries(r.have)) {
  say('  ' + String(k).padEnd(26) + (v === true ? 'yes' : v === false ? 'no' : v));
}
say();

if (OUT) { writeFileSync(OUT, lines.join('\n') + '\n'); say('written to ' + OUT); }
