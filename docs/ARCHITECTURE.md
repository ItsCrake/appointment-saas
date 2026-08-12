# Architecture Handover

Multi-tenant appointment booking SaaS. Hebrew/RTL, mobile-first.
Public booking page per business at `/[slug]`; owner dashboard at `/dashboard`.

Companion docs: [PROJECT_PLAN.md](PROJECT_PLAN.md) (roadmap), [DEPLOYMENT.md](DEPLOYMENT.md) (deploy).

## Stack

| Layer      | Choice                                                             |
| ---------- | ------------------------------------------------------------------ |
| Framework  | Next.js 16 (App Router, Turbopack), React 19, TypeScript strict    |
| Styling    | Tailwind CSS v4, lucide-react. No component library.               |
| Font       | Heebo via `next/font` — Hebrew + Latin glyphs                      |
| DB         | Supabase Postgres, Drizzle ORM, postgres.js driver                 |
| Auth       | Supabase Auth (`@supabase/ssr`), email + password                  |
| Validation | Zod v4 (shared client/server), react-hook-form on the public form  |
| Dates      | date-fns + date-fns-tz                                             |
| Tests      | Vitest + PGlite (WASM Postgres) — 792 tests; Playwright — 10 specs, all green |
| Hosting    | Vercel. **Root Directory must be `Frontend`.**                     |

Everything lives in `Frontend/`. There is no separate backend tier — Server
Actions and route handlers _are_ the backend.

```
Frontend/src/
  app/            routes: /[slug], /b/[token], /dashboard/* (incl. /analytics), /master/*, /login,
                  /login/forgot, /login/reset, /auth/confirm,
                  /legal/*, /accessibility, /api/cron
                  loading.tsx beside every dynamic route (see Navigation feedback)
  components/     booking/ (public), dashboard/ (owner), marketing/ (landing),
                  master/ (platform console), ui/ (cross-surface primitives)
  db/             schema, migrations, queries/ (repository layer), scripts
  lib/            availability, notifications/, stats, cancellation, env, ics
                  slot-periods (slot grouping), branding (theme/gallery/reviews)
                  plans + landing-content + legal-content (copy as data)
                  entitlements (what a tier buys), billing/ (lifecycle, sweep,
                  activate, provider adapter)
                  auth-validation (password rules + hashed rate-limit key)
                  safe-redirect (open-redirect guard for a `next` in a query)
                  public-slug + slug-cache (is this path a tenant, and does
                    that tenant exist — the proxy's 404 guard)
                  app-url (which origin a shareable link uses — and, in
                    authRedirectOrigin, the stricter rule an emailed one uses)
                  brand (the wordmark, one place), platform-metrics (MRR etc.)
                  super-admin + master-session + impersonation (/master access)
                  supabase/ (server client + forced cookie flags)
  test/           PGlite harness + factories
  proxy.ts        unknown-slug 404 guard + auth redirect
                  (NOT middleware.ts — see below)
```

## Database

Eleven tables. Seven are tenant-scoped by `business_id`; `rate_limits` is not,
and `subscription_events` only optionally is.

- **businesses** — slug, timezone, `slot_interval_min`, `buffer_min`,
  `min_notice_min`, `max_advance_days`, `cancel_window_hours`,
  `reminder_hours_before`, `notification_email`, `onboarding_completed_at`,
  plus the branding columns from `0009`, the subscription columns from `0010`
  and `trial_ends_at` from `0011` (see below)
- **services** — duration, price (agorot), `buffer_min` (NULL inherits business)
- **working_hours** — weekly template; multiple rows per weekday = split shift;
  no rows = closed. Naive `time` values interpreted in the business timezone.
- **time_off** — one-off closures, stored UTC
- **appointments** — UTC instants, status enum, snapshots `service_name` and
  `price_cents`, `cancel_token` for the self-service link
- **notifications** — transactional outbox (see below)
- **rate_limits** — fixed-window counters; no `business_id`, so RLS is on with
  **no policy at all**
- **subscription_events** (`0012`) — provider webhook log. `UNIQUE (provider,
  provider_event_id)` is the same idempotency trick as
  `notifications.dedupe_key`: providers retry, and a duplicate `invoice.paid`
  must not extend a paid period twice. RLS on, **zero policies**
- **invoices** (`0012`) — billing history. RLS grants **SELECT only**

Migrations `0000`–`0012` in `src/db/migrations/`, applied with
`npm run db:migrate`. **Not automatic on deploy.**

## Multi-staff

Eleven tables now. `staff` and `staff_schedules` arrived in `0013`, and
`appointments.staff_id` with them.

**One binary question, asked once.** `businesses.has_multiple_staff` is the
answer to "האם יש יותר מנותן שירות אחד בעסק?". False hides the concept
everywhere — no picker in the booking flow, no manager in the dashboard — and
**only the primary staff row is bookable**, whatever else the roster holds. An
explicit column rather than `count(staff) > 1`, because an owner must be able to
answer *yes* before adding anyone, and to collapse back without deleting people
who hold history — which is exactly the state that made the flag load-bearing in
availability rather than only in the UI. See
[has_multiple_staff decides who is bookable](#has_multiple_staff-decides-who-is-bookable-not-only-what-renders).

**Every business has at least one staff row, and that is an invariant, not a
convention.** `appointments.staff_id` is NOT NULL and the exclusion constraint
keys on it, so a business without one cannot take a booking at all. `0013`
backfilled every existing tenant; `createBusiness()` writes one for every new
tenant, in the repository layer rather than in the setup action so a second
creation path cannot forget. The test factory mirrors it, or the suite would be
exercising a state the schema forbids.

**No schedule rows means "inherit the business hours".** That default is what
keeps the feature free for a shop that does not need it: a single-staff tenant
never fills in a staff schedule, and the backfill did not have to generate a row
per weekday per tenant to be correct.

### The guard was rekeyed, in an order that never leaves it absent

```sql
-- 0013
EXCLUDE USING gist (business_id WITH =, staff_id WITH =,
                    tstzrange(starts_at, ends_at, '[)') WITH &&)
  WHERE (status NOT IN ('cancelled', 'completed', 'no_show'))
```

The migration **adds the new constraint while the old one still stands**, then
drops the old one. Dropping first would open a window in which two clients
racing for the same slot could both win, and both being briefly active is safe
because the old one is strictly stricter.

**The predicate is inverted, and that is load-bearing.** It used to list the
statuses that *hold* a slot; it now lists the ones that *release* it. Identical
today. The difference is `0014`: a new enum value cannot be **referenced** in
the same transaction that adds it, and Drizzle runs every pending migration in
one transaction — so a predicate naming `pending_deposit` would fail on any
database applying both at once. Worse, PGlite executes statement by statement
and would have passed, so the suite would have proved the opposite of
production. Stated as "not terminal", the deposit statuses are covered the
moment they exist, without `0014` mentioning them.

Anything added later that should *release* a slot has to be listed — which
fails toward over-holding rather than double-booking.

`BLOCKING_STATUSES` is **derived** from the same rule rather than written out,
or availability would ignore a `pending_deposit` appointment the database still
blocks: the UI would offer a slot and the insert would refuse it.

### Availability is a layer over the engine, not a rewrite of it

`computeStaffSlots()` runs the existing `computeSlots()` **once per staff
member** and unions the results. Every hard-won rule in that function — the
block-sized step, the re-anchoring cursor, the two-sided buffer, DST — applies
per person unchanged, and the headline property falls out with no new logic:

> an appointment at 09:20 for one provider leaves 09:20 open for another

because each call only ever sees that person's own busy list. Expressing this
*inside* `computeSlots` would have meant teaching the cursor walk about resource
sets, which is where the subtle bugs live.

The returned list is the union — a time is offered if at least one person is
free — and each slot carries the ids that were free at it. So the staff list
shown at step 3 comes from the same computation that offered the time at step 2
and cannot disagree with it. `createBookingAction` re-derives it server-side and
**refuses** a requested provider who is not in that list rather than silently
substituting one, which would book a client with the wrong person.

### A personal schedule narrows the shop's hours — it never widens them

`staff_schedules` rows used to **replace** `working_hours` for anyone who had
any. A provider whose row read 08:00–20:00 was therefore offered 08:00–20:00
against a shop open 09:00–17:00, and a row on a weekday with no shop hours at
all produced a fully bookable day out of nothing. Because the person with the
row was usually the only one with one, those off-hours times showed exactly one
provider free — which is how it was spotted in production.

`intersectShifts()` is the fix, and the rule it encodes is:

| `staff_schedules` rows | Hours used                          |
| ---------------------- | ----------------------------------- |
| none                   | the shop's hours, unchanged         |
| some                   | those rows **∩** the shop's hours   |

Three things about it are load-bearing:

- **The inherit-or-intersect decision is made on the raw row count**, before the
  intersection runs. An empty *result* means "works no hours today" and must
  stay empty; treating it as "no rows" would hand that person the whole day —
  the exact bug, reintroduced through the fix.
- **A broken row grants nothing.** An unparseable or inverted personal shift is
  dropped rather than falling back to the shop's hours, so a typo cannot become
  extra availability.
- **Times are parsed, not compared as strings.** A `time` column returns
  `"09:00:00"` and a form sends `"09:00"`; lexicographically `"09:00"` sorts
  first, so string comparison would clip a shift by its own formatting.

None of this depends on `has_multiple_staff`: `computeStaffSlots` is handed a
list of people and unions it, so a one-chair shop ran the identical algorithm
and had the identical bug. **Which people are in that list — and how their
times are placed — is a different question, and the flag decides both.** See
below, and [Free windows](#availability-is-free-windows-first-candidates-second).

### `has_multiple_staff` decides who is bookable, not only what renders

It was documented as a pure UI switch, and `getAvailableSlotsWithStaff` read the
whole roster regardless. That is wrong for a shop holding more than one active
row while answering "no" — an easy state to reach, because collapsing back to
one chair deliberately does *not* delete people who hold booking history.

Two things went wrong for those tenants, and the second is the one that got
reported:

1. **A secondary provider's hours and time off widened the public page.** Times
   were offered that the one person actually working could not take, and
   `createBookingAction` assigns `freeStaff[0]` — so a booking could land on
   somebody the owner had stopped counting.
2. **The slot grid appeared to jump by five minutes.** Each provider's cursor
   re-anchors on *their own* bookings, so a colleague whose appointment ended at
   09:05 contributed 09:05, 10:05 … beside the primary's 09:00, 10:00 …, and the
   union interleaved them. Nothing was wrong with the step — it is
   `durationMin + bufferMin` and always was — and nothing on the owner's own
   calendar explained the times they were seeing.

The flag is therefore applied **above** the engine, by choosing who goes into
it, rather than threading a tenant setting through the cursor walk.
`primaryStaff()` in `db/queries/staff.ts` is the single definition of who that
is — the head of `listActiveStaff`, whose order is total by construction
(`sortOrder, createdAt, id`) — and `getDefaultStaff` resolves the same row, so
availability and the dashboard's manual booking cannot disagree about who takes
a booking.

`/[slug]` filters the roster it ships to the browser by the same rule. The
picker never renders for these tenants, so those names were a list of staff the
shop does not present, sent to every visitor for nothing.

> **Superseded for team shops.** This originally left a team's interleaved grid
> alone, on the grounds that it was real availability. That call was reversed
> deliberately: a team now snaps to a shared lattice, which costs a little
> density and buys a readable column. The single-staff rule here is unchanged
> and still load-bearing — see
> [Free windows](#availability-is-free-windows-first-candidates-second).

### One booking blocks its provider on every service

Availability partitions appointments by `staff_id` and **never reads
`service_id`**, so a haircut booked at 09:00 removes 09:00 from the beard trim,
the colour, and everything else that person offers. It also removes any *start*
a longer service would overlap, not merely the identical time.

This was already correct; what it lacked was a test saying so, which is what
made it worth auditing. `availability-staff-db.test.ts` now pins it against
real Postgres, including the case where cancelling releases the time on every
service and the case where a `pending` booking still holds it.

### Booking flow: the time first, the person second

Step 2 offers every time **anyone** can do; step 3 asks who, from the people
free at the one time already chosen. Asking who first would filter the calendar
by someone the client has no opinion about, and hide times another provider
could have taken.

The staff step is a state between choosing a time and entering details, but the
Stepper still shows three: picking a provider is part of choosing the
appointment, not a fourth thing to do, and a four-wide rail that appeared only
for some tenants would make the flow look longer than it is.

**A one-person shop resolves silently; a team shop never does.** With
`hasMultipleStaff` off — or exactly one active provider — the client never
learns the concept exists, which is what the binary setup question is for. But a
shop that genuinely has a team gets a card even when only one person is free at
the chosen time:

> בשעה 09:30 פנוי/ה רק יוסי — [להמשיך עם יוסי] [בחירת מועד אחר]

Skipping straight to the details form there is the obvious implementation and
the wrong one. The client came somewhere with several barbers; being quietly
handed the only one left is a decision made *for* them that they cannot see, and
they have no way to tell that a different time would have offered a choice. One
tap buys that nobody discovers who they are booked with on arrival.

Both halves of the condition matter — `hasMultipleStaff` **and** more than one
active provider. An owner who flips the toggle before adding anybody would
otherwise get "only X is available" on every slot, which says nothing.

**Nothing is preselected.** A preselected name is the failure mode worth
avoiding: a client who does not read carefully books a specific person without
meaning to. "מי שפנוי ראשון" is offered as an explicit choice rather than as a
default, and travels to the server as an *absent* `staffId`.

The picker is rendered from the chosen slot's own `staffIds`, not from the
roster — the roster only supplies names for ids the engine already returned. So
the list cannot contain someone the availability computation did not offer.
`createBookingAction` then re-derives it server-side and **refuses** a requested
provider who is not free, rather than substituting one: silently booking a
client with the wrong barber is worse than an error they can act on.

### Time off comes in two kinds, and they compose

`0016` adds a nullable `time_off.staff_id`. NULL keeps the original meaning —
the whole shop is shut, for a holiday or a renovation — so every row that
predates the migration stayed correct with no backfill. Set, it is one person's
absence.

The distinction is the point: **a shop closure removes the time from the page;
a personal absence only removes one name from the picker.** They are
concatenated, never chosen between, because a shop closed for a holiday is also
closed for someone who happens to be on leave that week.

Before this, a barber taking Thursday afternoon could only express it by editing
their weekly hours — a permanent change used to describe a one-off.

> **The FK is composite, `(business_id, staff_id)` against `staff`.** A plain
> `REFERENCES staff(id)` would accept one tenant's staff member on another
> tenant's closure: both rows exist, so both ends are satisfied and nothing in
> the schema objects — and availability would then apply the wrong shop's
> absence. The composite form needs a `UNIQUE (business_id, id)` on `staff`,
> which is redundant for uniqueness and exists only to give the FK something to
> point at.
>
> It also gets the nullable case right for free. `MATCH SIMPLE` — the default —
> skips the check entirely when any column of the key is NULL, so a
> business-wide row is exempt automatically and a staff-specific one is fully
> enforced. No CHECK and no trigger.
>
> `ON DELETE CASCADE` here, unlike the appointments FK: an absence is not
> history, so it should go with the person rather than outlive them.

### Managing a team (`/dashboard/staff`)

CRUD over the roster, each person's weekly override, and time off for one person
or the whole shop. Three rules worth stating:

- **There is no delete.** `appointments.staff_id` is `ON DELETE RESTRICT`, so
  anyone who has taken a booking cannot be removed at all — their history is the
  reason. Deactivating is the operation that actually exists.
- **The last active provider cannot be deactivated.** A tenant with none takes
  no bookings: availability returns an empty list for every day and the public
  page silently stops working with nothing to explain it. The action refuses,
  because it is the only place that can say why.
- **An empty schedule is a valid answer, not an unsaved form.** It means "works
  the business hours" — the default everyone starts on, and what keeps a shop
  whose team share hours from filling in seven rows per person. The save button
  says so rather than looking like a no-op.

The per-person editor allows one shift per weekday, unlike the business hours
editor which supports split shifts. A per-person override exists to say "Yossi
works mornings"; offering a second shift per day would mostly produce empty
fields.

`staff.color` (0017) is a swatch **name**, never a hex value — the same
reasoning as `businesses.theme_color`. Tailwind cannot build a class from a
runtime value, so a stored `#7c3aed` is a colour the agenda cannot render and
cannot guarantee is legible. `lib/staff-colors.ts` owns which names are legal
and validates on read; the stylesheet owns what they look like. `staff.phone` is
for the owner's own use — nothing dispatches to it.

## The booking flow's step graph is two functions, not one

`lib/booking-steps.ts` holds `stepAfterSlot` (where a chosen slot **sends** you)
and `previousStep` (where you **came from**). They look like the same question
and are opposites, and conflating them broke the back button:

`back()` reused `stepAfterSlot`, which answers `3` for a shop with no staff
question — so back from step 3 set the step to 3, and **the button on the final
step did nothing at all for every single-staff tenant**, which is most of them.
Only one of the two functions can ever answer `3`.

Extracted and pure so the graph is testable without rendering the flow. The
test that matters asserts, over every step in every tenant configuration, that
`previousStep` **never returns the step it was given** — a back button that
lands where it started is indistinguishable from a dead one.

The button is also named by its destination ("בחירת מועד", "בחירת נותן שירות")
rather than a bare "חזרה". Someone mid-form should not have to guess whether
they are about to lose what they typed. Nothing is discarded either way: the
service, the date and the slot all stay in state.

### There is no "מי שפנוי ראשון"

It was removed from the staff picker, and its absence is the point. The option
made sense when the question came before the time — "whoever is free" is a real
preference about a *day*. Once the time is already fixed, **every name on that
list is free at it**, so the option only asked the client to defer a choice they
had just been given, and produced a booking nobody had decided.

A single-staff tenant still resolves silently to the details form and never
learns the concept exists. A tenant with a team never skips silently, even when
only one person is free — see the sole-provider card.

## Analytics (`/dashboard/analytics`)

Peak heatmap, service breakdown, status split, staff utilisation and a
booking/revenue trend, over 30 / 90 / 365 days.

**Wall clock, not UTC.** "Busiest hour" is a question about the hour on the
shop's wall, so every date part is extracted from
`starts_at AT TIME ZONE <business tz>`. Reading the column raw would put a Tel
Aviv shop's 09:00 rush at 06:00 in summer and 07:00 in winter — wrong in a way
nobody would notice, because it is plausible. A test books the same wall-clock
hour either side of a DST change and asserts both land in the same bucket.

**Cancelled rows are excluded from every "how busy were we" figure** and counted
only in the status breakdown, which is the one question that is about them.

**Weeks start on Sunday.** Postgres' `date_trunc('week', …)` starts on Monday,
so the timestamp is shifted a day forward before truncating and back after.
Without it every Sunday files under the previous week.

**`GROUP BY` uses ordinals, not the repeated expression.** The timezone is a
bound parameter, so writing the same expression twice emits `$1` in the select
and `$5` in the group by — and Postgres matches grouping expressions
_syntactically_, so it sees two different things and rejects the query. This bit
during development and the fix is `GROUP BY 1, 2`.

**No charting library**, for the same reason there is no component library: a
bar is a div with a width and a heatmap is a grid of background colours. Nothing
on the page is a client component either — the range and sort controls are links
that change `searchParams`, so it costs the browser nothing and survives a
refresh or a share.

Grouped by the **snapshotted** `service_name`, never joined to `services`: a
renamed or deleted service still has history, and a join would drop those rows
or relabel last quarter under this quarter's name.

> All six aggregates were smoke-tested against real Supabase, not only PGlite —
> the known driver gap is that a `sql` template which binds cleanly in PGlite can
> still throw at bind time in production.

## "התורים שלי" — client self-service (`/[slug]/my-appointments`)

A client types the phone number they booked with and sees their history at that
one business: status, service, time, provider, and a cancel button when the
shop's own window still allows it.

**Cancellation reuses `cancelBookingAction` unchanged.** The lookup hands back
each appointment's `cancel_token` — the same opaque value the confirmation link
carries — so cancelling here runs the identical code path with the identical
rules. There is no second implementation of "may this still be cancelled" to
drift from the first.

### The phone number is not a credential, and that is a deliberate trade-off

Anyone who knows someone's number can see their name, services and times at that
business. The honest alternative is an SMS one-time code, which a shop with no
Twilio account cannot use — so the feature ships as specified, with the risk
named rather than hidden:

- `LOOKUP_RULES` is the **tightest non-auth limit in the app** — 20/hour per IP
  and 5/hour per phone. The IP rule stops one host walking the `05X-XXXXXXX`
  space; the per-phone rule survives a rotating IP pool and caps how often any
  single number can be probed from anywhere.
- Results are scoped by `business_id` **and** phone. A client who books at two
  shops on this platform cannot see one shop's list from the other's page —
  proved in `client-lookup.test.ts` rather than reasoned about.
- The page is `robots: noindex` and `force-dynamic`; nothing about it is
  cacheable or shareable between two visitors.

**The upgrade path is an OTP**: same page, one extra step, and the phone stops
being the whole answer. Worth doing the moment Twilio is configured.

### The phone never enters a URL

It travels in a Server Action body. A query string survives in browser history,
in referrer headers and in server logs, and this one identifies a person.

The input also carries **no `name` attribute**, which matters for one specific
case: if the page has not hydrated yet — a slow phone, the first tap — the
browser submits the form natively, and a named field would put the number
straight into the URL anyway. Unnamed, that submit is a bare reload.

## One save bar for a page of five forms

`/dashboard/settings` grew a Save button per section — details, appearance,
logo, social links, deposits — each with its own action and its own idea of
whether it had been pressed. An owner who changed three things had to find three
buttons, and the one they missed simply did not save, with nothing on the page
saying which was which.

Sections now **register themselves** with a small store, and one bar appears
only when at least one of them differs from what was last saved. Pressing save
runs each dirty section's own action; each keeps its own validation, its own
error message and its own server action.

`useSyncExternalStore`, not context state, because the registry is written from
inside child effects — putting it in state would be a child setting a parent's
state during its own commit, and would re-render every section whenever any one
of them went dirty.

Three details carry the weight:

- **Notify only when the set of dirty ids changes.** Sections re-register on
  nearly every render to keep their `save` closure fresh — a stale one would
  save what the field held a keystroke ago — so without this guard the bar
  re-renders on every character typed anywhere on the page.
- **Baseline is state, not the prop.** A successful save marks the section clean
  immediately; waiting for the server data to come back would leave the bar up
  for a beat after a save that already worked, which reads as failure.
- **Saves run sequentially.** They are separate writes to one row, and failing
  halfway should leave the sections that did save marked clean rather than
  rolling anything back.

The logo used to save itself on upload, which was right when it was the only
control of its kind. With one save control on the page it became the only thing
an owner could not undo with "ביטול", so it joined the bar.

`beforeunload` is registered only while something is unsaved. A page that always
warns on leaving is a page people learn to click through.

## WhatsApp has two backends, and they are not interchangeable

`lib/notifications/whatsapp.ts` puts one interface over both, because the
difference decides the product rather than only the plumbing:

| Backend       | Business-initiated message                                        |
| ------------- | ----------------------------------------------------------------- |
| **Twilio**    | Official Business API — needs a **Meta-approved template**         |
| **Green API** | Drives the shop's own account — **no template approval**           |

A confirmation and a reminder are both business-initiated, so over Twilio they
need template approval before they deliver anything. Green API is therefore
preferred when both are configured: it is the one that works for an Israeli
barber on the day they sign up. It is also unofficial, which is a risk the
operator takes knowingly and should not learn from a support ticket.

Both satisfy `NotificationProvider`, so the outbox, the dedupe key, the retry
policy and the templates are identical either way — choosing is a credential,
not a rewrite.

**WhatsApp now leads `CLIENT_CHANNEL_PREFERENCE`**, where it used to be excluded
outright for the template reason above. `isChannelLive` is what makes that safe:
with no WhatsApp credentials the channel resolves to the console provider and
the loop falls through to SMS and then email, rather than logging a confirmation
nobody receives.

## Reminders are planned from the lead time, not fixed at 24 hours

A fixed "24 hours before" loses half of all bookings. Someone who books at 09:00
for 14:00 the same day gets **nothing** — the send time is already in the past —
and that is exactly the client most likely to forget, because they booked in a
hurry.

| Booked this far ahead | Reminder goes out |
| --------------------- | ----------------- |
| 30h or more           | 24h before        |
| less than 30h         | 2h before         |

> **The brief specified `>30h → 24h` and `<24h → 2h`, which leaves 24–30h
> undefined.** Rules are expressed as ordered thresholds matched longest-first,
> so every lead time hits exactly one — a gap in a table like this does not fail
> loudly, it silently sends nothing. The 24–30h band resolves to the 2h rule on
> purpose: a booking made 26 hours ahead would otherwise be reminded two hours
> after it was made, which reads as a duplicate confirmation.

The tenant's own `reminder_hours_before` replaces the **long** rule's lead, so a
shop that prefers 48 hours keeps 48 for advance bookings and still gets the
short-notice fallback for same-day ones. `0` disables reminders entirely.

`planReminder` returns null rather than throwing when no rule matches or when
the computed time has already passed — a "reminder" arriving seconds after the
confirmation is worse than none. The lead is part of the dedupe key, so a
request approved later and replanned onto the short rule is not deduped against
a reminder that was never scheduled.

Thresholds are configurable in code (`DEFAULT_REMINDER_RULES`, or a table passed
straight to `planReminder`). **Per-tenant thresholds would need columns** and are
not built.

## Requires approval — "תורים באישור" (0019)

`businesses.requires_approval`, default false. When on, a public booking is
written as **`pending`** and does not become an appointment until the owner
says so.

**The slot is held either way.** `pending` is non-terminal, so the exclusion
constraint blocks it exactly as a confirmed booking would. A request that did
not reserve the time would be a request to be disappointed — someone else takes
it while the owner is deciding.

**`pending`, not `pending_approval`.** The enum has both, and they are about
different questions. `pending_approval` belongs to the deposit flow 0014 laid
out: _the client says they transferred the money, the owner has not checked_.
The two will eventually coexist on one appointment. `pending` is also already
rendered as "ממתין" everywhere, and already treated as open by the agenda.

**Owner-created bookings are never pending.** A manual booking is the owner
already agreeing; asking them to approve their own walk-in would be a step with
one possible answer.

### The copy is the feature

A client told "התור נקבע בהצלחה!" for something that has not been approved
**turns up**. So the confirmation screen changes wholesale — amber and an
hourglass rather than green and a tick, because someone skimming reads the
colour before the sentence — and the calendar download is withheld, since an
unconfirmed time sitting in someone's phone for weeks is the same
misunderstanding with a longer life. The manage link stays: the time really is
held, so withdrawing is real.

Three notification kinds rather than one status-aware template:

| Kind               | When                     | Why it cannot be shared             |
| ------------------ | ------------------------ | ----------------------------------- |
| `booking_pending`  | request created          | must not contain "נקבע"             |
| `booking_approved` | owner approves           | "אושר", and schedules the reminder  |
| `booking_rejected` | owner rejects            | "בוטל" is wrong for the unconfirmed |

The last one is the reason they are separate at all: **by dispatch time a
rejected request and a cancelled booking are both simply `cancelled`**, so no
template could tell them apart from the row. `setAppointmentStatusAction` reads
the appointment _before_ updating it for the same reason — approving a request
and un-cancelling a booking both land on `confirmed`.

**No reminder is scheduled while a request is open.** Reminding someone about an
appointment the owner has not agreed to is the same lie as the confirmation,
arriving the day before instead. `enqueueApprovalNotifications` schedules it at
the moment the answer is yes.

### Requests live above the agenda, not in it

The agenda shows one day; a request can be for any day. An owner who has to
navigate to next Tuesday to discover next Tuesday's request will not find it,
and the client waits on an answer that never comes — the whole feature fails on
that one gap. `listPendingRequests` fetches every future request regardless of
the selected date, and the panel renders nothing when there are none, so a shop
that does not use the feature never sees it.

## Deposits — schema only, nothing enabled

`0014` adds `pending_deposit` and `pending_approval`, tenant configuration
(`deposit_enabled` defaulting to **false**, manual Bit/PayBox fields, gateway
handles) and per-appointment state.

`/dashboard/settings` can now configure it, and says plainly on screen that the
feature is not live yet. **Nothing in the booking flow reads any of it** — no
appointment is created with `pending_deposit`, and turning the switch on changes
nothing a client can see. Hiding the section until the flow exists would leave
an owner enabling it later with no idea what it does; showing it *unlabelled*
would be worse still, because a switch that appears to work and does not is how
trust in every other switch goes. It exists now for
the reason 8a taught: the database learns a value before the code writes one,
and a status the enum does not know is a constraint violation at the worst
possible moment.

The deposit amount is a flat sum in agorot, never a percentage — the manual flow
asks a human to transfer a specific number through Bit, and "30% of ₪180" is not
a number people type correctly.

`db/staff-constraint.test.ts` asserts that both new statuses hold their slot,
because the mechanism is now indirect enough to be worth proving rather than
reasoning about.

### Two constraints that carry real weight

```sql
-- 0001: the authoritative double-booking guard
EXCLUDE USING gist (business_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)
  WHERE (status IN ('pending','confirmed'))
```

Half-open `[)` makes back-to-back bookings legal. The partial predicate means
cancelling frees the slot instantly, with no cleanup.

`notifications.dedupe_key` is `UNIQUE` — that is what makes enqueueing
idempotent under retries.

### Owner deletion cascades (0008)

```sql
ALTER TABLE businesses
  ADD CONSTRAINT businesses_owner_user_id_fkey
  FOREIGN KEY (owner_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
```

`owner_user_id` was a logical FK with nothing enforcing it. Deleting an owner
in Supabase Auth left the business row behind, still holding its **UNIQUE
slug** — so the same person re-registering (a new uuid, same email) hit
`duplicate key value violates unique constraint "businesses_slug_unique"` and
could never reclaim it. Nobody could clean it up either: the row belonged to a
uuid that no longer resolved to an account.

**This is a data-destruction path.** Deleting a row in the Supabase Auth
dashboard now erases that tenant's business, services, hours, time off,
appointments and notifications — every client name and phone number it held —
with no prompt and no undo. Correct while the platform has no tenants whose
records must outlive their account; revisit as `ON DELETE RESTRICT` if that
changes, which would force businesses to be deleted explicitly instead.

The migration refuses to apply if orphans already exist, rather than deleting
them to make room for the constraint. `src/db/owner-cascade.test.ts` covers the
cascade, the slug reclaim, tenant isolation, and that refusal.

### RLS status: 12 of 12 tables, **0 anon policies**

Migrations `0002`, `0005`, `0007`, `0012`, `0013` and `0020`. Nine tables carry
one `FOR ALL TO authenticated` policy keyed on `auth.uid() = owner_user_id`,
joined through `businesses` for child tables. Both `USING` and `WITH CHECK` are
set, so an owner cannot insert rows pointing at someone else's business.

`db/rls.test.ts` asserts the whole table list, not only the policies — which is
what caught `push_subscriptions` arriving without a policy. A new tenant table
cannot be added without a deliberate decision about its RLS.

Three tables deliberately differ, and the same test asserts each:

| Table                 | Policy                | Why                                                                                                            |
| --------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------- |
| `rate_limits`         | none                  | Infrastructure, no tenant data. RLS on with zero policies denies every role RLS applies to.                    |
| `subscription_events` | none                  | Raw provider payloads can carry billing addresses and card metadata. An owner has no reason to read webhooks.  |
| `invoices`            | `FOR SELECT` only     | Owners edit services and hours; nobody edits their own invoices. One who could `INSERT` could mark themselves paid. |

Verified against the live database (`pg_policies`): no policy names `anon` or
`public` in its roles. Note that `relforcerowsecurity` is `false` everywhere,
so the `postgres` owner still bypasses RLS — which is exactly how the app
connects, and why server-side `business_id` scoping remains mandatory.

**The app's own connection authenticates as `postgres` and bypasses RLS.** RLS
exists to close the PostgREST hole: the anon key is public by design, and
without it anyone could read every tenant's client names and phone numbers.
Server code stays responsible for its own `business_id` scoping — which is why
every repository function takes it explicitly.

### Branding columns (0009)

`businesses` carries five presentation-only columns: `theme_color`,
`hero_media_url`, `hero_media_type`, `gallery_urls` (jsonb) and `reviews`
(jsonb). **Nothing here is read by the availability engine or the booking
rules**, so a bad value can only produce a plain page, never a wrong
appointment.

`gallery_urls` is jsonb rather than a child table because the array position
_is_ the display order — a sort column would add a table to reorder two
thumbnails. `reviews` is jsonb for the same reason plus one more: they are
typed in by the owner, never queried across tenants, and have no lifecycle.

Three CHECK constraints, because jsonb accepts whatever it is handed:

```sql
CHECK (jsonb_typeof(gallery_urls) = 'array')
CHECK (jsonb_typeof(reviews) = 'array')
CHECK ((hero_media_url IS NULL AND hero_media_type IS NULL)
    OR (hero_media_url IS NOT NULL AND hero_media_type IN ('image','video')))
```

The hero pair constraint exists because a type without a URL renders nothing
and a URL without a type cannot be rendered at all — the two columns must not
drift. `lib/branding.ts` still re-validates every one of these on read: a seed
or a psql session can write past the app, and the public page must render
regardless. `parseGallery` and `parseReviews` drop what does not parse rather
than throwing.

### Image uploads (Supabase Storage)

Owners upload logos, banners, gallery photos and staff portraits from the
dashboard. **The bytes never pass through the Next server.**

```
browser                     Next server                 Supabase Storage
   │  requestMediaUploadAction()  │
   ├─────────────────────────────►│ requireWritable()
   │                              │ entitlement check
   │                              │ createSignedUploadUrl(path)  ──────►│
   │◄─── ticket {uploadUrl, publicUrl} ◄──────────────────────────────  │
   │                                                                     │
   ├──── PUT the file, straight to the signed URL ──────────────────────►│
   │                                                                     │
   └─ onChange(publicUrl) → the *existing* save action writes the column
```

**Why not just POST the file to a Server Action.** Action bodies are capped at
1MB by default, and raising the cap only moves the problem — a 5MB photo would
still be buffered in a serverless function on its way to a service that already
speaks HTTP, paid for twice and slower on the phone connection this product is
actually used on.

**Why the browser needs a ticket at all.** It has no Supabase session to
authenticate with: the auth cookies are `httpOnly` (see `supabase/cookies.ts`),
deliberately, so an XSS bug cannot walk off with the token. A browser client
would therefore upload as anonymous and any RLS policy would refuse it. So the
server issues a signed URL good for one exact path.

**Why the server signs with the service-role key rather than the owner's
session.** The alternative is an RLS policy on `storage.objects` matching the
first path segment against the businesses this `auth.uid()` owns. That is a
second copy of "who owns this tenant" written in SQL, free to drift from
`requireWritable()` — and it would **silently break admin impersonation**, which
resolves a business the signed-in user does not own. Signing server-side keeps
one authorisation boundary, the one the coverage test already polices.

The consequence is that `SUPABASE_SERVICE_ROLE_KEY` is now a production
requirement rather than a CLI convenience. `createSupabaseAdminClient()` returns
`null` when it is absent, so uploads say they are not configured instead of
crashing, and the URL fields they were added beside still work.

`admin-isolation.test.ts` is what keeps that key out of the browser bundle: it
resolves every import in `src/` and fails the build if a `"use client"` module
reaches the admin client, or if anything beyond `media-actions.ts` imports it at
all. A leaked service-role import would not actually expose the value — the
variable has no `NEXT_PUBLIC_` prefix, so Next inlines `undefined` — which is
precisely the danger: the feature would break in a way that invites someone to
"fix" it by renaming the variable.

**Three size checks, and only one of them is a guarantee.** The browser checks
for instant feedback, `requestMediaUploadAction` checks before spending a
signature, and the bucket carries `file_size_limit` and `allowed_mime_types`.
Only the last cannot be skipped by a crafted request; the first two exist to
produce a good error message.

`image/svg+xml` is excluded on purpose. An SVG is a document that can carry
script, and these files land in a public bucket where the URL can be opened
directly rather than only rendered inside an `<img>`.

Paths are `{businessId}/{kind}/{uuid}.{ext}`. The tenant comes first so
everything a business owns shares a prefix. The extension is derived from the
**MIME type, never the uploaded filename**, and both variable segments are
asserted to be UUIDs rather than escaped — escaping invites the question of
whether it was done right.

The bucket is created by `npm run storage:setup`, **not by a migration**. It
looks like schema and Supabase Storage is Postgres tables underneath, so the
obvious move is a `0019_storage.sql` — which would break the entire suite, since
the tests run the real migration files against PGlite, a bare Postgres with no
`storage` schema in it at all.

Known trade-off: **replacing an image orphans the old object.** Every upload
gets a fresh UUID path (so a CDN can never serve stale bytes at a live URL), and
nothing sweeps the previous one. A tenant who re-crops their logo ten times
leaves ten files. At this scale that is cheaper than a delete-on-replace that
would have to guess whether an unsaved form is going to be submitted.

### Subscription columns (0010) — enforced as entitlements, still not billed

`plan_type` (`free|starter|pro|business`) and `subscription_status`
(`trialing|active|cancelled`), both CHECK-constrained. CHECK rather than a
Postgres enum so adding a tier is one migration instead of two.

**Features are now gated on these columns; money still is not collected.** See
[Entitlements](#entitlements) below. There is no payment provider, so nothing
moves `subscription_status` off `trialing` on its own — but the tier a tenant
holds does decide what they can do.

Migration `0012` closed the drift that stage 8a deliberately opened: `business`
rows were rewritten to `pro` and dropped from the CHECK, and `past_due` was
added to it. During that window the code understood both values and the
database understood neither fully.

That ordering is the rule, not an accident: **code learns a value before the
database can produce it, and keeps understanding a value after the database
stops.** The reverse order breaks every read between deploy and migration, and
in this specific case would have let `toSubscriptionStatus` resolve `past_due`
to `trialing` — handing paid features to a tenant who had stopped paying.

### The lifecycle (0012)

```
trialing --(trial lapses)--> past_due --(7 days)--> frozen
   |                            |
   +--------(pays)-------> active <--(pays)--+
```

`lib/billing/lifecycle.ts` is pure: `planTransition(row, now)` returns one
action and touches nothing. `lib/billing/sweep.ts` does the IO around it, and
rides the existing daily cron rather than taking a second entry — the same
precedent as the rate-limit prune. Daily granularity is genuinely right here,
unlike for booking confirmations: a trial clock is measured in days.

Decisions worth keeping:

- **Freezing is last, never first.** A tenant whose card expired still has
  clients holding a link to their booking page. Seven days degraded, then dark.
- **One action per tenant per run.** A trial that lapsed ninety days ago starts
  its grace clock *today* and is considered for freezing on a later run, so a
  backlog cannot skip the window it is owed.
- **Warning bands are half-open and non-overlapping** (`1 < d <= 3`, then
  `0 < d <= 1`). A cron run that never happened degrades to one late warning
  rather than two landing in the same inbox on the same morning.
- **`past_due` with no clock is never frozen.** That state means a status set by
  hand or by a provider event that started no clock, and the guess would cost a
  tenant their public page.
- **Status and clock move in one statement.** Split across two, a failure
  between them strands a tenant `past_due` with no clock — degraded forever,
  never frozen, never recovered.
- **Only `frozen_reason = 'billing'` is ever auto-unfrozen.** An admin freeze is
  a deliberate act, and a successful charge must not buy a way back in.

The tier a visitor picks on the landing page travels as
`/dashboard/setup?plan=pro`. `proxy.ts` preserves the **query** as well as the
path when it bounces an anonymous visitor to `/login`, or that choice would be
lost across sign-in.

## Key technical decisions

**Timezone: UTC storage, business-local reasoning.** Every timestamp column is
`timestamptz` in UTC. Wall-clock inputs (working hours, time-off forms) are
resolved through `fromZonedTime(…, business.timezone)`. Never compare a local
date to a UTC one.

**Dashboard stats are one aggregate plus one grouped query.** Every headline
number rides a single `FILTER` scan, except `newClientsThisWeek`: it groups by
phone and asks whether `min(starts_at)` falls inside the week, which cannot
share a scan with a row count. That definition matters — counting everyone who
booked this week would relabel regulars as new on every return visit.
`todayRevenueCents` is coalesced because `sum()` over an empty filter is NULL,
and it is _expected_ revenue: nothing in this product records a payment.

**Pure/IO split for anything time-based.** `computeSlots()` and
`getStatsWindows()` are pure functions; `getAvailableSlots()` and
`getDashboardStats()` do the IO around them. This is what makes DST behaviour
testable — the same `09:00` shift is `06:00Z` in August and `07:00Z` in
December, and both are asserted.

**The slot grid steps by the service block, not by `slot_interval_min`.** The
step is `durationMin + bufferMin`, so a 15-minute service with a 5-minute gap
offers 09:00, 09:20, 09:40 and a 35-minute service offers 09:00, 09:35, 10:10.
Consecutive starts therefore leave no remainder too short to sell.

**A booking re-anchors the grid.** `computeSlots` walks a cursor rather than
filtering a precomputed list: when a candidate conflicts, the cursor jumps to
`appointment.end + buffer` and stepping resumes from _there_. Keeping the
original line as well would offer 09:40 right after a re-anchored 09:35 and
strand a five-minute sliver nobody can book. Closures re-anchor the same way.
The walk always terminates — a conflict can only match while
`cursor < conflict.end + buffer`, so every jump is strictly forward. Covered by
`lib/availability-backtoback.test.ts`.

> **`businesses.slot_interval_min` is now almost dead.** It survives only as a
> fallback for a service whose block computes to zero, which the
> `durationMin <= 0` guard already rejects — so in practice it is unreachable.
> The dashboard still exposes it as an editable setting that no longer affects
> anything. Either drop it from the settings form or restore it as an opt-in
> "keep a fixed grid" mode; leaving a live-looking control that does nothing is
> the worse option.

**Availability is server-only.** The client echoes back a `startsAt` produced
by the server; `createBookingAction` re-derives duration from the stored
service and re-runs availability before inserting. The exclusion constraint
settles any remaining race.

**The public origin is resolved, not assumed.** `lib/app-url.ts` is pure and
free of `next/headers`, so the same rule runs on the server, in a client
component and in a test. `NEXT_PUBLIC_APP_URL` wins — it is the only value that
is also correct inside a notification email, where there is no request to
inspect — **except when it says localhost and the request plainly did not**.
That combination is a misconfigured deploy rather than an instruction, and
honouring it is what put `http://localhost:3000/[slug]` on a link an owner
handed to a customer. A runtime origin never overrides a real configured
domain, so a preview deployment cannot rewrite the canonical one.

Cron-sent mail has no request to fall back to, so `NEXT_PUBLIC_APP_URL` remains
the only source there. `check:env --production` already fails when it is unset
or still points at localhost, which is what keeps that path honest.

**Notifications use a transactional outbox.** Messages are written to
`notifications` first and dispatched by `/api/cron/notifications` (scheduled in
`vercel.json`, guarded by `CRON_SECRET`). Rationale: a provider outage delays
rather than loses; `dedupe_key` prevents double-sends; and the dispatcher
re-checks appointment state before sending, so a reminder for a
since-cancelled appointment is skipped rather than delivered.

**A manual booking dispatches inline.** `dispatchDueNotifications` takes an
optional `appointmentId`, and the dashboard's manual-booking action calls it
straight after enqueueing. The outbox still owns durability — the row stays
pending and the daily run retries it — but an owner standing in front of a
client should not have to explain that the confirmation arrives tomorrow
morning. A failure there never fails the booking.

> **The manual-booking bug was not a missing call.** The action always
> enqueued. The problem is that a walk-in booked over the phone has a number
> and no email, and email is the only channel with a live provider today, so
> `clientDelivery()` resolved to nothing and queued nothing at all. That is
> now surfaced to the owner as a warning on the success toast instead of
> looking like a broken confirmation. It resolves properly once Twilio is
> configured and the SMS branch can take phone-only clients.

**Dispatch cadence is the outbox's one hard constraint.** Confirmations and
owner alerts are enqueued with `scheduledFor: now`, so a client sees them only
as fast as the dispatcher runs. `vercel.json` is set to `0 8 * * *` because
Vercel's Hobby plan rejects any expression that fires more than once a day — at
that cadence a booking made at 14:00 gets its confirmation the next morning.
Anything approaching real-time needs Pro, or an external scheduler hitting the
same URL with the same bearer token. See [DEPLOYMENT.md](DEPLOYMENT.md).

**Providers resolve at send time.** `getProvider(channel)` checks credentials
on every call, so adding a key switches a channel live with no code change.
Resend for email, Twilio for SMS/WhatsApp. **Every channel falls back to a
console provider when unconfigured** — messages are logged and marked sent.
This is why the entire pipeline was testable before any provider account
existed. Check `live: false` in the cron response to see what is not real.

**The client channel follows the tenant's entitlements.** `CLIENT_CHANNEL` used
to be a module constant; it is now `clientDelivery()`, which picks SMS for a Pro
tenant and email for everyone else. Two guards, both load-bearing:

- `isChannelLive()` — routing to an unconfigured channel would hand messages to
  the console provider, which reports success. A Pro tenant on a deploy without
  Twilio keys keeps their email reminders rather than silently losing them.
- the entitlement itself — a lapsed Pro tenant resolves to `free` and lands
  back on email, with no separate downgrade path to maintain.

WhatsApp is deliberately **never auto-selected**, even when entitled and
configured: a reminder is business-initiated, so Meta requires a pre-approved
template outside the 24-hour service window. The adapter works; routing to it
before that approval exists produces provider rejections, not messages.

The reminder `dedupe_key` deliberately excludes the channel — one reminder per
appointment, whatever carries it. Including it would let a plan change between
booking and send time queue a second copy.

That fallback is silent by design, which makes it dangerous at launch: an
unconfigured production deploy sends nothing and reports success. So
`check:env --production` requires `RESEND_API_KEY` and
`NOTIFICATIONS_FROM_EMAIL` and prints the resolved channel outright — a green
deploy check must not coexist with zero delivered mail. Development rules keep
it a warning, since the console provider is the whole point locally.

**`proxy.ts`, not `middleware.ts`.** Next 16 deprecates the middleware file
convention. It has two jobs and they share nothing but the entry point:
resolving an unknown slug to a real 404 (below), and redirecting anonymous
visitors away from `/dashboard`. The second is **only** a redirect — the real
authorization boundary is `requireBusiness()` in
`src/lib/dashboard-session.ts`, which resolves the business **from the session**
and is called by every dashboard page and action. No action takes a business id
from its request body.

The two are kept in separate functions because a public booking page must not
pay for a Supabase `getUser()` round trip it has no use for. Broadening the
matcher without splitting them would have put an auth call in front of the
product's most-loaded page.

## Unknown slugs return a real 404

`/[slug]` sits at the root of the URL space, so **every** unmatched
single-segment path lands on it — a mistyped link, a shop that closed,
`/wp-admin`. All of them used to answer **200**.

The cause is documented Next behaviour rather than a bug in this app.
`not-found.js` returns "a `200` HTTP status code for streamed responses, and
`404` for non-streamed ones", and `loading.js` § Status Codes says why: the
response body starts streaming the moment a Suspense fallback renders, and *"to
start streaming, the response headers must be set"*. `/[slug]` gained a
`loading.tsx` in the navigation-performance pass, so by the time the database
says the business is missing the status line is already gone. `/b/[token]` has
no `loading.tsx`, makes the identical `notFound()` call, and has always
returned a real 404 — which is the clearest confirmation of the mechanism.

**The SEO risk was already covered, and that is worth stating precisely**
because it changes what this fix is for. `generateMetadata` returns
`robots: { index: false, follow: false }` for a missing slug, and Next's own
guidance is that the `noindex` meta is what prevents indexation in the
streaming case. So this was never "an empty page gets indexed". What was
actually wrong is narrower and still worth fixing: analytics and uptime
tooling could not distinguish a dead link from a live page, and **every bot
probe of the domain got a 200**.

Next's recommended fix is to resolve the resource in the proxy, before the body
streams, and that is what `proxy.ts` now does.

### Three verdicts, not two

`lib/public-slug.ts` classifies each path as `platform`, `tenant` or
`impossible`, and the third one earns its place:

| Verdict      | Example                        | Cost      |
| ------------ | ------------------------------ | --------- |
| `platform`   | `/legal/terms`, `/sw.js`, `/`  | nothing   |
| `tenant`     | `/demo-barber`, `/wp-admin`    | one query |
| `impossible` | `/Demo-Barber`, `/wp_admin`    | nothing   |

Every slug is lowercased through Zod before it reaches the column, so a path
outside `^[a-z0-9-]{1,40}$` cannot match a row however the data looks. Folding
`impossible` into `platform` would send those back down the render path to
produce the streamed soft 404 again; folding it into `tenant` would spend a
round trip proving what the character set already settles. Bot noise is the
overwhelming majority of this traffic and it now costs nothing at all.

### The reserved list is in code, and a test defends it

Adding `src/app/pricing/page.tsx` gives the platform a `/pricing` page **and**
makes it indistinguishable from a tenant called "pricing" — the proxy would
look the slug up, fail to find it, and 404 a working page. In production only,
since a local database may have no businesses at all.

The matcher cannot hold that list: Next requires matcher patterns to be
statically analysable literals, so a second copy would live in a regex and
drift. `RESERVED_SEGMENTS` is therefore the single source of truth and
`public-slug.coverage.test.ts` fails the build when a top-level route is
missing from it — the same mechanical-coverage pattern as `nav-coverage` and
`dashboard-session.coverage`. It also fails on a *stale* reservation, because
a reserved name is permanently denied to every tenant.

What the matcher still carries is only what can never be a page: `_next/`,
`api/`, and anything with a file extension. It ends in `.+` rather than `.*`
so `/` — the highest-traffic route in the product, and a static prerender with
no slug to resolve — never invokes the function at all.

### The cache, and why hits and misses are separate

`lib/slug-cache.ts` sits in front of the lookup, because the proxy runs before
the most latency-sensitive page in the product and a business's slug changes
perhaps twice in its lifetime. Two properties are load-bearing:

- **Separate maps with separate caps.** In one shared map a bot spraying random
  slugs would evict every real business, so the defence against pointless
  queries would collapse under exactly the traffic it exists for.
- **Misses expire far sooner than hits** (20s against 5min). The failure modes
  are not symmetric: a stale *hit* means a deactivated shop renders and then
  soft-404s — the old behaviour, no worse — while a stale *miss* means a live
  booking page answers 404 to real clients.

Next's proxy docs warn against relying on globals, because a proxy may be
deployed separately from the app and instances are not coordinated. That is
fine here precisely because this is a *cache*: every entry is derived, expiry
is absolute, and a cold instance simply asks again. Nothing is ever only in it.

**It fails open.** If the lookup throws, the request is let through to render
exactly as it did before — the same rule the rate limiter follows. Taking every
tenant's booking page offline because one query failed is far worse than the
soft 404 being replaced.

### Why a dedicated route rather than deleting the `loading.tsx`

A miss is rewritten — not redirected, so the visitor keeps the URL they typed —
to `/business-not-found`, which is **synchronous, has no `loading.tsx` and
nothing to await**. Nothing suspends, so nothing streams, so its `notFound()`
still owns the status line. It prerenders static, which makes the 404 free to
serve.

Removing the `loading.tsx` from `/[slug]` would also restore the status and
costs far more: Next skips prefetching a dynamic route with no fallback, which
is the exact regression the navigation-performance pass was built to fix.

`components/booking/business-not-found.tsx` is the shared UI, rendered both
there and from `/[slug]/not-found.tsx`. A visitor cannot tell which path they
took and should not be able to.

**Abuse defence is layered, and fails open.** The public booking action is
unauthenticated by design, so it carries a honeypot (a visually hidden field
that returns a _fabricated_ success, writing nothing, so a script gets no
signal) plus Postgres-backed rate limits on IP and on phone-per-business. Rate
limits are consumed **before** the honeypot check, or a bot filling the
honeypot would get unlimited free requests. If the counter table is
unreachable, requests are allowed through: refusing every booking because a
counter is down is worse than the spam.

**The accent theme is CSS, not Tailwind classes.** Tailwind cannot emit a
class built from a runtime value — `bg-${colour}-600` is never generated — so
the owner's choice becomes a `data-accent` attribute on the page wrapper and
the colours arrive as custom properties (`--accent`, `--accent-strong`,
`--accent-contrast`, `--accent-soft`, `--accent-soft-border`,
`--accent-on-soft`). Components then use static `bg-(--accent)` utilities.

The values live in `globals.css` for a second reason: each swatch needs a dark
variant, which an inline style cannot express. `THEME_COLORS` in
`lib/branding.ts` is the source of truth for which names are _legal_; the
stylesheet is the source of truth for what they _look like_. Nothing at compile
time connects the two, so a test asserts every listed colour has a matching
`[data-accent="…"]` block.

Every swatch clears WCAG AA (4.5:1) for `--accent-contrast` on `--accent`,
verified by measuring in a browser rather than by eye. This is why emerald and
cyan sit at the 700 level while the rest are 600 — at 600 both measured ~3.6:1
against white, and the CTA label is 14px semibold, which gets no large-text
exemption. Amber inverts `--accent-contrast` to near-black for the same reason.

**Onboarding state is explicit.** `onboarding_completed_at` rather than
inferring from service count, which would drag an owner back into setup after
deleting a service. The business row is created at step 1 so an abandoned
signup still leaves a usable account.

## Entitlements

`lib/entitlements.ts` is the single place that decides what a tier buys. Pure,
like `platform-metrics.ts` — no IO, no database handle — so every rule is
unit-testable and callable from an action, a page or the notification enqueuer.

**Two tiers, separated by features only — never by volume.** Both include
unlimited bookings. A usage cap would mean adding IO to this module, which is
the signal to stop: a cap punishes the *client* for the tenant's plan choice,
turning a booking page into a paywall at the worst possible moment.

```
                    starter (₪69)   pro (₪99)   trialing
customBranding            ·             ✓           ✓
smsReminders              ·             ✓           ✓
whatsappReminders         ·             ✓           ✓
advancedAnalytics         ·             ✓           ✓
prioritySupport           ·             ✓           ✓
```

**A trial grants `TRIAL_PLAN` (Pro) regardless of the tier picked at signup.**
The chosen tier is a statement of intent for *after* the trial. Before this
rule, a tenant who picked Basic hit "upgrade your plan" walls on branding and
gallery during the exact window they were evaluating the product — the trial
demonstrated the tier they had not chosen. `/dashboard/billing` shows what they
actually hold, so it reads Pro at ₪99 during a trial, with the post-trial price
labelled as such.

`free` and `starter` are identical here, and that is not an oversight.
Everything Starter sells — booking page, unlimited bookings, email reminders,
self-service cancellation, the basic dashboard — is baseline product no tenant
is denied. Starter buys *the right to keep using it*, not an extra capability.
The consequence is worth stating rather than discovering: **for a Starter
tenant the coming grace window applies no pressure at all**, and the freeze at
the end of it is the only enforcement they will feel.

### Two rules that carry the weight

**Plan and status are never consulted separately.** `entitlementsFor()` takes
the business row, not a `PlanType`, so no caller can check the tier without the
status. Resolution is three cases in order: trialing grants `TRIAL_PLAN`,
active grants the tier actually paid for, everything else grants `free`. That
is what makes both the trial upgrade and the non-payment downgrade a single
rule rather than a second code path in every consumer.

`isDowngraded()` therefore compares against the *entitled statuses*, not
against the chosen tier: a trialing Basic tenant resolves to Pro, so a plain
`effectivePlan !== planType` check would flag them as downgraded while they are
being handed more than they picked.

**The trial clock is written at business creation** and nowhere else. Until
stage 8c it was written nowhere at all: migration `0011` backfilled existing
rows and `/master` could extend it, but a tenant who signed up got NULL. The
sweep only considers rows with a clock, so every new account was invisible to
it — never warned, never lapsed, never frozen, holding full trial entitlements
indefinitely.

**Unknown status fails closed; unknown plan fails open.** `effectivePlan`
matches the raw column against the paying set rather than reusing
`toSubscriptionStatus`, whose fallback is `trialing`. The realistic way an
unrecognised status appears is a provider webhook writing one the constant has
not learned yet — `unpaid`, `incomplete_expired`, `paused` — and nearly all of
them mean the tenant is not paying, so unknown must not become a grant. An
unknown *plan* on a paying status still gets the default tier, because there
the tenant demonstrably is paying. The display normaliser and the entitlement
check default in opposite directions on purpose.

### Where it is enforced

| Surface                             | Gate                                                              |
| ----------------------------------- | ----------------------------------------------------------------- |
| `settings/appearance-actions.ts`    | Refuses branding writes without `customBranding`, and logs them   |
| `dashboard/settings/page.tsx`       | Renders an upgrade panel instead of the form                      |
| `lib/notifications/enqueue.ts`      | Picks the client channel from `smsReminders`                      |

The action check is the boundary; the page check is courtesy. A server action
is a plain POST endpoint, so a hidden button proves nothing about who can call
it — the same reasoning that makes every `/master` action re-check the roster.

## The write gate

`requireBusiness()` returns an `access` of `full` or `read-only`, derived from
`is_active`. **Every mutating dashboard action calls `requireWritable()`**,
which redirects rather than throwing: a frozen owner with a stale tab clicks
Save and lands back on the dashboard, where the banner explains why, instead of
an unhandled server error. Still fail-closed — the action body never runs.

Reads stay open deliberately. A frozen tenant keeps their calendar, their
client list and their history; only writes and new bookings stop.

> **This is the gate the impersonation warning was waiting for.** It is
> currently wired to the freeze only. Making impersonation read-only is now a
> one-line change in `accessFor()`, and is a product decision rather than a
> technical one — support may legitimately need to fix a tenant's settings.

### Coverage is checked mechanically, not by review

`lib/dashboard-session.coverage.test.ts` parses every `"use server"` module,
extracts each exported action, and fails the build unless it names a sanctioned
guard. Actions that legitimately need none — onboarding, the public booking
flow, auth entry points, `stopImpersonationAction` — sit in an `EXEMPT` map
with a stated reason, and a second test fails if an entry there goes stale.

This exists because ARCHITECTURE.md warned that a per-action gate with partial
coverage is **worse** than no gate, since it looks safe. Trusting review to
catch a missing `requireWritable` is exactly the failure mode that warning
describes. The test was verified by reverting three actions to
`requireBusiness()` and confirming it named all three.

**Branding is gated on write only, and grandfathered on read.** Anything
already saved keeps rendering on the public page. Branding predates this gate,
so a tenant could have set it while it was free; pulling their gallery down as
a side effect of a repackaging would be hostile.

## Platform console (`/master`)

Super-admin only. Four tabs — overview, businesses, live feed, alerts — over
`db/queries/admin.ts`, the one module whose queries deliberately cross tenant
boundaries. It lives apart from the tenant-scoped repository precisely so a
function without a `business_id` filter reads as intentional.

**Access is an env roster, not a column.** `SUPER_ADMIN_EMAILS` is a
comma-separated list. A `is_super_admin` column was rejected: super-admin is a
property of a _user_, users live in Supabase's `auth.users` which this app must
not add columns to, and `businesses` is the wrong home — an owner may have
several and a platform admin may own none. An empty or unset roster **denies
everyone**; the console fails closed.

`proxy.ts` does not match `/master`, so there is no middleware fallback. The
guard runs in the layout, in every page, and in every action. The layout alone
is not enough — a client-side navigation between tabs reuses it without
re-running it — and an action is a plain POST endpoint that being rendered
inside `/master` proves nothing about.

### Impersonation

`/master` can open a tenant's dashboard for support. The cookie holds only a
business id and is **not trusted on its own**: `requireBusiness()` re-checks
that the caller is a super admin on every request before honouring it, so a
stolen or forged cookie is inert without a live admin session.

Minting a real Supabase session for the target owner was rejected — it would
make the admin indistinguishable from the tenant in Supabase's own auth logs,
and a leaked token would be a standalone credential for that account. Here the
admin keeps their own identity, and start/stop are logged with the admin's user
id under `master.impersonate.*`.

> ⚠️ **Impersonation is still not read-only.** An impersonating admin can write
> as the tenant, and those writes are indistinguishable from the owner's in the
> data. The banner and the audit log remain the mitigations.
>
> The per-action gate this warning asked for now exists (see
> [The write gate](#the-write-gate)) and is enforced for frozen tenants, with
> mechanical coverage. Pointing it at impersonation is a one-line change; it is
> held back as a product decision, not a technical gap. An impersonating admin
> *does* inherit a frozen tenant's read-only access, because that reflects the
> account's state rather than who is looking at it.

### Trial column (0011)

`trial_ends_at`, backfilled to `created_at + 14 days` for existing trialing
tenants. Since `0012` it **is** enforced: the daily sweep moves a lapsed trial
to `past_due` and starts the grace clock. It still also drives the console's
expiry alerts and the "+7 days" action.

## Marketing surface

`/` is a **static prerender** with no database access, and must stay that way.
The pricing billing toggle and the FAQ accordion are the only interactive
parts, so each is its own client island in `components/marketing/` rather than
a `"use client"` on the page.

Pricing tiers, feature copy and FAQs live in `lib/plans.ts` and
`lib/landing-content.ts` as plain data with no JSX, so prices and copy can be
edited without touching a component — and so the pricing maths is unit-tested.
`landing-content.ts` still stores icon _names_ rather than components, which is
what keeps it importable as data. The landing page no longer renders them: the
feature section is an editorial list, not an icon grid. The field is kept
because it costs nothing and the next surface that wants icons will need it.

### The landing page is monochrome plus one gradient. Nothing else is.

`/` runs on a **monochrome base with a single accent gradient**: ink is
`zinc-950` (`#09090b`), paper is white, and the `zinc-200..600` ramp carries
everything between. Measured in a browser, both schemes: 19.9:1 on solid CTAs,
16.1:1 on the outline CTA, 12.0:1 on hero body copy.

**One gradient, declared once** as `--brand-gradient` in `globals.css`, violet
into blue. A second near-matching accent is the fastest way to make a
monochrome page look cheap, so components read the variable and never define
their own. It stops short of cyan deliberately: anything past blue lands back
in teal, which this page exists to be rid of.

It is spent only on things that are **active or primary** — the live dot and
the next appointment in the mockup, the recommended tier's badge and action,
the closing banner. Everything else stays monochrome. A gradient used for
decoration is what turns an accent into a theme.

> **The ramp's lightness is set by contrast, not by taste.** The first draft ran
> violet-500 into blue-600 and measured **4.23:1** and **4.47:1** against white,
> both under the 4.5:1 floor, on a button label, a badge and a status chip. One
> step darker across all three stops (`#6d28d9`, `#4f46e5`, `#1d4ed8`) puts the
> worst case at **6.29:1**. Re-measure before brightening any of them.

#### The hero panel is the one large fill that carries colour

Its dark half used to be flat `zinc-950`. On a phone that panel **is** the first
screen — 10rem of it above everything else — so the product introduced itself in
black and white before anyone scrolled.

`.brand-mesh` replaces it: four soft radial blobs over a deep base, in the same
violet→blue family as `--brand-gradient-deep` and the closing banner, so the top
of the page and the bottom of it now belong to one product. A *mesh* rather than
a linear ramp, because a two-stop fade at that size reads as a background
someone forgot to finish.

This does not loosen the rule above. The accent is still spent only on things
that are active, primary, or — here — the brand's own introduction. Everything
between the hero and the closing banner stays monochrome, which is precisely
what makes both ends read as deliberate.

> **Measured, like the ramp.** The lightest possible composite is where all four
> blobs overlap the lightest base stop: `rgb(106 77 230)`, **5.51:1 against
> white**. That clears AA for body text with room, and the only type on it is
> display-sized. Re-measure before raising any alpha or lightening the base.

The **tenant** booking page gets the same treatment in *their* colour rather
than ours — see below.

### The booking page is the tenant's, in the tenant's colour

`theme_color` used to reach a handful of controls and stop. The rest of
`/[slug]` was the platform's monochrome, so a shop that picked emerald got a
mostly grey page with a few green buttons on it.

Now the accent carries every surface that is **active, selected or theirs**: the
banner, the monogram, the stepper, selected cards, the summary bar on the final
step, the service duration badge, and every focus ring. Body copy, cards and
borders stay neutral, which is what keeps the colour meaning "this is the thing
you picked" rather than "this page is green".

`.accent-mesh` is the same mesh as `.brand-mesh` reading `--accent-mesh-*`
instead of hard-coded stops, so it resolves from `data-accent` with no runtime
class names. Each swatch declares a deep base plus **two companion hues from its
own family**: one hue at three opacities is a wash, two neighbours overlapping
is what reads as a mesh.

**The banner now renders for every business, media or not.** It used to appear
only when a hero had been uploaded, so a shop that had not got round to it
opened as a white page with a grey monogram — the most important screen in the
product introducing them as nothing in particular. With no media the mesh is the
banner.

Nothing sits on top of it but decoration: the business name and description live
on the page background *below* the banner. That is what lets these stay
saturated — no text over the mesh means no contrast floor to defend, so a
tenant's colour can be as vivid as they chose it.

> **`/b/[token]` was themed at the same time, and had to be.** The moment its
> primary button moved to `bg-(--accent)`, a page with no `data-accent` on it
> resolved that to nothing and rendered an **invisible cancel button**.
> `theme-coverage.test.ts` now fails the build if a page rendering a booking
> component omits the attribute, and `:root` carries a fallback accent so the
> same slip can never produce an invisible control again.

### Banner sizing is an aspect ratio, not a height

`aspect-[4/3]` on a phone, `aspect-[16/9]` from `sm` up, capped at `26rem`. A
fixed height holds a different share of a 375px phone than of a laptop; a ratio
holds the same one. The cap is what stops a tablet turning the banner into a
full screen of decoration before anyone reaches a service.

### Video heroes

`hero_media_type` has accepted `"video"` since 0009 and the page has always
rendered one; what was missing was any way to *get* a video in. The uploader now
takes `video/mp4` and `video/webm` at **25MB**, on the hero and nowhere else.

- **Only the hero.** A looping clip as a logo, a gallery thumbnail or a
  portrait is a mistake nobody meant to make, and those surfaces are `<img>`
  tags that would render nothing at all.
- **25MB is a product decision, not a technical ceiling.** This file autoplays
  on a client's first paint, usually on mobile data. 25MB of H.264 is roughly
  twenty seconds of decent 1080p — enough for the loop a shop wants, little
  enough that the page still arrives.
- **The type comes back from the server**, not from a guess in the browser.
  `hero_media_url` and `hero_media_type` are a CHECK-constrained pair, so the
  upload ticket reports which of the two it accepted and the form stores them
  together.
- **The bucket now carries one limit for both**, the larger. The 5MB image rule
  is enforced in the browser and in the action only — a crafted request could
  put a 20MB PNG in a tenant's own folder. That costs storage, not safety, and
  the alternative is a second bucket to police a number the app checks twice.

Playback is `autoPlay muted loop playsInline`, with `controls={false}` and
`disablePictureInPicture`: it is a background, not a player. The settings
preview deliberately does **not** autoplay — a settings page that starts playing
on load is startling, and a poster frame is enough to confirm the right file.

Two rules hold the rest together:

- **Soft geometry, one documented scale.** Pill (`rounded-full`) for anything
  interactive, `rounded-3xl` for containers, `rounded-2xl` for a surface nested
  inside a container. Pill buttons dropped into square cards is what reads as
  unfinished, so the rule applies to the whole surface or none of it. Bare text
  links carry no radius because they paint no box.
- **One theme per page.** The hero's ink/paper split is a deliberate
  composition inside one section, not a light section next to a dark one. In
  dark mode the paper half becomes `zinc-900` against the `zinc-950` half so
  the split survives instead of collapsing into a single black rectangle.

> **Teal is now gone from the entire product**, and the rules above are the
> whole platform's rules rather than this page's. See
> [One palette, one ramp](#one-palette-one-ramp).

Per-business `--accent` is unrelated to either and is untouched: `/[slug]` is
tenant-branded and still uses the custom properties from `lib/branding.ts`.

### Above-the-fold structure

The hero is `calc((100dvh - 4rem) * 0.7)` tall: exactly 70% of the space below
the 64px header, so the section beneath occupies the remaining 30% and peeks
above the fold. A `min-h` floor stops it collapsing on a short laptop, where
70% of 500px would crush the mockup.

The document is `dir="rtl"`, so grid column 1 renders on the **right**. The
hero's dark panel therefore carries `lg:order-2` to sit on the visual left
while staying first in the DOM, where its `<h1>` belongs. Below `lg` the split
stacks and the mockup is dropped rather than shrunk.

**The split is structural: two crisp grid cells meeting on one edge.** An
earlier pass feathered the seam with a `mask-image` so the ink dissolved into
the paper. It read as a smudge rather than a transition, and it has been
removed — the only mask left in the hero is the dot texture inside the mockup
card.

**The scroll cue is anchored to the section, not to a panel.** It used to live
inside the copy column, which is vertically centred, so as that column grew the
cue cut straight through the demo button. At the section's own bottom edge it
has nothing to collide with: on desktop it sits at the panel seam, while the
copy column's content begins ~90px to its side. It is mid-grey for that reason
— black on one side of it, white on the other.

**The showcase card sheds its summary row under 820px of viewport height.** The
hero is capped at 70% of the screen, so on a 1280x700 laptop the full card does
not fit beside the copy and the actions: content overflowed the section and
pushed the headline up underneath the header. The agenda is what sells the
product, so the three summary figures are what give way.

`hero-particles.tsx` is a Canvas client leaf drawing **hollow stroked bubbles**,
varied in size, drifting upward with a sine sway and a slow radius pulse. Size
drives parallax: bigger rings rise slower and sit fainter, which is where the
depth comes from. Canvas rather than a swarm of animated DOM nodes — forty
absolutely-positioned divs are forty composited layers, which is what turns a
"subtle" effect into a 30fps phone. Nothing in it touches React state; positions
live in a plain array mutated inside the rAF loop, so the component renders
exactly once. It paints one frame synchronously before starting the loop,
because `requestAnimationFrame` is suspended in a background tab and a page
opened in one would otherwise show an empty black panel until focused.

The scroll affordance is a hairline that draws downward and retracts, with no
label and no wheel icon. It exists because the 70/30 split is deliberate and
something has to say the peek is intentional.

## Payment adapter (8c)

`lib/billing/providers.ts` resolves a `BillingProvider` at call time, the same
way `getProvider(channel)` does for notifications. Adding credentials switches
the live provider on with no code change, and `getBillingProvider()` is the
single function stage 8d has to teach a new name.

> **The fallback rule is inverted here, and that is the whole point.** An
> unconfigured notification channel falls back to a console provider that
> reports success and delivers nothing — annoying, recoverable, and the reason
> the outbox was testable before Resend existed. The same fallback in billing
> would mark tenants as paying without money moving: it would not lose a
> message, it would **invent revenue**. So the console provider *refuses* in
> production rather than simulating, and a test asserts it.

`check:env` reports the resolved billing provider beside the email channel, but
does **not** fail on `console` — there is no provider to configure until 8d, so
blocking every deploy on it would be theatre. The runtime refusal is the real
guard.

`activateSubscription()` in `lib/billing/activate.ts` is the single place a
subscription becomes `active`. Both checkout and the eventual webhook land
there, so the status change, the invoice and the audit row cannot drift apart
between two call sites. It clears `grace_started_at` (left set, the sweep would
freeze a tenant who has just paid), writes the invoice and event with
`onConflictDoNothing` so a retried webhook cannot bill twice, and lifts a
freeze only when `canAutoUnfreeze` allows it.

Cancellation records `cancel_at_period_end` and revokes nothing: the tenant
paid through the period, and the provider event is what eventually moves the
status.

### The proof strip is a card, and its glass is darker than the mesh

It used to be a full-bleed mesh band butted against the hero, with bare text on
it. Two things were wrong.

**The seam read as a second section starting.** Inset on the page background as
a `rounded-3xl` card with a blurred copy of its own colour bleeding out behind
it, the colour now looks like the hero continuing rather than beginning again —
which is the whole job of the strip that sits between the promise and the proof.

**The glass is `bg-black/20`, not `bg-white/10`, and that is measured.** The
reflex for glassmorphism is a white scrim, and on this mesh it is wrong in both
senses. The mesh's lightest possible composite is `rgb(106 77 230)`, where plain
white already sits at only **5.50:1**; a white scrim lightens that further,
dropping white text to 4.54:1 and a `white/70` detail line to about 3.1:1 —
under the AA floor for 12px type. Darkening instead gives `rgb(85 62 184)`:

| Text | On the bare mesh | On `bg-black/20` glass |
| ---- | ---------------- | ---------------------- |
| white | 5.50:1 | **7.59:1** |
| `white/75` | 3.55:1 ✗ | **5.05:1** |

So the old strip's `text-white/70` detail was **failing AA at 3.55:1** at the
panel's lightest point, and the redesign fixes that rather than inheriting it.
It also simply looks better: depth on a mid-toned field comes from a tile
receding, not glowing. Re-measure before lightening any of it.

### Closing banner

`cta-banner.tsx` closes the page: the deep gradient variant, a dot-matrix
pattern masked out toward the bottom, a warm flare at the base, and five glass
tiles drifting on individual offsets so the group never pulses in unison. Every
decorative layer is `aria-hidden` and `pointer-events-none` — none of it carries
meaning and all of it sits over the region the buttons live in.

It **replaces** the previous ink CTA rather than following it. Two signup
sections stacked at the bottom is two asks, and the second reads as the first
not having worked. The tiles are `hidden lg:flex` because at phone width they
would sit on top of the headline rather than around it.

## Navigation feedback

Alpha testers reported a 1.5–2 second dead click on every navigation, and
clicked again thinking it had failed. The cause was structural, not slow code.

**Every dynamic route lacked a `loading.tsx`.** Next skips prefetching a
dynamic route entirely unless one exists; with one, the route is *partially*
prefetched — shared layout and loading skeleton ahead of time, dynamic content
on demand. Every dashboard page is `force-dynamic` and none had a fallback, so
nothing could be prefetched and the browser sat on the old page until the
server finished its database work before painting a single pixel.

Measured on `/demo-barber`, prefetch payload with `Next-Router-Prefetch: 1`:

| | Payload | Skeleton prefetched |
| ------------------------ | ------------ | ------------------- |
| Without `loading.tsx`    | 197 bytes    | no                  |
| With `loading.tsx`       | 11,896 bytes | yes                 |

So the fix is a `loading.tsx` per dynamic route, not a spinner bolted onto a
button. Three layers now cover the whole transition:

1. **`useLinkStatus` on sidebar links** — the gap between the click and the
   fallback painting, while the RSC payload is in flight. The indicator is
   always rendered and only faded, because an inline element that appears would
   reflow the row it sits in.
2. **`loading.tsx`** — prefetched, so it paints on the click. Each skeleton
   mirrors its page's real layout so the swap does not shift anything.
   `/master` has its own, because the tenant shimmer is tuned for paper and
   flashes against slate.
3. **`RouteProgress`** — the top-edge bar, rendered *by* the fallbacks. Driven
   by Suspense rather than router events, so there is no subscription to router
   internals, no timers, and no state that can stick on after a cancelled
   transition. It is a server component and ships no JavaScript.

**Form-action buttons use `useFormStatus` via `components/ui/submit-button`.**
It has to be a separate component: the hook returns `{ pending: false }` when
called from whatever renders the `<form>`. Disabling on submit is not only
feedback — a form action posted twice runs twice, and "nothing happened so I
clicked again" is precisely what was reported.

## One palette, one ramp

The landing page was rebuilt monochrome while `/login`, `/dashboard/*` and
`/master` kept a teal chrome, so a visitor who signed up walked out of one
product and into another. That split is closed: **there is no teal anywhere in
the codebase**, and the production CSS bundle contains the string zero times.

Three ramps became one. `zinc` is the only grey — `neutral` (dashboard and
booking, 819 uses) and `slate` (`/master`) are both gone, so a card on
`/dashboard` and a card on `/` are now the same colour rather than nearly the
same colour.

**In a system with no accent hue, contrast is the accent.** Every primary
action is solid ink (`zinc-950`) on paper and inverts wholesale in dark mode.
Measured in-browser on `/login`: 19.06:1 on the primary button in both schemes,
19.9:1 on a secondary link, 10.44:1 on a field label.

`--brand-gradient` stays the single exception and is spent only where `/`
spends it — on something **active or recommended**:

| Surface                        | What carries the gradient          |
| ------------------------------ | ---------------------------------- |
| Dashboard sidebar & bottom bar | the current route, one item at a time |
| Setup flow                     | the current step only; completed steps go quiet |
| Plan picker / setup plan step  | the "recommended" badge and the upgrade action |
| Settings                       | the branding upsell — the one thing being recommended |
| `BRAND_MARK` stop              | every surface, via `bg-clip-text`  |

White on the three gradient stops measures 7.10 / 6.29 / 6.70 — the same worst
case the landing page documents, because it is literally the same variable.

Geometry follows the landing scale: pill for anything interactive, `rounded-2xl`
for a card inside a page. **Text inputs are the one documented departure**, at
`rounded-xl`: a pill field wastes its horizontal ends and, in RTL, drops the
caret against a curve. A button is a target; a field is a container for content.

`components/dashboard/ui.tsx` holds every shared control — `btnPrimary`,
`btnAccent`, `btnSecondary`, `btnDanger`, `inputClass`, `cardClass`,
`StatusChip`, `EmptyState`, `SkeletonRows`, `PageHeader`. Each manager
previously styled its own buttons and focus rings, which is how they drifted
apart; the reconciliation pulled six more hand-rolled buttons onto the shared
tokens rather than merely recolouring them, since a recolour would have left
the same six copies to drift again.

`btnAccent` is deliberately separate from `btnPrimary`: it is for the one
action on a screen being *recommended* rather than merely available. Making
save buttons gradient is exactly how an accent becomes a theme.

### The four semantic hues that survived

Appointment status colours live in `StatusChip` only — pending amber, cancelled
rose, no-show zinc, completed emerald — and they are **not** brand colour.
Amber-for-waiting is read without a legend, and flattening it to grey would
delete information from the screen an owner scans fastest. The label is always
rendered beside the colour, so status never depends on hue alone.

Only `confirmed` moved, from teal to **indigo** — the gradient's mid stop —
because a confirmed appointment is the *active* thing in the list, which is
what the brand ramp is for. `/master` uses indigo the same way, for a paying
tenant and the MRR metric.

> **`--accent` is untouched and unrelated.** `/[slug]` is tenant-branded: the
> owner's chosen swatch still drives the public booking page through the custom
> properties in `lib/branding.ts`. A tenant who picked cyan still gets cyan.
> The brand ramp is the *platform's* identity; `--accent` is the *tenant's*, and
> conflating them would have meant repainting every customer's booking page as
> a side effect of a marketing decision.

**Numeric fields are edited as strings, and select on focus.** A number-backed
input cannot hold "empty": clearing it yields `Number("")`, which is `0`, so
the field springs back to a zero the owner has to delete before every entry.
Typing into a string draft that already reads `0` is worse still — it produces
`05`, because nothing coerces it away until submit. Both halves are needed:
string state so the field can genuinely be blank, and `select()` on focus so
the first keystroke replaces what is there. Parsing happens once, on submit.

**Time inputs carry `dir="ltr"`.** The page is RTL, and on Android the native
time picker anchors to the input's direction — in RTL it opened clipped by the
viewport with the confirm button off-screen. A time is `HH:MM` in every locale,
so forcing LTR on the field costs nothing and is what keeps the picker on
screen.

**Navigation breakpoints are paired at `md` on purpose.** The desktop sidebar
is `md:block` and the mobile bottom bar is `md:hidden`. Moving the bottom bar
to `sm:hidden` without also moving the sidebar would leave 640–768px with no
navigation at all.

### Every dashboard page must be reachable on a phone

The bottom bar takes four links — more than that and the labels truncate — and
the sidebar that held the rest is `md:block`. So adding `/dashboard/staff` made
it reachable on a desktop and **invisible on a phone**, with nothing in the type
system, the build or the suite to notice. An owner running the shop from their
pocket simply could not get to it.

Two changes, and the second is the one that matters:

- A **"עוד" bottom sheet** in the mobile header holds the overflow. A sheet
  rather than a dropdown for the same reason the booking page's hours drawer is
  one: the trigger is at the top of a phone and the thumb is at the bottom, so a
  menu opening *downward from the trigger* puts every item in the hardest part
  of the screen to reach. Sign-out moved inside it — a destructive action one
  stray thumb from the header is not where it belongs.
- **`SECONDARY_LINKS` is derived, not listed**: `LINKS.slice(MOBILE_LINKS.length)`.
  A hand-written second array could drift from the first and put a link in both
  places or in neither, which is the same bug wearing a different hat.

`nav-coverage.test.ts` reads the nav as source text — the module imports a
`"use server"` file and cannot be loaded in a test environment — and fails the
build when a `/dashboard/*` page is absent from `LINKS`. Routes that legitimately
belong outside it sit in a `NOT_IN_NAV` map with a stated reason, and a second
test fails if an entry there goes stale. Verified by removing `/dashboard/staff`
from `LINKS` and confirming it named it.

> The sheet's open state is **derived from the pathname**, not a boolean: it
> stores the route it was opened on and is open only while the path has not
> moved. Navigation therefore closes it with no effect and no cleanup, including
> for a back gesture or a redirect that a click handler would miss — and it
> avoids a `setState` inside an effect body, which is the cascading render the
> `set-state-in-effect` rule exists to stop.

## Public booking components

`components/booking/` splits by responsibility rather than by step, so the
pieces that need client state are the only ones that ship JavaScript.

| Component          | Boundary   | Role                                                  |
| ------------------ | ---------- | ----------------------------------------------------- |
| `booking-flow`     | client     | Orchestrates the 3 steps, owns all booking state      |
| `business-header`  | **server** | Logo, hero banner, contact row                        |
| `hours-drawer`     | client     | Weekly-hours bottom sheet — the only JS in the header |
| `service-step`     | client     | Service cards                                         |
| `datetime-step`    | client     | Day strip; delegates the slot area                    |
| `slot-picker`      | client     | Grouped slots, skeleton, empty and error states       |
| `details-step`     | client     | RHF + Zod form, summary card, honeypot                |
| `confirmation`     | client     | Success view, `.ics` download, cancel link            |
| `business-gallery` | client     | Thumbnail grid + lightbox                             |
| `business-reviews` | **server** | Average rating and testimonial cards                  |

Slots are grouped into morning / afternoon / evening by
`lib/slot-periods.ts`, a pure function over `slot.label`. The label is already
rendered in the business timezone by the availability engine, so grouping needs
no timezone maths of its own and cannot disagree with the time on the button.
Empty periods are dropped rather than rendered as bare headings.

## Auth hardening

**Session cookies are `httpOnly`, and that is enforced here rather than
inherited.** `lib/supabase/cookies.ts` declares the five flags once and spreads
them *after* whatever `@supabase/ssr` sends, so the library cannot weaken them.
Both writers — the server client and `proxy.ts`, which is the one that actually
refreshes on most requests — go through it, because two copies would drift.

`httpOnly` is the flag that matters: it puts the session out of reach of
`document.cookie`, so an XSS bug cannot read the token and walk off with the
account. It is safe because **nothing in this app reads the session from the
browser** — every check runs on the server. The browser Supabase client was
deleted for the same reason: it was already unused, and leaving it invited a
future client-side auth path that these flags would then break confusingly.

There is no token in `localStorage` or `sessionStorage` anywhere in the
codebase, and `getCurrentUser()` uses `getUser()` rather than `getSession()`,
so the identity is revalidated against the auth server instead of trusted from
a cookie.

**Credential endpoints are rate limited** by `AUTH_RULES`, on two identifiers
for the same reason bookings use two: an IP rule stops one host hammering, and
a per-identity rule survives the rotating IP pool a real credential-stuffing
run uses. The identity key is a **hash** of the email — otherwise the counter
table becomes a list of everyone who ever mistyped a password, a list worth
stealing created as a side effect of defending against theft. Counting happens
*before* credentials are checked, so a wrong guess costs budget whether or not
the account exists.

> Server Actions are not HTTP handlers, so there is no status line to set. The
> "429" travels in the payload as `rateLimited`. Like the booking guard, it
> **fails open**: an unreachable counter table must not lock every customer out
> of their own account.

**Password strength applies when a password is *chosen*, never when it is
used.** That is sign-up and password reset; sign-in is deliberately exempt,
because enforcing it there would lock out anyone who registered before the
policy and leaks the policy to someone who has not guessed a valid password.
Length carries most of the value, so the character classes are mild — a rule
demanding symbols and mixed case mostly produces `Password1!` and a sticky note.
Hebrew letters count, because the audience types Hebrew. `PASSWORD_RULES` drives
both the live UI hints and the schema, and a test asserts the two agree: a form
that ticks every box on a password the server then rejects is worse than no hint.

### Password reset

Three surfaces and one route handler: `/login/forgot` asks for an address,
`/auth/confirm` turns the emailed link into a session, `/login/reset` chooses
the new password.

**The request action says exactly one thing, always.** Registered or not,
throttled by Supabase or not — the same sentence. A response that varies with
whether the address has an account turns a public form into a membership
oracle: point it at a list of addresses, read the answers, and you have a list
of people who run a business here *and* are worth phishing with a convincing
Bazman email. The accepted cost is that a mistyped address is told to check an
inbox that stays empty. The one exception is a transport failure, which says
nothing about the address and is reported honestly — telling an owner mail is on
its way when the request never reached Supabase is its own kind of lie.

**The reset rate limits protect a mailbox, not a password.** Sign-in limits make
guessing expensive; a reset cannot be guessed at all, because it sends mail to
an address the requester may not own. Without `resetIdentity` this app is an
anonymous button that drops a password-reset email into somebody's inbox on
demand. It is keyed on the same `authIdentifier` hash as sign-in, so defending
the mailbox does not create a list of who asked. A test asserts it is tighter
than the sign-in budget.

**The reset link's origin is pinned to `NEXT_PUBLIC_APP_URL`, and this is the
one place `pickAppUrl` must not be used.** That function rescues a *share* link
from a stale env var by falling back to the origin the request arrived on.
Applied here it does two bad things. Supabase only honours a `redirect_to` that
matches its Redirect URLs allow-list, and a header-derived origin — a preview
deployment, a bare IP, anything behind a different proxy — is not on that list,
so Supabase silently discards the destination and sends the user to the project
Site URL instead: the reported bug where a reset link lands on `/`. And building
a password-reset link out of `Host` / `x-forwarded-host` is the classic
reset-poisoning shape, where an attacker triggers a reset for someone else's
address with a forged header and the victim gets a genuine email pointing at the
attacker's host. `authRedirectOrigin()` therefore takes the configured origin
outright and never promotes a header into an emailed link; the request origin is
used only when nothing is configured at all, which `check:env --production`
already refuses to deploy, and the caller logs a warning when it happens.

**`/auth/confirm` handles both link shapes, and that is not belt-and-braces.**
Supabase mints either a `token_hash` (redeemed with `verifyOtp`, works on any
device) or a PKCE `code` (redeemed with `exchangeCodeForSession`, works only in
the browser that requested the reset, because the verifier is a cookie there).
Which one arrives is decided by an email template in the Supabase dashboard, not
by this code. Handling only the PKCE shape is the trap: it passes every local
test, where request and click happen in one browser, and fails the extremely
common phone-request / laptop-click case. See
[DEPLOYMENT.md](DEPLOYMENT.md#password-reset-needs-two-settings-and-both-bite-silently).

**The `next` parameter is validated before it is followed.** `lib/safe-redirect.ts`
rejects absolute URLs, protocol-relative `//host`, backslashes (some browsers
normalise them into the authority) and control characters that could forge a
`Location` header. This matters more here than on an ordinary redirect: the link
genuinely signs the victim in and *then* forwards them, so it arrives from the
real domain, authenticates, and lands wherever the attacker wrote — which is far
more convincing than a plain phishing link. `signInAction` now uses the same
function with a `/dashboard` prefix instead of its own inline check.

**The session is written onto the response the callback returns**, not into the
ambient `cookies()` store with the redirect signalled by throwing. The thrown
form leaves the cookie writes depending on the framework flushing a mutated
store onto a thrown redirect — an implementation detail to stake a *single-use*
token on. If it ever fails to flush, the token is spent and the owner sees "this
link is invalid" with no way to tell why. `route.test.ts` asserts the cookies
are on the 307 itself, which is the seam that actually broke.

**A completed reset signs out every other session** (`scope: "others"`). Reset is
the remedy for "somebody may have my password", so it has to evict whoever that
was; `others` rather than `global` keeps the session that just did the work,
because signing an owner out of their own recovery is a strange reward for
finishing it. It is best-effort — the password is already changed by then, and
failing the action would tell the owner it had not worked.

> **Reset mail does not use the outbox.** Supabase Auth sends it directly, so
> `RESEND_API_KEY` and the notification pipeline have nothing to do with it and
> the dispatcher's cadence does not delay it. The corollary is that Supabase's
> own SMTP has to be configured, or resets die at a handful per hour across the
> whole project with no signal on this side.

> **A signed-in owner reaching `/login/reset` can change their password without
> entering the old one.** The gate is "is there a session", because a recovery
> link mints a full one — a "this came from a recovery link" marker would look
> like a second factor while gating a door that is already open. Requiring
> re-authentication for the signed-in case is a product decision (Supabase has a
> setting for it) and is deliberately not taken here; the page is not linked
> from anywhere inside the dashboard.

## Legal surface

`/legal/terms`, `/legal/privacy` and `/accessibility` are static prerenders
built from `lib/legal-content.ts`. Copy lives as data for the same reason the
pricing tiers do — it can be reviewed without touching a component, and the
figures in it are pulled from the constants that actually govern behaviour
(`TRIAL_DAYS`, `GRACE_DAYS`, `PRICING_TIERS`) rather than retyped. A refund
window quoted in prose that disagrees with the code is worse than no document.

> ⚠️ **The legal text is a template and has not been reviewed by a lawyer.**
> It was written to be structurally complete and consistent with what the
> software does. It must be reviewed by an Israeli lawyer before the platform
> takes real money. `LEGAL_ENTITY` still has placeholder registration and
> address fields, and the clauses most likely to need changing are the refund
> terms and anything touching חוק הגנת הפרטיות and תיקון 13.

**Consent is implicit, under the button.** No blocking checkbox: for a booking
there is no account and no ongoing relationship, and a required tickbox in
front of a one-minute flow costs completions without adding meaningful consent.
`ConsentNote` is one component so the wording cannot drift between the two
places it appears — two slightly different consent sentences is exactly what
undermines the claim that consent was given.

**The cookie banner stores its answer in `localStorage`, not a cookie**, which
is the deliberate opposite of the session rule: it is a UI preference with no
security meaning, and keeping it client-side keeps it out of every request
header. The site uses strictly necessary cookies only, so it is a notice rather
than a gate, and there is no reject button because there is nothing optional to
switch off. A refuse button that disables nothing would be theatre.

**The accessibility button is draggable, because every corner is the wrong
corner on some screen.** Pinned to the bottom-left it sat on top of the mobile
tab bar and covered a control the owner needs; a fixed element cannot know what
is underneath it. `useDraggableCorner` persists a position per browser, and
three details carry it: a movement threshold so a drag does not also fire the
button's click, pointer events so touch needs no second code path, and clamping
**on read** — a position saved on a desktop would otherwise put the handle
off-screen on a phone, where it is both unreachable and unmovable, which is
worse than the collision it was moved to avoid. The default position now clears
the tab bar (`bottom-20` under `md`) so the drag is a preference rather than a
repair.

**The accessibility widget is deliberately small** — text scale, contrast,
stop-motion. The overlay products that bolt on a screen-reader emulator are
widely criticised for interfering with the assistive software a user already
has. Preferences are attributes on `<html>` read by `globals.css`, and are
never sent to the server: a record of who needs high contrast is
health-adjacent information there is no reason to hold.

## Why a Server Action returned HTML

The reported symptom was `Unexpected token '<', "<!DOCTYPE "... is not valid
JSON` on sign-up. That string is never thrown by application code: it is the
client trying to parse a Server Action's serialised reply and finding an error
*page*. It means the function did not return — so nothing inside the action's
own error handling could have caught it.

Two causes, both fixed, plus a backstop for the ones that remain:

**`@/db` threw at module scope.** It validated `DATABASE_URL` and called
`postgres()` at import. Any database misconfiguration therefore made the module
**unloadable**, and every importer died with it — including the auth actions,
which need the database only for a rate-limit counter they are explicitly
willing to skip. The connection is now opened on first use behind a `Proxy`, so
the same misconfiguration surfaces as a thrown error *inside* a query, where
`enforceRateLimits` already fails open.

**The rate-limit guard could hang.** Failing open only helps if it happens in
time. A pooler that accepts the socket and then stalls produces no error to
catch, so the guard held the request until the platform's own timeout — and a
Vercel 504 is an HTML page, the same unparseable reply reached a different way.
`enforceRateLimits` now carries a 3-second budget across all its rules and a
`connect_timeout` on the pool. Skipping a counter is the outcome this module
already accepts; it may as well be reached deliberately.

**`typedFailure` wraps every exported auth action.** It converts an unhandled
throw into `{ ok: false, error }`. The critical detail is `unstable_rethrow`
first: `redirect()` signals success *by throwing* `NEXT_REDIRECT`, so a plain
try/catch here would swallow every successful sign-in and report it as a
failure — which is exactly what a blanket try/catch around these actions
introduces if written the obvious way.

**`callAuthAction` catches on the client.** The three fixes above all assume the
action ran. A cold start that times out, or a deploy that lands mid-session and
invalidates the action id, fails outside it entirely. The forms catch the
rejected call and render Hebrew, which is what guarantees that string cannot
reach a business owner again.

> **A `"use server"` file may only export async functions.** `isRateLimited` and
> `isAlreadyRegistered` live in `lib/auth-errors.ts` for that reason — exporting
> a plain predicate from the actions module breaks the whole module at runtime,
> which is the *same failure class* this section is about and looks identical
> from the browser.

### Duplicate sign-up has two shapes

Supabase reports an already-registered address one of two ways depending on
whether the project has enumeration protection on: a 200 with a user whose
`identities` array is empty, or a 422 saying so. **Both are handled**, because a
project setting decides which arrives and handling one leaves the other reading
as an unexplained failure.

### Reset throttling is ours, not Supabase's

`resetPasswordForEmail` returning a rate-limit error used to be logged and
swallowed, and the reader still got "check your inbox" — a completely silent
failure, and the reported bug. Two changes:

- **`resetCooldown`** — one request per hashed address per minute, checked
  first, so our refusal beats Supabase's. That matters because our counter knows
  nothing about whether the address is registered, so it answers identically for
  a real address and an unknown one. Supabase's per-address throttle can only
  ever answer for a real one, which is why it must not be what the reader hears.
- A Supabase throttle that still gets through is surfaced. Safe *because* of the
  cooldown: what survives is the project-wide email cap, which is the same for
  every address and therefore discloses nothing.

## Availability is free windows first, candidates second

The engine used to walk the day with a cursor that jumped forward whenever it
hit something. It was correct, and it fused two questions into one loop: *where
is there free time* and *where may a slot start*. The second was only ever
observable through the first, which is why a scattered day — the shape of a real
Tuesday afternoon — was so hard to reason about or assert on.

It is now two steps.

**1. Free windows.** Shift intervals minus everything blocked, as plain
`[start, end)` maths. `mergeIntervals` and `subtractIntervals` are exported and
tested on their own, so "the gap between the 10:00 and the 12:00 booking" is a
value rather than an emergent property of a loop.

**The buffer is folded into the blocked intervals, not into the boundary test.**
A candidate `[c, c+d)` conflicts with booking `b` exactly when it overlaps
`(b.start - buffer, b.end + buffer)`, so expanding each booking by the buffer on
both sides and then asking `c + d <= window.end` is the *same rule*, stated once
instead of at every comparison.

> **This is why the boundary test is `start + duration <= end` and not
> `start + duration + buffer <= end`.** The brief specified the latter, and it
> would be wrong twice over: where a booking created the window's edge the
> trailing buffer is already inside it, so charging it again double-counts;
> and where the edge is the **end of the shift** there is nothing to be
> separated from, so charging it there deletes the last bookable slot of every
> single day. A test pins both halves.

Closures carry no buffer — a shop is shut or it is not.

**2. Packing.** How starts are placed inside each window, and the two modes
differ on purpose:

| Mode | Who gets it | Rule |
| ---- | ----------- | ---- |
| `dense` | single-staff | from the window's own start, stepping by `duration + buffer` |
| `grid` | multi-staff | every lattice anchor that fits, stepping by the base grid |

**Dense wastes nothing.** A gap that opens at 09:35 is offered at 09:35, not at
the next tidy number, and consecutive starts inside a window leave no remainder
too short to sell.

**Grid trades a little density for a readable column.** Its anchors are measured
from the day's **local midnight**, not from each provider's shift start — that
is the entire point. Two people whose free time begins at 09:00 and 09:20 land
on the same anchors, so the union across a team is one column of times instead
of two interleaved ones. Grid mode also offers *overlapping* candidates (a
60-minute service on a 15-minute lattice is offered at 09:00, 09:15, 09:30 …)
because those are alternative start times, not consecutive bookings.

### The lattice revives `slot_interval_min`

That column had decayed into a live-looking setting that changed nothing, which
ARCHITECTURE.md flagged as the worse of the two options available. It is now the
tenant's base grid, and load-bearing for team shops.

**The GCD is only the fallback, and it is floored at 5 minutes.** The brief
offered GCD *or* a configured interval; on a real catalogue GCD is far too fine
to be useful — `gcd(15, 20, 30, 45)` is **5**, which would offer 09:00, 09:05,
09:10 … and reintroduce the exact five-minute noise a one-chair shop reported.
So the configured interval wins, the catalogue is only consulted when a tenant
has none, and the floor stops an unusual catalogue producing that column again.

### What this does not change

- **Multi-service aggregation needs no engine change.** `durationMin` is a total:
  a caller that sums the durations and buffers of several services gets the
  right window, and a test proves a 45-minute aggregate fits a 60-minute hole
  and not a 30-minute one. **The booking *flow* still books one service** —
  `appointments` has a single `service_id` and nothing in the UI selects add-ons,
  so this is engine readiness, not a shipped feature.
- **Query count is unchanged.** `getAvailableSlotsWithStaff` already batched
  hours, staff schedules, appointments and time off into one `Promise.all` per
  date, and all window maths is in memory. The catalogue query for the GCD
  fallback is reached only when `slot_interval_min` is unset.

## Client win-back — the only marketing message (0021)

Every other message the outbox carries is *about an appointment the client made*
— a confirmation, a reminder, a cancellation. "We have not seen you in a while"
is a commercial approach to somebody who is not currently a customer, which
under **סעיף 30א לחוק התקשורת** is דבר פרסומת and requires prior explicit
consent, an identifiable sender and a working way out.

That difference is why it is gated four times, and why no single gate is "the
feature switch":

| Gate                          | Who decides       | Where                     |
| ----------------------------- | ----------------- | ------------------------- |
| `clientRetention`             | the plan          | `entitlements.ts`         |
| `businesses.retention_enabled`| the owner         | `/dashboard/settings`     |
| `appointments.client_consented_marketing` | the client | the booking form   |
| `marketing_opt_outs`          | the client, later | the opt-out line's promise |

**Entitlement is deliberately not enough.** Being entitled to a feature is not
the same as having chosen to use it, and this one speaks to the tenant's
customers in the tenant's name, over the tenant's own WhatsApp number — which
is also the number that receives the complaint. So `retention_enabled` defaults
to false and stays false through every upgrade.

### Consent lives on the appointment, and the latest row wins

There is no clients table — a client is derived from booking history, keyed by
phone. Putting consent on `appointments` follows that, and buys something
useful: the **most recent** booking is the current answer, so leaving the box
unticked next time withdraws consent with no form to fill in and no support
ticket. `listWinBackCandidates` uses `DISTINCT ON (client_phone)` ordered by
`starts_at DESC` for exactly this reason — a `max(starts_at)` with a separate
consent lookup would let an older ticked box resurrect a consent since dropped.

The column is never backfilled to `true`. Consent that arrives switched on is
not consent, and a backfill would have manufactured it for every client who
booked before the migration ran.

The checkbox renders **only when the tenant has the campaign switched on**.
Asking permission to send messages nobody is going to send is a question with
no honest purpose. The accepted cost is that a shop enabling retention starts
with an empty pool and waits for consented clients to lapse.

### The dedupe key is the lapsed visit, not a time window

`client_winback:<lastAppointmentId>`. A client who never returns therefore gets
**exactly one message, ever**, and one who does return becomes eligible again
only after a *new* visit has lapsed. A key bucketed by month would have
re-sent on a schedule, which is the shape of the thing everyone means by spam.

`MAX_PER_RUN` caps a tenant at 25 per run. A shop switching this on has years
of history behind it and every lapsed client becomes eligible on the same
morning; without the cap the first run is a bulk send, which is what both the
law and WhatsApp treat as abuse — and the number that gets blocked is the
tenant's own.

### WhatsApp only, and no console fallback

`retentionBlockedReason` refuses when `isChannelLive("whatsapp")` is false.
Every other channel in this product falls back to a console provider that logs
and reports success — recoverable for a reminder, and the reason the outbox was
testable before Resend existed. Here it would leave an owner believing a
campaign is running while nothing has ever been delivered. Falling back to
email instead would be a different product decision taken silently on their
behalf.

### It is re-checked immediately before sending

The dispatcher re-asks two questions for `client_winback` rows: does the client
now have a booking, and have they since opted out. The eligibility query
answers both, but it runs when the row is *queued* — a retried row, or one
queued minutes before the client rebooked, is exactly the gap. Unlike a
reminder this message has no deadline, so skipping it costs nothing.

> **The opt-out line is honoured by a table, not by a reply handler.**
> `marketing_opt_outs` exists and every send consults it, but nothing yet reads
> inbound WhatsApp, so a client replying "הסר" is currently acted on by the
> owner rather than automatically. `addMarketingOptOut` is the call an inbound
> webhook would make when one exists. Shipping the sentence without the table
> would have made the message's only promise a lie.

## iOS safe areas

The installed app's tab bar sat underneath the home indicator, and the reason
is worth recording because the code looked right.

Five components already carried `pb-[env(safe-area-inset-bottom)]` — the
dashboard's bottom bar, the hours drawer, the "עוד" sheet, the gallery lightbox
and the week-calendar sheet. **All five were no-ops.** iOS only reports
non-zero `env(safe-area-inset-*)` values when the viewport opts in with
`viewport-fit=cover`, and the viewport export set width, scale and theme colour
but not that. Without it the page is laid out inside the safe area and every
inset resolves to `0px`, so the padding was real CSS applied to a real element
and computed to nothing.

Turning it on means content now draws into the unsafe areas, so the two edges
that matter claim their space back:

- **The status bar** is handled in `globals.css` on `body`, not on a component,
  because the topmost element on the dashboard is not fixed — an impersonation
  or freeze banner can render above the nav, so no component can own the inset
  without being wrong whenever a banner is present. Scoped to
  `@media (display-mode: standalone)`: in a browser tab the chrome already
  occupies that space, and padding the body there would push every page,
  including the landing page's full-bleed hero, down by a strip of blank paper.
- **The bottom bar** insets itself, with the background still running to the
  physical edge — a bar that stopped short would show page content scrolling
  underneath it. `max(…, 0.25rem)` because flush against the bezel on a device
  with no inset reads as clipped rather than as full-bleed. The dashboard's
  `main` clears `6rem + env(safe-area-inset-bottom)`, since 6rem covered the
  4rem of tabs but not the inset that appeared beneath them.

`pwa.test.ts` asserts `viewport-fit=cover` is still there. The failure it
guards against is deletion, and the symptom of that deletion is five silent
regressions on hardware the suite cannot reach.

> **Verified as far as this environment allows**: the compiled CSS is valid
> (`max(env(safe-area-inset-bottom), .25rem)`, `calc(6rem + env(…))`), the meta
> tag renders, and there is no horizontal overflow at 375px. The insets
> themselves are zero in every browser here, so the on-device result still needs
> a look on a real iPhone with the app installed.

## Web push

`lib/push.ts` sends owner notifications inline and best-effort, deliberately
outside the outbox: a push is a nudge whose value expires in a minute, and the
booking is on the dashboard either way.

### The VAPID subject is required, and there is no default

`ensureConfigured()` used to fall back to a hard-coded `mailto:` address when
`VAPID_SUBJECT` was unset. That is the wrong shape of guess in three ways:

- The `sub` claim is how a push service reaches **the operator** when a
  deployment misbehaves (RFC 8292 §2.1). An address nobody reads is worse than
  an error, because the report goes somewhere and is never seen.
- The domain in a constant need not belong to whoever deployed the code. A
  self-hoster would have been sending someone else's contact details to Google
  and Mozilla on every push.
- It made a missing variable invisible. The first sign of trouble would have
  been a push service quietly dropping traffic, with `check:env` green.

So the subject is now required whenever the key pair is set, validated against
`mailto:` / `https:`, and **the `.env.example` placeholder is rejected by
name** — it is structurally a perfectly good `mailto:`, so nothing else would
have caught it, and it is the single most likely wrong value to reach
production.

`validateVapidSubject` lives in `lib/env.ts` and is called by both
`check:env` and the runtime. Two copies would let a green deploy check coexist
with a runtime that refuses, which is the exact failure the check exists to
prevent; a test asserts the two agree across valid, placeholder and malformed
subjects.

**Severity follows the consequence, not the tier.** The variable is `optional`,
because a shop with no push configured is a legitimate state. Alongside a real
key pair, a bad subject is an **error in every mode**: `setVapidDetails` throws
on it, so push would refuse at runtime while every screen still claimed it was
configured. The half-configured rule is the same one email has, and for the
same reason — `push:keys` prints all three lines at once, so two-of-three is a
paste that went wrong, never a decision.

`check:env` now reports `push → live` or `push → off` beside the email channel,
because a half-configured trio is indistinguishable from an unconfigured one
from inside the product: the settings card says "not configured" either way.

## Observability

Every server boundary reports through `reportError` / `reportWarning` in
`src/lib/observability.ts`, which emits **one structured JSON line** per event
— searchable by `scope` (`booking.create`, `cron.notifications`,
`ratelimit.tripped`) rather than by prose, and parsed as a single record by
Vercel's log drain where a multi-line `console.error` becomes several.

Context keys matching `phone|email|token|secret|password|key|name` are redacted
before the line is written, so client identifiers never reach a log that might
be shipped to a third party.

**Sentry is not installed.** `reportError` is the only function that would need
to call it; every existing call site inherits it for free.

## Testing

`npm run verify` = env check → lint → typecheck → tests → build.
`npm run test:e2e` runs Playwright separately (it needs a live server and DB).

Tests run against **PGlite applying the real migration files**, so the
exclusion constraint, enum casts and RLS are genuinely exercised.

> **Known gap:** PGlite is more forgiving than postgres.js about parameter
> binding. A raw `Date` inside a Drizzle `sql` template passes in tests and
> throws at bind time in production — this happened once, in
> `getDashboardStats`. Aggregate `sql` templates need a smoke test against real
> Supabase after changes. The suite proves SQL _semantics_, not driver binding.

Useful scripts: `db:migrate`, `db:seed`, `db:claim -- <uuid>` (point the demo
shop at a real auth user), `storage:setup` (create the media bucket),
`check:env`, `test:e2e`.

> **The upload path itself is not covered by the suite.** What _is_ covered is
> every rule around it — validation, path construction, the Pro gate, and the
> mechanical check that the service-role key cannot reach a client bundle. The
> HTTP conversation with Supabase Storage needs a real project, so it is a
> manual check after deploy: upload a logo, confirm it renders on `/[slug]`.

The E2E suite books against `demo-barber` and tags every row it creates with
the phone number `0559990001`, which is all teardown deletes. The dashboard
specs need `E2E_EMAIL` / `E2E_PASSWORD` for a confirmed owner account in
`.env.local`; without them those specs skip and the public ones still run.

## Feature status

**Done (Phases 0–9, bar the payment provider and a production pilot)**

> **All 21 migrations (0000–0020) are applied.** Verified directly against the
> live database: twelve public tables, RLS on every one. The long-standing
> "0012 has never been applied" warning is retired.


- Public booking: 3-step flow, no client login, `.ics` download, self-service
  cancellation at `/b/[token]` within the business's cancel window
- Availability engine: split shifts, per-service buffer override, min notice,
  booking horizon, time-off, DST-correct
- Dashboard: day/week agenda, manual booking for walk-ins, quick status
  actions, services CRUD, working hours, time off, clients list, settings,
  stats cards
- Auth + 5-step onboarding (details → services → hours → plan → live link)
- Notifications: confirmation, owner alert, reminder, cancellation — all four
  verified end to end
- SEO: per-business metadata, canonical, `LocalBusiness` JSON-LD with opening
  hours and offers, robots, sitemap
- Marketing landing page at `/` — static RSC, no DB, prerendered
- Deployment: `vercel.json` with the cron schedule, security headers in
  `next.config.ts`, env validation CLI
- Abuse defence: honeypot + Postgres rate limits on IP and phone-per-business
- Observability: structured JSON logging with client identifiers redacted
- Playwright E2E over the public booking and cancellation flows — **green**,
  including a real 404 for an unknown slug
- **A real 404 for unknown slugs**, resolved in the proxy before the response
  streams, behind a bounded slug cache that fails open — see
  [Unknown slugs return a real 404](#unknown-slugs-return-a-real-404)
- Per-business branding: accent theme, hero media, gallery + lightbox, reviews
- Pricing page with a monthly/yearly toggle; plan recorded during onboarding
- Super-admin console at `/master`: tenant metrics, impersonation, trial
  extension, freeze, live feed, churn and delivery alerts
- Two-tier plan line (₪69 / ₪99) with entitlements enforced server-side —
  branding gated on write, client reminder channel chosen by tier
- Subscription lifecycle: trial sweep, 7-day grace window, automatic freeze,
  dunning mail through the outbox, and a read-only dashboard for frozen
  tenants with mechanically-verified action coverage
- `/dashboard/billing` — plan, status, grace deadline and invoice history
- Landing page rebuilt monochrome: 70/30 above-the-fold split, a crisp 50/50
  ink/paper hero with a Canvas bubble field and the typed wordmark, the agenda
  preview presented in a brand-gradient card with glass tiles, one accent
  gradient reserved for active and primary states, soft geometry throughout,
  and a gradient closing banner
- Payment adapter: `BillingProvider` resolved at call time, a console provider
  that refuses in production, `activateSubscription` as the single activation
  path, and checkout/cycle-change UI
- Navigation performance: `loading.tsx` on every dynamic route, which is what
  restores prefetching, plus a Suspense-driven top progress bar and
  `useLinkStatus` indicators
- Auth hardening: forced `httpOnly` session cookies, rate-limited credential
  endpoints keyed on a hashed identity, sign-up password strength
- Self-service password reset: `/login/forgot`, `/auth/confirm`, `/login/reset`
  — enumeration-safe, mailbox-rate-limited, open-redirect guarded, and evicting
  other sessions on success
- Legal surface: `/legal/terms`, `/legal/privacy`, `/accessibility`, a cookie
  notice, implicit consent under the primary CTAs, and an accessibility widget
- One palette across the whole product: teal removed everywhere, `neutral` and
  `slate` collapsed into `zinc`, the brand gradient reserved for active and
  recommended states, and six hand-rolled buttons pulled onto the shared
  tokens — see [One palette, one ramp](#one-palette-one-ramp)
- **Multi-staff**: per-person schedules and time off, a staff picker that asks
  *after* the time is chosen, the exclusion constraint rekeyed on
  `(business_id, staff_id)`, and calendar swatches shared by the agenda and the
  analytics charts
- **Media uploads**: images anywhere and video on the hero, straight from the
  browser to Supabase Storage on a server-minted signed URL — the bytes never
  pass through Next
- **"תורים באישור"**: a booking arrives as a request that holds its slot, with
  three notification kinds and an approve/reject panel above the agenda
- **Client self-service** at `/[slug]/my-appointments`: phone lookup, history,
  and cancellation reusing the emailed link's own code path
- **Analytics** at `/dashboard/analytics`: wall-clock heatmap, service and staff
  breakdowns, status split and a booking/revenue trend — Pro-gated behind a
  paywall that ships invented sample numbers rather than blurring real ones
- **Full week calendar** at `/dashboard/agenda/full`, where a custom block is a
  `time_off` row and therefore blocks client bookings for free
- **PWA + web push**: installable manifest, a service worker that caches
  nothing, and per-device VAPID subscriptions notifying owners of new bookings
- **WhatsApp** behind one interface with two backends (Green API preferred over
  Twilio, because only one of them needs Meta template approval), and reminders
  planned from the booking's lead time rather than a fixed 24 hours
- Per-tenant theming across the whole booking page, including an accent-driven
  mesh banner and a video hero

**Not built**

- **A real payment provider.** The adapter, the checkout action, the activation
  path and the invoice/audit writes all exist and are tested; what is missing
  is an implementation of `BillingProvider` that talks to a payment company,
  and the webhook that would drive it. `getBillingProvider()` is the only
  function that needs to learn a new name. Stages 8d and 8e — see
  [PROJECT_PLAN.md](PROJECT_PLAN.md).
- Google Calendar sync, recurring appointments, custom domains
- **Service images.** `services.image_url` exists and renders on the public
  page, but nothing sets it — the uploader supports every other surface. The
  same orphaned-column gap `businesses.logo_url` had until the upload work.
- Appointment status filters, timezone editing in settings
- **Per-tenant reminder thresholds.** The lead-time table is configurable in
  code; making it per-business needs columns and a settings UI.
- **Deposits are still schema-only.** `deposit_*` columns and the two enum
  statuses exist and are configurable in settings, and the section says so on
  screen. No booking has ever been written as `pending_deposit`.
- **Marketing mockups** are the existing `MockupShowcase`, not phone-framed
  renders of the booking flow and dashboard. A design-asset job, not a code one.
- Sentry — `reportError` is the single call site to wire it into
- E2E coverage of dashboard CRUD; that path is exercised only by the PGlite
  suite, not through a browser
- E2E coverage of the owner dashboard runs only when `E2E_EMAIL` /
  `E2E_PASSWORD` name **the account that owns `demo-barber`**. Any other
  confirmed account lands in `/dashboard/setup`, and the specs then fail on a
  missing appointment when the real cause is an onboarding form. `db:seed`
  reassigns the demo shop, which is how the two drift apart.
- **Legal review.** `/legal/*` and `/accessibility` are engineer-written
  templates and `LEGAL_ENTITY` still holds placeholder registration and address
  fields. They must be reviewed by an Israeli lawyer before real money moves.
- SMS/WhatsApp are code-complete but **unproven — no account with either
  provider yet**. The routing is wired and WhatsApp now leads the channel
  order, so the only thing between a Pro tenant and a real message is
  credentials. `check:env --production` fails without the Twilio ones, which
  blocks a deploy until that account exists.
- **Web push is unproven end to end**, though no longer unconfigured: a VAPID
  trio is present locally and `check:env` reports `push → live`. Every part
  around it is tested — subscription storage, expiry handling, the manifest's
  icons, the worker's handlers, and now the configuration rule itself — but no
  notification has yet left a real server to a real device.
- `appointments.reminder_sent_at` is dead since the outbox landed; safe to drop
- Read-only impersonation. An admin viewing a tenant can still write as that
  tenant; see the warning under [Impersonation](#impersonation). 8b built the
  per-action write gate for frozen tenants, which is the mechanism this needs —
  it is now a matter of passing a second reason through it, not of new
  machinery.
- **Orphaned uploads.** Replacing an image leaves the old object in the bucket,
  because every upload gets a fresh UUID path so a CDN can never serve stale
  bytes at a live URL. No sweep collects them. Cheap at this scale; a job for
  the day storage costs anything.

## Gotchas

- `db:seed` deletes and recreates the demo business, which resets its owner —
  re-run `db:claim` afterwards.
- Supabase email confirmation is **on** by default; signup returns a user with
  no session and the UI says to check the inbox.
- Vercel Hobby caps cron at once per day, and **fails the build** rather than
  silently downgrading — `*/15 * * * *` is rejected at deploy time. The
  schedule is daily for that reason; the real cadence has to come from Pro or
  an external scheduler, or confirmations arrive a day late.
- A `"use server"` file may only export async functions — a exported `const`
  breaks the whole module at runtime.
- `router.push()` immediately followed by `router.refresh()` cancels the
  navigation. Let the action's `revalidatePath` do the work.
