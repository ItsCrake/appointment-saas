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
| Tests      | Vitest + PGlite (WASM Postgres) — 164 tests; Playwright — 10 specs |
| Hosting    | Vercel. **Root Directory must be `Frontend`.**                     |

Everything lives in `Frontend/`. There is no separate backend tier — Server
Actions and route handlers _are_ the backend.

```
Frontend/src/
  app/            routes: /[slug], /b/[token], /dashboard/*, /login, /api/cron
  components/     booking/ (public), dashboard/ (owner), ui/
  db/             schema, migrations, queries/ (repository layer), scripts
  lib/            availability, notifications/, stats, cancellation, env, ics
  test/           PGlite harness + factories
  proxy.ts        auth redirect guard (NOT middleware.ts — see below)
```

## Database

Seven tables. Six are tenant-scoped by `business_id`; `rate_limits` is not.

- **businesses** — slug, timezone, `slot_interval_min`, `buffer_min`,
  `min_notice_min`, `max_advance_days`, `cancel_window_hours`,
  `reminder_hours_before`, `notification_email`, `onboarding_completed_at`
- **services** — duration, price (agorot), `buffer_min` (NULL inherits business)
- **working_hours** — weekly template; multiple rows per weekday = split shift;
  no rows = closed. Naive `time` values interpreted in the business timezone.
- **time_off** — one-off closures, stored UTC
- **appointments** — UTC instants, status enum, snapshots `service_name` and
  `price_cents`, `cancel_token` for the self-service link
- **notifications** — transactional outbox (see below)
- **rate_limits** — fixed-window counters; the only table with no
  `business_id`, so RLS is on with **no policy at all**

Migrations `0000`–`0007` in `src/db/migrations/`, applied with
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

## Key technical decisions

**Timezone: UTC storage, business-local reasoning.** Every timestamp column is
`timestamptz` in UTC. Wall-clock inputs (working hours, time-off forms) are
resolved through `fromZonedTime(…, business.timezone)`. Never compare a local
date to a UTC one.

**Pure/IO split for anything time-based.** `computeSlots()` and
`getStatsWindows()` are pure functions; `getAvailableSlots()` and
`getDashboardStats()` do the IO around them. This is what makes DST behaviour
testable — the same `09:00` shift is `06:00Z` in August and `07:00Z` in
December, and both are asserted.

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

**Onboarding state is explicit.** `onboarding_completed_at` rather than
inferring from service count, which would drag an owner back into setup after
deleting a service. The business row is created at step 1 so an abandoned
signup still leaves a usable account.

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

**Done (Phases 0–6, bar the production deploy itself)**

- Public booking: 3-step flow, no client login, `.ics` download, self-service
  cancellation at `/b/[token]` within the business's cancel window
- Availability engine: split shifts, per-service buffer override, min notice,
  booking horizon, time-off, DST-correct
- Dashboard: day/week agenda, manual booking for walk-ins, quick status
  actions, services CRUD, working hours, time off, clients list, settings,
  stats cards
- Auth + 4-step onboarding with live-link finish screen
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

**Not built**

- Payments/deposits, multi-staff resources, Google Calendar sync, recurring
  appointments, reviews, custom domains
- Service image upload (needs Supabase Storage), appointment status filters,
  timezone editing in settings
- Sentry — `reportError` is the single call site to wire it into
- E2E coverage of dashboard CRUD; that path is exercised only by the PGlite
  suite, not through a browser
- SMS/WhatsApp are code-complete but unproven — no Twilio account yet.
  Switching client messages to SMS is a one-line change to `CLIENT_CHANNEL` in
  `lib/notifications/enqueue.ts`.
- `appointments.reminder_sent_at` is dead since the outbox landed; safe to drop

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
