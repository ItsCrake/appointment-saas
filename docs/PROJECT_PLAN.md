# PROJECT PLAN — Bazman · בזמן

Multi-tenant booking platform. Each business gets a public mobile-first booking page at `/[business_slug]` plus an admin dashboard at `/dashboard`.
Reference model: Noah Calendar (Hebrew / RTL, service → date → time → confirm).

---

## 1. Core Features (MVP)

### Public Booking Page — `/[business_slug]`

- Business header: logo, name, cover image, short description.
- **Step 1 — Service**: list of services with image, duration, price.
- **Step 2 — Date & Time**: month/week date picker; available slots computed from working hours − existing appointments − blocked time.
- **Step 3 — Details & Confirm**: name, phone, email (optional), notes → summary → confirm.
- No client registration required (phone number is the identity).
- Confirmation screen + "add to calendar" (.ics) link.
- Self-service cancel/reschedule via signed link (`/b/[token]`).
- Mobile-first, RTL-ready (Hebrew), fast (SSR + cached availability).
- Optional gallery section ("our work") and business contact/social links.

### Admin Dashboard — `/dashboard`

- Auth (email magic link / OTP) scoped to a single business.
- **Calendar view**: day / week list of appointments; create, edit, cancel manually.
- **Services CRUD**: name, duration, price, description, image, active toggle.
- **Working hours**: per weekday open/close + breaks; slot interval; booking buffer.
- **Time off / blocked dates**: vacations, one-off closures.
- **Settings**: business name, slug, logo, phone, address, timezone, cancellation window, min/max advance booking.
- **Clients list**: derived from appointments (name, phone, visit history).
- Basic stats: appointments today / this week, no-show & cancellation counts.

### Notifications (MVP-lite)

- Email confirmation to client + notification to business owner on new booking/cancellation.
- Reminder job (N hours before appointment) via cron.
- Provider-agnostic adapter so WhatsApp/SMS can be plugged in post-MVP.

### Explicitly out of MVP (post-launch)

Online payments/deposits, multi-staff resources, Google Calendar 2-way sync, AI chatbot, marketing automation, reviews, recurring appointments, custom domains.

---

## 2. Recommended Tech Stack

| Layer         | Choice                                                               | Why                                                                                                                    |
| ------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Framework     | **Next.js 15+ (App Router)** — RSC + Server Actions                  | SSR public pages, one codebase for API + UI                                                                            |
| Language      | **TypeScript** (strict)                                              | Type safety end-to-end                                                                                                 |
| Styling       | **Tailwind CSS v4** + shadcn/ui + Radix                              | Fast, consistent, RTL via logical properties                                                                           |
| DB            | **PostgreSQL (Supabase)**                                            | Managed, pooled, backups, generous free tier                                                                           |
| ORM           | **Drizzle ORM** + drizzle-kit migrations                             | Fast, edge-friendly, SQL-first, zero runtime bloat _(Prisma is the acceptable alternative if the team prefers its DX)_ |
| Auth          | **Supabase Auth** (magic link / OTP) — owners only                   | Clients book without accounts                                                                                          |
| Validation    | **Zod** (shared client/server schemas)                               | Single source of truth for forms + API                                                                                 |
| Dates         | **date-fns** + `date-fns-tz`                                         | Timezone-correct slot math                                                                                             |
| Forms         | React Hook Form + Zod resolver                                       | Minimal re-renders                                                                                                     |
| State/Data    | Server Components + Server Actions; TanStack Query only where needed | Less client JS                                                                                                         |
| Files         | Supabase Storage                                                     | Logos, service & gallery images                                                                                        |
| Email         | Resend + React Email                                                 | Confirmations & reminders                                                                                              |
| Jobs/Cron     | Vercel Cron (or Supabase pg_cron)                                    | Reminder dispatch                                                                                                      |
| Hosting       | Vercel                                                               | Edge CDN, preview deploys                                                                                              |
| Quality       | ESLint + Prettier, Vitest (slot logic), Playwright (booking flow)    | Guard the critical path                                                                                                |
| Observability | Sentry + Vercel Analytics                                            | Errors + funnel drop-off                                                                                               |

**Key conventions**

- Store all timestamps in **UTC**; render in `business.timezone`.
- Multi-tenancy by `business_id` on every row; enforce with RLS + app-layer scoping.
- Slot generation is **server-side only** — never trust client-computed availability.

---

## 3. Database Schema (concise)

> ⚠️ **This section is the original design sketch and has drifted.** It predates
> migrations `0003`–`0011`, so it omits per-service buffers, the notifications
> outbox, rate limits, onboarding state, and the branding / subscription /
> trial columns. `Frontend/src/db/schema.ts` is the source of truth, and
> [ARCHITECTURE.md](ARCHITECTURE.md#database) documents the constraints that
> carry weight. Kept here for the original reasoning, not as a reference.

```
businesses
  id            uuid pk
  owner_user_id uuid            -- FK auth.users
  slug          text unique     -- /[business_slug]
  name          text
  description   text?
  logo_url      text?
  phone         text?
  address       text?
  timezone      text            -- e.g. 'Asia/Jerusalem'
  locale        text            -- 'he' | 'en'
  slot_interval_min      int    -- default 15
  buffer_min             int    -- default 0, gap after each appointment
  min_notice_min         int    -- earliest bookable
  max_advance_days       int    -- booking horizon
  cancel_window_hours    int
  is_active     bool
  created_at    timestamptz

services
  id            uuid pk
  business_id   uuid fk -> businesses (cascade)
  name          text
  description   text?
  duration_min  int
  price_cents   int
  currency      text            -- 'ILS'
  image_url     text?
  sort_order    int
  is_active     bool
  created_at    timestamptz
  idx (business_id, is_active)

working_hours                    -- weekly recurring template
  id            uuid pk
  business_id   uuid fk -> businesses (cascade)
  weekday       smallint         -- 0=Sun .. 6=Sat
  start_time    time             -- local to business timezone
  end_time      time
  is_closed     bool
  unique (business_id, weekday, start_time)   -- multiple rows = split shifts

time_off                         -- one-off closures / breaks
  id            uuid pk
  business_id   uuid fk -> businesses (cascade)
  starts_at     timestamptz
  ends_at       timestamptz
  reason        text?

appointments
  id                uuid pk
  business_id       uuid fk -> businesses (cascade)
  service_id        uuid fk -> services (restrict)
  starts_at         timestamptz      -- UTC
  ends_at           timestamptz      -- UTC (derived from service duration)
  status            enum('pending','confirmed','cancelled','completed','no_show')
  client_name       text
  client_phone      text
  client_email      text?
  notes             text?
  price_cents       int              -- snapshot at booking time
  cancel_token      text unique      -- self-service cancel/reschedule link
  reminder_sent_at  timestamptz?
  created_at        timestamptz
  idx (business_id, starts_at)
  exclusion constraint: no overlapping [starts_at, ends_at) per business_id
    where status in ('pending','confirmed')   -- DB-level double-booking guard
```

**Notes**

- Postgres `EXCLUDE USING gist (business_id WITH =, tstzrange(starts_at, ends_at) WITH &&)` is the authoritative anti-double-booking guard; the UI check is only an optimization.
- Snapshot `price_cents` / service name on the appointment so history survives service edits.
- Add `staff` + `appointments.staff_id` later without breaking this model.

---

## 4. Development Roadmap

### Phase 0 — Foundation ✅

- [x] `create-next-app` (TS, App Router, Tailwind), ESLint/Prettier, strict `tsconfig`.
- [x] Supabase project; connection strings in `.env.local` + `.env.example`.
- [x] Drizzle schema + first migration; seed script (1 demo business, 3 services, working hours).
- [x] Base layout: RTL support, fonts, shadcn/ui init, theme tokens. _(Heebo via next/font; `dir="rtl"`. shadcn/ui not initialised — components written directly against Tailwind so far.)_

### Phase 1 — Data & Availability Engine (the core) ✅

- [x] Repository/query layer scoped by `business_id`. _(`src/db/queries/`, driver-agnostic `Database` handle.)_
- [x] `getAvailableSlots({ businessId, serviceId, date })`: working hours → subtract booked + time_off → apply buffer, min notice, max advance → return slot list. _(`src/lib/availability.ts`; takes `db` as first arg for injectability.)_
- [x] Unit tests: DST boundary, split shifts, back-to-back bookings, closed days, buffer edges. _(24 tests on PGlite running the real migrations.)_
- [x] Add overlap exclusion constraint + booking transaction that fails cleanly on conflict. _(`0001_double_booking_guard.sql`, live on Supabase.)_
- [x] **Added:** tenant-isolation RLS on all 5 tables, zero anon policies (`0002_tenant_isolation_rls.sql`). Pulled forward from Phase 5.

### Phase 2 — Public Booking Page ✅

- [x] `/[business_slug]` route: fetch business + active services (404 on unknown/inactive slug).
- [x] Step 1 — service list UI (image, duration, price).
- [x] Step 2 — date picker + slot grid (server-fetched availability, loading/empty states). _(Horizontal day strip instead of a month grid — better for thumbs.)_
- [x] Step 3 — details form (Zod + RHF) → Server Action `createAppointment` (re-validates slot server-side).
- [x] Confirmation screen + `.ics` download.
- [x] `/b/[cancel_token]` — view and cancel within the cancellation window. _(Reschedule deferred: it is a re-book, so it belongs with the Phase 3 admin edit flow.)_
- [x] Mobile polish, RTL pass, SEO/OG tags per business.

### Phase 3 — Admin Dashboard ✅

- [x] Supabase Auth + guard; `/dashboard` shell + business resolution from session. _(Email/password rather than magic link — no SMTP configured. Guard lives in `src/proxy.ts`; `middleware` is deprecated in Next 16. Verified end to end against the live project.)_
- [x] Appointments: day **and week** view, manual create (walk-ins), cancel / completed / no-show. _(Status filters not built.)_
- [x] Services CRUD **incl. per-service buffer** (`0003_service_buffer.sql`; NULL inherits the business default). _(No image upload to Supabase Storage yet.)_
- [x] Working hours editor (weekday rows, split shifts, closed = no shifts).
- [x] Time off manager.
- [x] Settings page — name, slug (uniqueness-checked), phone, address, description, default buffer, cancellation window. _(Timezone is displayed read-only; logo upload waits on Storage.)_
- [x] Clients list derived from appointment history (name, phone, bookings, last visit).
- [x] **Added:** `/dashboard/setup` onboarding + `npm run db:claim` to point the demo shop at a real auth user. Pulled forward from Phase 5.
- [x] **Added:** toast notifications, empty states, loading states across the dashboard.
- [ ] Deferred: service image upload (needs Supabase Storage), appointment status filters, timezone editing.

### Phase 4 — Notifications ✅

- [x] Email adapter (Resend) + Hebrew templates: client confirmation, owner alert, cancellation, reminder. _(Plain-text templates wrapped in minimal RTL HTML rather than React Email — one template set serves email, SMS and WhatsApp.)_
- [x] `/api/cron/notifications` — dispatches due messages, idempotent. _(Uses a `notifications` outbox table with a unique `dedupe_key`, not `appointments.reminder_sent_at`; the column is now unused. Scheduled via `vercel.json`, guarded by `CRON_SECRET`; daily on Hobby, which rejects sub-daily expressions at build time.)_
- [x] Notification interface ready for a WhatsApp/SMS provider. _(Twilio adapters written for both; they activate when their keys are present. Every channel falls back to a console provider when unconfigured.)_
- [x] **Added:** reminders are cancelled when their appointment is, and the dispatcher re-checks appointment state before sending.
- [x] **Added:** RLS on `notifications` (`0005_notifications_rls.sql`) — it stores client emails and phone numbers.
- [ ] Deferred: switching client messages to SMS/WhatsApp is a one-line channel change in `enqueue.ts` once Twilio keys exist.
- [ ] Deferred: drop the now-unused `appointments.reminder_sent_at` column.

### Phase 5 — Onboarding & Multi-tenant Polish

- [x] Sign-up flow: create business → pick slug → services → working hours → live link. _(4 steps at `/dashboard/setup`; business created at step 1 so an abandoned signup still leaves a usable account; `onboarding_completed_at` gates re-entry.)_
- [x] Enable RLS policies on all tables; verify cross-tenant isolation with tests. _(Pulled forward to Phase 1; migrations `0002` + `0005`, 6/6 tables, 0 anon policies.)_
- [x] Dashboard stats cards (today / week / cancellations / no-shows). _(Business-local day/week boundaries; rates measured only against appointments that have already started.)_
- [x] Basic marketing landing page at `/`. _(Static RSC, zero DB access: hero, live-demo banner, how-it-works, feature grid, footer. Hebrew OG/canonical metadata.)_

> Note: the deploy-readiness work (env checks, security headers, `vercel.json`)
> was done ahead of schedule and belongs to Phase 6, not here. SEO belonged to
> Phase 2 and is complete.

### Phase 6 — Ship

- [x] Playwright E2E: booking flow + dashboard verification + cancel flow. _(10 specs in `e2e/`; self-cleaning via a marker phone number. Admin CRUD is still covered only by the PGlite suite, not through the browser.)_
- [x] Rate limiting on booking endpoint, honeypot/anti-spam on the public form. _(Postgres fixed-window counters, `0007`; IP + phone-per-business layers; honeypot returns fabricated success.)_
- [x] Structured error reporting at every server boundary (`src/lib/observability.ts`), with client identifiers redacted. _(**Sentry SDK not installed** — `reportError` is the single call site to wire it into.)_
- [x] **Added:** security headers moved from `vercel.json` to `next.config.ts`, so they apply in dev and on any host — and are testable locally.
- [ ] Production deploy to Vercel, custom domain, DB backups verified.
- [ ] Pilot with 1–2 real businesses; collect feedback before building payments/staff/WhatsApp.

### Phase 7 — Brand, branding and the platform console ✅

- [x] Per-business branding: accent theme, hero image/video, gallery with lightbox, owner-entered reviews (`0009`). _(Theme is a `data-accent` attribute plus CSS custom properties — Tailwind cannot emit a class from a runtime value. Every swatch is WCAG AA verified.)_
- [x] Landing page rebuilt: split hero, animated `Bazman.` / `בזמן.` wordmark, dashboard mockup, pricing table with a monthly/yearly toggle, FAQ accordion. _(`/` stays a static prerender; the toggle and accordion are client islands.)_
  - [x] **Rebuilt again after stage 8a.** Monochrome base, 70/30 above-the-fold split, feathered ink/paper hero: a Canvas field of hollow drifting bubbles and the typed wordmark on ink, the agenda preview and the actions on paper. One accent gradient (violet into blue) reserved for active and primary states, soft geometry throughout, and a gradient closing banner with a dot matrix, a warm flare and floating glass tiles. Teal was gone from `/` and still present on `/login`, `/dashboard/*` and `/master` — since closed by the palette reconciliation below. See [ARCHITECTURE.md](ARCHITECTURE.md#one-palette-one-ramp).
- [x] Subscription plans recorded on the tenant (`0010`) and selectable during onboarding, which is now five steps.
- [x] Global rename to **Bazman / בזמן**, with the name centralised in `lib/brand.ts`.
- [x] Dashboard overhaul: shared chrome (teal at the time, monochrome since), mobile bottom nav, revenue and new-client stats, clients search with call/WhatsApp shortcuts.
- [x] **Super-admin command center at `/master`** — four tabs (סקירה / עסקים / פעילות בלייב / התראות) over `db/queries/admin.ts`.
  - [x] Access by `SUPER_ADMIN_EMAILS` env roster. Fails closed: an empty or unset roster denies everyone. A column was rejected — super-admin is a property of a _user_, and users live in Supabase's `auth.users`, which this app must not alter.
  - [x] Guarded in the layout, in every page **and** in every action. A layout alone is not a boundary: a client navigation between tabs reuses it without re-running it.
  - [x] Overview: tenant breakdown by status, platform booking pulse, MRR and trial-conversion. Conversion excludes the still-trialing cohort from its denominator.
  - [x] Businesses: searchable tenant table with impersonation, `+7 days` trial extension and freeze/unfreeze.
  - [x] Impersonation keeps the admin's own identity — a cookie holding only a business id, re-verified against the roster on every request. Minting a real Supabase session for the target owner was rejected: it would make the admin indistinguishable from the tenant in Supabase's own auth logs.
  - [x] Live feed across all tenants, deliberately excluding client names and phone numbers.
  - [x] Alerts: churn risk (7 quiet days), trials expiring within 48h, failed notification deliveries.
  - [x] Trial clock (`0011`, `trial_ends_at`), backfilled for existing trialing tenants.
- [ ] Deferred: impersonation is **not read-only**. `requireBusiness()` is the one boundary every dashboard action shares, so an impersonating admin can write as the tenant. Needs a per-action gate — half-covering it would be worse than not doing it.

### Phase 8 — Billing (in progress)

Money was **recorded but not enforced**. Stage 8a closed the enforcement half:
features are now gated on the subscription columns. The collection half — a
payment provider, a lifecycle driven by webhooks, and a job that acts on a
lapsed trial — is stages 8b–8e.

**Decisions taken (2026-08-05), previously blocking:**

| Question           | Decision                                                                                                 |
| ------------------ | -------------------------------------------------------------------------------------------------------- |
| Tier line          | **Two tiers**: Starter ₪69/mo, Pro ₪99/mo. `business` retired and folded into `pro`.                    |
| Volume caps        | **None.** Both tiers include unlimited bookings; differentiation is by feature only.                     |
| Unpaid tenants     | **7-day grace** (downgrade + warnings), then **freeze**: public booking off, dashboard read-only.        |
| Multi-staff copy   | **Removed** — it does not exist. SMS/WhatsApp stays, because the Twilio adapters and outbox do exist.    |
| Payment provider   | **Deferred by design.** Build the adapter and a console provider; the concrete provider is one file.     |

Sequencing is deliberate: only 8d needs the provider decision, so everything
else ships before a merchant account exists.

#### 8a — Plans & entitlements ✅

- [x] Two-tier line in `lib/plans.ts` at ₪69 / ₪99. Booking-cap copy removed;
      a test asserts no tier feature can reintroduce one.
- [x] `lib/entitlements.ts` — pure, no IO, the single place deciding what a
      tier buys. Takes the business row rather than a `PlanType`, so no caller
      can consult the plan without the status.
- [x] Enforced: branding writes in `settings/appearance-actions.ts` (the
      boundary) with an upgrade panel on the settings page (the courtesy), and
      the client reminder channel in `lib/notifications/enqueue.ts`.
- [x] `past_due` taught to the code ahead of the migration that allows it, so
      it can never normalise into a status that grants paid features. Retired
      `business` maps **up** to `pro`, never down to the default.
- [x] Unknown status fails closed, unknown plan fails open — see
      [ARCHITECTURE.md](ARCHITECTURE.md#entitlements) for why they differ.
- [x] Twilio moved to a production requirement: a tier that sells SMS must not
      deploy onto a console provider that reports success and delivers nothing.
- [x] 18 new unit tests; `npm run verify` green at 270.

> Known consequence, accepted: **for a Starter tenant, entitlements change
> nothing.** Everything Starter sells is baseline product, so the grace window
> applies no pressure and the 8b freeze is their only real enforcement.

#### 8b — Lifecycle & the write gate ✅

- [x] Migration `0012`: `past_due` added to the status CHECK; legacy `business`
      rows rewritten **up** to `pro` and dropped from the plan CHECK;
      `grace_started_at`, `frozen_reason`, `billing_cycle`,
      `provider_customer_id`, `provider_subscription_id`, `current_period_end`,
      `cancel_at_period_end` added.
- [x] New tables `subscription_events` (UNIQUE `(provider, provider_event_id)`,
      scoped by provider because two providers mint the same opaque ids; RLS on
      with **zero** policies) and `invoices` (RLS **`FOR SELECT` only** — an
      owner who could `INSERT` could mark themselves paid). Invariant now
      **9 of 9 tables, 0 anon policies**, asserted by `db/rls.test.ts`.
- [x] `lib/billing/lifecycle.ts` — the state machine as pure functions. Freeze
      is last not first, one action per tenant per run, half-open warning bands,
      and `past_due` with no clock is never frozen.
- [x] `requireBusiness()` returns `access`; `requireWritable()` guards every
      mutating dashboard action and redirects rather than throwing.
- [x] **Coverage test over every `"use server"` module.** Verified by reverting
      three actions to `requireBusiness()` and confirming it named all three.
      A stale-exemption test keeps the waiver list honest.
- [x] Trial sweep riding the existing daily cron: warn at T-3 and T-1, lapse to
      `past_due` with the clock, freeze after 7 days. Only
      `frozen_reason = 'billing'` is ever auto-unfrozen. Runs *before* dispatch
      so a warning queued this run goes out this run.
- [x] `/master` breakdown gains a `past_due` bucket; trial conversion still
      excludes it, because a tenant mid-grace has not decided.
- [x] **Pulled forward from 8c:** the dispatcher's appointment-optional path
      and the four billing `notification_kind` values. Without them the sweep's
      warnings would have inserted cleanly and vanished, so shipping the sweep
      without the fix would have been shipping a silent failure.
- [x] **Pulled forward from 8c:** a read-only `/dashboard/billing`, because the
      freeze banner and the branding upsell both needed a real destination.

#### 8c — Payment adapter ✅

- [x] **Trial entitlement fix (found before starting 8c).** A trial now grants
      `TRIAL_PLAN` (Pro) whatever tier was picked at signup. Previously a
      tenant who chose Basic hit "upgrade your plan" walls on branding and
      gallery during the exact window they were evaluating, and
      `/dashboard/billing` labelled them בסיסי while they held Pro features.
- [x] **Trial clock fix (found while fixing the above).** Nothing ever wrote
      `trial_ends_at` on signup: `0011` backfilled existing rows and `/master`
      could extend it, but new tenants got NULL. The sweep only considers rows
      with a clock, so **every account created since launch was invisible to
      the entire 8b lifecycle** — never warned, never lapsed, never frozen. It
      is now set at business creation.
- [x] `/dashboard/billing` shows the tier actually held, the post-trial price,
      and a countdown derived from the tenant's own `trial_ends_at` rather than
      the `TRIAL_DAYS` constant — a trial extended from `/master` is longer
      than the constant, and printing it told that owner the wrong date.
- [x] `lib/billing/types.ts` + `providers.ts` — `BillingProvider` resolved at
      call time, with a console provider that **hard-refuses in production**.
      Asserted by test: the inverted fallback is the point.
- [x] `activateSubscription()` — the one place a subscription becomes active.
      Clears the grace clock, writes invoice and audit rows idempotently, and
      lifts only a `billing` freeze. Nine PGlite tests over the real tables.
- [x] Checkout and cycle-change UI on `/dashboard/billing`, with buttons
      disabled and the reason stated while no provider is configured.
- [x] `check:env` reports the resolved billing provider beside the email
      channel. Deliberately not a hard error yet: nothing can be configured
      until 8d, and the runtime refusal is the real guard.

#### Alpha feedback pass (between 8c and 8d) ✅

Four issues from real business owners testing the product.

- [x] **Share links pointed at localhost.** `lib/app-url.ts` resolves the origin
      from the request when the env is unset or still says localhost, with a
      `window.location.origin` backstop in the copy-link step. A runtime origin
      never overrides a real configured domain.
- [x] **Manual bookings appeared not to notify.** The action always enqueued;
      the real cause is that a phone booking has no email, and email is the
      only live channel, so nothing was queued at all. Now reported to the
      owner instead of silent. Confirmations also dispatch inline rather than
      waiting for the daily cron.
- [x] **Sticky `0` in price and duration.** Numeric drafts are strings so a
      field can be blank, and select on focus so the first keystroke replaces.
- [x] **Android RTL time picker clipped.** `dir="ltr"` on every time input.

#### Navigation performance pass ✅

- [x] **Root cause: no `loading.tsx` on any dynamic route.** Next skips
      prefetching dynamic routes without one, so every navigation waited on a
      full server render before painting. Measured: the prefetch payload for
      `/demo-barber` went from 197 bytes to 11,896 with the skeleton included.
- [x] `loading.tsx` for all seven dashboard routes, all four `/master` tabs and
      the public booking page, each shaped like its real page.
- [x] `RouteProgress` top bar, rendered by the fallbacks so Suspense drives it
      rather than router events. Server component, no JavaScript.
- [x] `useLinkStatus` indicators on the sidebar, covering the moment before the
      fallback paints.
- [x] `SubmitButton` (`useFormStatus`) for the two form-action buttons that had
      no pending state. The rest already had `useTransition` guards.

#### Password reset ✅

The gap an owner could not work around: forgetting a password meant losing the
account, because there is no support inbox and impersonation deliberately mints
no session for the owner. `signUpAction` had been telling people to "sign in or
reset your password" since launch, pointing at a flow that did not exist.

- [x] `/login/forgot` → emailed link → `/auth/confirm` → `/login/reset`, reusing
      `AUTH_RULES`, `authIdentifier` and the sign-up strength rules rather than
      restating any of them.
- [x] **One response, always.** A reply that varies with whether the address is
      registered turns the form into a membership oracle. Only a transport
      failure is reported honestly, because it says nothing about the address.
- [x] `resetIdentity` rate limit, tighter than sign-in's, keyed on the hashed
      address. It guards a *mailbox*: a reset cannot be guessed, so the abuse
      case is using this form to bomb someone else's inbox.
- [x] `/auth/confirm` accepts **both** the `token_hash` and PKCE `code` link
      shapes. PKCE alone only works in the browser that asked for the reset,
      which passes every local test and fails the phone-then-laptop case.
- [x] `lib/safe-redirect.ts` — open-redirect guard on `next`, shared with
      `signInAction`. The link authenticates before it forwards, which is what
      makes an unchecked destination worth more than an ordinary phishing link.
- [x] Success signs out all other sessions (`scope: "others"`).
- [x] Auth surfaces share one `AuthShell`, and `PasswordRulesList` is now one
      component instead of a copy in each password form.
- [x] 18 new unit tests; `npm run verify` green at 355.

> Two Supabase dashboard settings are load-bearing and both fail silently:
> the recovery template must use `{{ .TokenHash }}`, and custom SMTP must be
> configured or resets are throttled to a handful an hour project-wide. See
> [DEPLOYMENT.md](DEPLOYMENT.md#4-supabase-auth).

#### Palette reconciliation ✅

`/` was rebuilt monochrome in Phase 7 and the app was left teal, so signing up
walked a visitor out of one product and into another. Resolved in one pass, as
the note promised, rather than drifting further.

- [x] **Teal removed from the codebase.** The production CSS bundle contains
      the string zero times. `/login`, all of `/dashboard/*` and `/master`.
- [x] **Three grey ramps became one.** 819 `neutral-*` uses (dashboard, booking,
      shared UI) and 83 `slate-*` uses (`/master`) swept to `zinc`, which is
      what `/` already used. A card on the dashboard and a card on the landing
      page are now the same colour rather than nearly the same colour.
- [x] Primary actions are solid ink and invert wholesale in dark mode —
      **contrast is the accent** when there is no accent hue. Measured on
      `/login`: 19.06:1 both schemes, 19.9:1 secondary link, 10.44:1 field label.
- [x] `--brand-gradient` reserved for *active* or *recommended*: the current nav
      item, the current setup step, the recommended tier, the upgrade path, the
      wordmark stop. White on its three stops measures 7.10 / 6.29 / 6.70.
- [x] `btnAccent` added **separate from** `btnPrimary`, so a save button can
      never become a gradient. That is how an accent turns into a theme.
- [x] Six hand-rolled buttons and inputs pulled onto the shared tokens instead
      of being recoloured in place — a recolour would have left the same copies
      to drift again.
- [x] `StatusChip` keeps amber / rose / emerald: those are **semantic**, read
      without a legend, and greying them would delete information. Only
      `confirmed` moved, teal → indigo, the gradient's mid stop.
- [x] Per-business `--accent` on `/[slug]` deliberately untouched. Verified in
      a browser that the demo tenant still renders its own cyan.

> The brand ramp is the *platform's* identity and `--accent` is the *tenant's*.
> Conflating them would have repainted every customer's booking page as a side
> effect of a marketing decision.

#### 8d — The payment provider *(needs the provider decision)*

- [ ] Concrete `BillingProvider` (Stripe, or Cardcom/Meshulam/Grow for native
      חשבונית מס). `getBillingProvider()` is the only function to change.
- [ ] `POST /api/billing/webhook` — signature-verified; the provider signature
      is the auth, not a bearer token. Idempotent on `provider_event_id`, and
      calling the existing `activateSubscription()` rather than a second path.
- [ ] `payment_failed` → `past_due` + grace clock, reusing the sweep's states.
- [ ] Flip `check:env` to fail on a `console` billing provider in production.

#### 8e — Cost model

- [ ] `lib/cost-model.ts`, pure like `platform-metrics.ts`.
- [ ] Per-tenant usage query in `db/queries/admin.ts` (notification counts by
      channel, appointment volume).
- [ ] `/master` finance tab: **marginal** per-tenant cost reported separately
      from **fixed** platform overhead amortised across active tenants, plus
      break-even tenant count. A blended per-tenant number would be a confident
      fiction, and this is a screen a pricing decision gets made on.

---

**Definition of Done for MVP:** a business owner signs up, configures services and hours in under 10 minutes, shares `yourdomain.com/their-slug`, and a client books a real appointment from a phone — with both parties emailed and no double-booking possible. ✅ _Met — pending the production deploy and a pilot._
