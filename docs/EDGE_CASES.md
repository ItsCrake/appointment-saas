# Edge cases, and how far the tests actually go

Written for the beta pilot. Honest about what is proven, what is merely
plausible, and what cannot be tested with the current harness at all.

> **On "100% coverage".** There is no meaningful denominator for "all realistic
> edge cases", so a percentage would be theatre. What follows instead is a
> ranked list: every case named for the pilot, plus the ones found while looking
> for them, each marked with what actually holds it up. Read the **Residual
> risk** section last — it is the part that matters.

## 1. Double booking, and the race

**Status: proven, by the strongest mechanism available.**

`appointments_no_overlap_staff` — an exclusion constraint on
`(business_id, staff_id)` over the non-terminal statuses — is the only thing
preventing a double booking, and it runs inside the database whatever the
application believes. Every write to `starts_at`/`ends_at` goes through
`rescheduleAppointment`, so a violation surfaces as `SlotTakenError` rather than
a corrupt calendar.

| Covered | Where |
| --- | --- |
| A second insert on the same provider and time is refused | `db/cross-feature.test.ts` |
| A second provider at the same time is allowed | `db/cross-feature.test.ts` |
| A move onto another booking of the same provider is refused | `lib/reschedule.test.ts` |
| `force: true` cannot waive it | `lib/reschedule.test.ts` |
| The waitlist race leaves the loser `active` with a dead token | `db/cross-feature.test.ts` |

> ### ⚠️ True concurrency is not tested, and cannot be here
>
> The suite runs on **PGlite, which is a single in-process connection**. Two
> inserts wrapped in `Promise.all` serialise, so a "race" test would pass
> without ever racing and would be worse than no test — it would look like
> proof.
>
> What the sequential test proves is the constraint's *predicate*, which is the
> part application code can get wrong. What it cannot prove is behaviour under
> genuine contention. If you want that before the pilot it needs **two real
> Postgres connections** — a small integration test against a throwaway Supabase
> branch, not PGlite. Given the guarantee lives in the database rather than in
> our code, this is a low-value gap, but it should be a known one.

## 2. Daylight saving

**Status: was completely uncovered. Now the largest new suite —
`lib/availability-dst.test.ts`, 12 tests.**

Israel switches twice a year and no test in the repo used a transition date.
The exact 2026 instants, verified against the platform tz database:

| Transition | UTC instant | Local effect |
| --- | --- | --- |
| spring forward | `2026-03-27T00:00:00Z` | 02:00 → 03:00; local **02:00–02:59 does not exist** |
| fall back | `2026-10-24T23:00:00Z` | 02:00 → 01:00; local **01:00–01:59 happens twice** |

**The fall-back transition is the near one — 25 October 2026.** A pilot running
through the autumn meets it.

| Covered | Result |
| --- | --- |
| 09:00 lands at 06:00Z in spring, 07:00Z in autumn | ✅ correct |
| Same shop gets the same eight slots on both days | ✅ correct |
| A shift spanning the missing hour yields 2 slots, not 3 | ✅ correct |
| No slot is ever labelled `02:xx` on 27 March | ✅ correct |
| A shift spanning the repeated hour yields 5 slots, not 4 | ✅ correct |
| A 24h reminder stays 24 *real* hours across a transition | ✅ correct |
| Waitlist windows read the shop's wall clock, not a fixed offset | ✅ correct |

The engine came through this clean — `fromZonedTime` was already doing the right
thing. One genuine finding, documented rather than fixed:

> **Two distinct slots both render as `01:00` on 25 October.** A shop open
> across 01:00–02:00 that night offers two real, one-hour-apart instants with
> identical labels, and a client picking between them is guessing. Harmless for
> a pilot of barbers and nail salons; a real defect for any 24-hour venue. The
> fix is a disambiguating label on that one day, not a change to the instants —
> which are correct.

## 3. The waitlist against the clock

**Status: was partly covered. Now `lib/waitlist-timing.test.ts`, 8 tests.**

| Case | Status | Where |
| --- | --- | --- |
| Preferences filter independently; blank filters nothing | ✅ pre-existing | `lib/waitlist.test.ts` |
| Rejoining preserves the original `created_at` (FIFO) | ✅ pre-existing | `lib/waitlist-db.test.ts` |
| **Editing preferences while an invite is out keeps the invite, status and place** | ✅ **new** | `waitlist-timing` |
| **An edit cannot jump the queue ahead of a longer waiter** | ✅ **new** | `waitlist-timing` |
| **A cancellation 20 minutes out is still offered** | ✅ **new** | `waitlist-timing` |
| **The offer window clamps to the slot when the slot comes first** | ✅ **new** | `waitlist-timing` |
| **A slot already in the past is never offered** | ✅ **new** | `waitlist-timing` |
| **TTL `0` disables the shop's window but not the slot's own deadline** | ✅ **new** | `waitlist-timing` |
| **A slot the owner filled by hand is not re-offered** | ✅ **new** | `waitlist-timing` |
| **Another provider's booking at the same time is not a clash** | ✅ **new** | `waitlist-timing` |
| Expiry cycles to the next match; `expired` prevents the loop | ✅ | `lib/waitlist-expiry.test.ts` |
| Each tenant is swept against its own window | ✅ | `lib/waitlist-expiry.test.ts` |

**A known ordering wrinkle, not yet a test.** Two cancellations can offer
overlapping slots to the same person: the second `markWaitlistInvited`
overwrites the first and retires its token. If the first notification has not
yet been dispatched, it renders from the entry's *current* slot — so the client
receives two messages describing the same opening rather than one about each.
The immediate `dispatchDueNotifications` after each offer makes the window very
narrow, and the outcome is duplication rather than a wrong slot. Worth knowing
before a pilot shop reports "I got the same message twice".

## 4. Cancellation timing

**Status: covered at the policy layer, thin at the action layer.**

`getCancellationState` is pure and takes its clock as an argument, so the
window boundary is pinned in `lib/cancellation.test.ts`. The states that matter
— past, already cancelled, inside/outside the window — all resolve there, and
the page and the server action share the one function, so the button and the
enforcement cannot disagree.

Not covered: the **server action wrapper** around it. See the structural gap
below.

## 5. Owner overrides and off-hours

**Status: the safety property is proven. The decision table is not.**

`rescheduleAppointmentAction` distinguishes three outcomes — proceed, ask "are
you sure?" for a slot outside posted hours, and refuse outright for a
same-provider clash. The **refusal** is proven at the database layer
(`lib/reschedule.test.ts`), and that is the one that protects a client.

The *branching* — which message an owner sees, and that `force` waives shop
rules but never the constraint — is untested, because it lives inside a server
action.

> ### ⚠️ Structural gap: server actions are effectively untestable today
>
> Actions bind `db` and `requireWritable()` at module scope, so there is no seam
> to test them through, and none of the suite does. That covers
> `rescheduleAppointmentAction`, `setAppointmentStatusAction`,
> `createManualBookingAction`, `claimWaitlistSlotAction` and the settings
> actions.
>
> Everything they *delegate to* is tested — the queries, the policies, the pure
> rules. What is untested is the glue: ordering, branching, and which error
> string comes back.
>
> **Recommended fix, in order of value for the effort:**
>
> 1. Extract the reschedule decision into a pure function —
>    `classifyRescheduleRequest(...) → "ok" | "confirm" | "clash"` — and test
>    the table directly. Around an hour, and it covers the highest-traffic
>    branch in the product.
> 2. Leave the rest. The pattern that makes them untestable is also what makes
>    them small.

## 6. Residual risk for the pilot

Ranked by what is most likely to embarrass you in front of a real shop owner.

| # | Risk | Status |
| --- | --- | --- |
| 1 | **Client email reaches nobody.** Resend rejects every recipient with a `403` — no verified domain. Email is the *final fallback* in the channel walk, so a shop without WhatsApp or SMS reaches no one at all, and the booking looks fine from the owner's side. | **Blocker.** Verify a domain at resend.com and point `NOTIFICATIONS_FROM_EMAIL` at it. |
| 2 | **Six WhatsApp templates unapproved.** On the Meta path `booking_pending`, `booking_approved`, `booking_rejected`, `cancellation_confirmation`, `waitlist_invite` and `client_winback` are refused rather than sent — and now produce *failed* outbox rows, since credentials are live. | **Blocker for approval-mode shops.** See [WHATSAPP_TEMPLATES.md](WHATSAPP_TEMPLATES.md). |
| 3 | **`waitlist_invite` submitted against the wrong button base** would send every invite to a cancellation page. | Avoidable — register `https://www.bazman.app/w/`. |
| 4 | **The expiry sweep depends on a GitHub Actions workflow.** `vercel.json` is daily; the 15-minute cadence is external. If it stops, offers lapse but never cycle. | Monitor it. |
| 5 | **No UI has been checked in a browser** since the calendar rebuild. | One pass on a real tenant. |
| 6 | Two identical `01:00` labels on 25 October | Cosmetic unless a 24-hour venue joins. |
| 7 | True booking concurrency untested | Low — the guarantee is in the database. |

## 7. What this added

| File | Tests | Covers |
| --- | --- | --- |
| `lib/availability-dst.test.ts` | 12 | Both clock changes, across availability, reminders and waitlist matching |
| `lib/waitlist-timing.test.ts` | 8 | Cancellations near the slot, preference edits mid-offer, slots changing hands |

Suite total: **1154 tests across 77 files**, up from 1134/75.
