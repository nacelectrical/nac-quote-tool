# Quoting a job

A short guide, 4 November 2026. Written for Nick and anyone else at NAC who
quotes a job. It assumes nothing about the old duct designer, which is gone.

Everything happens on three screens:

| Screen | What it is for |
|---|---|
| **/quote-builder.html** | Building and issuing one quote |
| **/quotes.html** | Everything that has gone out, and sending it through Podium |
| **/quote-presentation.html** | The content library: wording, photographs, prices, allowances |

All three need an NAC sign-in. An unauthenticated visitor gets a sign-in
screen and nothing behind it.

---

## The six steps

The builder is six steps across the top. They are a navigation, not a wizard —
you can jump between them in any order, and the tick appears on a step once it
has what it needs.

### 1. Customer and property

Name, phone, email and the site address. The address is printed in full on the
cover; the rest of the proposal uses the suburb.

Two things worth setting here:

- **What kind of job.** New installation, or replacing an existing system. A
  replacement has to deal with the old unit, and the checks panel asks about
  recovering the refrigerant, removing it and taking it away if your scope does
  not mention them — in whatever words you used.
- **This is a TEST quote.** Tick it and every page of the proposal is
  banner-labelled TEST QUOTE. Never tick it for a real customer; never leave it
  unticked when you are testing.

Saving a quote also finds or opens the customer and job records, matching on
phone or email first. It never overwrites a detail NAC already holds — if the
number on this quote disagrees with the one on file, it says so after the save
and leaves the record alone.

### 2. Floor plan and rooms

Drop a PDF or a photograph of the plan. The rooms it can read come up as a
list, and you correct them.

**The scale.** A room only counts as measured when a dimension was printed on
the plan, or you measured a known distance on site and told the tool what it
was. A car, a bed, a sofa or a kitchen bench is not a scale, and the tool will
not derive one from them. A room with nothing behind it reads "Needs a
dimension" rather than a number nobody can stand behind — and a quote carrying
one goes out as a provisional estimate.

There is no plan on some jobs. Type the rooms in by hand on step 4; nothing
here blocks a quote.

### 3. Sizing and equipment

One option, or several for the customer to choose between. Each needs the
brand, the **exact indoor and outdoor model pair**, the capacity, the power
supply and the price including GST.

Under each option is a panel only you see:

- **Customer pays** and the **price basis** — whether this is NAC's approved
  price from the Prices screen or a figure you typed for this job. If the two
  disagree it says by how much. Your figure wins: you are at the house.
- **Supplier cost**, from the MMEM trade list by model, or whatever you enter.
- **Markup** and **margin**, separately. Markup is profit over cost — what NAC
  add on. Margin is profit over the sell price — what NAC keep. A 50% markup is
  a 33% margin. If the supplier cost is not known, both read **Unknown**: the
  tool will not estimate them.

The zone control follows the zone count on step 4, by NAC's house rule. You can
always type a controller by hand instead.

### 4. Scope and pricing

The outlet, return and zone counts you took on site, the rooms, and what the
price covers.

- **Insert NAC's usual list** fills the inclusions and exclusions from the
  content library. Edit them for the job in front of you.
- **Installation allowances** are the named sums you set up in the library — a
  switchboard upgrade, say. Adding one writes the line into the inclusions.
  **The amount still has to go into the system price**; the tool will not move
  money around on its own.
- **Fixed price or estimate.** Tick it if you have not been in the roof space,
  or if anything could still move, and say in a sentence what has to be
  confirmed — the customer reads your words. The tool also decides this on its
  own: an allowance in the scope, a room nobody measured, or a replacement with
  nothing said about the old system all make it a provisional estimate.

### 5. Proposal and approval

**Preview** opens the real customer page, exactly as the customer will see it.
**Printable version** opens the same proposal as a clean document for printing
or saving as a PDF.

Read it, then tick the approval box. Nothing issues without it: an issue with
no approver recorded is refused by the server, and the approval is frozen into
the offer with a fingerprint of the exact quote you approved.

**Issue to customer** saves the quote and mints the link. If the save does not
reach the database it refuses and says so, because the server builds the
customer's proposal from the saved quote.

### 6. Issued and responses

What has gone out on this quote, and what came back.

---

## Sending it, and chasing it

Everything issued is on **/quotes.html**, with who it went to, when, whether it
has been opened, what was quoted, and what was accepted.

Each one has a **Send through Podium** panel:

1. The message is written for you, in NAC's voice, with the real link in it.
   **Edit it** before you send it.
2. **Copy the message**, paste it into Podium, and send it there.
3. Press **I have sent it** and say how it went.

**Nothing is sent by this application.** There is no Podium connection yet.
That is why copying the link is recorded as *copying a link* and not as sending
one — the panel says "Link copied" and tells you nobody has recorded sending
it. A quote that was never sent is never chased.

When the customer writes back, press **Customer replied**; follow-up pauses
until somebody resumes it. **I am handling it** does the same. **Asked not to
be chased** is permanent and asks you to confirm.

---

## The content library

**/quote-presentation.html** holds everything a proposal is made of. The first
tab, **What is missing**, is the list worth reading: everything only NAC can
supply, and whether a proposal can go out at all without it.

The rest: branding and the cover photograph, about NAC, licences and
warranties, reviews, past installations, product images, **manufacturer
brochures**, **standard inclusions and exclusions**, **installation
allowances**, included-service cards, optional upgrades, payment terms, quote
validity, terms and conditions, and the email introduction.

### Pictures

Three places a photograph appears on a proposal, and all three come from the
**Product images** tab:

- **The installations gallery.** Tick **"This is NAC's own work"** on a
  photograph and it appears under *Recent NAC installations*, captioned with
  the description already written for it. A manufacturer's stock shot is a
  picture of the same machine and not a picture of your work, so it stays out.
- **The unit beside each option.** Where you have supplied a product set for a
  brand — the indoor fan coil, the outdoor unit and the controller — that is
  what the option shows. Otherwise it falls back to a photograph matched on the
  brand and model. An option you have no photograph of shows none.

  Brands are matched **exactly as they are named**. Mitsubishi Electric and
  Mitsubishi Heavy Industries are two different companies, so a brand recorded
  as plain "Mitsubishi" matches neither and shows no picture — which is the
  safe answer.
- **The picture beside each upgrade.** Matched against the upgrade's own
  wording — the AirTouch console lands on the AirTouch line and the console
  showing room sensors lands on the sensors line. You can pick one by hand on
  the **Optional upgrades** tab instead, and the panel shows you which
  photograph has been matched before a customer sees it.

- **The picture beside the zone control.** This one is **never matched** —
  every zone controller ever made is named with the words "zone" and
  "control", so a matcher scoring on those words would put any panel in your
  library beside any kit, under its price, on the page the customer signs.
  Instead the picture is recorded **against the part you buy**. Your Siemens
  kits (MMASEM4ZTPKIT / MMASEM6ZTPKIT / MMASEM8ZTPKIT) carry the Zonemaster
  wall plate, because you told us that is what ships with them — nothing in
  the data could have worked it out, since the kit is badged Siemens and the
  plate is badged Zonemaster.

  The **Picture of the zone control** field on the Zone control card has three
  settings: leave it blank for the kit's own picture, pick another photograph
  to override it on this quote, or choose *show no picture on this quote*. The
  card shows you the picture the customer will get before they get it.

  One thing to know: the Zonemaster photograph on file has **six** buttons, so
  it is exact for the 6-zone kit and shows two switches too few on an 8-zone
  job and two too many on a 4-zone one. Send a 4-zone and an 8-zone shot and
  each kit gets its own.

Two rules the library enforces:

- A review, a photograph or a brochure that has not been approved does not
  appear on a proposal, and a section with nothing in it is left out rather
  than filled with a placeholder. A lookalike photograph beside a price is a
  product claim, so an option or an upgrade with no matching picture gets
  none.
- An allowance with no figure is held back, not quoted at zero. A zero on a
  proposal reads as "no charge".

Equipment prices live in the existing **Prices** screen, as they always have.

---

## What the tool will not do

Worth knowing, because each of these is deliberate:

- It will not invent a price, a rate, a supplier cost or a margin. A figure
  nobody set is absent and says so.
- It will not work out a scale from furniture or a car.
- It will not let a quote go out without an approval recorded against it.
- It will not report a quote as saved unless the database confirms it.
- It will not change a quote that has already been issued. A change means a new
  revision.
- It will not send a customer anything.
