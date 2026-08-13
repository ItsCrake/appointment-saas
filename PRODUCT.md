# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**The client** is the primary user of `/[slug]`: a stranger on a phone, usually
on mobile data, who followed a link their barber, hairdresser, clinic or studio
sent them over WhatsApp. They have no account, will never make one, and are
trying to do one thing — get a time — in under a minute. They read Hebrew and
their phone is in RTL.

**The owner** is the primary user of `/dashboard`: a small service business,
often a single chair, frequently running the shop from their pocket between
clients. They are not a software buyer by temperament and abandon anything that
needs a manual.

**The platform operator** uses `/master` — a single super-admin roster, not a
support organisation.

## Product Purpose

Bazman (בזמן) gives a small Israeli service business a booking page its clients
can use without registering, and the shop a calendar that cannot be
double-booked. Success for the client is a confirmed appointment with no
account. Success for the owner is a shop configured in under ten minutes and a
link worth sending.

## Positioning

Four claims, all confirmed as load-bearing, and no neighbouring product can
truthfully make all four at once:

- **Hebrew/RTL-native, built for Israeli shops.** Not a translated product.
  Hebrew copy, RTL layout, Israeli phone and date conventions, ILS in agorot,
  an Israeli legal and accessibility surface, and a marketing message written
  against סעיף 30א לחוק התקשורת.
- **No account for the client, ever.** A phone number is the identity. No
  registration, no password, no app install.
- **Availability is server-authoritative.** Slots are derived from real
  contiguous free windows server-side, and double booking is prevented by a
  Postgres exclusion constraint rather than by application logic. The page never
  offers a time it cannot honour.
- **It runs the whole shop, not just the calendar.** Staff, hours, clients,
  analytics, reminders, approvals and an installable owner app — a one-chair
  barber gets what a chain gets.

## Operating Context

- The booking link is shared over **WhatsApp**, so `/[slug]` is usually opened
  from a chat, on a phone, once, by someone who will not return to explore.
- The public page is **the tenant's**, rendered in the tenant's own accent
  colour, while the dashboard and marketing site are the platform's.
- `/[slug]` is **genuinely dual-purpose**, confirmed: it converts the client
  *and* it is the strongest sales asset the platform has, because shop owners
  encounter Bazman by receiving a competitor's booking link. Both goals are
  co-equal, and the platform pitch is entitled to real estate of its own rather
  than a footer afterthought. Where the two genuinely conflict inside the
  booking flow itself, the client's booking wins.
- Notifications are moving to **WhatsApp** as the client channel. Email is
  retained for owner alerts and, later, signup verification.

## Capabilities and Constraints

- Booking is service → date & time → provider (team shops only) → details. A
  single-staff tenant never sees the provider step.
- Tenants may require approval on incoming bookings, in which case the
  confirmation screen must not read as a confirmation.
- Owners may upload a hero image or video, a logo, a gallery and reviews. Many
  tenants will have **none of these**, and the page must still open as somebody
  in particular rather than as a blank card.
- Per-business `--accent` drives `/[slug]` and is the **tenant's** identity, not
  the platform's. It is a swatch name, never a hex value: Tailwind cannot emit a
  class from a runtime value, so colours arrive as CSS custom properties.
- Every accent swatch is verified to WCAG AA for its contrast pair; changes that
  affect colour must be re-measured rather than eyeballed.
- Undecided: the payment provider, per-tenant reminder thresholds, deposits
  (schema exists, nothing reads it), and whether client lookup gains an OTP.

## Brand Commitments

- The name is **Bazman / בזמן**, centralised in `lib/brand.ts`.
- The platform surfaces (`/`, `/login`, `/dashboard/*`, `/master`) run one
  monochrome `zinc` ramp plus a single violet→blue `--brand-gradient`, spent
  only on what is *active* or *recommended*. There is no teal anywhere.
- `/[slug]` is deliberately outside that rule: it wears the tenant's colour.
  Conflating the two would repaint every customer's booking page as a side
  effect of a platform decision.
- Geometry: pill for interactive, `rounded-3xl` for containers, `rounded-2xl`
  for a surface nested in one; text inputs are the documented exception at
  `rounded-xl`.
- Voice is plain Hebrew, second person, no exclamation marks in transactional
  copy, and never claims something has happened that has not.

## Evidence on Hand

**Demo tenant only.** `demo-barber` is real and seedable, and real tenants carry
owner-entered reviews and galleries that render on their own page.

There are **no platform-level testimonials, customer logos, case studies, press,
or usage figures**, and design must not imply any exist — no "trusted by N
businesses", no logo wall, no invented counts. Real business owners have tested
the product, but none have agreed to be named or quoted.

The analytics paywall already sets the precedent: it ships **invented sample
numbers that are labelled as samples**, rather than blurring a tenant's real
figures.

## Product Principles

1. **Never claim more than happened.** A pending request is not a confirmation,
   a console provider is not a delivery, and a page must not print a date it
   cannot stand behind. This is the product's oldest rule and it has decided
   more designs here than any aesthetic one.
2. **The client's minute is the budget.** Anything that does not move a stranger
   toward a confirmed time is spending someone else's attention.
3. **The tenant's page is the tenant's.** The platform is a guest on `/[slug]`
   and dresses accordingly.
4. **Degrade to something, never to nothing.** A shop with no logo, no hero, no
   gallery and no reviews must still open as a real business.
5. **A control that appears to work must work.** A live-looking setting that
   changes nothing is worse than an absent one.

## Accessibility & Inclusion

Israeli accessibility statement at `/accessibility` commits to **WCAG 2.0 AA**.
Contrast is measured in a browser rather than judged by eye, and the repository
records the measurements. Status is never carried by hue alone — a label is
always rendered beside the colour. The accessibility widget is deliberately
small (text scale, contrast, stop-motion) and stores preferences client-side
only, because a record of who needs high contrast is health-adjacent data there
is no reason to hold.
