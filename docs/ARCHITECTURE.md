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
| Tests      | Vitest + PGlite (WASM Postgres) — 270 tests; Playwright — 10 specs |
| Hosting    | Vercel. **Root Directory must be `Frontend`.**                     |

Everything lives in `Frontend/`. There is no separate backend tier — Server
Actions and route handlers _are_ the backend.

```
Frontend/src/
  app/            routes: /[slug], /b/[token], /dashboard/*, /master/*, /login, /api/cron
  components/     booking/ (public), dashboard/ (owner), marketing/ (landing),
                  master/ (platform console), ui/
  db/             schema, migrations, queries/ (repository layer), scripts
  lib/            availability, notifications/, stats, cancellation, env, ics
                  slot-periods (slot grouping), branding (theme/gallery/reviews)
                  plans + landing-content (pricing and landing copy as data)
                  brand (the wordmark, one place), platform-metrics (MRR etc.)
                  super-admin + master-session + impersonation (/master access)
  test/           PGlite harness + factories
  proxy.ts        auth redirect guard (NOT middleware.ts — see below)
```

## Database

Seven tables. Six are tenant-scoped by `business_id`; `rate_limits` is not.

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
- **rate_limits** — fixed-window counters; the only table with no
  `business_id`, so RLS is on with **no policy at all**

Migrations `0000`–`0011` in `src/db/migrations/`, applied with
`npm run db:migrate`. **Not automatic on deploy.**

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

### RLS status: 7 of 7 tables, **0 anon policies**

Migrations `0002`, `0005` and `0007`. Six tables carry one
`FOR ALL TO authenticated` policy keyed on `auth.uid() = owner_user_id`, joined
through `businesses` for child tables. Both `USING` and `WITH CHECK` are set,
so an owner cannot insert rows pointing at someone else's business.

`rate_limits` is the seventh: RLS on, **zero policies**, which denies every
role that RLS applies to. That is the intent — it holds no tenant data and
nothing outside the app's own connection has any business reading it.

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

### Subscription columns (0010) — enforced as entitlements, still not billed

`plan_type` (`free|starter|pro|business`) and `subscription_status`
(`trialing|active|cancelled`), both CHECK-constrained. CHECK rather than a
Postgres enum so adding a tier is one migration instead of two.

**Features are now gated on these columns; money still is not collected.** See
[Entitlements](#entitlements) below. There is no payment provider, so nothing
moves `subscription_status` off `trialing` on its own — but the tier a tenant
holds does decide what they can do.

The column values and the TypeScript constants have deliberately drifted, in
the safe direction, ahead of migration `0012`:

| Value        | In the CHECK? | In `lib/plans.ts`? | Why                                                                                  |
| ------------ | ------------- | ------------------ | ------------------------------------------------------------------------------------ |
| `business`   | yes           | no                 | Retired tier. `toPlanType` maps it **up** to `pro` until `0012` rewrites the rows.   |
| `past_due`   | no            | yes                | Listed early so it can never normalise into a status that grants paid features.       |

That ordering is the rule, not an accident: **code learns a value before the
database can produce it, and keeps understanding a value after the database
stops.** The reverse order breaks every read between deploy and migration.

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

**Notifications use a transactional outbox.** Messages are written to
`notifications` first and dispatched by `/api/cron/notifications` (scheduled in
`vercel.json`, guarded by `CRON_SECRET`). Rationale: a provider outage delays
rather than loses; `dedupe_key` prevents double-sends; and the dispatcher
re-checks appointment state before sending, so a reminder for a
since-cancelled appointment is skipped rather than delivered.

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
convention. It only redirects; the real authorization boundary is
`requireBusiness()` in `src/lib/dashboard-session.ts`, which resolves the
business **from the session** and is called by every dashboard page and action.
No action takes a business id from its request body.

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
                    starter (₪69)   pro (₪99)
customBranding            ·             ✓
smsReminders              ·             ✓
whatsappReminders         ·             ✓
advancedAnalytics         ·             ✓
prioritySupport           ·             ✓
```

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
status. A `past_due` or `cancelled` Pro tenant resolves to `free` — which is
what makes the downgrade a single rule instead of a second code path in every
consumer.

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

> ⚠️ **Impersonation is not read-only.** `requireBusiness()` is the single
> boundary every dashboard action shares, so an impersonating admin can write
> as the tenant and those writes are indistinguishable from the owner's in the
> data. The banner and the audit log are the mitigations. Enforcing read-only
> needs a per-action gate and is deliberately deferred rather than half-done —
> partial coverage would be worse than none, because it would look safe.

### Trial column (0011)

`trial_ends_at`, backfilled to `created_at + 14 days` for existing trialing
tenants. Like `plan_type` it is **recorded, not enforced**: no job downgrades a
lapsed trial and no feature checks it. It drives the console's expiry alerts
and the "+7 days" action, nothing else.

## Marketing surface

`/` is a **static prerender** with no database access, and must stay that way.
The pricing billing toggle and the FAQ accordion are the only interactive
parts, so each is its own client island in `components/marketing/` rather than
a `"use client"` on the page.

Pricing tiers, feature copy and FAQs live in `lib/plans.ts` and
`lib/landing-content.ts` as plain data with no JSX, so prices and copy can be
edited without touching a component — and so the pricing maths is unit-tested.
`landing-content.ts` stores icon _names_, not components, which is what keeps
it importable as data; `page.tsx` maps a name to a `lucide-react` component in
one place.

**Teal is the platform brand and is unrelated to the per-business
`--accent`.** Landing, login and onboarding are platform surfaces and use
static Tailwind teal utilities; `/[slug]` is tenant-branded and uses the
custom properties. Solid CTAs use **teal-700, not teal-600** — white on
teal-600 measures 3.67:1 and fails WCAG AA, teal-700 measures 5.36:1.
Measured in a browser, as with the accent palette.

## Dashboard chrome

`components/dashboard/ui.tsx` holds every shared control — `btnPrimary`,
`btnSecondary`, `inputClass`, `cardClass`, `StatusChip`, `EmptyState`,
`SkeletonRows`, `PageHeader`. Each manager previously styled its own buttons
and focus rings, which is how they drifted apart; one definition per control
is what stops that recurring. Same teal-700 rule as the marketing surface.

Appointment status colours live in `StatusChip` only: confirmed teal, pending
amber, cancelled rose, no-show slate, completed emerald. The label is always
rendered beside the colour, so status never depends on hue alone.

**Navigation breakpoints are paired at `md` on purpose.** The desktop sidebar
is `md:block` and the mobile bottom bar is `md:hidden`. Moving the bottom bar
to `sm:hidden` without also moving the sidebar would leave 640–768px with no
navigation at all.

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
shop at a real auth user), `check:env`, `test:e2e`.

The E2E suite books against `demo-barber` and tags every row it creates with
the phone number `0559990001`, which is all teardown deletes. The dashboard
specs need `E2E_EMAIL` / `E2E_PASSWORD` for a confirmed owner account in
`.env.local`; without them those specs skip and the public ones still run.

## Feature status

**Done (Phases 0–7, bar the production deploy itself)**

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
- Playwright E2E over the public booking and cancellation flows
- Per-business branding: accent theme, hero media, gallery + lightbox, reviews
- Pricing page with a monthly/yearly toggle; plan recorded during onboarding
- Super-admin console at `/master`: tenant metrics, impersonation, trial
  extension, freeze, live feed, churn and delivery alerts
- Two-tier plan line (₪69 / ₪99) with entitlements enforced server-side —
  branding gated on write, client reminder channel chosen by tier

**Not built**

- **Billing.** No payment provider. Features are now gated on `plan_type` and
  `subscription_status` (see [Entitlements](#entitlements)), but **nothing
  charges against them** and no job acts on a lapsed trial. The landing page
  advertises prices that cannot be collected. Stages 8b–8e of the milestone —
  see [PROJECT_PLAN.md](PROJECT_PLAN.md).
- Multi-staff resources, Google Calendar sync, recurring appointments,
  custom domains
- Service image upload (needs Supabase Storage), appointment status filters,
  timezone editing in settings
- Sentry — `reportError` is the single call site to wire it into
- E2E coverage of dashboard CRUD; that path is exercised only by the PGlite
  suite, not through a browser
- SMS/WhatsApp are code-complete but **unproven — no Twilio account yet**. The
  routing is wired (`clientDelivery()` picks SMS for Pro), so the only thing
  between a Pro tenant and real SMS is credentials. `check:env --production`
  now fails without them, which blocks a deploy until that account exists.
- WhatsApp needs a Meta-approved template before reminders can route to it.
  Until then the channel is deliberately configured-but-unused.
- `appointments.reminder_sent_at` is dead since the outbox landed; safe to drop
- Read-only impersonation. An admin viewing a tenant can currently write as
  that tenant; see the warning under [Impersonation](#impersonation). Stage 8b
  builds the per-action write gate for frozen tenants — the same mechanism, so
  that is when this gets closed properly rather than half-done.

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
