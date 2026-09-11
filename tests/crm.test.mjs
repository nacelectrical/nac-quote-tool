// Customers and jobs.
//
// The tests that matter most are the ones about NOT losing anything: a merge
// must never overwrite a value NAC already had, and running the migration twice
// must change nothing the second time.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalisePhone, normaliseEmail, normaliseAddress, normaliseName,
  customerMatch, findCustomer, mergeCustomer, mergeJob, jobMatch, findJob,
  customerId, jobId, planBackfill, planIsEmpty, describePlan, customerIsEmpty
} from '../designer/engines/crm.mjs';

// ── Identity ───────────────────────────────────────────────────────────────

test('an Australian mobile is the same number however it was typed', () => {
  const forms = ['0427 101 685', '0427101685', '+61 427 101 685', '+61427101685',
                 '(0427) 101-685', '0061427101685', '61427101685'];
  const first = normalisePhone(forms[0]);
  assert.ok(first, 'it produces something');
  for (const f of forms) assert.equal(normalisePhone(f), first, f);
});

test('something that is not a phone number produces nothing, not a false match', () => {
  for (const junk of ['', null, undefined, 'n/a', '-', '123', 'call me']) {
    assert.equal(normalisePhone(junk), '', String(junk));
  }
});

test('an address is the same address whether the street type is spelled out', () => {
  const a = normaliseAddress('14 Wattlebird Dr, Springfield Lakes QLD 4300');
  const b = normaliseAddress('14 Wattlebird Drive, Springfield Lakes, Queensland');
  assert.equal(a, b);
  assert.notEqual(a, normaliseAddress('16 Wattlebird Drive, Springfield Lakes'));
});

test('only something that looks like an email counts as one', () => {
  assert.equal(normaliseEmail('  Nick@NACelectrical.com.AU '), 'nick@nacelectrical.com.au');
  for (const junk of ['nick', 'nick@', '@nac.com', 'nick at nac', '']) {
    assert.equal(normaliseEmail(junk), '', junk);
  }
});

// ── Matching ───────────────────────────────────────────────────────────────

test('the same email is the same customer, whatever the name says', () => {
  assert.equal(customerMatch({ name: 'Nick', email: 'n@x.com' },
                             { name: 'Nicholas A', email: 'N@X.com' }), 'email');
});

test('two different emails are two different customers, even with one name', () => {
  assert.equal(customerMatch({ name: 'John Smith', email: 'a@x.com' },
                             { name: 'John Smith', email: 'b@x.com' }), null);
});

test('the same phone is the same customer', () => {
  assert.equal(customerMatch({ name: 'J Smith', phone: '0427101685' },
                             { name: 'John Smith', phone: '+61 427 101 685' }), 'phone');
});

test('a shared name alone is only a match when nothing contradicts it', () => {
  assert.equal(customerMatch({ name: 'John Smith' }, { name: 'john smith' }), 'name');
  assert.equal(customerMatch({ name: 'John Smith', address: '1 A St' },
                             { name: 'John Smith', address: '1 A Street' }), 'name+address');
  // Two John Smiths at different addresses are two people.
  assert.equal(customerMatch({ name: 'John Smith', address: '1 A St' },
                             { name: 'John Smith', address: '99 B Rd' }), null);
  // …and two with different phones.
  assert.equal(customerMatch({ name: 'John Smith', phone: '0400000001' },
                             { name: 'John Smith', phone: '0400000002' }), null);
});

test('nothing matches an empty candidate', () => {
  assert.equal(customerMatch({ name: 'John' }, {}), null);
  assert.ok(customerIsEmpty({}));
  assert.ok(customerIsEmpty({ name: '   ', notes: 'just a note' }));
  assert.ok(!customerIsEmpty({ name: 'John' }));
});

test('the strongest match wins when several rows could be the customer', () => {
  const list = [
    { id: 'C1', name: 'John Smith' },
    { id: 'C2', name: 'J Smith', phone: '0400111222' },
    { id: 'C3', name: 'Johnny', email: 'js@x.com' }
  ];
  const hit = findCustomer(list, { name: 'John Smith', phone: '0400111222', email: 'js@x.com' });
  assert.equal(hit.how, 'email');
  assert.equal(hit.customer.id, 'C3');
});

// ── Merging: the rule about not losing anything ────────────────────────────

test('a merge fills blanks', () => {
  const r = mergeCustomer({ id: 'C1', name: 'John Smith' },
                          { name: 'John Smith', phone: '0400111222', email: 'j@x.com' });
  assert.equal(r.customer.phone, '0400111222');
  assert.equal(r.customer.email, 'j@x.com');
  assert.deepEqual(r.conflicts, []);
  assert.ok(r.changed);
});

test('a merge NEVER overwrites a value NAC already had', () => {
  const existing = { id: 'C1', name: 'John Smith', phone: '0400111222',
                     email: 'old@x.com', address: '1 Old Rd' };
  const r = mergeCustomer(existing, { name: 'John Smith', phone: '0499999999',
                                      email: 'new@x.com', address: '99 New St' });
  assert.equal(r.customer.phone, '0400111222', 'the old phone stands');
  assert.equal(r.customer.email, 'old@x.com', 'the old email stands');
  assert.equal(r.customer.address, '1 Old Rd', 'the old address stands');
  assert.equal(r.conflicts.length, 3, 'and every disagreement is reported');
  assert.deepEqual(r.conflicts.map(c => c.field).sort(), ['address', 'email', 'phone']);
  const addr = r.conflicts.find(c => c.field === 'address');
  assert.equal(addr.kept, '1 Old Rd');
  assert.equal(addr.offered, '99 New St');
});

test('a merge never blanks a field just because the incoming record is empty', () => {
  const r = mergeCustomer({ id: 'C1', name: 'John', phone: '0400111222', email: 'j@x.com' },
                          { name: 'John' });
  assert.equal(r.customer.phone, '0400111222');
  assert.equal(r.customer.email, 'j@x.com');
  assert.equal(r.changed, false);
});

test('the same value written differently is not a conflict', () => {
  const r = mergeCustomer({ id: 'C1', name: 'John Smith', phone: '0427 101 685',
                            address: '14 Wattlebird Dr' },
                          { name: 'john smith', phone: '+61427101685',
                            address: '14 Wattlebird Drive' });
  assert.deepEqual(r.conflicts, []);
  assert.equal(r.changed, false, 'nothing to write');
});

test('a job status is allowed to move on; the rest of a job is not overwritten', () => {
  const r = mergeJob({ id: 'J1', description: 'Ducted install', status: 'open', siteAddress: '1 A St' },
                     { description: 'Something else', status: 'quoted', siteAddress: '99 B Rd' });
  assert.equal(r.job.status, 'quoted');
  assert.equal(r.job.description, 'Ducted install');
  assert.equal(r.job.siteAddress, '1 A St');
  assert.deepEqual(r.conflicts.map(c => c.field).sort(), ['description', 'siteAddress']);
});

test('a job is the same job at the same site for the same customer', () => {
  assert.equal(jobMatch({ customerId: 'C1', siteAddress: '1 A St' },
                        { customerId: 'C1', siteAddress: '1 A Street' }), 'site');
  assert.equal(jobMatch({ customerId: 'C1', siteAddress: '1 A St' },
                        { customerId: 'C2', siteAddress: '1 A St' }), null);
  assert.equal(jobMatch({ customerId: 'C1', siteAddress: '1 A St' },
                        { customerId: 'C1', siteAddress: '99 B Rd' }), null);
  assert.equal(jobMatch({ servicem8JobId: 'SM8-1' }, { servicem8JobId: 'SM8-1' }), 'servicem8');
  assert.equal(jobMatch({ servicem8JobId: 'SM8-1' }, { servicem8JobId: 'SM8-2' }), null);
  assert.ok(findJob([{ id: 'J1', customerId: 'C1', siteAddress: '1 A St' }],
                    { customerId: 'C1', siteAddress: '1 a street' }));
});

// ── Identifiers ────────────────────────────────────────────────────────────

test('ids are readable and deterministic', () => {
  assert.equal(customerId({ name: 'John Smith' }, 1), 'CUS-JOHN-SMITH-0001');
  assert.equal(customerId({ name: 'John Smith' }, 1), customerId({ name: 'john  smith' }, 1));
  assert.equal(customerId({ name: '' }, 7), 'CUS-CUSTOMER-0007');
  assert.match(jobId({ siteAddress: '14 Wattlebird Drive' }, 2), /^JOB-14-WATTLEBIRD-DRIVE-0002$/);
});

// ── The migration ──────────────────────────────────────────────────────────

const QUOTES = [
  { id: 'NAC-SMITH-1', client: 'John Smith', job_desc: 'Ducted AC Supply & Install' },
  { id: 'NAC-SMITH-2', client: 'John Smith', job_desc: 'Ducted AC Supply & Install' },
  { id: 'NAC-JONES-1', client: 'Mary Jones', job_desc: 'Split system' },
  { id: 'NAC-BLANK-1', client: '', job_desc: 'No name on this one' }
];
const DESIGNS = [
  { id: 'D-1', customer_name: 'John Smith', customer_address: '1 Alpha St, Buderim',
    design: { customer: { name: 'John Smith', address: '1 Alpha St, Buderim',
                          phone: '0400 111 222', email: 'john@x.com' },
              job: { description: 'Ducted, new build' } } },
  { id: 'D-2', customer_name: 'Mary Jones',
    design: { customer: { name: 'Mary Jones', phone: '0400 333 444' }, job: { description: 'Split system' } } }
];

test('a migration turns existing quotes and designs into customers and jobs', () => {
  const plan = planBackfill({ quotes: QUOTES, designs: DESIGNS });
  // John Smith appears on two quotes and a design — that is ONE customer.
  assert.equal(plan.summary.customersCreated, 2, 'John Smith and Mary Jones');
  assert.equal(plan.summary.skipped, 1, 'the quote with no name is left alone');
  const john = plan.customers.find(c => c.name === 'John Smith');
  assert.equal(john.phone, '0400 111 222', 'the design detail comes across');
  assert.equal(john.email, 'john@x.com');
  assert.equal(john.address, '1 Alpha St, Buderim');

  // Every row that could be linked, is.
  assert.equal(plan.links.filter(l => l.table === 'nac_quotes').length, 3);
  assert.equal(plan.links.filter(l => l.table === 'nac_designs').length, 2);
  for (const l of plan.links) assert.ok(l.customerId, l.table + ' ' + l.id + ' has a customer');
});

test('running the migration a second time changes nothing', () => {
  const first = planBackfill({ quotes: QUOTES, designs: DESIGNS });
  const second = planBackfill({ quotes: QUOTES, designs: DESIGNS,
                                customers: first.customers, jobs: first.jobs });
  assert.ok(planIsEmpty(second), 'no inserts and no updates on the second pass: ' +
    JSON.stringify(second.summary));
  assert.equal(second.summary.customersCreated, 0);
  assert.equal(second.summary.jobsCreated, 0);
  assert.equal(second.summary.customersUpdated, 0);
  assert.equal(second.summary.jobsUpdated, 0);
  // The links are still produced, so a half-finished run can be completed.
  assert.equal(second.links.length, first.links.length);
});

test('a migration NEVER destroys customer information that is already there', () => {
  // Same person — the phone proves it — but NAC's record has a different email
  // and address from the one typed into the design.
  const existing = [{ id: 'C-EXISTING', name: 'John Smith', phone: '0400 111 222',
                      email: 'the.real@address.com', address: '7 Established Rd',
                      notes: 'Do not lose me' }];
  const plan = planBackfill({ quotes: QUOTES, designs: DESIGNS, customers: existing });

  const john = plan.customers.find(c => c.id === 'C-EXISTING');
  assert.equal(john.phone, '0400 111 222');
  assert.equal(john.email, 'the.real@address.com', 'NAC\'s email stands');
  assert.equal(john.address, '7 Established Rd', 'NAC\'s address stands');
  assert.equal(john.notes, 'Do not lose me');

  // The differences are reported rather than applied.
  const reported = plan.conflicts.filter(c => c.id === 'C-EXISTING');
  assert.ok(reported.length, 'the disagreement is surfaced');
  const fields = reported.flatMap(c => c.differences.map(d => d.field));
  assert.ok(fields.includes('email'), 'the email disagreement is listed');
  assert.ok(fields.includes('address'), 'the address disagreement is listed');
  // And it did not quietly create a duplicate John Smith alongside it.
  assert.equal(plan.customers.filter(c => c.name === 'John Smith').length, 1);
});

test('a contradicting email makes a SEPARATE customer rather than a guess', () => {
  // Nothing links these two beyond a common name, and their emails disagree.
  // Merging would be a guess; overwriting would be worse. Two records it is,
  // and both survive for a person to look at.
  const existing = [{ id: 'C-EXISTING', name: 'John Smith',
                      email: 'the.real@address.com', address: '7 Established Rd' }];
  const plan = planBackfill({ designs: [DESIGNS[0]], customers: existing });
  assert.equal(plan.summary.customersCreated, 1);
  const kept = plan.customers.find(c => c.id === 'C-EXISTING');
  assert.equal(kept.email, 'the.real@address.com');
  assert.equal(kept.address, '7 Established Rd');
  assert.equal(plan.customerUpdates.length, 0, 'the existing row is not written to at all');
});

test('the rows NAC already had are never mutated in place', () => {
  const existing = [{ id: 'C-EXISTING', name: 'John Smith', phone: '0411 999 888' }];
  const before = JSON.stringify(existing);
  planBackfill({ quotes: QUOTES, designs: DESIGNS, customers: existing });
  assert.equal(JSON.stringify(existing), before, 'the input array is untouched');
});

test('one customer at two sites gets two jobs, not one', () => {
  const plan = planBackfill({ designs: [
    { id: 'D-A', design: { customer: { name: 'John Smith', email: 'j@x.com', address: '1 Alpha St' },
                           job: { description: 'Ducted' } } },
    { id: 'D-B', design: { customer: { name: 'John Smith', email: 'j@x.com', address: '2 Beta Rd' },
                           job: { description: 'Ducted' } } }
  ] });
  assert.equal(plan.summary.customersCreated, 1, 'the same email is one customer');
  assert.equal(plan.summary.jobsCreated, 2, 'but two sites are two jobs');
});

test('two people with the same name at different addresses stay two people', () => {
  const plan = planBackfill({ designs: [
    { id: 'D-A', design: { customer: { name: 'John Smith', address: '1 Alpha St' } } },
    { id: 'D-B', design: { customer: { name: 'John Smith', address: '99 Beta Rd' } } }
  ] });
  assert.equal(plan.summary.customersCreated, 2);
});

test('a migration of nothing is a valid plan, not a crash', () => {
  const plan = planBackfill({});
  assert.ok(planIsEmpty(plan));
  assert.equal(plan.links.length, 0);
  assert.match(describePlan(plan), /Read 0 quote\(s\)/);
});

test('the plan describes itself in words a person can check', () => {
  const text = describePlan(planBackfill({ quotes: QUOTES, designs: DESIGNS }));
  assert.match(text, /Customers: 0 before, 2 to create/);
  assert.match(text, /5 existing row\(s\) would be linked/);
  assert.match(text, /nothing to identify a customer by/);
});
