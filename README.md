# Bazman · בזמן

Multi-tenant appointment booking platform for small service businesses —
barbers, salons, clinics, studios. Hebrew / RTL, mobile-first.

Every business gets a public booking page at `/[slug]` that clients use without
creating an account, plus an owner dashboard at `/dashboard` for the calendar,
services, hours and settings. Notifications (confirmation, owner alert,
reminder, cancellation) are dispatched from a transactional outbox. The
platform owner gets a super-admin console at `/master`.

|                                 |                                              |
| ------------------------------- | -------------------------------------------- |
| Architecture & design decisions | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Deploying to Vercel + Supabase  | [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)     |
| Scope, schema and roadmap       | [docs/PROJECT_PLAN.md](docs/PROJECT_PLAN.md) |

---

## What it does

**For the client** — opens the business link, picks a service, picks a slot,
picks a provider if the shop has a team, enters name and phone. No
registration. Gets a confirmation with an `.ics` download and a personal link
to cancel within the business's cancellation window, plus
`/[slug]/my-appointments` to look up their history by phone.

**For the owner** — day and week agenda plus a **full calendar** with day and
week views and custom blocks that also block client bookings, manual booking for walk-ins,
quick status actions, optional **approve/reject** on every incoming request,
services CRUD with per-service buffer, weekly working hours with split shifts,
**staff with their own hours, time off and colours**, a clients list derived
from booking history with a **per-client profile** — visit and no-show counts,
full history, and saved preferences that follow the phone number onto the
calendar card, **analytics** (peak heatmap, top services, staff load,
trends), and an **installable app with push notifications** for new bookings.

**Underneath**

- Availability is computed **server-side only**. The client never decides what
  is bookable; the server re-derives duration and re-runs availability before
  every insert.
- Slots come from **contiguous free windows**, not a fixed grid. A one-chair
  shop packs each gap from its own start so nothing is wasted; a team snaps to
  the shop's interval so two providers' times line up instead of interleaving.
- Double booking is prevented by a Postgres `EXCLUDE USING gist` constraint,
  not by application logic — two clients tapping the same slot at the same
  instant cannot both win.
- All timestamps are stored in UTC and reasoned about in the business
  timezone. DST transitions are covered by tests.
- Staff schedules **narrow** the shop's hours, never widen them — a personal
  shift is intersected with `working_hours`, so a provider can never be booked
  while the shop is shut.
- Row Level Security is on for all 14 tables with **zero anon policies**, which
  is what keeps the public Supabase anon key from reading every tenant's client
  names and phone numbers.
- Owner image and video uploads go **straight from the browser to Supabase
  Storage** on a server-minted signed URL; the bytes never pass through Next.
- The public booking form carries a honeypot plus Postgres-backed rate limits
  on IP and on phone-per-business.
- The one **marketing** message — an automated WhatsApp to a client who has
  gone quiet — is gated on the plan, the owner's opt-in, the client's own
  consent and a suppression list, because Israeli law treats it differently
  from every other message here.
- An unknown slug is resolved in the proxy **before the response streams**, so
  it answers a real 404 rather than a 200 with a not-found page inside it. A
  path that cannot be a slug at all costs no database query.

---

## Repository layout

```
.
├── Frontend/          the entire application — there is no separate backend tier
│   ├── src/
│   │   ├── app/       routes: /, /[slug], /[slug]/my-appointments,
│   │   │              /b/[token], /master/*, /login, /login/forgot,
│   │   │              /login/reset, /auth/confirm, /legal/*, /accessibility,
│   │   │              /api/cron, manifest.ts
│   │   │              /dashboard/* — agenda, agenda/full (week calendar),
│   │   │              services, hours, clients, analytics, staff, billing,
│   │   │              settings, setup
│   │   ├── components/  booking/, dashboard/, marketing/, master/, ui/
│   │   ├── db/        schema, migrations (0000–0022), queries/ (repository
│   │   │              layer), scripts
│   │   │              queries/admin.ts — the only cross-tenant queries
│   │   │              queries/client-profiles.ts — phone-keyed client notes
│   │   │              queries/sql-types.ts — coercions for raw `sql` results
│   │   ├── lib/       availability, calendar-layout, calendar-week, analytics,
│   │   │              retention (the win-back window),
│   │   │              notifications/ (+ whatsapp, reminder-policy), billing/,
│   │   │              entitlements, stats, push, media-upload, booking-steps
│   │   │              rate limiting, auth-validation, safe-redirect, app-url,
│   │   │              public-slug + slug-cache (the proxy's 404 guard),
│   │   │              env, ics
│   │   │              branding, plans, legal-content, platform-metrics
│   │   │              super-admin, impersonation, supabase/
│   │   ├── test/      PGlite harness + factories
│   │   └── proxy.ts   unknown-slug 404 guard + auth redirect
│   │                  (Next 16 deprecates middleware.ts)
│   ├── public/        sw.js (push, caches nothing) + PWA icons
│   ├── e2e/           Playwright specs
│   ├── next.config.ts security headers
│   └── vercel.json    cron schedule + function limits
├── docs/              architecture, deployment, project plan
└── PRODUCT.md         durable product truth — users, positioning, constraints,
                       and what evidence may and may not be claimed. Written by
                       `/impeccable init`; read before design work, not code.
```

Server Actions and route handlers _are_ the backend. Every command below runs
from `Frontend/`, or from the root with `npm --prefix Frontend run <script>`.

---

## Quickstart

Requires **Node 20+** (developed on 24.x) and a Supabase project.

```bash
cd Frontend
npm install
cp .env.example .env.local
```

Fill in `.env.local` — at minimum `NEXT_PUBLIC_APP_URL`,
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `DATABASE_URL`,
`DIRECT_URL` and `CRON_SECRET`. Add `SUPER_ADMIN_EMAILS` if you want the
`/master` console — it denies everyone while unset. Then:

```bash
npm run check:env
```

Apply migrations and seed the demo shop:

```bash
npm run db:migrate
npm run db:seed
npm run dev
```

Open <http://localhost:3000> for the landing page and
<http://localhost:3000/demo-barber> for a live booking page.

To use the dashboard, sign up at `/login`, confirm the email, then point the
demo business at your account:

```bash
npm run db:claim -- <your-auth-user-uuid>
```

> `db:seed` deletes and recreates the demo business, which resets its owner —
> re-run `db:claim` afterwards.

Media uploads need one extra step, once per Supabase project. Set
`SUPABASE_SERVICE_ROLE_KEY`, then:

```bash
npm run storage:setup
```

Images up to 5MB anywhere, plus **`video/mp4` and `video/webm` up to 25MB on the
hero banner**. It is idempotent — re-run it after pulling a build that changes
the limits, or a bucket created earlier keeps the old ones and rejects the new
uploads with a storage error.

Without it the dashboard still runs and every media field still accepts a pasted
URL — only the upload button refuses, and it says so. The bucket is not created
by a migration because Supabase Storage lives in a schema the PGlite test
database does not have.

Notifications work out of the box without any provider account: every channel
falls back to a console provider that logs the message and marks it sent. Add
`RESEND_API_KEY` + `NOTIFICATIONS_FROM_EMAIL` to make email real, and the
`TWILIO_*` keys to make SMS real. All are required for production and
`check:env --production` fails without them — a channel a tier *sells* must
not resolve to a provider that delivers nothing.

---

## Scripts

Run from `Frontend/`.

### Develop & build

| Script          | Purpose                             |
| --------------- | ----------------------------------- |
| `npm run dev`   | Dev server (Turbopack) on port 3000 |
| `npm run build` | Production build                    |
| `npm run start` | Serve the production build          |

### Quality

| Script                 | Purpose                                              |
| ---------------------- | ---------------------------------------------------- |
| `npm run verify`       | **The gate.** env → lint → typecheck → tests → build |
| `npm run test`         | Vitest, one pass                                     |
| `npm run test:watch`   | Vitest, watch mode                                   |
| `npm run test:e2e`     | Playwright (needs a live server + DB)                |
| `npm run test:e2e:ui`  | Playwright interactive runner                        |
| `npm run lint`         | ESLint                                               |
| `npm run typecheck`    | `tsc --noEmit`                                       |
| `npm run format`       | Prettier write                                       |
| `npm run format:check` | Prettier check (CI)                                  |

### Database & environment

| Script                       | Purpose                                                   |
| ---------------------------- | --------------------------------------------------------- |
| `npm run check:env`          | Validate env vars; `-- --production` for deploy-readiness |
| `npm run db:migrate`         | Apply SQL migrations via `DIRECT_URL`                     |
| `npm run db:generate`        | Generate a migration from schema changes                  |
| `npm run db:push`            | Push schema without a migration (dev only)                |
| `npm run db:studio`          | Drizzle Studio                                            |
| `npm run db:seed`            | Reset and seed the `demo-barber` business                 |
| `npm run db:claim -- <uuid>` | Point the demo business at a real auth user               |
| `npm run storage:setup`      | Create the `business-media` bucket (once per project)     |
| `npm run push:keys`          | Generate the VAPID pair for web push (**once, ever**)     |

All three VAPID variables are needed together, including a real `VAPID_SUBJECT`
— push refuses to configure with two of the three, and `check:env` reports
`push → live` or `push → off` so a half-configured trio cannot pass for an
unconfigured one.

---

## Tech stack

| Layer          | Choice                                                                      |
| -------------- | --------------------------------------------------------------------------- |
| Framework      | Next.js 16 (App Router, Turbopack), React 19, TypeScript strict             |
| Styling        | Tailwind CSS v4, lucide-react — no component library                        |
| Font           | Heebo via `next/font` (Hebrew + Latin)                                      |
| Database       | Supabase Postgres, Drizzle ORM, postgres.js driver                          |
| Auth           | Supabase Auth (`@supabase/ssr`); owners by session, `/master` by env roster |
| Validation     | Zod v4 shared client/server, react-hook-form on the public form             |
| Dates          | date-fns + date-fns-tz                                                      |
| Email          | Resend (falls back to a console provider)                                   |
| SMS / WhatsApp | Meta Cloud API, Green API and Twilio adapters — code-complete, unproven     |
| Unit tests     | Vitest against PGlite (WASM Postgres) running the real migrations           |
| E2E            | Playwright, Chromium                                                        |
| Hosting        | Vercel — **Root Directory must be `Frontend`**                              |

---

## Routes

| Route                     | Access        | Notes                                           |
| ------------------------- | ------------- | ----------------------------------------------- |
| `/`                       | public        | Marketing landing page, static, no DB           |
| `/[slug]`                 | public        | Booking flow: service → date & time → details   |
| `/[slug]/my-appointments` | public        | Client looks up their own history by phone      |
| `/b/[token]`              | token         | Self-service cancellation, `noindex`            |
| `/login`                  | public        | Owner sign-in / sign-up                         |
| `/login/forgot`           | public        | Request a password-reset link, `noindex`        |
| `/login/reset`            | recovery link | Choose a new password, `noindex`                |
| `/auth/confirm`           | emailed token | Turns a recovery link into a session            |
| `/dashboard`              | owner         | Day & week agenda, stats, manual booking        |
| `/dashboard/agenda/full`  | owner         | Full calendar, `?view=day` or `?view=week`      |
| `/dashboard/services`     | owner         | Services CRUD                                   |
| `/dashboard/hours`        | owner         | Weekly hours + time off                         |
| `/dashboard/staff`        | owner         | Team, per-staff hours, per-staff time off       |
| `/dashboard/clients`      | owner         | Derived from booking history, per-client profile |
| `/dashboard/analytics`    | owner         | Peak heatmap, services, staff load — Pro-gated   |
| `/dashboard/settings`     | owner         | Business profile, booking rules, win-back              |
| `/dashboard/billing`      | owner         | Plan, status, grace deadline, invoices          |
| `/dashboard/setup`        | owner         | 5-step onboarding, incl. plan selection         |
| `/master`                 | super admin   | Platform overview: tenants, MRR, conversion     |
| `/master/businesses`      | super admin   | Tenant table: impersonate, extend trial, change tier, freeze/unfreeze |
| `/master/live`            | super admin   | Global booking feed across all tenants          |
| `/master/alerts`          | super admin   | Churn risk, expiring trials, failed sends       |
| `/legal/terms`            | public        | Terms, refunds, subscription, communications    |
| `/legal/privacy`          | public        | Privacy, retention, deletion rights, cookies    |
| `/accessibility`          | public        | Israeli accessibility statement (AA)            |
| `/business-not-found`     | internal      | The proxy's 404 target for an unknown slug      |
| `/api/cron/notifications` | `CRON_SECRET` | Dispatches the outbox on a schedule             |

`/dashboard/*` and `/b/*` send `X-Robots-Tag: noindex` and
`Cache-Control: private, no-store`; security headers are set globally in
`next.config.ts` so they apply in dev too. `/master` is `noindex` in its own
metadata and is guarded server-side in its layout, in every page **and** in
every action — see [ARCHITECTURE.md](docs/ARCHITECTURE.md#platform-console-master).

---

## Testing

```bash
npm run verify     # env, lint, types, 903 unit tests, build
npm run test:e2e   # 11 tests / 3 specs, separate — needs a running server
```

> **The Playwright suite is green at 11/11**, dashboard specs included. Those
> skip unless `E2E_EMAIL` / `E2E_PASSWORD` name the account that owns
> `demo-barber` — see below. Both long-standing failures are fixed: the stale
> slot selector, and an unknown slug answering 200 rather than 404, which was a
> real soft-404 and is described in
> [ARCHITECTURE.md](docs/ARCHITECTURE.md#unknown-slugs-return-a-real-404).

Unit tests run against **PGlite applying the real migration files**, so the
exclusion constraint, enum casts and RLS policies are genuinely exercised
rather than mocked.

The E2E suite books against `demo-barber` and tags every row it creates with
the phone number `0559990001`, which is all teardown deletes. The dashboard
specs need `E2E_EMAIL` / `E2E_PASSWORD` for a confirmed owner account in
`.env.local`; without them those specs skip and the public ones still run.

> **Those credentials must name the account that owns `demo-barber`**, not just
> any confirmed account. An owner with no business is redirected into
> `/dashboard/setup`, so the specs fail on a missing appointment when the real
> cause is that they are looking at an onboarding form. `npm run db:seed`
> reassigns the demo shop, which is how the two drift apart — re-run
> `npm run db:claim -- <uuid>` afterwards.

> **Known gap:** PGlite is more forgiving than postgres.js in **both**
> directions, so the suite proves SQL _semantics_, not driver behaviour.
> Binding: a raw `Date` in a `sql` template passes here and throws in
> production. Reading: a bare `sql` aggregate comes back as a string from
> postgres.js and as a `Date` from PGlite, which took `/master/alerts` down with
> a `RangeError` no test could have caught. Aggregate `sql` templates need a
> smoke test against real Supabase after changes — the full account is in
> [ARCHITECTURE.md](docs/ARCHITECTURE.md#testing).

---

## Deployment

Full checklist in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). The four that bite
hardest:

1. **Vercel Root Directory must be `Frontend`.** Otherwise the build fails with
   "No Next.js version detected" and `vercel.json` is ignored.
2. **Migrations do not run on deploy.** Run `npm run db:migrate` against
   production yourself.
3. **Vercel Hobby rejects sub-daily cron at build time.** The schedule is
   therefore daily, which delays every confirmation email by up to a day.
   Restoring a useful cadence needs Pro or an external scheduler.
4. **Without Resend configured, email silently goes nowhere.** Messages are
   logged and marked sent. `check:env --production` fails on this.

Run `npm run check:env -- --production` before every deploy.

---

## Status

Feature-complete through **Phase 9**, plus **stages 8a–8c** of the billing
milestone. Shipped since the MVP: per-business branding, a two-tier plan line
with server-enforced entitlements, the full subscription lifecycle, a payment
adapter behind a console provider, a monochrome rebuild of the landing page, a
navigation-performance pass, auth hardening, the Israeli legal surface,
self-service password reset, one palette across the product — and then Phase 9:
multi-staff, media uploads, booking approval, client self-service, analytics, a
full week calendar, an installable app with push, and a WhatsApp backend.

**Since Phase 9 closed**, in roughly the order it shipped:

- **A real 404 for unknown slugs**, decided in the proxy before the response
  streams, behind a bounded positive slug cache that fails open.
- **Single-staff shops book only their primary provider.** A leftover second
  provider was widening a one-chair shop's availability and taking bookings;
  turning the team off now deactivates the others rather than hiding them.
- **Availability rebuilt on free windows.** Slots come from contiguous gaps: a
  one-chair shop packs each gap from its own start so nothing is wasted, a team
  snaps to the shop's interval so two providers line up instead of interleaving
  into apparent 5-minute increments.
- **Client win-back** — the only marketing message here, and the only one
  Israeli law treats differently. Default-off, Pro-gated, and gated again on the
  owner's opt-in, the client's own consent, and a suppression list.
- **The full calendar** got day and week views, cards that survive a glance,
  and instant view/date switching. "Last visit" counts visits — not
  cancellations, and not the future.
- **Phone-keyed client profiles**: visit and no-show counts, full history, and
  saved preferences that follow the phone number onto the calendar card.
- Web push now demands a real `VAPID_SUBJECT`; iOS safe areas actually apply;
  `/master/alerts` renders again.
- **The driver gap is enforced rather than remembered.** A coverage test fails
  the build when a `sql<…>` selection annotated `Date` skips `toDate`, or one
  annotated `number` is not cast to a type postgres.js decodes as a number —
  `count(*)` is `int8` and comes back as a string.
- **A freeze now outranks everything.** `effectivePlan` resolves to `free` when
  a tenant is frozen, ahead of both a live subscription and a running trial —
  `/master` used to report a frozen tenant as "מקצועי" while the pill beside it
  said frozen. Extending a trial also writes `subscription_status` back to
  `trialing` and clears the grace clock, so the console reflects it immediately
  instead of appearing to do nothing.
- **The three approved Meta WhatsApp templates** (`appointment_confirmation`,
  `reminder_24h`, `reminder_2h`) on the official Business API path, with the
  reminder chosen from the booking's lead time. Green API still sends free text.
- **A Meta Cloud API backend, matched to the copy Meta actually approved.**
  Templates addressed by name, with header, body and button as separate
  components — Meta numbers each from 1 independently, which is why the approved
  confirmation carries two `{{1}}`. The button's base URL was registered without
  `b/`, so it sends a bare cancel token and the proxy redirects `/{token}` to
  `/b/{token}` rather than 404ing a link a client was just sent. See
  [ARCHITECTURE.md](docs/ARCHITECTURE.md#whatsapp-has-three-backends-and-they-are-not-interchangeable).
- **"ליבי" — booking by Hebrew voice command.** A microphone beside "תור ידני"
  on `/dashboard`: the owner speaks, Libi extracts the fields, asks in Hebrew
  for whatever is missing, and books through the *existing* manual path. The
  browser does the speech-to-text (`he-IL`, no audio leaves the device); Claude
  turns the transcript into structured fields. Pro-gated, and hidden entirely
  without an `ANTHROPIC_API_KEY`. See
  [ARCHITECTURE.md](docs/ARCHITECTURE.md#ליבי--booking-by-hebrew-voice-command).
- **The agenda answers "who is next" first.** Six equal-weight metric cards
  above the appointments — three rows of them on a phone, two of which were
  30-day rates that read `—` for any new shop — became one sentence with the
  rest behind a native disclosure. Nothing was removed: the rates stay
  reachable by a Starter tenant, which moving them to the Pro-gated analytics
  page would have prevented. `היום` is now always rendered in the date nav, so
  the toolbar stops reflowing under a thumb. See
  [ARCHITECTURE.md](docs/ARCHITECTURE.md#the-agenda-answers-one-question-before-it-offers-anything).
- **The booking page got an elevation system**: four shadow tokens (one of them
  resolving the tenant's own accent), a real typographic scale, `zinc-400` text
  lifted off a 2.6:1 contrast failure, and one rule learned the hard way —
  geometry never animates on a click target, because a hover transition makes
  every tap land on a moving element. See
  [ARCHITECTURE.md](docs/ARCHITECTURE.md#the-booking-page-has-an-elevation-system-and-geometry-never-animates).

> **The whole product now runs on one palette.** Teal is gone from `/login`,
> `/dashboard/*` and `/master`, and `neutral` and `slate` were collapsed into
> `zinc`, so the marketing site and the app are no longer two different-looking
> products. Ink carries every primary action and the violet-to-blue gradient is
> reserved for what is *active* or *recommended*. Per-business `--accent` on
> `/[slug]` is untouched — that is the tenant's identity, not the platform's.
> See [ARCHITECTURE.md](docs/ARCHITECTURE.md#one-palette-one-ramp).

**The milestone in progress is billing.** Plans are enforced and the lifecycle
runs: a trial hands over the full Pro product, a lapsed trial drops to
`past_due`, the owner gets warned at T-3 and T-1, paid features switch off, and
after a 7-day grace window the tenant is frozen — public page offline,
dashboard read-only. The checkout path, the activation and the invoice trail
are built and tested behind a provider adapter.

What is missing is **an implementation of that adapter that talks to a payment
company**, plus its webhook. Until one exists the console provider refuses in
production, so nothing can be marked paid without money moving. Stages 8d–8e —
see [docs/PROJECT_PLAN.md](docs/PROJECT_PLAN.md#phase-8--billing-in-progress).

Owners can now recover a forgotten password themselves — `/login/forgot` →
emailed link → `/login/reset`. Two Supabase dashboard settings make it work
properly in production; both fail quietly if skipped, and both are in
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#4-supabase-auth).

**Four newer surfaces are code-complete but have never run on real
infrastructure**, and each needs one credential before it can: media uploads
(`SUPABASE_SERVICE_ROLE_KEY` + `npm run storage:setup`), web push
(`npm run push:keys`), WhatsApp (`WHATSAPP_PHONE_NUMBER_ID` +
`WHATSAPP_ACCESS_TOKEN`), and SMS (Twilio). Everything around them is tested;
the wire itself has not been exercised.

> **Five WhatsApp templates are still missing**, and on a WhatsApp-only
> deployment that is a gap rather than a nicety: `cancellation_confirmation`,
> `booking_pending`, `booking_approved`, `booking_rejected` and
> `client_winback`. Without an approved template the official path refuses to
> send, and with SMS and email dark there is nothing to fall through to — so a
> cancelled appointment currently tells the client nothing at all. The post-deploy
checklist in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#6-post-deploy-checks)
walks each one.

Still not built: a real payment provider and its webhook (8d), the per-tenant
cost model (8e), client deposits beyond the schema, Google Calendar sync,
recurring appointments, custom domains, service image upload, per-tenant
reminder thresholds, and Sentry.

### Before this goes live

Three things are known-outstanding and none of them are code:

1. **Have a lawyer review the legal text.** `/legal/*` and `/accessibility`
   are engineer-written templates, and `LEGAL_ENTITY` in
   `lib/legal-content.ts` still carries placeholder ח.פ. and address fields.
2. **Open a Twilio account**, or drop the SMS line from the Pro tier in
   `lib/plans.ts`. `check:env --production` fails without the credentials,
   because a tier that *sells* SMS must not deploy onto a provider that
   silently delivers nothing.
3. **Pick a payment provider** (Stripe, or an Israeli one with native
   חשבונית מס). Only `getBillingProvider()` needs to learn the new name.

> The fourth item here used to be "apply migration `0012`". It is retired:
> verified against the live database, **all 23 migrations (0000–0022) are
> applied** — fourteen public tables, RLS on every one, twelve owner policies,
> zero reachable by `anon`, and every `0012` billing column present.

> **Deploy note:** the Pro tier sells SMS reminders, so
> `check:env --production` now requires Twilio credentials. Without a Twilio
> account, either add one or drop the SMS line from the Pro tier in
> `lib/plans.ts` before deploying.
