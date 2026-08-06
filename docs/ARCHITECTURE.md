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
| Tests      | Vitest + PGlite (WASM Postgres) — 324 tests; Playwright — 10 specs |
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

Nine tables. Seven are tenant-scoped by `business_id`; `rate_limits` is not,
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

### RLS status: 9 of 9 tables, **0 anon policies**

Migrations `0002`, `0005`, `0007` and `0012`. Six tables carry one
`FOR ALL TO authenticated` policy keyed on `auth.uid() = owner_user_id`, joined
through `businesses` for child tables. Both `USING` and `WITH CHECK` are set,
so an owner cannot insert rows pointing at someone else's business.

Three tables deliberately differ, and `db/rls.test.ts` asserts each:

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

> **Teal is not gone from the platform.** `/login`, `/dashboard/*` and
> `/master` still use the teal chrome described under
> [Dashboard chrome](#dashboard-chrome), and `BRAND_MARK` is still rendered
> with a teal stop on those surfaces. The landing page and the app now look
> like two different products. That is a real inconsistency and it is
> deliberate scope, not an oversight: the brief covered `/`. Whichever way it
> is resolved, it should be resolved in one pass rather than drifting.

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

## Dashboard chrome

`components/dashboard/ui.tsx` holds every shared control — `btnPrimary`,
`btnSecondary`, `inputClass`, `cardClass`, `StatusChip`, `EmptyState`,
`SkeletonRows`, `PageHeader`. Each manager previously styled its own buttons
and focus rings, which is how they drifted apart; one definition per control
is what stops that recurring. Same teal-700 rule as the marketing surface.

Appointment status colours live in `StatusChip` only: confirmed teal, pending
amber, cancelled rose, no-show slate, completed emerald. The label is always
rendered beside the colour, so status never depends on hue alone.

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
- Subscription lifecycle: trial sweep, 7-day grace window, automatic freeze,
  dunning mail through the outbox, and a read-only dashboard for frozen
  tenants with mechanically-verified action coverage
- `/dashboard/billing` — plan, status, grace deadline and invoice history
- Landing page rebuilt monochrome: 70/30 above-the-fold split, a crisp 50/50
  ink/paper hero with a Canvas bubble field and the typed wordmark, the agenda
  preview presented in a brand-gradient card with glass tiles, one accent
  gradient reserved for active and primary states, soft geometry throughout,
  and a gradient closing banner

**Not built**

- **A real payment provider.** The adapter, the checkout action, the activation
  path and the invoice/audit writes all exist and are tested; what is missing
  is an implementation of `BillingProvider` that talks to a payment company,
  and the webhook that would drive it. `getBillingProvider()` is the only
  function that needs to learn a new name. Stages 8d and 8e — see
  [PROJECT_PLAN.md](PROJECT_PLAN.md).
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
