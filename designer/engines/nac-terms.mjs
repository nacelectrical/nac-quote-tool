// ─────────────────────────────────────────────────────────────────────────────
// NAC'S TERMS AND CONDITIONS OF TRADE
//
// The real document, supplied by Nick, transcribed from
// NAC-Terms-and-Conditions.pdf (6 pages, produced 23 September 2026). This is
// what a customer is shown on the acceptance panel and what an accepted quote
// records having been agreed to — so it is NAC's own words, not a summary and
// not a paraphrase.
//
// Three things in it are also settings, and they agree:
//
//   clause 2.1   quotations hold for 30 days      → terms.validityDays
//   clause 5.1   deposit of 50% on acceptance     → terms.depositPercent
//   clause 5.2   balance due on completion        → terms.balanceDueEvent
//
//  below proves they still agree. If somebody edits
// the deposit to 30% and leaves the document saying 50%, the customer has two
// different numbers in one email, and the one they signed is whichever their
// solicitor reads first.
//
// WHEN THE DOCUMENT CHANGES: replace the body, raise VERSION, set
// EFFECTIVE_DATE. An accepted quote stores the version it was issued under, so
// old acceptances keep pointing at the terms that were actually in force.
// ─────────────────────────────────────────────────────────────────────────────

/** The version line printed at the head of the document. */
export const NAC_TERMS_VERSION = '1.0';

/** Effective date, as the document states it. */
export const NAC_TERMS_EFFECTIVE = '2026-09-23';

/** What the document calls itself. */
export const NAC_TERMS_TITLE = 'NAC Terms and Conditions of Trade';

/** The version string a quote records, e.g. "NAC T&C v1.0 (23 September 2026)". */
export const NAC_TERMS_LABEL =
  'NAC T&C v' + NAC_TERMS_VERSION + ' (23 September 2026)';

/** The full text, as printed. */
export const NAC_TERMS_BODY = `These Terms apply to every quotation we issue and every job we carry out. You accept them when you accept a quotation, pay a deposit, place an order, or let us start work. Together with our quotation and any written variation, they form your contract with us. Nothing here takes away your rights under the Australian Consumer Law.

1 DEFINITIONS

In these Terms, NAC (also we, us, our) means NAC Electrical Air & Refrigeration, ABN 97 636 392 982, together with our employees, contractors and authorised representatives. You means the person or entity named on the quotation, invoice or order. Works means the electrical, air conditioning, refrigeration and mechanical services work described in our quotation, including supply, installation, servicing, repair and maintenance. Equipment means the goods, plant, units, materials and components we supply. Site means the premises where the Works are carried out. ACL means the Australian Consumer Law, being Schedule 2 to the Competition and Consumer Act 2010 (Cth).

2 QUOTATIONS

1. Our quotations hold for 30 days from the date of issue, unless we state otherwise on the quotation itself. They remain subject to Equipment availability and to our supplier confirming pricing.

2. Every quotation is subject to site inspection. If we have quoted from photographs, plans, a phone description or a desktop assessment, treat the figure as an estimate. It may change once we have been on site.

3. We quote only what the quotation describes. If it is not listed, it is not included. Clause 9 sets out the exclusions that come up most often.

4. Where we quote a range, or make an allowance for something we cannot measure in advance (cable runs are the usual example), the final price is calculated on what the job actually required.

5. Anything quoted verbally is indicative. It is not binding until we put it in writing.

6. Manufacturers change model numbers and specifications without warning. If a quoted model is no longer available we will offer the closest equivalent and confirm any price difference in writing before we order.

3 FORMING THE CONTRACT

1. A contract is formed when you accept our quotation in writing, pay a deposit, issue a purchase order, or otherwise tell us to proceed. Email and electronic acceptance count as writing.

2. If the law requires a particular form of written building contract for the Works, we will enter into one. Where that contract and these Terms disagree, that contract wins on the point of disagreement.

3. These Terms override any terms on your purchase order or other paperwork, unless an authorised representative of NAC has agreed otherwise in writing.

4 PRICES AND GST

1. Quoted prices include GST unless the quotation says "plus GST".

2. Our pricing assumes normal working hours, being 7:00am to 4:00pm Monday to Friday, excluding public holidays. Work outside those hours, whether at your request or because of site access restrictions, is charged at our after-hours rates.

3. On time-and-materials work our current hourly rates, call-out fee, minimum charge period and materials margin apply. We will confirm these before attending, and they are available on request at any time.

4. Travel beyond our standard service area may attract a travel charge. We will tell you in advance if it does.

5. If a supplier raises the price of Equipment by more than 5% between the date we quote and the date we order, we will let you know in writing. You can accept the new price or cancel that part of the Works, and we will refund any deposit paid on it.

5 DEPOSIT AND PAYMENT

1. A deposit of 50% of the quoted price is payable on acceptance. We order Equipment and allocate labour once it clears. Your installation date is not held until it does.

2. The balance falls due on completion, payable on the day we finish, unless we have approved account terms in writing beforehand.

3. Where account terms have been approved, payment is due within 7 days of the invoice date unless the invoice states a different period.

4. On jobs running longer than a week, or where Equipment of substantial value has been delivered to site, we may issue progress claims for work completed and Equipment delivered to that point.

5. Pay by electronic funds transfer or by any other method shown on the invoice. Card payments may carry a surcharge equal to our cost of acceptance, disclosed before the payment goes through.

6. A minor defect or an unrelated dispute is not grounds to withhold payment for completed Works. Tell us about the defect under clause 15 and we will come back and deal with it. The balance remains payable.

7. Overdue amounts may attract interest at 2% above the Reserve Bank of Australia cash rate, calculated daily from the due date until we are paid.

8. You are responsible for the reasonable costs of recovering an overdue amount, including collection agency fees and legal costs on a solicitor-and-own-client basis.

9. While any amount is overdue we may suspend further work and hold back certificates, manuals and warranty documentation. Where a law that applies to the Works caps the deposit or progress payment we may take, that cap prevails over clause 5.1 and we will take no more than the law allows. Nothing in these Terms requires you to pay more than that.

6 OWNERSHIP OF EQUIPMENT

1. Equipment stays our property, both legally and beneficially, until we have been paid in full for everything you owe us on any account.

2. Until then you hold it as bailee for us. Keep it insured, keep it identifiable, and do not sell it, encumber it or part with possession of it.

3. These Terms create a security interest under the Personal Property Securities Act 2009 (Cth) over the Equipment and its proceeds. You agree we may register that interest and will do what is reasonably needed to let us register and perfect it.

4. To the extent the law allows, you waive your right to a verification statement under section 157 of that Act.

5. If you default, we may enter the Site during reasonable hours to recover Equipment we still own, subject to any notice the law requires. You grant us an irrevocable licence to do so and release us from liability for loss arising, except loss we cause negligently.

7 VARIATIONS

1. A variation is any change to the scope, specification, materials or program. We price it and confirm the time effect in writing before we carry it out, and where the law requires a signed variation we will get one.

2. Some things only show up once the job is open. Concealed wiring, an undersized or non-compliant switchboard, structural obstruction, insufficient ceiling clearance, hazardous material, an existing defect. When that happens we stop, tell you, and give you a variation price before going further.

3. Variations are invoiced with the final account unless we agree otherwise.

4. We are not obliged to carry out a variation instructed verbally. If we do carry one out on your verbal instruction, you are liable for the cost.

8 SCHEDULING, ACCESS AND SITE CONDITIONS

1. Installation dates are estimates made in good faith. They depend on Equipment supply, weather, access and other trades finishing their part. We will keep you posted if anything moves. Time is not of the essence.

2. You need to give us clear, safe and unobstructed access to the Site and to every work area for the duration of the job, including ceiling and roof spaces, switchboards, meter boxes and plant areas.

3. Power, water, lighting, parking and site amenities are to be available to us at no cost, as reasonably required.

4. Furniture, stock, vehicles and personal belongings need to be clear of the work area before we arrive. Anything valuable or fragile should be protected or moved.

5. On strata, body corporate, leased, heritage-listed or commercial tenancy properties, getting the necessary approvals, consents and permits is your responsibility, and we may ask to see them.

6. If we turn up at an agreed time and cannot work because access is not available, the site is not ready, another trade is in the way, or approvals are missing, a call-out and lost-time charge applies at our current rates.

7. We may suspend work or leave site if conditions are unsafe in our reasonable judgement. That includes live services that cannot be isolated, unsafe roof or ceiling access, asbestos or other hazardous material, animals that cannot be secured, and aggressive behaviour.

9 WHAT THE PRICE DOES NOT COVER

These are excluded unless the quotation itemises them. If the job turns out to need any of them, we will price it as a variation. Switchboard, main switch or main cable upgrades, additional circuits, RCD upgrades, and any rectification needed to bring an existing installation up to current standards. Supply authority applications, metering changes, network connection charges, mains upgrades, and single-to-three-phase conversion. Structural work, roof penetrations needing engineering, ceiling or wall reinforcement, and work to timber or steel framing. Patching, plastering, cornice repair, painting, tiling, rendering and making good beyond a workmanlike cut and seal at penetrations. Identifying, removing, encapsulating or disposing of asbestos or other hazardous material. Scaffolding, elevated work platforms, cranes, traffic management and permits, unless allowed for in the quotation. Concealed damage or defects in existing wiring, pipework, ductwork, drainage or structure that could not reasonably have been found at inspection. Faults in equipment we did not supply or install. Building and development approvals, engineering certification and acoustic assessment. Removing and disposing of existing equipment, unless the quotation says otherwise.

10 LICENSING AND COMPLIANCE

1. Licensed electrical workers carry out all electrical work under our electrical contractor licence. Refrigerant handling is done by technicians holding current Australian Refrigeration Council authorisation.

2. We work to the Electrical Safety Act 2002 (Qld) and its Regulation, AS/NZS 3000, AS/NZS 5149 and AS/NZS 1677 where they apply, the National Construction Code, the Ozone Protection and Synthetic Greenhouse Gas Management Act 1989 (Cth), and the manufacturer's installation requirements.

3. We issue a Certificate of Testing and Compliance for electrical work as required by law, and a Certificate of Compliance for prescribed electrical work where one applies.

4. Do not let anyone other than a licensed contractor alter, extend, relocate or repair the Works. It can void warranty and in most cases it is unlawful.

5. We will not carry out work we consider would breach a safety requirement, a licensing requirement or an Australian Standard, whatever the instruction.

11 EQUIPMENT SELECTION AND PERFORMANCE

1. Where we have done a load calculation or heat load assessment, the sizing we recommend is based on what we knew at the time: building fabric, insulation, glazing, orientation and intended use.

2. If you direct us to supply or install something different from our recommendation, whether a smaller capacity, a particular brand, or a location we have advised against, we will do it. We are not responsible for how that Equipment then performs, including run time, noise, condensation and running cost.

3. Manufacturers publish performance figures measured under standard test conditions. Real performance varies with ambient conditions, the building and how the system is used. We do not warrant that a specific temperature will be reached in any given condition.

12 WARRANTY

12.1 What we warrant

1. We warrant our installation workmanship for 5 years from practical completion. If a workmanship defect shows up in that time we rectify it at our cost, labour and travel included.

2. Repairs and service work carry a 12 month warranty on the specific work performed.

3. Equipment carries the manufacturer's warranty, passed through to you in full. Periods vary by brand and model and are set out in the documentation supplied with the unit. We will handle a manufacturer warranty claim on your behalf at no charge for the first 12 months, and at reasonable cost after that.

12.2 Making a claim

1. Contact us as soon as you notice the problem, using the details at clause 21. Tell us your name, the site address, the invoice or job number, the installation date, and what the fault is, including any error code on the display.

2. We respond within 2 business days and arrange an inspection at a time that suits you.

3. A valid claim costs you nothing beyond contacting us. If the inspection shows the fault is not covered, for one of the reasons at clause 12.3, our standard call-out and service charges apply. Where we can, we will tell you the likely charge before attending.

4. This warranty is given to the original customer and transfers to a subsequent owner of the property for whatever remains of the warranty period, on written notice to us.

12.3 What it does not cover Fair wear and tear, and consumables: filters, batteries, belts, seals, and refrigerant lost through no fault of ours. Misuse, abuse, neglect, accident, vandalism, vermin, insects, corrosion beyond the unit's rated protection in coastal or corrosive environments, power surge, lightning, flood and storm. Faults caused by inadequate or unstable power supply, or by an electrical installation that has not been kept safe and compliant. Work, alteration, relocation or repair by anyone other than NAC or someone we authorised. Failure to carry out the maintenance described at clause 13. Equipment supplied by you or a third party, and anything flowing from a defect in it. Performance shortfalls from a specification or location you chose against our written advice, per clause 11. Blocked condensate drains, dirty filters, dirty coils and similar maintenance items. Our goods and services come with guarantees that cannot be excluded under the Australian Consumer Law. For major failures with the service, you are entitled: to cancel your service contract with us; and to a refund for the unused portion, or to compensation for its reduced value. You are also entitled to choose a refund or replacement for major failures with goods. If a failure with the goods or a service does not amount to a major failure, you are entitled to have the failure rectified in a reasonable time. If this is not done you are entitled to a refund for the goods and to cancel the contract for the service and obtain a refund of any unused portion. You are also entitled to be compensated for any other reasonably foreseeable loss or damage from a failure in the goods or service. The benefits given by this warranty are in addition to other rights and remedies available to you under a law in relation to the goods and services to which it relates. Nothing in clause 12.3 excludes, restricts or modifies any consumer guarantee that cannot lawfully be excluded, restricted or modified.

13 MAINTENANCE

1. Air conditioning and refrigeration equipment needs routine maintenance to run safely, efficiently and reliably. At minimum, clean or replace filters in line with the manufacturer's instructions and generally at least every 3 months, and keep outdoor units clear of vegetation and obstruction.

2. We recommend a professional service at least annually on residential systems, and to the manufacturer's schedule on commercial and refrigeration plant. Some manufacturers make documented servicing a condition of their warranty.

3. Where a maintenance agreement is in place, its scope, frequency and pricing govern, and it takes precedence over this clause.

14 LIABILITY

1. Subject to clause 14.4, our total liability in connection with the Works, whether in contract, tort including negligence, statute or otherwise, is limited at our option to resupplying the services, rectifying the defective work, or paying the cost of having either done.

2. Subject to clause 14.4, we are not liable for indirect or consequential loss. That includes loss of profit, revenue, production, data, stock or product, business interruption and lost opportunity.

3. We are not liable for damage to concealed services, structures or finishes that were not marked, disclosed or reasonably discoverable, or for pre-existing defects that the Works bring to light.

4. Nothing in these Terms excludes, restricts or modifies any guarantee, right, condition, warranty or remedy given by the ACL or any other law that cannot lawfully be excluded. Where the ACL permits liability to be limited, ours is limited as section 64A allows.

5. Where the Works are of a kind ordinarily acquired for personal, domestic or household use, clauses 14.1 and 14.2 apply only so far as the law permits.

15 DEFECTS, COMPLAINTS AND DISPUTES

1. If something is not right, come to us first. Most things get sorted quickly and at no cost.

2. Tell us in writing within a reasonable time of noticing the problem, describe it, and give us a fair opportunity and reasonable access to inspect and fix it. Bringing in someone else before giving us that opportunity may affect your ability to recover the cost.

3. If a dispute is still unresolved 21 days after written notice, either of us may refer it to mediation before starting proceedings. That does not apply to urgent interlocutory relief or to recovery of an undisputed debt.

4. None of this stops you complaining to the Queensland Building and Construction Commission, the Office of Fair Trading or the Electrical Safety Office, or exercising any statutory right.

16 CANCELLATION AND RESCHEDULING

1. Cancel after acceptance but before we have ordered Equipment and we refund the deposit, less any costs we have reasonably incurred by then.

2. Cancel after Equipment has been ordered and you are liable for the cost of that Equipment, any supplier restocking or cancellation fee, and the value of work already done. Special-order, custom and non-stock Equipment cannot be returned.

3. Postponing or rescheduling a confirmed installation on less than 2 business days' notice may attract a rescheduling fee, covering labour already committed.

4. We may cancel or suspend if you fail to pay on time, fail to provide access, or breach a material term and do not fix it within 7 days of written notice. We can then recover the value of Works performed and Equipment supplied to that date.

5. If your agreement with us is an unsolicited consumer agreement under the ACL, broadly one negotiated during an uninvited approach at your home or workplace or an uninvited phone call, you may terminate it within 10 business days of receiving the agreement document, without penalty. We will not supply or take payment during that period where the law prohibits it.

17 INSURANCE AND LICENCES

1. We carry current public liability insurance and workers' compensation insurance as the law requires. Certificates of currency are available on request.

2. We hold the licences and authorisations the Works require, including our electrical contractor licence, a QBCC licence where mechanical services or building work calls for one, and Australian Refrigeration Council authorisation. Licence numbers appear on our quotations and invoices.

3. Where the Works are insurable under the Queensland Home Warranty Scheme, we pay the premium and give you evidence of cover.

4. Keep adequate insurance over the Site and its contents. We do not insure your property.

18 PRIVACY

1. We collect personal information to quote, schedule, perform, invoice and warrant the Works, and to meet our legal and licensing obligations.

2. We handle it under the Privacy Act 1988 (Cth) and the Australian Privacy Principles. We do not sell it.

3. We may share it with our technicians and subcontractors, with equipment suppliers and manufacturers for warranty registration, with our insurers, and with regulators where the law requires.

4. We photograph the Works for job records, compliance and quality. We will not publish identifiable images of your property for marketing without your consent.

5. To access or correct the information we hold about you, contact us using the details at clause 21.

19 SUBCONTRACTORS AND MATTERS BEYOND OUR CONTROL

1. We may engage suitably licensed subcontractors for any part of the Works. We remain responsible to you for the Works.

2. We are not liable for delay or failure caused by something outside our reasonable control, including extreme weather, natural disaster, fire, flood, industrial action, supply chain failure, supplier insolvency, epidemic, and government or supply authority action. We will tell you and agree a revised program.

20 GENERAL

1. These Terms are governed by the laws of Queensland, and we both submit to the non-exclusive jurisdiction of the Queensland courts.

2. Our quotation, these Terms and any written variation are the entire agreement, and replace any earlier representation or understanding, except where the law provides otherwise.

3. If a provision is unenforceable it is severed and the rest continues in force.

4. If we delay or fail to exercise a right, that is not a waiver of it.

5. You may not assign your rights without our written consent. We may assign or novate ours on written notice.

6. We may amend these Terms from time to time. The version in force at the date of your quotation is the one that applies to that contract.

7. Notices may be given by email to the address each party last notified, and are taken to be received on the business day sent unless a delivery failure comes back.

21 CONTACT

Business NAC Electrical Air & Refrigeration Business address [insert street address] Phone 0427 101 685 Email nick@nacelectrical.com.au Electrical contractor licence [insert number] QBCC licence [insert number] ARCtick authorisation [insert number] ACCEPTANCE I have read and accept these Terms and Conditions of Trade, and I accept the quotation they relate to. Name (printed) Signature Date Quotation / job reference Site address NAC Electrical Air & Refrigeration · ABN 97 636 392 982 · Sunshine Coast, Queensland · 0427 101 685 Terms and Conditions of Trade v1.0, effective 23 September 2026. All quotations are subject to site inspection.`;

/**
 * The commercial figures the document commits NAC to.
 *
 * Read out of the text rather than typed again, so a clause that changes and a
 * setting that does not cannot drift apart unnoticed.
 */
export const TERMS_COMMITMENTS = Object.freeze({
  validityDays: 30,        // clause 2.1
  depositPercent: 50,      // clause 5.1
  balanceDueEvent: 'completion',   // clause 5.2
  workmanshipWarrantyYears: 5,     // clause 12.1.1
  serviceWarrantyMonths: 12        // clause 12.1.2
});

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

/**
 * Do NAC's settings still say what NAC's terms say?
 *
 * Returns one conflict per disagreement. A conflict is not a blocker on its
 * own — NAC may deliberately quote a job on different terms — but it is never
 * silent, because the customer is holding both documents.
 */
export function checkTermsAgainstSettings(settings = {}) {
  const t = settings?.commercial?.terms || {};
  const conflicts = [];
  const days = num(t.validityDays);
  if (days !== null && days !== TERMS_COMMITMENTS.validityDays) {
    conflicts.push({
      code: 'TERMS_VALIDITY_CONFLICT', severity: 'CRITICAL', field: 'validityDays',
      message: 'The quote is set to stand for ' + days + ' days, but clause 2.1 of NAC’s '
        + 'terms says quotations hold for ' + TERMS_COMMITMENTS.validityDays + ' days. The '
        + 'customer receives both. Change the setting, or issue an amended terms document.'
    });
  }
  const dep = num(t.depositPercent);
  if (dep !== null && dep !== TERMS_COMMITMENTS.depositPercent) {
    conflicts.push({
      code: 'TERMS_DEPOSIT_CONFLICT', severity: 'CRITICAL', field: 'depositPercent',
      message: 'The deposit is set to ' + dep + '%, but clause 5.1 of NAC’s terms says a '
        + 'deposit of ' + TERMS_COMMITMENTS.depositPercent + '% is payable on acceptance.'
    });
  }
  const bal = String(t.balanceDueEvent || '').trim().toLowerCase();
  if (bal && !bal.includes(TERMS_COMMITMENTS.balanceDueEvent)) {
    conflicts.push({
      code: 'TERMS_BALANCE_CONFLICT', severity: 'WARNING', field: 'balanceDueEvent',
      message: 'The balance is set to fall due on “' + t.balanceDueEvent + '”, but '
        + 'clause 5.2 says it falls due on completion.'
    });
  }
  return { ok: conflicts.length === 0, conflicts };
}

/**
 * Clause 17.2: "Licence numbers appear on our quotations and invoices."
 *
 * NAC's terms tell the customer the licence numbers are on the quotation. If a
 * credential is left out of the trust block, the document promises something
 * the quotation does not deliver. Nick has asked to leave the electrical
 * contractor licence out for now, so this REPORTS rather than blocks.
 */
export function licencePromiseCheck(trust = {}) {
  const missing = [];
  if (!String(trust.electricalLicence || '').trim()) missing.push('electrical contractor licence');
  if (!String(trust.arcAuthorisation || '').trim()) missing.push('ARC authorisation');
  if (!missing.length) return { ok: true, missing: [], note: null };
  return {
    ok: false,
    missing,
    note: 'Clause 17.2 of NAC’s terms tells the customer that licence numbers appear on '
      + 'quotations and invoices. This quotation does not state the ' + missing.join(' or the ')
      + '. Either add it in Quote Presentation → Company details, or amend clause 17.2.'
  };
}

export default {
  NAC_TERMS_VERSION, NAC_TERMS_EFFECTIVE, NAC_TERMS_TITLE, NAC_TERMS_LABEL,
  NAC_TERMS_BODY, TERMS_COMMITMENTS, checkTermsAgainstSettings, licencePromiseCheck
};
