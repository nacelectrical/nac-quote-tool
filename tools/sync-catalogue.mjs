// ─────────────────────────────────────────────────────────────────────────────
// THE MODELS THE PRICES SCREEN CAN PRICE
//
// Nick, 17 October 2026: "You still don't have all 3 phase and single phase
// models in there."
//
// He was right about the screen he was typing into, and the reason is worth
// writing down because it is not the reason it looks like.
//
// THE DESIGNER WAS NEVER MISSING THEM. buildCatalogue() in catalogue.mjs
// already appends every MMEM_DUCTED line the base list does not cover — the
// whole Daikin FDYAN range in both phases, Gree and Panasonic included — and
// tests/supplier-pricing covers exactly that. Adding them to DUCTED_CATALOGUE
// as well duplicates every one of them and changes which unit the engines
// select, which broke 51 tests when I tried it.
//
// THE PRICES SCREEN WAS. `BRANDS` in index.html is a plain literal in a
// compiled file with no imports, so nothing has ever merged the supplier list
// into it. That is the screen an estimator types prices into, and three-phase
// under 16 kW had no row to type a price into at all.
//
// So this tool writes to index.html and nothing else. NOTHING IS INVENTED:
// every model number, capacity and phase is read from MMEM_DUCTED, which is
// NAC's own price list. A model that is not on it is not added by this tool —
// it is a person's to supply.
//
//   node tools/sync-catalogue.mjs            → report only, writes nothing
//   node tools/sync-catalogue.mjs --write    → update index.html
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MMEM_DUCTED, MMEM_ZONE_CONTROLS, MMEM_META, indoorCode, codesMatch }
  from '../designer/engines/supplier-pricing.mjs';
import { DUCTED_CATALOGUE } from '../designer/engines/catalogue.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The name a model goes into the catalogues under.
 *
 * The indoor code alone is not enough: FDYAN160AV1 is sold on a single-phase
 * outdoor (RZA160C2V1) AND a three-phase one (RZA160C2Y1), so the bare code
 * names two different jobs. The series and the phase separate them, which is
 * also how an estimator tells them apart on the price list.
 */
export function catalogueName(line) {
  // An MMEM line may be keyed on MMEM's own STOCK code (MMABRAKCHV160D1B) and
  // carry the manufacturer's pair separately. The manufacturer's name is what
  // goes on a quote and what an estimator recognises, so it wins.
  const base = indoorCode(line.model || line.code);
  const bits = [line.series, line.phase === '3Ph' ? '3Ph' : null].filter(Boolean);
  return bits.length ? base + ' — ' + bits.join(' ') : base;
}

/** Already in this brand's list? Matched on code AND phase, so the 1Ph and
 *  3Ph builds of one indoor unit are two rows, not one. */
function alreadyHas(models, line) {
  // Either naming is a legitimate way to refer to the same unit, which is why
  // findSupplierLine() checks both. Checking only `code` listed every Braemar
  // twice: once as KDHV160D1S and once as MMEM's MMABRAKCHV160D1B.
  return models.some(m => m.phase === line.phase
    && (codesMatch(m.name, line.code) || (line.model && codesMatch(m.name, line.model))));
}

/**
 * The BRANDS literal out of index.html, as data.
 *
 * Planned against the TARGET, not against the designer's catalogue. Planning
 * against the catalogue made the tool report the same 41 models every run,
 * because the catalogue never changes — so a second `--write` would have added
 * all of them a second time.
 */
export function readIndexBrands(text) {
  const at = text.indexOf('var BRANDS = [');
  if (at < 0) throw new Error('BRANDS not found in index.html');
  const open = text.indexOf('[', at);
  const literal = text.slice(open, closingBracket(text, open + 1) + 1);
  // A plain array of plain objects, and nothing else: parsed rather than run.
  return JSON.parse(literal
    .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
    .replace(/,\s*([}\]])/g, '$1'));
}

export function plan(indexText) {
  const target = new Map(readIndexBrands(indexText).map(b => [b.id, b]));
  const named = new Map(DUCTED_CATALOGUE.map(b => [b.id, b.name]));
  const add = [];
  const unknownBrand = [];
  for (const line of MMEM_DUCTED) {
    const brand = target.get(line.brandId);
    const brandName = named.get(line.brandId);
    if (!brand && !brandName) { unknownBrand.push(line); continue; }
    if (brand && alreadyHas(brand.models, line)) continue;
    add.push({ brandId: line.brandId, brandName: (brand && brand.name) || brandName,
               line, name: catalogueName(line), kw: line.kw, phase: line.phase });
  }
  return { add, unknownBrand };
}

// ── WRITING ────────────────────────────────────────────────────────────────
//
// Both files hold the list as a plain array literal, so the entries are spliced
// in before each brand's closing bracket. The files are left otherwise exactly
// as they were — this is not a code generator, it is an insert.

function nextId(prefix, existing) {
  let n = 1;
  const taken = new Set(existing);
  while (taken.has(prefix + n)) n++;
  return prefix + n;
}

/** The index of the "]" closing the array that opens at `from`. */
function closingBracket(text, from) {
  let depth = 1, i = from;
  while (i < text.length && depth > 0) {
    const c = text[i];
    if (c === '[') depth++;
    else if (c === ']') depth--;
    i++;
  }
  if (depth !== 0) throw new Error('unbalanced array from offset ' + from);
  return i - 1;
}

function insertIntoIndex(text, rows) {
  let out = text;
  for (const [brandId, items] of groupByBrand(rows)) {
    const open = new RegExp('id: "' + brandId + '",\\s*\\n\\s*name: "[^"]*",\\s*\\n\\s*models: \\[');
    let m = open.exec(out);
    if (!m) {
      // ── A BRAND THE PRICES SCREEN HAS NEVER HEARD OF ───────────────────
      // Gree and Panasonic are on NAC's MMEM account and were never in the
      // quote tool's list, so there was nowhere to price them. The brand is
      // created empty and the models drop into it on the next pass.
      out = addBrandToIndex(out, brandId, items[0].brandName);
      m = open.exec(out);
      if (!m) throw new Error('could not create brand ' + brandId + ' in index.html');
    }
    // The brand's models array ends at the matching "]" before the next brand.
    const start = m.index + m[0].length;
    const close = closingBracket(out, start);
    const block = out.slice(start, close);
    const ids = [...block.matchAll(/id:\s*"([a-z]+\d+)"/g)].map(x => x[1]);
    const prefix = (ids[0] || (brandId.slice(0, 2) + '1')).replace(/\d+$/, '');
    const lines = [];
    for (const it of items) {
      const id = nextId(prefix, ids); ids.push(id);
      lines.push('{\n    id: "' + id + '",\n    name: "' + it.name
        + '",\n    kw: "' + it.kw.toFixed(1) + '",\n    phase: "' + it.phase
        + '",\n    price: ""\n  }');
    }
    out = out.slice(0, close) + (block.trim() === '' ? '' : ', ')
      + lines.join(', ') + out.slice(close);
  }
  return out;
}

/** Append an empty brand to index.html's BRANDS array. */
function addBrandToIndex(text, brandId, brandName) {
  const open = text.indexOf('var BRANDS = [');
  if (open < 0) throw new Error('BRANDS not found in index.html');
  const close = closingBracket(text, text.indexOf('[', open) + 1);
  const entry = ', {\n  id: "' + brandId + '",\n  name: "' + brandName
    + '",\n  models: []\n}';
  return text.slice(0, close) + entry + text.slice(close);
}

function groupByBrand(rows) {
  const g = new Map();
  for (const r of rows) {
    if (!g.has(r.brandId)) g.set(r.brandId, []);
    g.get(r.brandId).push(r);
  }
  return g;
}

/**
 * THE ZONE CONTROLS, THE SAME WAY.
 *
 * `CONTROLLERS` in index.html held two rows: "Brand Standard Controller" and
 * "Airtouch 5". NAC's supplier list carries nineteen, including the three
 * Siemens kits that are NAC's own house standard — Nick: "Siemens is used if
 * not AirTouch" — and none of them had a row to be priced in.
 *
 * The per-zone accessories (the AirTouch sensor) are left out: they are bought
 * by the unit against a zone count, not priced once per job, and the quote
 * builder already offers them that way.
 */
export function planControllers(indexText) {
  const at = indexText.indexOf('var CONTROLLERS = [');
  if (at < 0) throw new Error('CONTROLLERS not found in index.html');
  const open = indexText.indexOf('[', at);
  const literal = indexText.slice(open, closingBracket(indexText, open + 1) + 1);
  const have = JSON.parse(literal
    .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
    .replace(/,\s*([}\]])/g, '$1'));
  const names = new Set(have.map(c => String(c.name).toLowerCase().replace(/[^a-z0-9]/g, '')));
  const ids = new Set(have.map(c => c.id));
  const add = [];
  for (const c of MMEM_ZONE_CONTROLS) {
    if (c.perZoneAccessory) continue;
    const key = String(c.name).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (names.has(key) || ids.has(c.id)) continue;
    // The generic "Airtouch 5" row already on the screen IS the kit.
    if (/^airtouch5/.test(key) && [...names].some(n => /^airtouch5/.test(n))) continue;
    add.push(c);
    names.add(key); ids.add(c.id);
  }
  return { add, open, close: closingBracket(indexText, open + 1) };
}

function insertControllers(text, rows) {
  const { add, close } = planControllers(text);
  if (!add.length) return text;
  const entries = rows.map(c => '{\n  id: "' + c.id + '",\n  name: "' + c.name
    + '",\n  maxZones: ' + c.maxZones + ',\n  price: ""\n}');
  return text.slice(0, close) + ', ' + entries.join(', ') + text.slice(close);
}

export function sync({ write = false } = {}) {
  const idxPath = resolve(ROOT, 'index.html');
  const text = readFileSync(idxPath, 'utf8');
  const { add, unknownBrand } = plan(text);
  const controllers = planControllers(text).add;
  if (!write || (!add.length && !controllers.length)) {
    return { add, controllers, unknownBrand, written: [] };
  }
  let out = text;
  if (add.length) out = insertIntoIndex(out, add);
  if (controllers.length) out = insertControllers(out, controllers);
  writeFileSync(idxPath, out);
  return { add, controllers, unknownBrand, written: [idxPath] };
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const write = process.argv.includes('--write');
  const { add, controllers, unknownBrand, written } = sync({ write });

  if (!add.length && !controllers.length) {
    console.log('  The Prices screen already carries every model and control on the MMEM list.');
  }
  if (controllers.length) {
    console.log('\n  Zone controls  (+' + controllers.length + ')');
    for (const c of controllers) {
      console.log('     ' + c.name.padEnd(42) + 'up to ' + String(c.maxZones).padStart(2)
        + ' zones   MMEM $' + c.cost.toFixed(2) + ' ex GST');
    }
  }
  for (const [brandId, items] of groupByBrand(add)) {
    console.log('\n  ' + items[0].brandName + '  (+' + items.length + ')');
    for (const it of items) {
      console.log('     ' + it.name.padEnd(42) + String(it.kw).padStart(5) + ' kW  '
        + it.phase + '   MMEM $' + it.line.cost.toFixed(2) + ' ex GST');
    }
  }
  for (const l of unknownBrand) {
    console.log('  ?  ' + l.brandId + ' is on the supplier list and is not a brand in the '
      + 'catalogue: ' + l.code);
  }
  console.log('\n  source: ' + MMEM_META.edition);
  console.log(written.length
    ? '  written: ' + written.map(p => p.replace(ROOT + '/', '')).join(', ')
    : '  nothing written (pass --write)');
}
