// ─────────────────────────────────────────────────────────────────────────────
// WHO IS ALLOWED TO SEE WHAT NAC PAYS
//
// Nick, 8 November 2026: "The inspection reported that every signed-in user
// could see costs and margins." It did, and it was right.
//
// There was no role model in this application at all. designer/rls.sql says so
// in as many words: "Any authenticated user is treated as NAC staff; there is
// no second tier, because NAC is one team and inventing roles nobody asked for
// would be guesswork." That was the correct call in October. It is the wrong
// one now that NAC has asked for the separation, so this file is the second
// tier — and it is still not guesswork, because it reads WHO IS AN OWNER out
// of configuration rather than deciding.
//
// ── WHAT A TECHNICIAN MUST NOT SEE ──────────────────────────────────────────
//
// The money that is NAC's business and not the customer's:
//
//   · supplier cost prices (`nac_brands_v4`, the MMEM list)
//   · the job fee, which IS the margin on NAC's pricing method
//   · the installation allowances
//   · the contingency percentage
//
// All four live in `nac_settings`, which the BROWSER reads directly over
// PostgREST with the signed-in user's token. That is why hiding the fields
// would have been theatre: the data is one `fetch` away in the page the
// technician is already holding. It has to be closed in three places and this
// file is the one they agree on —
//
//   1. the DATABASE (designer/roles-rls.sql): the row-level policy that
//      actually stops the read. Nothing else is a control.
//   2. the SERVER (server/roles.js): every endpoint that could hand the same
//      figures back another way.
//   3. the SCREEN: so a technician is told, not confused.
//
// ── WHAT A TECHNICIAN MUST STILL BE ABLE TO DO ──────────────────────────────
//
// Everything that is their job. Take an enquiry, upload a plan, measure rooms,
// run the sizing, record site checks, prepare a handover, confirm that the
// equipment is on site and that a date is agreed. A permission model that
// stops the crew working gets switched off within a week, and then there is no
// permission model.
//
// ── AND NOBODY IS AN OWNER BY DEFAULT ───────────────────────────────────────
//
// With nothing configured, this returns `technician` for everyone and says
// `configured: false`. It does NOT fall back to treating all staff as owners:
// a permission layer whose unconfigured state is "everyone" is the bug it was
// written to fix. The screens read `configured` and print the one setting that
// has to be made, which is a deployment action and is documented as one.
// ─────────────────────────────────────────────────────────────────────────────

const str = (v) => String(v ?? '').trim();
const lower = (v) => str(v).toLowerCase();

/** The roles. There are three and there is no fourth. */
export const ROLE = Object.freeze({
  /** Nick, and anybody he says stands in his place. Sees everything. */
  OWNER: 'owner',
  /** The same reach as an owner. A separate word only so Nick can tell them apart. */
  ADMIN: 'admin',
  /** NAC staff doing the work. No costs, no margins, no pricing settings. */
  TECHNICIAN: 'technician'
});

export const INTERNAL_ROLES = Object.freeze([ROLE.OWNER, ROLE.ADMIN, ROLE.TECHNICIAN]);

/** Roles that may see what NAC pays and what NAC makes. */
export const PRICING_ROLES = Object.freeze([ROLE.OWNER, ROLE.ADMIN]);

/**
 * Every capability this application gates on, and who has it.
 *
 * Written out in full rather than derived, so the answer to "can a technician
 * do X" is read rather than reasoned about. A capability absent from a role's
 * list is denied; there is no implicit grant.
 */
export const CAPABILITIES = Object.freeze({
  /** Read supplier costs, the job fee, allowances, contingency. */
  VIEW_INTERNAL_PRICING: 'view_internal_pricing',
  /** Change them. */
  EDIT_PRICING_SETTINGS: 'edit_pricing_settings',
  /** Approve a revision and issue the customer link. Nick's, by his own rule. */
  ISSUE_QUOTE: 'issue_quote',
  /** Take enquiries, build drafts, measure rooms, run the sizing. */
  ASSESS: 'assess',
  /** See the list of issued quotes and where each stands. */
  VIEW_QUOTE_STATUS: 'view_quote_status',
  /** Prepare a handover from an accepted revision, and record site checks. */
  PREPARE_HANDOVER: 'prepare_handover',
  /** Confirm the equipment is available and the date is agreed. */
  CONFIRM_SITE_FACTS: 'confirm_site_facts',
  /** Confirm the DEPOSIT. Money, so owners only. */
  CONFIRM_DEPOSIT: 'confirm_deposit'
});

const C = CAPABILITIES;

const GRANTS = Object.freeze({
  [ROLE.OWNER]: Object.freeze([
    C.VIEW_INTERNAL_PRICING, C.EDIT_PRICING_SETTINGS, C.ISSUE_QUOTE, C.ASSESS,
    C.VIEW_QUOTE_STATUS, C.PREPARE_HANDOVER, C.CONFIRM_SITE_FACTS, C.CONFIRM_DEPOSIT
  ]),
  [ROLE.ADMIN]: Object.freeze([
    C.VIEW_INTERNAL_PRICING, C.EDIT_PRICING_SETTINGS, C.ISSUE_QUOTE, C.ASSESS,
    C.VIEW_QUOTE_STATUS, C.PREPARE_HANDOVER, C.CONFIRM_SITE_FACTS, C.CONFIRM_DEPOSIT
  ]),
  // A technician does the work and sees the job. Not the costs, not the
  // margin, and not the button that commits NAC to a price.
  [ROLE.TECHNICIAN]: Object.freeze([
    C.ASSESS, C.VIEW_QUOTE_STATUS, C.PREPARE_HANDOVER, C.CONFIRM_SITE_FACTS
  ])
});

/** Is this a role word this application knows? */
export function isRole(v) {
  return INTERNAL_ROLES.includes(lower(v));
}

/** What a role may do. An unknown role may do nothing. */
export function capabilitiesOf(role) {
  return GRANTS[lower(role)] || [];
}

/** May this role do this? */
export function can(role, capability) {
  return capabilitiesOf(role).includes(capability);
}

/**
 * Parse the owner allowlist out of its environment variable.
 *
 * `NAC_OWNER_EMAILS` is a comma or whitespace separated list of email
 * addresses. It is SERVER-SIDE configuration and never reaches a browser; the
 * only thing a browser is ever told is its own role.
 */
export function parseOwnerEmails(raw) {
  return String(raw ?? '')
    .split(/[,\s;]+/)
    .map(lower)
    .filter(v => v.includes('@'));
}

/**
 * Resolve the role of a VERIFIED user.
 *
 * `user` must be what Supabase's own /auth/v1/user returned — this never
 * decides for itself that a token is good, and it never reads a role off
 * anything the browser sent.
 *
 * Precedence, highest first:
 *
 *   1. `app_metadata.nac_role` on the Supabase user. Only a Supabase admin
 *      can write app_metadata; the user cannot set it on themselves. (The
 *      user_metadata twin IS user-writable and is deliberately ignored.)
 *   2. a row in `nac_staff_roles` for their email.
 *   3. the `NAC_OWNER_EMAILS` allowlist.
 *   4. technician.
 *
 * @param {object|null} user
 * @param {object} config { ownerEmails: string[], roleRows: [{email, role}] }
 */
export function resolveRole(user, config = {}) {
  if (!user || !str(user.id || user.email)) {
    return { signedIn: false, email: null, role: null, source: 'not_signed_in',
             capabilities: [], configured: isConfigured(config) };
  }

  const email = lower(user.email);
  const ownerEmails = Array.isArray(config.ownerEmails) ? config.ownerEmails : [];
  const roleRows = Array.isArray(config.roleRows) ? config.roleRows : [];
  const configured = isConfigured(config);

  const decide = () => {
    // 1. Supabase app_metadata, which only an admin can set.
    const claimed = lower(user.app_metadata?.nac_role);
    if (isRole(claimed)) return { role: claimed, source: 'supabase_app_metadata' };

    // 2. The roles table.
    const row = roleRows.find(r => lower(r.email ?? r.user_email) === email && email);
    if (row && isRole(row.role)) return { role: lower(row.role), source: 'nac_staff_roles' };

    // 3. The deployment allowlist.
    if (email && ownerEmails.includes(email)) {
      return { role: ROLE.OWNER, source: 'NAC_OWNER_EMAILS' };
    }

    // 4. NOT an owner. Being signed in is not being Nick.
    return { role: ROLE.TECHNICIAN,
             source: configured ? 'default_technician' : 'roles_not_configured' };
  };

  const { role, source } = decide();
  return {
    signedIn: true,
    email: user.email || null,
    role,
    source,
    capabilities: capabilitiesOf(role),
    configured,
    /**
     * Said out loud, because a screen that silently shows a technician's view
     * to the owner is a screen that gets described as broken rather than as
     * unconfigured.
     */
    note: configured ? null
      : 'No owner has been configured, so every signed-in user is treated as a '
        + 'technician and internal pricing is closed to everybody. Set '
        + 'NAC_OWNER_EMAILS in the server environment, or add a row to '
        + 'nac_staff_roles.'
  };
}

/** Has anybody told this deployment who the owners are? */
export function isConfigured(config = {}) {
  const ownerEmails = Array.isArray(config.ownerEmails) ? config.ownerEmails : [];
  const roleRows = Array.isArray(config.roleRows) ? config.roleRows : [];
  return ownerEmails.length > 0
    || roleRows.some(r => isRole(r.role) && lower(r.email ?? r.user_email).includes('@'));
}

/**
 * The fields a response must not carry to somebody without
 * VIEW_INTERNAL_PRICING.
 *
 * Named rather than inferred, so adding one to the settings record and
 * forgetting it here is a test failure (tests/roles.test.mjs walks the real
 * settings object against this list) rather than a leak.
 */
export const INTERNAL_PRICING_FIELDS = Object.freeze([
  'jobFee', 'jobFeeExGst', 'applyJobFeeOnComponentPricing', 'proposalAllowance',
  'contingencyPct', 'labourRatePerHour', 'cost', 'costExGst', 'supplierCost',
  'margin', 'marginPct', 'feeExGst', 'lines'
]);

/**
 * Strip internal pricing out of anything on its way to somebody who may not
 * see it.
 *
 * Deep, because the figures are nested — `commercial.proposalAllowance.ductwork`
 * is three levels down and a shallow strip would have shipped it.
 */
export function withoutInternalPricing(value) {
  if (Array.isArray(value)) return value.map(withoutInternalPricing);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (INTERNAL_PRICING_FIELDS.includes(k)) continue;
    out[k] = withoutInternalPricing(v);
  }
  return out;
}

export default {
  ROLE, INTERNAL_ROLES, PRICING_ROLES, CAPABILITIES, INTERNAL_PRICING_FIELDS,
  isRole, capabilitiesOf, can, parseOwnerEmails, resolveRole, isConfigured,
  withoutInternalPricing
};
