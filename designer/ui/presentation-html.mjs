// ─────────────────────────────────────────────────────────────────────────────
// THE CUSTOMER PRESENTATION, AS HTML
//
// This renders the view model from presentation.mjs and nothing else. It holds
// no business rules, reads no design, and cannot compute a price — if a number
// is not on the view model it does not appear, which is what keeps this file
// from becoming a second opinion about what the quote says.
//
// It emits a complete standalone document: no framework, no app bundle, no
// build step. A customer on poor mobile reception downloads one HTML file and
// the images the page actually shows.
//
// Nick: "It should feel like a professionally designed residential
// air-conditioning proposal — not an internal estimator report or generic
// invoice." So the layout is white paper, navy furniture, gold accents, and
// plenty of air. Every section disappears entirely when its data is absent,
// because a premium document with four empty headings is not a premium
// document.
// ─────────────────────────────────────────────────────────────────────────────

const str = (v) => (v === null || v === undefined) ? '' : String(v);

// Formatting lives here rather than being imported from the engine, so the
// public quote page pulls in the renderer alone. Nick: "no unnecessary app code
// in the public quote page" — importing the engine dragged the quote gate and
// the whole content library onto a customer's phone to print a dollar sign.
const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};
export function money(value) {
  const x = num(value);
  return x === null ? ''
    : '$' + x.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
export function moneyRound(value) {
  const x = num(value);
  return x === null ? '' : '$' + Math.round(x).toLocaleString('en-AU');
}

/** Escape for text nodes and quoted attributes alike. */
export function esc(v) {
  return str(v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** A URL we are willing to put in src/href. Blocks javascript: and data: HTML. */
export function safeUrl(v) {
  const s = str(v).trim();
  if (!s) return '';
  if (/^(https?:|mailto:|tel:|\/|\.\/|#)/i.test(s)) return esc(s);
  if (/^data:image\/(png|jpe?g|webp|avif|gif);base64,[A-Za-z0-9+/=]+$/i.test(s)) return esc(s);
  return '';
}

const when = (cond, html) => cond ? html : '';

// ─────────────────────────────────────────────────────────────────────────────
// ICONS — one small inline set, so the page makes no icon-font request.
// ─────────────────────────────────────────────────────────────────────────────

const ICONS = {
  unit:    'M3 7h18v7a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7Zm3 3h12M6 13h7',
  outdoor: 'M4 5h16v14H4zM8 12a4 4 0 1 0 8 0 4 4 0 0 0-8 0Zm4-7v2',
  outlet:  'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9ZM12 3v4.5M12 16.5V21M3 12h4.5M16.5 12H21',
  return:  'M4 6h16v12H4zM7 9h10M7 12h10M7 15h10',
  zone:    'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  control: 'M6 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm2 5h8M8 12h5',
  wifi:    'M2 8a16 16 0 0 1 20 0M5 12a11 11 0 0 1 14 0M8.5 15.5a6 6 0 0 1 7 0M12 19h.01',
  duct:    'M2 8h16a3 3 0 0 1 3 3v2a3 3 0 0 1-3 3H2V8Zm4 0v8m4-8v8m4-8v8',
  pipe:    'M3 7h9a5 5 0 0 1 5 5v9M3 12h9a0 0 0 0 1 0 0 0 0 0 0 0 0M21 7h-4M21 12h-4',
  drain:   'M12 3v10m0 0-3-3m3 3 3-3M5 17h14a2 2 0 0 1-2 4H7a2 2 0 0 1-2-4Z',
  power:   'M13 2 4 14h7l-1 8 9-12h-7l1-8Z',
  check:   'M20 6 9 17l-5-5',
  waste:   'M4 7h16M9 7V5h6v2m-8 0 1 13h8l1-13M10 11v6M14 11v6',
  shield:  'M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Z',
  badge:   'M12 3l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L4.2 8.7l5.4-.8L12 3Z',
  star:    'M12 3l2.6 5.6 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 9.4l6-.8L12 3Z'
};

function icon(name, cls = 'ic') {
  const d = ICONS[name] || ICONS.check;
  return '<svg class="' + cls + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
       + '<path d="' + d + '"/></svg>';
}

function stars(rating) {
  const r = Math.max(0, Math.min(5, Math.round(Number(rating) || 0)));
  let out = '<span class="stars" role="img" aria-label="' + r + ' out of 5 stars">';
  for (let i = 0; i < 5; i++) {
    out += '<svg class="st' + (i < r ? ' on' : '') + '" viewBox="0 0 24 24" aria-hidden="true">'
         + '<path d="' + ICONS.star + '"/></svg>';
  }
  return out + '</span>';
}

// ─────────────────────────────────────────────────────────────────────────────
// IMAGES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * An image with a reserved box.
 *
 * width/height and a CSS aspect-ratio are always emitted so the page does not
 * jump as pictures arrive — on a phone that reflow is the difference between a
 * document that feels built and one that feels thrown together.
 */
function picture(img, { ratio = '4 / 3', sizes = '100vw', eager = false, cls = '' } = {}) {
  if (!img || !safeUrl(img.src)) return '';
  const srcset = (img.srcset || []).filter(s => safeUrl(s.ref))
    .map(s => safeUrl(s.ref) + ' ' + Math.round(s.width) + 'w').join(', ');
  const focal = img.focalPoint
    ? (Math.round(img.focalPoint.x * 100) + '% ' + Math.round(img.focalPoint.y * 100) + '%')
    : '50% 50%';
  return '<div class="imgbox ' + esc(cls) + '" style="aspect-ratio:' + esc(ratio) + '">'
    + '<img src="' + safeUrl(img.src) + '"'
    + (srcset ? ' srcset="' + srcset + '" sizes="' + esc(sizes) + '"' : '')
    + (img.width ? ' width="' + Math.round(img.width) + '"' : '')
    + (img.height ? ' height="' + Math.round(img.height) + '"' : '')
    + ' alt="' + esc(img.alt || '') + '"'
    + ' loading="' + (eager ? 'eager' : 'lazy') + '" decoding="async"'
    + ' style="object-position:' + esc(focal) + '">'
    + '</div>';
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTIONS
// ─────────────────────────────────────────────────────────────────────────────

function heroHtml(p) {
  const h = p.hero;
  const logo = safeUrl(p.brand.logo);
  const meta = [
    h.proposalNumber ? ['Proposal', h.proposalNumber] : null,
    h.preparedDate ? ['Prepared', h.preparedDate] : null,
    h.expiryDate ? [h.expired ? 'Expired' : 'Valid until', h.expiryDate] : null
  ].filter(Boolean);
  // Two columns on a wide screen, stacked on a phone. Without this the desktop
  // hero was a wall of navy with the title tucked into the left third.
  return '<header class="hero' + (h.heroImage ? ' has-img' : '') + '" id="top">'
    + '<div class="hero-in">'
      + '<div class="hero-top">'
        + (logo ? '<img class="logo" src="' + logo + '" alt="' + esc(p.brand.name) + '" width="200" height="64">'
                : '<div class="logo-txt">' + esc(p.brand.name) + '</div>')
      + '</div>'
      + '<p class="eyebrow">' + esc(h.greeting) + '</p>'
      + '<h1>' + esc(h.title) + '</h1>'
      + when(!!h.site, '<p class="hero-site">' + esc(h.site) + '</p>')
      + when(meta.length > 0, '<dl class="hero-meta">' + meta.map(([k, v]) =>
          '<div><dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd></div>').join('') + '</dl>')
    + '</div>'
    + when(!!h.heroImage, '<div class="hero-img">'
        + picture(h.heroImage, { ratio: '16 / 7', sizes: '100vw', eager: true }) + '</div>')
  + '</header>'
  + '<section class="intro"><p>' + esc(h.intro) + '</p></section>';
}

function systemHtml(p) {
  const s = p.system;
  if (!s) return '';
  const specs = [
    ['Brand', s.brand],
    ['Indoor unit', s.indoorModel],
    ['Outdoor unit', s.outdoorModel],
    ['Capacity', s.capacityKw !== null ? s.capacityKw + ' kW' : ''],
    ['Power supply', s.phase],
    ['Conditioned rooms', s.conditionedRooms || ''],
    ['Supply outlets', s.outlets || ''],
    ['Zones', s.zones || ''],
    ['Controller', s.controller],
    ['Wi-Fi control', s.wifi ? 'Included' : ''],
    ['Warranty', s.warranty]
  ].filter(([, v]) => str(v).trim() !== '');

  return sect('system', 'Your recommended system',
      '<div class="sys">'
      + '<div class="sys-media">'
        + (s.image
            ? picture(s.image, { ratio: '4 / 3', sizes: '(min-width:900px) 380px, 100vw' })
            // Nick: never a lookalike product photo. A clean branded card instead.
            : '<div class="sys-card"><span class="sys-card-brand">' + esc(s.brand) + '</span>'
              + '<span class="sys-card-kw">' + esc(s.capacityKw !== null ? s.capacityKw + ' kW' : '') + '</span>'
              + '<span class="sys-card-type">Ducted reverse cycle</span></div>')
      + '</div>'
      + '<div class="sys-body">'
        + '<dl class="specs">' + specs.map(([k, v]) =>
            '<div><dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd></div>').join('') + '</dl>'
        + when(s.totalIncGst !== null,
            '<p class="sys-price"><span>Total installed</span><strong>'
            + esc(moneyRound(s.totalIncGst)) + '</strong><small>including GST</small></p>')
      + '</div>'
    + '</div>');
}

function rationaleHtml(p) {
  if (!p.rationale) return '';
  return sect('why', 'Why this system suits your home',
    '<div class="prose">' + p.rationale.points.map(t => '<p>' + esc(t) + '</p>').join('') + '</div>');
}

function inclusionsHtml(p) {
  if (!p.inclusions || !p.inclusions.length) return '';
  return sect('included', 'What is included',
    '<ul class="cards">' + p.inclusions.map(i =>
      '<li class="card"><span class="card-ic">' + icon(i.icon) + '</span>'
      + '<h3>' + esc(i.title) + '</h3><p>' + esc(i.blurb) + '</p></li>').join('') + '</ul>');
}

function zonesHtml(p) {
  const z = p.zones;
  if (!z || !z.rows.length) return '';
  // One markup, two presentations: a real table on wide screens, and the same
  // rows as cards under 720px. Nick: "avoid horizontal tables; convert
  // schedules into cards."
  return sect('zones', 'Your zones',
    when(!!z.controller, '<p class="lede">Controlled by the ' + esc(z.controller) + '.</p>')
    + '<div class="tablewrap"><table class="grid">'
    + '<thead><tr><th>Zone</th>' + when(z.showRooms, '<th>Rooms</th>')
      + '<th>Control</th></tr></thead><tbody>'
    + z.rows.map(r =>
        '<tr>'
        + '<th scope="row" data-l="Zone">' + esc(r.name) + '</th>'
        + when(z.showRooms, '<td data-l="Rooms">' + esc(r.rooms || r.name) + '</td>')
        + '<td data-l="Control">' + (r.switchable
            ? '<span class="pill ok">Switch on and off independently</span>'
            : '<span class="pill">' + esc(r.note) + '</span>') + '</td>'
        + '</tr>').join('')
    + '</tbody></table></div>');
}

function coverageHtml(p) {
  const c = p.coverage;
  if (!c || !c.rooms.length) return '';
  return sect('coverage', 'Proposed room coverage',
    '<div class="tablewrap"><table class="grid">'
    + '<thead><tr><th>Room</th><th>Outlets</th><th>Outlet type</th></tr></thead><tbody>'
    + c.rooms.map(r =>
        '<tr><th scope="row" data-l="Room">' + esc(r.name) + '</th>'
        + '<td data-l="Outlets">' + esc(r.outlets) + '</td>'
        + '<td data-l="Type">' + esc(r.type || '—') + '</td></tr>').join('')
    + '</tbody></table></div>'
    + when(c.excluded.length > 0,
        '<p class="note">Not conditioned: ' + esc(c.excluded.join(', ')) + '.</p>')
    + when(c.provisional, '<p class="note">' + esc(c.provisionalNote) + '</p>'));
}

function galleryHtml(p) {
  const gs = p.installations || [];
  if (!gs.length) return '';
  return sect('work', 'Recent NAC installations',
    '<ul class="gallery ' + gridClass(gs.length) + '">' + gs.map((g, i) => {
      const facts = [
        g.brand, g.capacityKw ? g.capacityKw + ' kW' : '',
        g.zoneCount ? g.zoneCount + ' zones' : ''
      ].filter(Boolean).join(' · ');
      return '<li class="shot">'
        + '<button type="button" class="shot-btn" data-gallery="' + i + '"'
        + ' aria-label="View larger image of the ' + esc(g.location) + ' installation">'
        + picture(g.cover, { ratio: '4 / 3', sizes: '(min-width:900px) 320px, 45vw' })
        + '</button>'
        + '<div class="shot-body">'
          + '<h3>' + esc(g.location) + '</h3>'
          + when(!!facts, '<p class="shot-facts">' + esc(facts) + '</p>')
          + when(!!g.description, '<p>' + esc(g.description) + '</p>')
        + '</div></li>';
    }).join('') + '</ul>');
}

function reviewsHtml(p) {
  const rs = p.reviews || [];
  if (!rs.length) return '';
  return sect('reviews', 'What our customers say',
    '<ul class="quotes ' + gridClass(rs.length) + '">' + rs.map(r =>
      '<li class="quote">'
      + stars(r.rating)
      // The review text is reproduced exactly as stored. It is escaped for
      // HTML safety and never reworded, trimmed to length or ellipsised.
      + '<blockquote><p>' + esc(r.text) + '</p></blockquote>'
      + '<p class="byline"><strong>' + esc(r.name) + '</strong>'
      + when(!!r.suburb, '<span>' + esc(r.suburb) + '</span>')
      + when(!!r.source, '<span class="src">' + esc(sourceLabel(r.source)) + '</span>')
      + '</p></li>').join('') + '</ul>');
}

/**
 * How many columns a fixed number of cards should sit in.
 *
 * `auto-fill` leaves four cards as three-plus-one and five as three-plus-two
 * with a hole on the end, which reads as a layout accident rather than a
 * choice. The count is known at render time, so the grid is chosen to divide
 * evenly wherever it can.
 */
function gridClass(n) {
  if (n <= 1) return 'g1';
  if (n === 2 || n === 4) return 'g2';
  return 'g3';
}

function sourceLabel(s) {
  return ({ google: 'Google review', facebook: 'Facebook review',
            product_review: 'ProductReview', email: 'Emailed to NAC',
            sms: 'Sent to NAC', word_of_mouth: 'Given to NAC' })[s] || 'Customer review';
}

function trustHtml(p) {
  const t = p.trust;
  if (!t || (!t.points.length && !t.facts.length)) return '';
  return sect('about', 'Why choose NAC',
    when(t.points.length > 0, '<ul class="ticks">' + t.points.map(x =>
      '<li>' + icon('check', 'ic tick') + '<span>' + esc(x) + '</span></li>').join('') + '</ul>')
    + when(t.facts.length > 0, '<dl class="facts">' + t.facts.map(f =>
      '<div><dt>' + esc(f.label) + '</dt><dd>' + esc(f.value) + '</dd></div>').join('') + '</dl>'));
}

function optionsHtml(p) {
  const os = p.options || [];
  if (!os.length) return '';
  return sect('options', 'Optional upgrades',
    '<p class="lede">Entirely optional. Selecting one prepares a revised proposal for you '
    + 'to review — nothing changes until you accept it.</p>'
    + '<ul class="opts">' + os.map(o =>
      '<li><label class="opt">'
      + '<input type="checkbox" class="opt-in" value="' + esc(o.id) + '"'
      + (o.selected ? ' checked' : '') + (o.group ? ' data-group="' + esc(o.group) + '"' : '') + '>'
      + '<span class="opt-body">'
        + '<span class="opt-h"><strong>' + esc(o.title) + '</strong>'
        + '<em>' + esc(money(o.priceIncGst)) + '</em></span>'
        + when(!!o.description, '<span class="opt-d">' + esc(o.description) + '</span>')
      + '</span></label></li>').join('') + '</ul>');
}

function investmentHtml(p) {
  const inv = p.investment;
  if (!inv) return '';
  const lines = [
    inv.subtotalExGst !== null ? ['Subtotal (excluding GST)', money(inv.subtotalExGst)] : null,
    inv.gst !== null ? ['GST', money(inv.gst)] : null
  ].filter(Boolean);
  const opt = (inv.selectedOptions || []).map(o => [o.title, money(o.priceIncGst)]);
  // Two columns on a wide screen: the breakdown on the left, the headline total
  // and the payment terms on the right. A single 560px column left the right
  // half of a desktop page empty, which read as unfinished rather than roomy.
  return sect('investment', 'Your investment',
    '<div class="inv">'
    + '<div class="inv-a">'
      + '<dl class="inv-lines">'
        + lines.map(([k, v]) => '<div><dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd></div>').join('')
        + opt.map(([k, v]) => '<div class="inv-opt"><dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd></div>').join('')
      + '</dl>'
      + when(!!inv.validity, '<p class="note">' + esc(inv.validity) + '</p>')
    + '</div>'
    + '<div class="inv-b">'
      + '<p class="inv-total"><span>Total investment</span>'
        + '<strong data-total>' + esc(moneyRound(inv.totalIncGst)) + '</strong>'
        + '<small>including GST</small></p>'
      + when(!!inv.deposit, '<p class="inv-dep">Deposit to confirm your booking: <strong>'
          + esc(money(inv.deposit && inv.deposit.amount)) + '</strong>'
          + when(!!(inv.deposit && inv.deposit.percent), ' (' + esc(inv.deposit && inv.deposit.percent) + '%)')
          + '</p>')
      + when((inv.stages || []).length > 0, '<ol class="stages">' + inv.stages.map(s =>
          '<li><strong>' + esc(s.label) + '</strong>' + when(!!s.detail, ' — ' + esc(s.detail)) + '</li>'
        ).join('') + '</ol>')
    + '</div>'
    + '</div>');
}

function warrantyHtml(p) {
  const w = p.warranty;
  if (!w) return '';
  return sect('warranty', 'Warranty and aftercare',
    '<dl class="facts wide">' + w.items.map(i =>
      '<div><dt>' + esc(i.title) + '</dt><dd>' + esc(i.detail) + '</dd></div>').join('') + '</dl>');
}

function acceptHtml(p) {
  const a = p.acceptance;
  const total = p.investment ? moneyRound(p.investment.totalIncGst) : '';

  if (a.accepted) {
    return sect('accept', 'Proposal accepted',
      '<div class="accepted"><p><strong>Thank you — this proposal has been accepted.</strong></p>'
      + '<p>We will be in touch to confirm your installation date. If anything needs to change, '
      + 'contact us and we will prepare a revised proposal.</p></div>');
  }
  if (a.declined) {
    return sect('accept', 'Proposal declined',
      '<div class="accepted"><p>This proposal has been declined. If that was not intended, '
      + 'please contact us.</p></div>');
  }
  if (!a.canAccept) {
    return sect('accept', 'This proposal has expired',
      '<div class="accepted"><p>' + esc(p.expired
          ? 'This proposal has passed its expiry date, so it can no longer be accepted online.'
          : 'This proposal is no longer available online.')
      + ' Please get in touch and we will prepare a current proposal for you.</p>'
      + contactButtons(p) + '</div>');
  }

  return sect('accept', 'Accept your proposal',
    '<form class="accept" id="acceptForm" novalidate>'
    + '<p class="accept-total"><span>Total to accept</span><strong data-total>' + esc(total) + '</strong></p>'
    + '<div class="fld"><label for="acc-name">Your full name</label>'
      + '<input id="acc-name" name="name" type="text" autocomplete="name" required '
      + 'placeholder="Full name"></div>'
    + when(!!a.terms, '<details class="terms"><summary>Terms and conditions</summary>'
        + '<div class="terms-body">' + esc(a.terms).replace(/\n{2,}/g, '</p><p>')
          .replace(/\n/g, '<br>').replace(/^/, '<p>').replace(/$/, '</p>') + '</div></details>')
    + '<label class="chk"><input type="checkbox" id="acc-terms" required>'
      + '<span>I have read and accept the proposal and terms above.</span></label>'
    + when(!!a.depositInstructions, '<p class="note">' + esc(a.depositInstructions) + '</p>')
    + '<div class="actions">'
      + '<button type="submit" class="btn primary" id="acceptBtn">Accept proposal</button>'
      + contactButtons(p)
      + '<button type="button" class="btn ghost" id="declineBtn">Decline proposal</button>'
    + '</div>'
    + '<p class="err" id="acceptErr" role="alert" hidden></p>'
    + '</form>');
}

function contactButtons(p) {
  const tel = p.brand.phone ? '<a class="btn ghost" href="tel:' + safeUrl('tel:' + p.brand.phone).replace(/^tel:/, '')
    + '">Ask a question</a>' : '';
  const mail = (!tel && p.brand.email)
    ? '<a class="btn ghost" href="mailto:' + safeUrl('mailto:' + p.brand.email).replace(/^mailto:/, '')
      + '">Ask a question</a>' : '';
  return tel || mail || '<button type="button" class="btn ghost" id="askBtn">Ask a question</button>';
}

function footerHtml(p) {
  const b = p.brand;
  const bits = [b.abn ? 'ABN ' + b.abn : '', b.phone, b.email, b.website].filter(Boolean);
  return '<footer class="foot"><p><strong>' + esc(b.name) + '</strong></p>'
    + when(bits.length > 0, '<p>' + bits.map(esc).join(' · ') + '</p>')
    + '<p class="rev">Proposal ' + esc(p.hero.proposalNumber || '') + ' · revision '
    + esc(p.revision) + '</p></footer>';
}

function navHtml(p) {
  const items = [
    p.system ? ['system', 'System'] : null,
    p.inclusions.length ? ['included', 'Included'] : null,
    p.zones ? ['zones', 'Zones'] : null,
    p.installations.length ? ['work', 'Our work'] : null,
    p.reviews.length ? ['reviews', 'Reviews'] : null,
    p.investment ? ['investment', 'Investment'] : null
  ].filter(Boolean);
  if (items.length < 3) return '';
  return '<nav class="nav" aria-label="Proposal sections"><ul>'
    + items.map(([id, label]) => '<li><a href="#' + id + '">' + esc(label) + '</a></li>').join('')
    + '</ul></nav>';
}

function stickyHtml(p) {
  if (!p.investment || !p.acceptance.canAccept) return '';
  return '<div class="sticky" id="sticky">'
    + '<div class="sticky-in">'
      + '<span class="sticky-t"><small>Total inc GST</small>'
      + '<strong data-total>' + esc(moneyRound(p.investment.totalIncGst)) + '</strong></span>'
      + '<a class="btn primary sticky-btn" href="#accept">Review &amp; accept</a>'
    + '</div></div>';
}

function sect(id, title, body) {
  return '<section class="sec" id="' + esc(id) + '">'
    + '<h2>' + esc(title) + '</h2>' + body + '</section>';
}

// ─────────────────────────────────────────────────────────────────────────────
// DOCUMENT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {object} presentation view model from buildPresentation()
 * @param {object} opts `{ mode: 'web'|'print' }` — print drops the sticky bar,
 *   the navigation and the acceptance form, and lets the browser paginate.
 */
export function renderPresentationHtml(presentation, opts = {}) {
  const p = presentation;
  if (!p) throw new Error('renderPresentationHtml: no presentation view model');
  const print = opts.mode === 'print';

  const body =
      heroHtml(p)
    + when(!print, navHtml(p))
    + systemHtml(p)
    + rationaleHtml(p)
    + inclusionsHtml(p)
    + zonesHtml(p)
    + coverageHtml(p)
    + galleryHtml(p)
    + reviewsHtml(p)
    + trustHtml(p)
    + investmentHtml(p)
    + when(!print, optionsHtml(p))
    + warrantyHtml(p)
    + when(!print, acceptHtml(p))
    + footerHtml(p);

  return '<!DOCTYPE html>\n<html lang="en-AU"><head>'
    + '<meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
    + '<meta name="robots" content="noindex,nofollow">'
    + '<meta name="referrer" content="no-referrer">'
    + '<meta name="color-scheme" content="light">'
    + '<title>' + esc(p.hero.title + ' — ' + p.brand.name) + '</title>'
    // Print rules apply unconditionally in print mode, and inside @media print
    // for the web build — so Cmd-P from the customer's own link produces the
    // same document the PDF does, not a screenshot of a web page.
    + '<style>' + CSS + (print ? PRINT_ONLY : '@media print{' + PRINT_ONLY + '}') + '</style>'
    + '</head><body class="' + (print ? 'print' : 'web') + '">'
    + '<main class="doc">' + body + '</main>'
    + when(!print, stickyHtml(p))
    + when(!print, '<div class="lightbox" id="lightbox" hidden role="dialog" aria-modal="true" '
        + 'aria-label="Installation photograph"><button class="lb-close" id="lbClose" '
        + 'aria-label="Close">&times;</button><img id="lbImg" alt=""></div>')
    + when(!print, '<script>' + SCRIPT + '</script>')
    + '</body></html>';
}

// ─────────────────────────────────────────────────────────────────────────────

const CSS = `
:root{
  --navy:#16204A; --navy-2:#202C61; --ink:#161A27; --body:#3D4458; --muted:#6B7285;
  --gold:#F5C200; --gold-d:#C79C00; --line:#E4E7EF; --bg:#FFFFFF; --soft:#F6F8FC;
  --ok:#1E7A46; --shadow:0 1px 2px rgba(22,32,74,.06),0 8px 24px rgba(22,32,74,.06);
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
}
*{box-sizing:border-box;margin:0;padding:0}
html{-webkit-text-size-adjust:100%}
body{font-family:var(--sans);color:var(--body);background:var(--bg);line-height:1.62;
  font-size:17px;-webkit-font-smoothing:antialiased;overflow-x:hidden}
.doc{max-width:1060px;margin:0 auto;padding-bottom:96px}
img{max-width:100%;display:block}
h1,h2,h3{color:var(--ink);line-height:1.22;font-weight:700;letter-spacing:-.01em}
p{margin:0 0 1em}p:last-child{margin-bottom:0}

/* ── hero ───────────────────────────────────────────────────────────── */
.hero{background:linear-gradient(160deg,var(--navy) 0%,var(--navy-2) 100%);color:#fff}
.hero-in{padding:32px 24px 36px;max-width:1060px;margin:0 auto}
@media(min-width:900px){
  .hero.has-img{display:grid;grid-template-columns:1.02fr .98fr;align-items:stretch;
    max-width:1060px;margin:0 auto}
  .hero.has-img .hero-in{padding:44px 36px 48px 24px;max-width:none;margin:0;
    display:flex;flex-direction:column;justify-content:center}
  .hero.has-img .hero-img{height:100%}
  .hero.has-img .hero-img .imgbox{height:100%;aspect-ratio:auto!important;border-radius:0}
  .hero.has-img h1{max-width:15ch;font-size:clamp(30px,3.4vw,40px)}
}
.hero-top{margin-bottom:26px}
.logo{height:56px;width:auto;background:#fff;border-radius:10px;padding:7px 12px}
.logo-txt{font-weight:800;font-size:19px;color:var(--gold);letter-spacing:.01em}
.eyebrow{color:var(--gold);font-weight:700;font-size:15px;letter-spacing:.04em;
  text-transform:uppercase;margin:0 0 10px}
.hero h1{color:#fff;font-size:clamp(27px,5.2vw,42px);max-width:17ch;margin-bottom:10px}
.hero-site{color:rgba(255,255,255,.82);font-size:16px;margin:0}
.hero-meta{display:flex;flex-wrap:wrap;gap:10px;margin-top:24px}
.hero-meta>div{background:rgba(255,255,255,.10);border:1px solid rgba(255,255,255,.16);
  border-radius:9px;padding:9px 14px;min-width:0}
.hero-meta dt{font-size:11.5px;text-transform:uppercase;letter-spacing:.07em;
  color:rgba(255,255,255,.66);font-weight:600}
.hero-meta dd{font-size:15px;font-weight:700;color:#fff;white-space:nowrap}
.hero-img{background:var(--navy)}
.hero-img .imgbox{border-radius:0}

.intro{max-width:760px;margin:0 auto;padding:36px 24px 6px;font-size:18.5px;color:var(--body)}

/* ── nav ────────────────────────────────────────────────────────────── */
.nav{position:sticky;top:0;z-index:30;background:rgba(255,255,255,.94);
  backdrop-filter:saturate(180%) blur(12px);border-bottom:1px solid var(--line);margin-top:28px}
.nav ul{display:flex;gap:4px;list-style:none;overflow-x:auto;padding:0 16px;
  max-width:1060px;margin:0 auto;scrollbar-width:none}
.nav ul::-webkit-scrollbar{display:none}
.nav a{display:block;padding:15px 12px;font-size:14.5px;font-weight:650;color:var(--muted);
  text-decoration:none;white-space:nowrap;border-bottom:3px solid transparent}
.nav a:hover,.nav a:focus-visible{color:var(--navy);border-bottom-color:var(--gold)}

/* ── sections ───────────────────────────────────────────────────────── */
.sec{padding:46px 24px;border-bottom:1px solid var(--line)}
.sec:last-of-type{border-bottom:none}
.sec>h2{font-size:clamp(21px,3.2vw,28px);margin-bottom:22px;position:relative;padding-bottom:12px}
.sec>h2::after{content:"";position:absolute;left:0;bottom:0;width:52px;height:4px;
  background:var(--gold);border-radius:2px}
.lede{font-size:17px;color:var(--muted);margin-bottom:20px;max-width:62ch}
.note{font-size:15px;color:var(--muted);margin-top:16px;padding-left:14px;
  border-left:3px solid var(--line)}
.prose p{max-width:66ch}

.imgbox{position:relative;overflow:hidden;background:var(--soft);border-radius:12px}
.imgbox img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}

/* ── system ─────────────────────────────────────────────────────────── */
.sys{display:grid;gap:28px}
@media(min-width:860px){.sys{grid-template-columns:360px 1fr;align-items:start}}
.sys-card{aspect-ratio:4/3;border-radius:12px;background:linear-gradient(160deg,var(--navy),var(--navy-2));
  color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;
  text-align:center;padding:24px}
.sys-card-brand{font-size:20px;font-weight:700;color:var(--gold)}
.sys-card-kw{font-size:40px;font-weight:800;line-height:1}
.sys-card-type{font-size:14px;color:rgba(255,255,255,.75)}
.specs{display:grid;gap:0;border-top:1px solid var(--line)}
.specs>div{display:flex;justify-content:space-between;gap:20px;align-items:baseline;
  padding:12px 2px;border-bottom:1px solid var(--line)}
.specs dt{color:var(--muted);font-size:15.5px;flex:0 0 auto}
.specs dd{font-weight:700;color:var(--ink);text-align:right;font-size:16px;
  overflow-wrap:anywhere;min-width:0}
.sys-price{display:flex;flex-wrap:wrap;align-items:baseline;gap:10px;margin-top:22px;
  padding:18px 20px;background:var(--soft);border-radius:12px;border:1px solid var(--line)}
.sys-price span{color:var(--muted);font-size:15px;font-weight:600}
.sys-price strong{font-size:clamp(26px,4.4vw,34px);color:var(--navy);letter-spacing:-.02em}
.sys-price small{color:var(--muted);font-size:13.5px}

/* ── inclusion cards ────────────────────────────────────────────────── */
.cards{list-style:none;display:grid;gap:14px;
  grid-template-columns:repeat(auto-fill,minmax(232px,1fr))}
.card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:20px 18px;
  box-shadow:var(--shadow);display:flex;flex-direction:column;gap:9px}
.card-ic{width:40px;height:40px;border-radius:10px;background:var(--soft);
  display:flex;align-items:center;justify-content:center;flex:0 0 auto}
.ic{width:21px;height:21px;fill:none;stroke:var(--navy);stroke-width:1.8;
  stroke-linecap:round;stroke-linejoin:round}
.card h3{font-size:16.5px}
.card p{font-size:14.8px;color:var(--muted);line-height:1.55}

/* ── tables ─────────────────────────────────────────────────────────── */
.tablewrap{border:1px solid var(--line);border-radius:12px;overflow:hidden}
.grid{width:100%;border-collapse:collapse;font-size:16px}
.grid thead th{background:var(--soft);text-align:left;font-size:12.5px;
  text-transform:uppercase;letter-spacing:.06em;color:var(--muted);padding:13px 18px;font-weight:700}
.grid tbody th,.grid td{padding:14px 18px;border-top:1px solid var(--line);text-align:left;
  vertical-align:top}
.grid tbody th{font-weight:700;color:var(--ink)}
.pill{display:inline-block;background:var(--soft);border:1px solid var(--line);
  border-radius:999px;padding:4px 12px;font-size:13.5px;color:var(--body);font-weight:600}
.pill.ok{background:#EAF6EF;border-color:#CBE7D7;color:var(--ok)}

/* ── gallery ────────────────────────────────────────────────────────── */
.gallery{list-style:none;display:grid;gap:18px;grid-template-columns:1fr}
.shot{background:#fff;border:1px solid var(--line);border-radius:12px;overflow:hidden;
  box-shadow:var(--shadow);display:flex;flex-direction:column}
.shot-btn{display:block;width:100%;padding:0;border:0;background:none;cursor:pointer}
.shot-btn .imgbox{border-radius:0}
.shot-body{padding:16px 18px 18px;display:flex;flex-direction:column;gap:6px;flex:1}
.shot h3{font-size:17px}
.shot-facts{font-size:13.5px;color:var(--gold-d);font-weight:700;letter-spacing:.01em}
.shot p{font-size:14.8px;color:var(--muted);line-height:1.55}

/* ── reviews ────────────────────────────────────────────────────────── */
.quotes{list-style:none;display:grid;gap:18px;grid-template-columns:1fr}
.quote{background:var(--soft);border:1px solid var(--line);border-radius:12px;padding:22px 20px;
  display:flex;flex-direction:column;gap:12px}
.stars{display:flex;gap:2px}
.st{width:17px;height:17px;fill:#D8DCE6;stroke:none}
.st.on{fill:var(--gold)}
.quote blockquote p{font-size:16px;color:var(--ink);line-height:1.62}
.byline{display:flex;flex-wrap:wrap;gap:8px;align-items:baseline;font-size:14px;
  color:var(--muted);margin-top:auto}
.byline strong{color:var(--ink);font-size:14.5px}
.byline .src{margin-left:auto;font-size:12.5px;opacity:.85}

/* ── trust ──────────────────────────────────────────────────────────── */
.ticks{list-style:none;display:grid;gap:11px;margin-bottom:26px;
  grid-template-columns:repeat(auto-fill,minmax(270px,1fr))}
.ticks li{display:flex;gap:11px;align-items:flex-start;font-size:16px}
.ic.tick{stroke:var(--ok);stroke-width:2.4;flex:0 0 auto;margin-top:3px}
.facts{display:grid;gap:0;border-top:1px solid var(--line)}
.facts>div{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px 22px;
  padding:13px 2px;border-bottom:1px solid var(--line)}
.facts dt{color:var(--muted);font-size:15.5px}
.facts dd{font-weight:650;color:var(--ink);text-align:right;overflow-wrap:anywhere}
.facts.wide>div{flex-direction:column;gap:4px}
.facts.wide dd{text-align:left;font-weight:500;color:var(--body)}

/* ── options ────────────────────────────────────────────────────────── */
.opts{list-style:none;display:grid;gap:12px}
.opt{display:flex;gap:14px;align-items:flex-start;padding:18px;border:2px solid var(--line);
  border-radius:12px;cursor:pointer;background:#fff;min-height:48px}
.opt:has(input:checked){border-color:var(--gold);background:#FFFCF0}
.opt input{width:22px;height:22px;flex:0 0 auto;margin-top:2px;accent-color:var(--navy)}
.opt-body{display:flex;flex-direction:column;gap:5px;min-width:0;flex:1}
.opt-h{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:baseline;justify-content:space-between}
.opt-h strong{font-size:16.5px;color:var(--ink)}
.opt-h em{font-style:normal;font-weight:700;color:var(--navy);font-size:16px;white-space:nowrap}
.opt-d{font-size:14.8px;color:var(--muted);line-height:1.55}

/* ── investment ─────────────────────────────────────────────────────── */
.inv{display:grid;gap:26px}
@media(min-width:900px){.inv{grid-template-columns:1fr 1fr;gap:40px;align-items:start}}
.inv-b{display:flex;flex-direction:column}
.inv-lines{display:grid;border-top:1px solid var(--line)}
.inv-lines>div{display:flex;justify-content:space-between;gap:20px;padding:12px 2px;
  border-bottom:1px solid var(--line)}
.inv-lines dt{color:var(--muted);font-size:15.5px}
.inv-lines dd{font-weight:650;color:var(--ink)}
.inv-opt dt::before{content:"+ ";color:var(--gold-d);font-weight:700}
.inv-total{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px 14px;margin-top:0;
  padding:24px;border-radius:14px;background:linear-gradient(160deg,var(--navy),var(--navy-2));color:#fff}
.inv-total span{font-size:15px;color:rgba(255,255,255,.78);font-weight:600;flex:1 0 100%}
.inv-total strong{font-size:clamp(34px,7vw,46px);letter-spacing:-.025em;line-height:1.1;
  color:var(--gold);overflow-wrap:anywhere}
.inv-total small{font-size:14px;color:rgba(255,255,255,.78)}
.inv-dep{margin-top:18px;font-size:16px}
.stages{margin:18px 0 0 20px;display:grid;gap:7px;font-size:15.5px}

/* ── acceptance ─────────────────────────────────────────────────────── */
.accept{max-width:620px;margin-inline:auto;background:#fff;border:1px solid var(--line);
  border-radius:16px;padding:28px 26px 30px;box-shadow:var(--shadow)}
@media(max-width:719px){.accept{padding:22px 18px 24px;border-radius:14px}}
.accept-total{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 12px;margin-bottom:22px;
  padding:18px 20px;background:var(--soft);border:1px solid var(--line);border-radius:12px}
.accept-total span{color:var(--muted);font-size:15px;font-weight:600;flex:1 0 100%}
.accept-total strong{font-size:clamp(26px,5vw,34px);color:var(--navy);letter-spacing:-.02em}
.fld{margin-bottom:16px}
.fld label{display:block;font-weight:650;color:var(--ink);margin-bottom:7px;font-size:15.5px}
.fld input{width:100%;font:inherit;font-size:16px;padding:14px 15px;border:1.5px solid var(--line);
  border-radius:10px;background:#fff;color:var(--ink);min-height:52px}
.fld input:focus-visible{outline:none;border-color:var(--navy);box-shadow:0 0 0 3px rgba(22,32,74,.12)}
.terms{border:1px solid var(--line);border-radius:10px;margin-bottom:16px;background:var(--soft)}
.terms summary{padding:15px 18px;cursor:pointer;font-weight:650;color:var(--ink);min-height:48px;
  display:flex;align-items:center;justify-content:space-between;gap:12px;list-style:none}
.terms summary::-webkit-details-marker{display:none}
.terms summary::after{content:"";width:9px;height:9px;border-right:2px solid var(--muted);
  border-bottom:2px solid var(--muted);transform:rotate(45deg);margin-right:4px;flex:0 0 auto}
.terms[open] summary::after{transform:rotate(-135deg)}
.terms-body{padding:0 18px 18px;font-size:15px;color:var(--body);max-height:300px;overflow:auto}
.chk{display:flex;gap:12px;align-items:flex-start;margin-bottom:22px;cursor:pointer;
  font-size:15.8px;min-height:48px;padding:4px 0}
.chk input{width:24px;height:24px;flex:0 0 auto;margin-top:1px;accent-color:var(--navy)}
.actions{display:flex;flex-wrap:wrap;gap:12px}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:52px;
  padding:14px 26px;border-radius:11px;font:inherit;font-size:16.5px;font-weight:700;
  cursor:pointer;border:2px solid transparent;text-decoration:none;transition:background .15s,border-color .15s}
.btn.primary{background:var(--gold);color:#241C00;border-color:var(--gold)}
.btn.primary:hover{background:var(--gold-d);border-color:var(--gold-d)}
.btn.ghost{background:#fff;color:var(--navy);border-color:var(--line)}
.btn.ghost:hover{border-color:var(--navy)}
.btn:focus-visible{outline:3px solid var(--navy);outline-offset:2px}
.err{color:#B3261E;font-weight:650;margin-top:14px;font-size:15.5px}
.accepted{background:#EAF6EF;border:1px solid #CBE7D7;border-radius:12px;padding:24px;
  font-size:16.5px;color:#14532D;max-width:620px}
.accepted .actions{margin-top:16px}

/* ── sticky bar ─────────────────────────────────────────────────────── */
.sticky{position:fixed;left:0;right:0;bottom:0;z-index:40;background:rgba(255,255,255,.97);
  backdrop-filter:blur(12px);border-top:1px solid var(--line);
  padding:10px 16px calc(10px + env(safe-area-inset-bottom));
  box-shadow:0 -4px 20px rgba(22,32,74,.08)}
.sticky-in{max-width:1060px;margin:0 auto;display:flex;align-items:center;gap:14px}
.sticky-t{display:flex;flex-direction:column;line-height:1.22;min-width:0;flex:1}
.sticky-t small{font-size:11.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;
  font-weight:650}
.sticky-t strong{font-size:21px;color:var(--navy);letter-spacing:-.02em;overflow-wrap:anywhere}
.sticky-btn{flex:0 0 auto;min-height:48px;padding:12px 22px;font-size:16px}

/* ── lightbox ───────────────────────────────────────────────────────── */
.lightbox{position:fixed;inset:0;z-index:60;background:rgba(10,14,32,.94);
  display:flex;align-items:center;justify-content:center;padding:20px}
.lightbox[hidden]{display:none}
.lightbox img{max-width:100%;max-height:88vh;border-radius:10px;object-fit:contain}
.lb-close{position:absolute;top:14px;right:16px;width:52px;height:52px;border-radius:50%;
  border:none;background:rgba(255,255,255,.14);color:#fff;font-size:30px;cursor:pointer;line-height:1}

/* ── footer ─────────────────────────────────────────────────────────── */
.foot{padding:34px 24px 44px;text-align:center;color:var(--muted);font-size:14.5px;
  border-top:1px solid var(--line);background:var(--soft)}
.foot strong{color:var(--ink)}
.foot .rev{margin-top:10px;font-size:12.5px;opacity:.8}

/* ── narrow screens: tables become cards ────────────────────────────── */
@media(max-width:719px){
  body{font-size:16.5px}
  .sec{padding:38px 18px}
  .hero-in{padding:26px 18px 30px}
  .intro{padding:30px 18px 4px;font-size:17.5px}
  .tablewrap{border:none;border-radius:0}
  .grid,.grid tbody,.grid tr{display:block;width:100%}
  .grid thead{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);
    clip-path:inset(50%);white-space:nowrap}
  .grid tr{border:1px solid var(--line);border-radius:12px;padding:6px 16px 12px;
    margin-bottom:12px;background:#fff;box-shadow:var(--shadow)}
  .grid tbody th,.grid td{display:block;border-top:none;padding:9px 0}
  .grid tbody th{font-size:17.5px;padding-top:13px}
  .grid td::before{content:attr(data-l);display:block;font-size:11.5px;text-transform:uppercase;
    letter-spacing:.06em;color:var(--muted);font-weight:700;margin-bottom:3px}
  .cards{grid-template-columns:1fr}
  .doc{padding-bottom:104px}
}
@media(min-width:720px){
  .cards{grid-template-columns:repeat(2,1fr)}
  .gallery.g2,.gallery.g3,.quotes.g2,.quotes.g3{grid-template-columns:repeat(2,1fr)}
  .gallery.g1,.quotes.g1{max-width:560px}
}
@media(min-width:1024px){
  .cards{grid-template-columns:repeat(auto-fill,minmax(232px,1fr))}
  .gallery.g3,.quotes.g3{grid-template-columns:repeat(3,1fr)}
}
@media(prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
`;

/** Print rules. Applied for mode:'print' and also inside @media print for web. */
const PRINT_ONLY = `
@page{size:A4;margin:14mm 12mm}
body{font-size:11pt;background:#fff}
.doc{max-width:none;padding-bottom:0}
.sec{padding:16pt 0;break-inside:auto}
.sec>h2{break-after:avoid}
.card,.shot,.quote,.opt,.inv-total,.accept-total{break-inside:avoid}
.grid tr{break-inside:avoid}
.hero{-webkit-print-color-adjust:exact;print-color-adjust:exact}
.inv-total,.hero,.sys-card{-webkit-print-color-adjust:exact;print-color-adjust:exact}
.cards{grid-template-columns:repeat(3,1fr)!important}
.gallery,.quotes{grid-template-columns:repeat(2,1fr)!important}
.hero-in{padding:18pt 0}
/* A4 inside its margins is narrower than the desktop breakpoint, so the
   multi-column layouts have to be asked for explicitly here. Without this the
   system card and the hero image each swallowed most of a page. */
.sys{grid-template-columns:200pt 1fr!important;gap:18pt!important}
.sys-card{aspect-ratio:auto!important;min-height:130pt;padding:16pt}
.sys-card-kw{font-size:30pt}
.hero-img .imgbox{aspect-ratio:16/4!important;width:100%}
.inv{grid-template-columns:1fr 1fr!important;gap:24pt!important}
.gallery .imgbox{aspect-ratio:16/10!important;width:100%}
.shot h3{font-size:12pt}
.accept{max-width:none;border:none;box-shadow:none;padding:0}
.foot{background:none}
`;

// The customer page's own behaviour. Deliberately tiny: no framework, no
// polyfills, and nothing that blocks first paint.
const SCRIPT = `
(function(){
  "use strict";
  var lb=document.getElementById('lightbox'),lbImg=document.getElementById('lbImg'),
      lbClose=document.getElementById('lbClose'),last=null;
  function openLb(src,alt){ if(!lb)return; last=document.activeElement;
    lbImg.src=src; lbImg.alt=alt||''; lb.hidden=false; lbClose.focus(); }
  function closeLb(){ if(!lb)return; lb.hidden=true; lbImg.src='';
    if(last&&last.focus)last.focus(); }
  document.addEventListener('click',function(e){
    var b=e.target.closest&&e.target.closest('.shot-btn');
    if(b){ var im=b.querySelector('img'); if(im) openLb(im.currentSrc||im.src,im.alt); return; }
    if(lb&&!lb.hidden&&(e.target===lb||e.target===lbClose)) closeLb();
  });
  document.addEventListener('keydown',function(e){ if(e.key==='Escape') closeLb(); });

  // Mutually exclusive upgrade groups, enforced in the page as well as on the
  // server: picking one in a group clears the others.
  document.addEventListener('change',function(e){
    var el=e.target; if(!el.classList||!el.classList.contains('opt-in'))return;
    var g=el.getAttribute('data-group');
    if(g&&el.checked){
      document.querySelectorAll('.opt-in[data-group="'+g+'"]').forEach(function(o){
        if(o!==el) o.checked=false; });
    }
    if(window.NACQuote&&window.NACQuote.onOptionsChanged){
      window.NACQuote.onOptionsChanged(selectedOptions());
    }
  });
  function selectedOptions(){
    return Array.prototype.slice.call(document.querySelectorAll('.opt-in:checked'))
      .map(function(i){return i.value;});
  }

  var form=document.getElementById('acceptForm');
  if(form){
    form.addEventListener('submit',function(e){
      e.preventDefault();
      var err=document.getElementById('acceptErr');
      var name=(document.getElementById('acc-name')||{}).value||'';
      var ok=(document.getElementById('acc-terms')||{}).checked;
      function fail(m){ if(err){err.textContent=m;err.hidden=false;} }
      if(!name.trim()) return fail('Please enter your name.');
      if(!ok) return fail('Please confirm you have read the terms.');
      if(err)err.hidden=true;
      var btn=document.getElementById('acceptBtn');
      if(btn){btn.disabled=true;btn.textContent='Sending…';}
      if(window.NACQuote&&window.NACQuote.accept){
        window.NACQuote.accept({name:name.trim(),acknowledgedTerms:true,
          selectedOptionIds:selectedOptions()});
      }
    });
  }
  var dec=document.getElementById('declineBtn');
  if(dec) dec.addEventListener('click',function(){
    if(window.NACQuote&&window.NACQuote.decline) window.NACQuote.decline();
  });
  var ask=document.getElementById('askBtn');
  if(ask) ask.addEventListener('click',function(){
    if(window.NACQuote&&window.NACQuote.ask) window.NACQuote.ask();
  });
})();
`;

// Web builds get the print rules too, so Cmd-P from the customer link produces
// the same document the PDF does rather than a screenshot of a web page.
export const PRINT_CSS = PRINT_ONLY;
