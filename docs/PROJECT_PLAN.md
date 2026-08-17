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

> ⚠️ **This section is the original design sketch and has drifted a long way.**
> It predates migrations `0003`–`0020`, so it omits per-service buffers, the
> notifications outbox, rate limits, onboarding state, branding, subscription
> and trial columns, the whole of multi-staff (`staff`, `staff_schedules`,
> `appointments.staff_id`, `time_off.staff_id`), deposits, social links,
> `requires_approval`, and `push_subscriptions`.
>
> **`Frontend/src/db/schema.ts` is the source of truth**, and
> [ARCHITECTURE.md](ARCHITECTURE.md#database) documents the constraints that
> carry weight. Kept here for the original reasoning, not as a reference —
> including the last note below, which predicted the multi-staff change and is
> worth reading against what it actually took.

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
  > **How that actually went (0013).** The model held, but the guard above did
  > not: the exclusion constraint had to be **rekeyed** onto
  > `(business_id, staff_id)`, added while the old one still stood and dropped
  > only afterwards so the table was never unguarded. Its predicate was also
  > inverted to list the statuses that *release* a slot, which is what later
  > let two new enum values be added without naming them anywhere.

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

- [x] Playwright E2E: booking flow + dashboard verification + cancel flow. _(11 tests across 3 spec files in `e2e/`; self-cleaning via a marker phone number. Admin CRUD is still covered only by the PGlite suite, not through the browser.)_
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
| Multi-staff copy   | **Removed** — it did not exist at the time. ~~Superseded:~~ multi-staff shipped in Phase 9 and is now Basic-tier copy. |
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

**Production fix, after testing on the live domain.** Reset links landed on `/`
instead of the reset form.

- [x] **Root cause: the link never reached the app.** Supabase honours a
      `redirect_to` only when it matches its **Redirect URLs** allow-list, and
      silently falls back to **Site URL** when it does not. Landing on `/` is
      that fallback, so the three origins — `NEXT_PUBLIC_APP_URL`, Redirect
      URLs, Site URL — had disagreed since the domain changed.
      [DEPLOYMENT.md §4.0](DEPLOYMENT.md#40-url-configuration--get-this-wrong-and-every-emailed-link-goes-to-) now spells all three out with a symptom table.
- [x] `authRedirectOrigin()` replaces `pickAppUrl` for the emailed link. The
      share-link rule promotes the request origin when the env var is stale,
      which here produces a `redirect_to` that is *not* on the allow-list —
      one way to reach exactly this bug — and builds a password-reset link out
      of a request header, which is the classic reset-poisoning shape.
- [x] `/auth/confirm` writes the session onto the `NextResponse` it returns
      instead of mutating the ambient cookie store and throwing. The old form
      staked a single-use token on the framework flushing a mutated store onto
      a thrown redirect.
- [x] `route.test.ts` — 8 tests over the callback, including that the session
      cookies are on the 307 itself and that a rejected link carries none.
- [x] 13 more tests; `npm run verify` green at 368.

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

### Phase 9 — Product depth ✅

Everything between the palette reconciliation and the current head. Ordered as
it shipped; each bullet is one commit.

#### Multi-staff (0013–0018) ✅

- [x] `staff` and `staff_schedules`, `businesses.has_multiple_staff`, and
      `appointments.staff_id` NOT NULL with `ON DELETE RESTRICT` — history
      outlives the person. Backfilled one staff row per existing tenant.
- [x] **The exclusion constraint rekeyed on `(business_id, staff_id)`**, added
      while the old one still stood and dropped only afterwards, so the table
      is never unguarded for an instant. Its predicate is *inverted* — it lists
      the statuses that release a slot — which is what let 0014 add two enum
      values without naming them in a constraint.
- [x] `computeStaffSlots()` layers over `computeSlots()` rather than replacing
      it: every hard-won rule applies per person unchanged, and "a booking for
      A leaves the time open for B" falls out with no new logic.
- [x] Booking flow asks **the time first and the person second**, so step 2
      shows every time anyone can do. A single-staff tenant skips it silently;
      a team shop never does, even when only one person is free.
- [x] Per-staff time off (0016) via a **composite FK** on
      `(business_id, staff_id)`, so one tenant's closure cannot name another's
      staff. Phone, colour and portrait in 0017–0018.

#### Media uploads ✅

- [x] Browser → Supabase Storage directly, on a signed URL minted server-side
      after `requireWritable()`. The bytes never pass through Next: a Server
      Action body is capped at 1MB, and the browser has no Supabase session to
      authenticate with because the auth cookies are `httpOnly` by design.
- [x] Signed with the **service-role key** rather than the owner's session, so
      authorisation stays in one place. An RLS policy matching the path prefix
      against `auth.uid()` would be a second copy of "who owns this tenant" —
      and would silently break admin impersonation.
- [x] `admin-isolation.test.ts` resolves every import in `src/` and fails the
      build if a `"use client"` module reaches the admin client.
- [x] Video on the hero (mp4/webm, 25MB) with `autoPlay muted loop playsInline`.
      Bucket created by `npm run storage:setup`, **not** a migration — Storage
      lives in a schema PGlite does not have.

#### Availability fix ✅

- [x] **`staff_schedules` used to replace `working_hours`, not intersect it.**
      A provider whose row read 08:00–20:00 was offered 08:00–20:00 against a
      shop open 09:00–17:00, and a row on a closed weekday produced a fully
      bookable day out of nothing. `intersectShifts()` clips.
- [x] The inherit-or-intersect decision is made on the **raw row count**, so an
      empty intersection stays empty rather than being read as "no rows" and
      handing that person the whole day.
- [x] Cross-service blocking audited and found already correct — availability
      partitions by `staff_id` and never reads `service_id`. It lacked a test,
      which is what made it worth auditing.

#### "תורים באישור" (0019) ✅

- [x] A booking arrives as `pending` and **holds its slot** — non-terminal, so
      the exclusion constraint blocks it. A request that reserved nothing would
      be a request to be disappointed.
- [x] Three notification kinds rather than one status-aware template: by
      dispatch time a rejected request and a cancelled booking are both simply
      `cancelled`, so nothing in the row could tell them apart.
- [x] The confirmation screen changes wholesale — amber and an hourglass, no
      calendar download. Someone who skims a green tick has been told they have
      an appointment, and turns up.
- [x] Requests render **above** the agenda, because the agenda shows one day and
      a request can be for any day.

#### Client self-service ✅

- [x] `/[slug]/my-appointments` — phone lookup, upcoming and past, cancellation
      reusing `cancelBookingAction` with the token the lookup returns.
- [x] **A phone number is not a credential**, and the docs say so. Mitigated
      with the tightest non-auth rate limit in the app, tenant-scoped results
      proved by test, and `noindex`. The upgrade path is an OTP once SMS exists.

#### Dashboard depth ✅

- [x] One unsaved-changes bar replacing five per-section save buttons.
- [x] `/dashboard/analytics` — wall-clock heatmap (`AT TIME ZONE`, DST-proved),
      services, staff load, status split, trend. No charting library.
- [x] `/dashboard/agenda/full` — week grid where a custom block is a `time_off`
      row, so it blocks client bookings with no new blocking logic.
- [x] Mobile navigation: every dashboard page reachable from a phone, with
      `nav-coverage.test.ts` failing the build if one is not.

#### Tier line moved ✅

- [x] **Custom branding moved from Pro to Basic.** The cheapest paying tenant
      should not have a booking page in somebody else's colours.
- [x] Pro is now the three things that cost per tenant: analytics, message
      delivery, human setup time.
- [x] The analytics paywall ships **invented sample numbers**, not the tenant's
      figures behind a blur — a blur is a visual effect, not an access control.
      The page gates before it queries, asserted by test.

#### Messaging ✅

- [x] `WhatsAppService` over two backends. Green API preferred because the
      official Business API needs a Meta-approved template for a message the
      shop sends first, and Green API drives the shop's own account.
- [x] Reminders planned from the **lead time**: ≥30h ahead → 24h before,
      otherwise 2h before. The brief left 24–30h undefined; ordered thresholds
      matched longest-first close it, because a gap here sends nothing silently.

#### PWA + push (0020) ✅

- [x] Manifest opening on `/dashboard` — whoever installs this is an owner.
- [x] **A service worker that caches nothing.** For a booking app stale is
      worse than offline: an owner who sees a cached slot books over it.
- [x] One subscription row per **device**; the tenant flag is separate so
      toggling notifications never re-triggers a permission prompt that can
      only be refused once.
- [x] Push is deliberately **not** in the outbox — it is a nudge whose value
      expires in a minute, and the booking is on the dashboard either way.
- [x] `push_subscriptions` with RLS and an owner policy. The RLS test caught the
      omission before review did.

#### Marketing ✅

- [x] Proof strip, six interactive feature cards, and an install guide split
      iOS/Android — the two platforms genuinely differ, and on iOS Safari will
      not offer notification permission until the app is on the home screen.

> **`npm run verify` is green at 644 tests across 50 files**, up from 337 at
> the start of this phase.

### The E2E suite, and the soft 404 it was hiding ✅

The two long-standing red specs are fixed, and fixing the second one turned out
to be a product defect rather than a test defect.

- [x] **The stale slot selector.** `getByRole("radiogroup", { name: "בחירת שעה" })`
      named something that existed only in `e2e/`: the picker was rewritten to
      group slots into morning/afternoon/evening, each radiogroup labelled by
      its own heading — and those headings carry a count, so none of them has a
      stable name. The rendered slot list is now a `group` with that label,
      which the day strip has always had and the time area never did. It is
      rendered **only when there are slots**, so the helper's wait still means
      "the fetch finished with something to show" rather than settling on the
      skeleton.
- [x] **A third breakage, which the first was masking.** Once the flow got past
      the slot step it failed on the confirmation screen: the helper read the
      first `<dl>`, and the date and time had moved out of that list into the
      hero block above it — and swapped order, time first. Now matched
      independently rather than as one ordered pattern, because order is
      presentation and the helper wants two values.
- [x] **An unknown slug returns a real 404.** Resolved in `proxy.ts` before the
      response streams, which is Next's own documented remedy. Three-way path
      classification so a path that *cannot* be a slug costs no query; a
      bounded cache with separate maps for hits and misses; fails open on a
      database error. Full reasoning in
      [ARCHITECTURE.md](ARCHITECTURE.md#unknown-slugs-return-a-real-404).
- [x] `public-slug.coverage.test.ts` fails the build when a new top-level route
      is not declared, because `/[slug]` is a root segment and `src/app/pricing`
      would otherwise be 404'd by the proxy in production only.
- [x] 62 new unit tests; `npm run verify` green at **706 across 54 files**.
      Playwright green at 7 passed / 3 skipped — the dashboard specs need
      credentials for the account that actually owns `demo-barber`.

> **The docs had the SEO framing wrong and it is corrected in place.** The soft
> 404 was described as "what gets an empty page indexed", but `generateMetadata`
> already returns `noindex` for a missing slug and Next's guidance is that the
> meta tag is what prevents indexation while streaming. The real cost was that
> analytics could not tell a dead link from a live page, and every bot probe of
> the domain got a 200.

### Single-staff shops book only their primary provider ✅

Reported as "the slot grid jumps by five minutes". The step was never the
problem — it is `duration + buffer`, tested since Phase 1. `has_multiple_staff`
was documented as a UI switch, so availability read the **whole** roster even
for a shop that had answered "no", and a shop can legitimately hold other active
rows because collapsing back to one chair does not delete people with history.

- [x] `getAvailableSlotsWithStaff` evaluates only the primary provider when the
      flag is off. Applied above the engine — `computeStaffSlots` still just
      unions the list it is handed, so no tenant setting reaches the cursor walk.
- [x] `primaryStaff()` is the single definition of who that is, shared with
      `getDefaultStaff`, so availability and manual booking cannot disagree
      about who takes a booking.
- [x] **Two bugs, one cause.** A secondary provider's hours also widened the
      public page, and `createBookingAction` takes `freeStaff[0]` — so a booking
      could be assigned to someone the owner had stopped counting.
- [x] `/[slug]` filters the roster it ships to the browser by the same rule.
- [x] A team shop is untouched: its interleaved grid is real availability, and
      snapping it to a common grid would hide bookable times. Asserted in both
      directions from one fixture.
- [x] Two existing tests were exercising the incoherent state (two active staff,
      flag off) and now declare `team: true`, which is what they meant.
- [x] `npm run verify` green at **711 tests across 54 files**.

### Web push requires a real VAPID subject ✅

- [x] The hard-coded `mailto:` fallback is gone. The `sub` claim is how a push
      service reaches *the operator* (RFC 8292 §2.1), the domain in a constant
      need not belong to whoever deployed the code, and defaulting it made a
      missing variable invisible — the first symptom would have been a push
      service dropping traffic with `check:env` green.
- [x] Validated as `mailto:` / `https:`, with the `.env.example` placeholder
      **rejected by name**: it is structurally a valid `mailto:`, so nothing
      else would catch it.
- [x] One validator, shared by `check:env` and the runtime. Two copies would let
      a green deploy check coexist with a runtime that refuses; a test asserts
      they agree.
- [x] Half-configured push is an error in every mode, like email — `push:keys`
      prints all three lines at once, so two-of-three is a bad paste.
- [x] `check:env` reports `push → live` / `push → off`, because from inside the
      product a half-configured trio looks identical to an unconfigured one.
- [x] 22 new unit tests; `npm run verify` green at **733 across 55 files**.

### iOS safe areas actually apply now ✅

- [x] **Root cause: `viewport-fit=cover` was missing.** Five components already
      had `pb-[env(safe-area-inset-bottom)]` and every one was a no-op — iOS
      reports zero insets unless the viewport opts in, so the padding was real
      CSS computing to nothing.
- [x] The status bar is claimed back on `body`, scoped to
      `display-mode: standalone` — the topmost dashboard element is not fixed
      (banners can precede the nav), and padding it in a browser tab would push
      the landing hero down for nothing.
- [x] The bottom bar insets itself with its background still reaching the edge,
      floored at `0.25rem`; `main` clears `6rem + inset`.
- [x] `pwa.test.ts` asserts the viewport flag, because deleting it silently
      re-breaks all five.
- [x] `npm run verify` green at **737 across 55 files**.

> Compiled CSS, the meta tag and the absence of horizontal overflow are
> verified. The insets are zero in every browser available here, so the
> on-device result still wants a look on a real iPhone with the app installed.

### Client win-back automation (0021) ✅

The only marketing message the product sends, and it is built as one rather
than as another notification kind. סעיף 30א לחוק התקשורת treats "we have not
seen you in a while" as דבר פרסומת: prior explicit consent, an identifiable
sender, a working opt-out.

- [x] **Four gates, none of them sufficient alone**: the plan
      (`clientRetention`, Pro), the owner (`retention_enabled`, default false
      and never flipped by an upgrade), the client (a consent checkbox that is
      unticked and rendered only when the campaign is on), and the suppression
      list.
- [x] Consent lives on `appointments` and the **latest** booking wins, so
      leaving the box unticked next time withdraws it with no form and no
      support ticket. Never backfilled to true.
- [x] `checkInactiveClients` ships as `runRetentionSweep`, riding the daily
      cron beside the billing sweep and before dispatch, so a message queued
      this morning goes out this morning. Wrapped so a marketing failure can
      never stop a booking confirmation.
- [x] **Dedupe key is the lapsed appointment**, so a client who never returns
      gets exactly one message ever. A time-bucketed key would re-send on a
      schedule, which is what everyone means by spam. Capped at 25 per tenant
      per run, because the first run after switching on is otherwise a bulk
      send from the tenant's own number.
- [x] WhatsApp only, with **no console fallback** — the usual fallback would
      leave an owner believing a campaign is running while nothing is sent.
- [x] Re-checked at dispatch: rebooked clients and later opt-outs are skipped.
- [x] `marketing_opt_outs` makes the opt-out line a promise rather than a
      sentence. Scoped per business — consent is given to a shop, not to the
      platform.
- [x] The RLS test caught the new table before review did, again.
- [x] Landing page gains a seventh feature card, and its copy names the consent
      and the opt-out — the owner's first question is whether this makes them
      look like a spammer to their own customers.
- [x] 21 new unit tests; `npm run verify` green at **758 across 56 files**.

> **Migration `0021` has not been applied to any database.** It is additive —
> two defaulted columns, one table, one enum value — but it is not automatic on
> deploy. `npm run db:migrate`.

> **Still open: nothing reads inbound WhatsApp.** A client replying "הסר" is
> currently acted on by the owner rather than automatically;
> `addMarketingOptOut` is the call a webhook would make.

### Proof strip rebuilt as a glass card ✅

- [x] A `rounded-3xl` card inset on the page with a blurred halo of its own
      colour behind it, instead of a full-bleed band whose seam against the
      hero read as a second section starting.
- [x] **Dark glass, not white.** `bg-black/20` with a bright hairline, because
      a white scrim on a mid-toned mesh washes it out *and* costs contrast: it
      would drop white text to 4.54:1 and the detail line to ~3.1:1.
- [x] **Fixed a live AA failure.** The old strip put `text-white/70` straight on
      the mesh at **3.55:1**. It is now 5.05:1, with white at 7.59:1, both
      measured at the mesh's lightest composite.
- [x] Verified in a browser: three tiles, 3-up on desktop and stacked on mobile,
      inset 20px at 375px with no horizontal overflow and no console errors.

### Availability rebuilt on free windows ✅

The cursor walk fused "where is there free time" with "where may a slot start",
so a scattered day could not be asserted on. Now two steps: interval subtraction
produces free windows, then a packing rule places candidates inside them.

- [x] `mergeIntervals` / `subtractIntervals` / `freeWindows` exported and tested
      on their own, so the hole between a 10:00 and a 12:00 booking is a value.
- [x] **Single-staff packs densely** from each window's own start — a gap that
      opens at 09:35 is offered at 09:35.
- [x] **Multi-staff snaps to a lattice** anchored on the day's local midnight,
      so providers whose free time starts at different minutes still line up.
      This **reverses** the earlier "leave a team's interleaved grid alone"
      call, at the user's direction; the density it costs buys a readable column.
- [x] `slot_interval_min` is the lattice and is load-bearing again — the
      "live-looking setting that changes nothing" ARCHITECTURE.md warned about.
      GCD is the fallback only, floored at 5m because `gcd(15,20,30,45)` is 5
      and would recreate the five-minute noise this engine exists to remove.
- [x] Variable service lengths, scattered mid-day gaps, two-sided buffers and
      aggregated multi-service durations all covered — 31 new pure tests plus
      three through the real query path.
- [x] `npm run verify` green at **792 across 57 files**.

> **The boundary test is `start + duration <= end`, not
> `start + duration + buffer <= end` as specified.** The buffer is folded into
> the blocked intervals instead, which is the same rule stated once. Adding it
> to the test as well would double-count it after a booking and invent it at
> closing time, deleting the last slot of every day.

> **Multi-service aggregation is engine-ready, not shipped.** `durationMin`
> accepts a total and a test proves the gap arithmetic, but `appointments` holds
> a single `service_id` and no UI selects add-ons.

### The Playwright suite is green end to end ✅

- [x] **10/10 for the first time**, dashboard specs included.
- [x] The helper now walks the **staff step** — `demo-barber` has two active
      providers, so its public flow is four steps and the helper knew three. It
      handles both the picker and the sole-provider card, since which appears
      depends on who is free at the chosen time.
- [x] Two long-standing latent test bugs fixed: the picker locator resolved to
      the reviews list rather than the staff list, and the upcoming-booking
      assertion matched only the **plural** wording — so it could only ever pass
      when the calendar held two or more upcoming appointments, and the suite
      creates exactly one.

> A `/b/[token]` failure during this pass turned out to be a **stale dev
> server**, not a defect: it 404'd valid tokens until restarted, while the same
> query returned the row out of process. Worth knowing before debugging the
> query next time.

### Calendar legibility, last-visit truth, hero contrast ✅

- [x] **Week calendar.** The hour row went 56px → 80px from a shared constant
      (the rail and the columns must agree or the week shears). Under 30 minutes
      a card is one row rather than two clipped half-lines; 30+ is two. Solid
      fills became translucent cards with a 4px accent bar — staff colour where
      a legend exists above the grid, status colour otherwise.
- [x] **Hover card** with client, phone, service, price, staff, status and
      call/WhatsApp links. Positioned `fixed` at the calendar root: the grid's
      `overflow-x-auto` clips both axes, and the cards' own `backdrop-blur`
      would re-trap a fixed descendant. Opens on focus too, and the native
      `title` stays as the pointer-free fallback.
- [x] **Last visit ignores cancellations, no-shows and the future.** It was
      `max(starts_at)` over everything. The column is now nullable — "טרם הגיע"
      — with `NULLS LAST`, because Postgres sorts nulls first under `DESC`.
      10 new tests. On the live demo tenant, all 16 clients showed a date before
      and none of them had ever been in.
- [x] **Hero banner.** `hero-particles.tsx` deleted along with the dot grid;
      `.hero-obsidian` replaces `.brand-mesh` there at **11.51:1** against white
      (was 5.51), and 9.15:1 through the glass wall.
- [x] `npm run verify` green at **802 across 58 files**; Playwright 10/10.

> **The hero had no glass wall to keep.** The brief asked to retain one; the
> wordmark sat directly on the mesh. One was added to match the intent, with the
> text content and the panel's dimensions unchanged.

### Calendar views, nav fixes, booking-page polish ✅

- [x] **Hero reverted.** The darker ramp and glass wall are gone; the panel is
      `.brand-mesh` with the dot grid and the Canvas bubble field, exactly as it
      was. `.obsidian-mesh` survived the round trip and moved to the proof strip.
- [x] **Proof strip has no pattern and a deep panel.** Dots removed; the glass
      flipped from dark to light with the base, measured at **9.15:1** for white
      and **6.00:1** for `white/75` — better than the 7.59 / 5.05 it replaced.
- [x] **"יומן מלא"**, renamed from "לוח שבועי" and rendered in the brand
      gradient at a larger size — the one recommended action on the agenda,
      where it was previously indistinguishable from "share the link".
- [x] **יומי / שבועי toggle.** Same grid over a different column count, so
      there is no second implementation of lane assignment or placement. The
      view lives in the URL; `week` travels with it. The day view runs 112px an
      hour and draws **solid** cards — the opposite of the week rule, because
      one wide column has nothing to compete with.
- [x] **The "עוד" sheet no longer reopens itself.** Derived-from-pathname state
      resurrected on the way *back* to the route it was opened on. Now a boolean
      reset during render. **Verified end to end** in a browser at phone width.
- [x] **Gallery moved above the booking flow** and rebuilt as a snapping
      horizontal rail — it used to sit below the steps, where a first-time
      visitor reached it only after deciding.
- [x] **Footer CTA** on `/[slug]`: "רוצה עמוד כזה לעסק שלך? לחץ כאן" → `/`.
- [x] `npm run verify` green at **802 across 58 files**.

> **The brief located the gallery work at `/b/[token]`.** That route is the
> client's cancellation page and has never had a gallery; the description
> matches `/[slug]`, the public booking page, which is where both changes
> landed.

### Staff cleanup, notes badge, instant calendar ✅

- [x] **Single-staff mode deactivates the rest.** The toggle used to change only
      the flag, leaving the roster and a calendar column per person on screen
      while the concept was supposedly off. Reversible by design — nobody is
      deleted and no history moves.
- [x] **Delete staff**, gated on having no appointments. `ON DELETE RESTRICT` is
      the guarantee, not an obstacle: for anyone with history the action returns
      a sentence naming how many bookings they hold and points at deactivation.
      Two-step confirm, because it is the only control on that card that does
      not undo with the same click that made it.
- [x] **"ישנן הערות"** on agenda rows, pending requests and the calendar hover
      card — and **nothing at all** when a client left no note, which is what
      keeps the badge worth noticing. The note itself renders where there is
      room to read it.
- [x] **RTL arrows** swapped: back on the right, forward on the left. The
      chevrons pointed correctly but sat on the wrong sides.
- [x] **"חסימה חדשה" → "אירוע חדש".**
- [x] **Instant day/week transitions.** The server now always sends the week, so
      the toggle and steps within it are state changes rather than round trips
      — **measured at zero requests** across a toggle, a step and a return.
      Crossing a week boundary still navigates, via a real `<Link>` whose click
      handler cancels only when memory can serve it. Bounds, rows and lane
      assignment memoised; lane assignment is O(n²) per day and was re-running
      for all seven columns on every hover.
- [x] `npm run verify` green at **802 across 58 files**.

### `/master/alerts` reproduced and fixed ✅

The reported "Error 2407341431" was a **`RangeError: Invalid time value`** — an
error digest and a blank page, not an auth problem.

- [x] **Root cause: the driver returns an untyped aggregate as a string.** A
      bare `sql` fragment has no column type, so postgres.js hands back
      `"2026-08-04 12:44:56.938+00"` while the annotation claims `Date`.
      `Intl.DateTimeFormat.format()` coerces with `ToNumber` → `NaN` → throw.
      The truthiness guard in front of it passed, because a string is truthy.
      PGlite parses it into a `Date`, so no test could have caught it.
- [x] `queries/sql-types.ts` holds `toDate`, applied at every boundary that
      returns such an aggregate. **`.mapWith()` was tried first and does not
      work in that position** — the clients-directory tests caught it.
- [x] The page also formats defensively now: one unparseable value costs a dash
      in one row, not the console an operator opens *because* something is wrong.

> **Surfaced by the fix:** the alerts page shows **7 failed sends**, all Resend
> 403 "You can only send testing emails to your own email address". Client mail
> is not being delivered in production — a domain needs verifying at Resend.

### Phone-keyed client profile (0022) ✅

- [x] `client_profiles`, keyed on `(business_id, client_phone)` — the identity
      the rest of the product already uses. Keying on the name would merge two
      people called דני and split one who typed their name two ways.
- [x] Per business, never per platform; asserted by a test.
- [x] Upsert on the unique key, so two open tabs cannot race into a constraint
      violation.
- [x] A drawer on `/dashboard/clients`: visits / cancellations / no-shows,
      a "העדפות והערות" field, and the full booking history with statuses.
      History and stats load **on demand**; the list carries only a marker.
- [x] The calendar hover card shows the saved preferences, labelled and tinted
      apart from the booking's own note — one is a request for today, the other
      is what the shop knows about the person.
- [x] 13 new query tests; `npm run verify` green at **815 across 59 files**.

> **Migration `0022` is applied** — verified against the live database.

### The driver gap is enforced, not remembered ✅

- [x] `db/queries/sql-types.coverage.test.ts` — the same mechanical-coverage
      pattern as `nav-coverage` and `dashboard-session.coverage`, aimed at the
      one bug class this suite structurally *cannot* catch, because PGlite
      parses what postgres.js hands back as a string.
- [x] Two rules over every keyed `sql<…>` selection in `src/`: an annotation of
      `Date` must pass through `toDate` in the same file, and an annotation of
      `number` must carry a cast the driver decodes as one.
- [x] The second rule had **no prose anywhere before now**: `count(*)` is
      `int8`, which postgres.js returns as a *string* rather than lose precision
      past 2^53 — so an uncast count annotated `number` yields `"51"`, and
      `+ 1` yields `"511"`. Every count in the repo was already `::int`; that is
      now a rule rather than a habit. `int8` and `numeric` are deliberately
      absent from the accepted-cast list, because casting to either fixes
      nothing.
- [x] Verified the way the other coverage tests were — by breaking two real call
      sites (`toDate` on `listClients`, `::int` on the analytics weekday bucket)
      and confirming it named both, then restoring them.
- [x] Every current call site was already correct, so this is regression
      insurance rather than a fix. That is the point: the next one would have
      passed every test here and failed only in production.

### Booking page: an elevation system, and a stability rule ✅

A visual-only pass over `/[slug]` — CSS, typography, spacing, shadows and
micro-motion. No state, hooks, actions, props or data flow were touched, and
every accessible name, role and string is unchanged, which is what let the
Playwright suite stay the check on it.

- [x] **Four shadow tokens in `@theme inline`**, so they compose through
      `--tw-shadow` instead of being clobbered by a focus ring. `--shadow-accent`
      resolves the *tenant's* colour at the element — verified in-browser as
      `oklab(0.511 0.032 -0.260)` on the demo shop rather than the token default.
- [x] **A typographic scale where there was one size**: 32px business name,
      17px section headings, 15px body and controls.
- [x] **`text-zinc-400` was failing AA at 2.6:1** on real text in five places —
      stepper labels, slot period counts, review dates, the footer and every
      input placeholder. All at `zinc-500` (4.6:1) now. A scripted pass over
      every rendered text node returns zero failures in light *and* dark.
- [x] **Geometry never animates on a click target.** Hover lifts plus
      `transition-all` took the E2E suite red on `element is not stable`:
      Playwright hovers before it clicks, so the pointer starts a 200ms
      transition and the click lands mid-flight — the same window a real tap
      lands in on a device that fires hover first. Hover now deepens the shadow
      and moves nothing, press snaps untransitioned, and the one lift left is
      the selected day chip's, applied instantly as a state.
- [x] The footer platform CTA is a designed panel rather than a 12px underlined
      link, following the decision that `/[slug]` is **genuinely dual-purpose**.
      It stays monochrome and stays last, so it cannot compete with the shop's
      own call to action.
- [x] `npm run verify` green at **819 across 60 files**; Playwright **11/11**.

> **Screenshots were not available for this pass** — the Browser pane was not
> displayed, so nothing could composite frames. Verification was done against
> the DOM and computed styles instead, which is the stricter path for contrast
> and token resolution, plus the full Playwright run for the interactive flow.
> The rendered composition still wants a human eye.

### "ליבי" — Hebrew voice booking ✅

A microphone beside "תור ידני" on `/dashboard`. The owner speaks; Libi extracts
the fields, asks in Hebrew for what is missing, and books through the existing
manual path.

- [x] **The browser does the audio, Claude does the meaning.**
      `webkitSpeechRecognition` at `he-IL` — no recording leaves the device, no
      per-minute cost, and only a short string reaches the server. The price is
      browser support, so the control removes itself on Firefox rather than
      failing on click.
- [x] **`parseVoiceAppointment` writes nothing.** It returns a draft;
      `createManualBookingAction` still does the booking, so voice adds no
      second path into `appointments` and inherits the exclusion constraint,
      staff resolution and notification dispatch unchanged.
- [x] **Multi-turn, because `client_phone` is NOT NULL** and is the identity the
      clients list, `client_profiles` and the win-back campaign are all keyed
      on. A placeholder number would merge distinct people; Libi asks instead.
      A null never overwrites a gathered value, or the conversation could never
      finish.
- [x] **She never reopens the microphone herself.** Each turn needs a press —
      an assistant that reopens the mic on its own is listening to a room the
      owner did not agree to have listened to.
- [x] **The model is not trusted with what it cannot be trusted with.**
      `serviceId` is re-matched against the tenant's catalogue, `missingFields`
      is recomputed server-side, and `startLocal` stays a **wall clock** for
      `fromZonedTime` — a model doing timezone arithmetic is wrong twice a year,
      silently.
- [x] `claude-opus-5` at **`low` effort**, adaptive thinking left on. The model
      is not downgraded for cost — a mis-parse books the wrong person — and
      effort is where the latency/cost lever belongs. Structured outputs over
      the same Zod schema the server validates with, so grammar, validator and
      type cannot drift.
- [x] **Pro-gated** (`voiceAssistant`), re-checked inside the action rather than
      only at the button, and gated again on `ANTHROPIC_API_KEY`. No console
      fallback: a fake parse would invent an appointment or refuse everything.
- [x] `libi-isolation.test.ts` keeps the key out of the browser, mirroring
      `admin-isolation.test.ts`. Verified by adding the forbidden import and
      confirming both assertions named the file.
- [x] 20 new unit tests; `npm run verify` green at **839 across 62 files**.

> **Unproven on a wire.** No real utterance has been parsed — this environment
> has no `ANTHROPIC_API_KEY` and no microphone. The logic, the isolation and the
> gates are tested; the model call and Hebrew STT accuracy are not.

> **`/legal/privacy` does not yet name a model provider as a processor.** A
> transcript can carry a client's name and phone. No audio is sent and nothing
> extra is stored, but the privacy text should say so before this runs against
> real client data.

### Manual tier changes from `/master` ✅

- [x] `updateTenantPlanAction` beside the trial extension: a select between
      בסיסי and מקצועי, guarded by `requireSuperAdmin()` re-run inside the
      action, audited under `master.tenant.plan` with the admin's own id.
- [x] **Writes `plan_type`, never `subscription_status`.** A support control
      that could mark a tenant `active` would be inventing revenue — the thing
      the console billing provider refuses to do in production.
- [x] **`free` is unassignable.** It is the degraded state a non-paying status
      produces, not a tier anyone is put on; offering it would manufacture a
      state indistinguishable from a lapsed subscription. The enum derives from
      `ASSIGNABLE_PLANS`, so a third tier needs no second list.
- [x] **The table now shows the served tier beside the stored one.** Changing a
      *trialing* tenant's plan is invisible by design — a trial already grants
      `TRIAL_PLAN` — and without saying so the control reads as broken.
- [x] `planLabel()` derives Hebrew names from `PRICING_TIERS`, so the console
      and the pricing page cannot name the same tier differently.
- [x] 10 new tests against real Postgres, including the CHECK constraint
      rejecting a tier pushed past the type, and a trialing tenant's
      entitlements being identical before and after.
- [x] `npm run verify` green at **849 across 63 files**.

### Entitlement names, and the three Meta templates ✅

- [x] **Starter owns the whole design surface** — branding, landing content and
      calendar management are ungated above Starter, and a test now asserts it
      from the shape of the type rather than one key, so a future
      `customLandingPage: false` for Starter fails rather than ships.
- [x] **Starter blocked from WhatsApp, analytics and Libi**, which is what it
      already was. **No tenant's access changed in this pass.**
- [x] `whatsappReminders` → `canSendWhatsapp`, `advancedAnalytics` →
      `canAccessAnalytics`, `voiceAssistant` → `canAccessLibi`. The first is a
      real correction: it is the flag `clientDelivery()` reads, so it has always
      gated the confirmation, approval, rejection and cancellation too.
- [x] **The three approved templates** (`appointment_confirmation`,
      `reminder_24h`, `reminder_2h`) in `whatsapp-templates.ts`, with five
      positional parameters shared across all three — Meta freezes `{{n}}`
      numbering at approval, so the order is pinned by test.
- [x] **A blank field becomes `—`, never `""`** — the Cloud API rejects an empty
      body parameter, so a shop with no address would have every templated
      message fail rather than arrive without a location.
- [x] **Which reminder template is derived, not stored.** `leadHoursFor` recomputes
      it from `starts_at` and `scheduled_for`, so no migration and no second
      source of truth.
- [x] **No template is a real answer.** Kinds Meta never approved, and any lead
      that is not 24h or 2h, return null — deliberately not a nearest match, since
      rounding 36h onto `reminder_24h` would say *tomorrow* a day and a half early.
      Twilio then refuses rather than posting free text Meta drops silently.
- [x] 21 new tests; `npm run verify` green at **870 across 64 files**.

> ⚠️ **The reminder boundary moved from 30h to 24h, reintroducing what the 30h
> floor prevented.** A booking made 25 hours ahead is now reminded **one hour
> after it was made**. It moved because the approved copy is `reminder_24h` /
> `reminder_2h` and the spec ties the boundary to it. The fix, if it bites, is a
> minimum gap between booking and reminder — not moving the boundary back, which
> would strand 24–30h bookings on a template whose text no longer matches. A test
> pins the one-hour gap so it stays a known trade.

> **Unproven on a wire.** No template has been sent. Twilio addresses them by
> Content SID (`TWILIO_TEMPLATE_*`), and this environment has no Twilio account
> — the mapping, the parameter order and the refusal path are tested; the
> Meta round trip is not.

### `/master` tenant status, fixed ✅

Three symptoms, one cause: the console answered "what is this tenant served"
from `plan_type` and `subscription_status` while ignoring the freeze flag, and
the trial extension moved a clock nothing else read.

- [x] **A freeze now outranks everything.** `effectivePlan` returns `free` when
      `is_active` is false, ahead of the trial and the paid tier — a frozen
      tenant used to resolve to `pro` while the status pill beside it said
      frozen. There is **no `frozen_at` column**: a freeze is `is_active = false`
      plus `frozen_reason` of `admin` or `billing`.
- [x] **Extending a trial writes the status, not just the clock.** Pushing
      `trial_ends_at` forward on a lapsed tenant left them `past_due` with a
      grace clock running, so the console went on saying "מושהה" and nothing an
      admin could see had changed. It now sets `trialing`, clears
      `grace_started_at`, and lifts a **billing** freeze — all in one statement,
      for the reason the sweep states.
- [x] **An admin freeze is never lifted as a side effect.** Only
      `frozen_reason = 'billing'` comes back on a trial extension; an admin
      freeze is a deliberate act and `setTenantActiveAction` is where it is
      undone.
- [x] **`setTenantActive` moves `frozen_reason` with the flag.** It previously
      left the old reason behind, so a hand-unfrozen tenant still looked
      billing-frozen to `canAutoUnfreeze` — meaning a later admin freeze could
      be lifted automatically by a payment.
- [x] **The plan cell says *why*.** "מושהה" has three causes with three
      different fixes; the reason is printed beside it, which is what stops
      "I unfroze them and it still says מושהה" — unfreezing a `past_due` tenant
      genuinely leaves them served nothing.
- [x] 14 new tests against real Postgres, verified by reverting each fix and
      confirming the suite named it. `npm run verify` green at **880 across 64
      files**.

> **The consequence worth knowing:** analytics is the one *read* gated on an
> entitlement, so a frozen tenant now loses it. The calendar, client list and
> history are ungated and stay readable — which is what "reads stay open" has
> always meant in practice.

> **Caught by the suite, not by review:** ordering. `retentionBlockedReason`
> checked the entitlement before the freeze, so a frozen tenant started
> reporting "not entitled" — true, but it sends somebody to look at a plan that
> is fine. Frozen is checked first now.

> **The brief asked for `basic`; the column stores `starter`.** "Basic" is the
> display name — `0012` pinned the CHECK to `free|starter|pro`. Implemented as
> `starter` and labelled בסיסי.

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

---

## 5. Where things stand

_This section is the handover between working sessions — if it disagrees with
the code, the code is right and this is stale. Read it first._

**Green:** `npm run verify` at **903 tests across 64 files**; Playwright at
**11/11** across 3 spec files. All **23 migrations (0000–0022)** are applied to
the live database — fourteen tables, RLS on every one, twelve owner policies,
zero reachable by `anon`. **No migration is pending**; everything below is
application code.

### The three rules a new session most needs

**1. What a tier buys.** `lib/entitlements.ts` is the only place that decides,
and it is pure. Starter owns the entire design surface — branding, landing
content, calendar management are ungated. Pro adds the four things that cost
*us* per tenant:

| | starter (₪69) | pro (₪99) | trialing | frozen |
| --- | --- | --- | --- | --- |
| `customBranding` | ✓ | ✓ | ✓ | · |
| `smsReminders` | · | ✓ | ✓ | · |
| `canSendWhatsapp` | · | ✓ | ✓ | · |
| `canAccessAnalytics` | · | ✓ | ✓ | · |
| `clientRetention` | · | ✓ | ✓ | · |
| `canAccessLibi` | · | ✓ | ✓ | · |
| `prioritySupport` | · | ✓ | ✓ | · |

`effectivePlan` resolves in four steps, in order: **frozen → `free`**, trialing
→ `TRIAL_PLAN` (Pro), active → the stored tier, anything else → `free`. Frozen
outranks a live subscription *and* a running trial. Never read `plan_type`
without the status and the freeze flag — `entitlementsFor` takes the row for
exactly that reason.

**2. WhatsApp sends Meta templates on the official paths only, and the shapes
are transcribed from Meta, not designed here.** Three are approved on the
platform's own Business account:

| Template | Header | Body `{{1}}` `{{2}}` `{{3}}` | Button |
| --- | --- | --- | --- |
| `appointment_confirmation` | client name | business · 📅 date · ⏰ time | ✓ |
| `reminder_24h` | — | business · ⏰ time · 📍 place | ✓ |
| `reminder_2h` | — | business · ⏰ time · 📍 place | · |

**Each component is numbered from 1 independently** — that is why the approved
confirmation contains two `{{1}}`, one header and one body, filled from
different values. They do **not** share a parameter list; an earlier version
assumed they did and was wrong. The button's base URL was registered as
`https://www.bazman.app/` (no `b/`), so the parameter is a **bare cancel
token** and `proxy.ts` redirects `/{token}` → `/b/{token}`.

There are **three backends** now, preferred in this order: **Meta Cloud API**
(the account actually in use, templates by name) → Green API (free text, no
approval, unofficial) → Twilio (templates by per-account Content SID, no
account here). Both official paths **refuse** to send with no template rather
than posting text Meta drops silently. Reminder scheduling: booked more than
24h ahead → 24h before; 24h or less → 2h before; exactly 24h → nothing.

**3. `/master` shows the tier a tenant is *served*, not the one stored.** They
differ constantly — trialing, past_due and frozen all diverge — and the plan
cell prints the served tier plus the reason. Extending a trial now also sets
`subscription_status` back to `trialing`, clears the grace clock and lifts a
*billing* freeze (never an admin one).

### How a message actually gets out

**Both booking paths dispatch their own messages, both awaited inline.** A
failure never fails the booking either way. The public path briefly deferred its
send into `after()` so the confirmation screen could not wait on a provider —
better on paper, but it made delivery depend on the platform running deferred
work after the response, and a message quietly falling back to the cron is the
failure this change exists to remove. What makes awaiting safe is the 10-second
`AbortSignal.timeout` inside the Meta provider's fetch: a hung connection would
otherwise hold the booking response open until the platform killed it. A timeout
is retryable, so the row stays pending and the sweep collects it.

**`DISABLE_WHATSAPP_DISPATCH` is the cost guard.** Set it and no WhatsApp
message reaches the network: `whatsappProvider()` swaps the configured backend
for a stand-in that logs the full payload and refuses, and the dispatcher marks
the row `skipped` — never `sent`, so nothing reads as delivered. Fail-safe
parsing: **any** value other than `false/0/no/off` suppresses, because a typo
compared against `"true"` would have read as enabled and started billing.
`check:env --production` **fails** while it is set, since WhatsApp is the only
live client channel and a deploy carrying it would tell nobody anything.

**Emoji-adjacent template parameters are wrapped in U+200F.** `⏰ 16:00` has no
strong directional character, so the Bidi algorithm defaults it to LTR and iOS
rendered the clock on the wrong side. `anchorRtl()` in
`whatsapp-templates.ts` fixes date, time and address; the business name is left
alone because it sits mid-sentence after Hebrew.

That leaves the sweep responsible for **reminders, retries, billing warnings and
win-back** — and reminders are the ones that care, because `reminder_2h` targets
a precise instant. `vercel.json` is pinned to daily only to satisfy Vercel Hobby;
`.github/workflows/dispatch-notifications.yml` hits the same authenticated URL
every 15 minutes and is what makes reminders land. It needs two repository
secrets — `CRON_SECRET` (same value as Vercel's) and `APP_URL` (deployed origin,
no trailing slash) — and fails the run loudly if either is missing.

`check:env` now prints the resolved WhatsApp backend under **Delivery**
alongside email, push and billing, so "which of the three is live" is visible
without reading credentials.

### Why the dashboard felt slow, and what is left

Every agenda interaction — an arrow, a day/week switch, an appointment status
button — re-renders the whole route. That render used to make **three Supabase
auth round trips and two identical business lookups**: one auth call in the
proxy, one in the layout's freeze check, one in the page's `requireBusiness()`,
with a `getBusinessByOwner` beside each of the last two. `getUser()` is a real
network call to the auth server, deliberately, because `getSession()` trusts a
spoofable cookie.

React `cache` on `getCurrentUser` and on `businessForOwner` collapses the
layout's and the page's work into one of each, and
`request-dedup.coverage.test.ts` fails the build if either is unwrapped. It is
per-request only, so nothing is weakened — each new request still revalidates.

**Prefetching is not the remaining lever, despite looking like it.**
`/dashboard` has a `loading.tsx`, so Next prefetches only down to that boundary,
and the client cache TTL for dynamic routes is **off by default** — a
`prefetch={true}` payload would be fetched and then discarded. Making it stick
means `staleTimes.dynamic` in `next.config.ts`, which trades a live calendar for
speed: an owner stepping to tomorrow and back would see a cached "today" that
can be missing a booking made seconds ago. **Deliberately not enabled** — that
is a product call, not a performance one.

### The one thing that is broken in production right now

**Client email reaches nobody.** Resend rejects every recipient with a `403`
because the account has no verified domain, so it may only mail its own owner.
`/master/alerts` shows **7 failed sends**. Nothing in `check:env` catches this —
the key is present and valid — and from the owner's side the booking simply
worked. Verify a domain at resend.com → Domains and point
`NOTIFICATIONS_FROM_EMAIL` at it. See
[DEPLOYMENT.md](DEPLOYMENT.md#2-environment-variables).

### Blocked on a decision or an account, not on code

| What                | Needs                                                        |
| ------------------- | ------------------------------------------------------------ |
| Billing 8d–8e       | A payment provider chosen. `getBillingProvider()` is the only function that learns the name. |
| SMS                 | A Twilio account, or drop the SMS line from Pro in `lib/plans.ts` — `check:env --production` fails either way until one happens. |
| WhatsApp            | `WHATSAPP_PHONE_NUMBER_ID` + `WHATSAPP_ACCESS_TOKEN` from the platform's Meta app. The three templates **are approved**; the transport is code-complete and matched to their exact shapes, but no message has left on any backend. Green API or Twilio remain alternatives. |
| WhatsApp, the other five | Meta's template builder, which is currently refusing to create new templates. `cancellation_confirmation`, `booking_pending`, `booking_approved`, `booking_rejected` (all UTILITY) and `client_winback` (MARKETING) are drafted and unsubmitted. Until they exist those kinds are refused on the official path, and with SMS and email dark they reach nobody — a cancelled appointment currently tells the client nothing. |
| Voice ("ליבי")      | `ANTHROPIC_API_KEY`. With none the microphone is not rendered. Pro-gated. No real utterance has been parsed. |
| Web push            | Nothing — a VAPID trio is configured and `check:env` reports `push → live`. Unproven end to end: no notification has reached a real device. |
| Media uploads       | `npm run storage:setup` against the production project.       |
| Legal text          | An Israeli lawyer. `LEGAL_ENTITY` still holds placeholder ח.פ. and address fields. |

### Worth knowing before touching the data layer

A bare `sql` aggregate comes back from postgres.js as a **string** and from
PGlite as a `Date`, so the test suite proves the opposite of production. Convert
at the boundary with `toDate` from `db/queries/sql-types.ts`; `.mapWith()` does
not work in that position. This took `/master/alerts` down once already —
[ARCHITECTURE.md](ARCHITECTURE.md#testing).

**This is now enforced rather than remembered.**
`db/queries/sql-types.coverage.test.ts` fails the build when a `sql<…>`
selection annotated `Date` skips `toDate`, or one annotated `number` is not cast
to a type the driver decodes as a number — `count(*)` is `int8`, which
postgres.js hands back as a string for the same reason. Both rules were verified
by breaking a real call site and confirming the test named it.

---

**Definition of Done for MVP:** a business owner signs up, configures services and hours in under 10 minutes, shares `yourdomain.com/their-slug`, and a client books a real appointment from a phone — with both parties emailed and no double-booking possible. ✅ _Met — pending the production deploy and a pilot._
