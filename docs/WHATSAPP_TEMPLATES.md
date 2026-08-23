# WhatsApp templates

What Meta has approved, what is still missing, the exact copy to submit, and how
much a pilot shop will actually send.

Read [`lib/notifications/whatsapp-templates.ts`](../Frontend/src/lib/notifications/whatsapp-templates.ts)
alongside this — it is the code that binds a template to a message kind, and if
the two disagree, the code is right.

## 1. Before you submit anything

Three rules that have already cost this project time, restated because a
template is frozen at approval and fixing one means resubmitting.

**Each component numbers its variables from 1 independently.** A header `{{1}}`
and a body `{{1}}` are different variables. That is why the approved
`appointment_confirmation` copy contains two `{{1}}` and why
`WhatsAppTemplateRef` carries `header` and `parameters` as separate arrays. A
flat parameter list cannot express it.

**An empty string is rejected for a body parameter.** Not ignored — the whole
send fails. Any field a tenant may have left blank goes through `filled()`,
which substitutes `—`. A shop with no address recorded still gets a deliverable
message rather than none at all.

**The URL button base is frozen at approval, and Meta appends only the tail.**
The base registered for the existing three is `https://www.bazman.app/` —
without `b/` — so the parameter is a bare cancel token and
[`classifyPublicPath`](../Frontend/src/lib/public-slug.ts) redirects
`/{token}` → `/b/{token}`. This is the half of the contract that lives on our
side.

> ### ⚠️ `waitlist_invite` must NOT reuse that base
>
> A waitlist invite belongs at `/w/{token}`, but its token is a `randomUUID()`
> exactly like a cancel token — the two are **indistinguishable by shape**, so
> the proxy cannot tell them apart and sends any bare UUID to `/b/`. Submitting
> `waitlist_invite` against the existing base means every invite button opens a
> cancellation page for an appointment that does not exist.
>
> **Register it with the base `https://www.bazman.app/w/` instead.** The base is
> per-template, so this costs nothing and needs no code change. `/w` is already
> routed: it is two segments, so `classifyPublicPath` returns `platform` and
> Next serves `/w/[token]` directly.

## 2. Audit — Meta vs. the code

Checked against the Meta dashboard on **2026-08-23**. Seven templates are
active; the code knows **three**.

| Meta template | Language | Code knows it | Kind it serves | Verdict |
| --- | --- | --- | --- | --- |
| `appointment_confirmation` | he | ✅ | `booking_confirmation` | **Working** — 2 sent in production |
| `reminder_24h` | he | ✅ | `reminder` @ 24h lead | **Working** |
| `reminder_2h` | he | ✅ | `reminder` @ 2h lead | **Working** |
| `booking_approved` | he | ❌ | `booking_approved` | ⚠️ **Approved but unwired** |
| `booking_rejected` | he | ❌ | `booking_rejected` | ⚠️ **Approved but unwired** |
| `booking_pending` | **en** | ❌ | `booking_pending` | ⚠️ Unwired **and wrong language** |
| `cancellation_confirmation` | **en** | ❌ | `cancellation_confirmation` | ⚠️ Unwired **and wrong language** |
| `waitlist_invite` | — | ❌ | `waitlist_invite` | ❌ **Not submitted** — this is the live failure |
| `booking_rescheduled` | — | ❌ | *(kind does not exist)* | ❌ Not submitted, and needs code |

> ### ⚠️ The finding that matters: an unwired kind **fails**, it does not fall back
>
> The comment in `whatsapp-templates.ts` claims a kind with no template
> "falls through to SMS or email". **That is wrong, and production proves it.**
>
> The channel is chosen at *enqueue* time by `clientDelivery`, which picks
> WhatsApp because WhatsApp is live. At *dispatch* time `whatsappTemplateFor`
> returns `null`, and `metaCloudProvider` refuses with
> `retryable: false` — so the row goes straight to `failed`. There is no
> second channel and no retry. The client receives nothing and the owner is
> never told.
>
> Four approved templates are currently sitting behind that refusal.

### What the outbox actually looks like

| Kind | Channel | Status | Count |
| --- | --- | --- | --- |
| `booking_confirmation` | whatsapp | **sent** | 2 |
| `booking_confirmation` | whatsapp | skipped | 4 |
| `cancellation_confirmation` | whatsapp | skipped | 1 |
| `reminder` | whatsapp | pending | 1 |
| `reminder` | whatsapp | skipped | 7 |
| `waitlist_invite` | whatsapp | **failed** | 1 |

Two things to read out of that.

**Messages have genuinely left on Meta Cloud.** Two confirmations were sent to
real numbers. PROJECT_PLAN §5 still says "no message has left on any backend" —
that line is stale and the WhatsApp blocker row with it.

**`cancellation_confirmation` has only ever been *skipped*, never attempted.**
Skipped means the dispatcher dropped it before sending — the appointment had
already moved on. So its missing template has not bitten yet. It will on the
first cancellation that reaches dispatch with the row still live.

### Are the triggers correct?

Yes — every one, and the one that is easiest to get wrong is right.

| Kind | Fires at | Verified in |
| --- | --- | --- |
| `booking_confirmation` | booking created, approval **off** | `enqueue.ts` — branches on `status === "pending"` |
| `booking_pending` | booking created, approval **on** | same branch, other arm |
| `booking_approved` | owner sets `confirmed` **and** it was a request | `dashboard/actions.ts` — guarded by `wasRequest` |
| `booking_rejected` | owner sets `cancelled` **and** it was a request | same guard |
| `cancellation_confirmation` | owner or client cancels a **confirmed** booking | the other arm of `wasRequest` |
| `reminder` | booking or approval, **one per appointment** | `planReminder` returns a single plan |
| `waitlist_invite` | slot freed, or an offer lapses and cycles | `waitlist-offer.ts` |

`wasRequest` is the subtle one: rejecting a pending request and cancelling a
confirmed booking both land on `cancelled`, and by dispatch time nothing can
tell them apart from the row. The action reads the appointment *before*
updating it, which is what keeps "בוטל" off a request that was never confirmed.

**No trigger changes are needed.** The gap is entirely in the template mapping.

### What wiring the four requires

`whatsappTemplateFor` needs one branch per kind, and each branch has to
reproduce the **exact component layout Meta approved** — how many body
variables, whether there is a header, whether there is a button. Getting the
parameter count wrong is a rejected send, which is no better than the refusal
it replaces.

That structure is not in this repository and cannot be guessed. **Paste the
approved copy for `booking_approved` and `booking_rejected`** (the two already
in Hebrew) and they can be wired immediately. `booking_pending` and
`cancellation_confirmation` should be re-submitted in Hebrew first, from §3
below, so they are wired once rather than twice.

## 3. The copy to paste into Meta

Four to submit or fix, in the order they are worth doing.

| # | Template | Action | Why this order |
| --- | --- | --- | --- |
| 1 | `waitlist_invite` | **new** | The only one failing in production today |
| 2 | `cancellation_confirmation` | **replace en with he** | Next to bite; every cancellation reaches it |
| 3 | `booking_pending` | **replace en with he** | Only affects shops running approval |
| 4 | `booking_rescheduled` | **new** | Needs code as well; ship last |

All Hebrew (`he`), all **Utility**. Parameters are numbered per component,
starting from 1 *within that component* — a header `{{1}}` and a body `{{1}}`
are different variables.

### `waitlist_invite`

**Category:** Utility — but see the risk note below.
**Button base:** `https://www.bazman.app/w/` ← **not** the shared base.

```
HEADER   שלום {{1}},

BODY     *התפנה תור ב{{1}}!*
         📅 {{2}}
         ⏰ {{3}}
         ⏳ התור שמור עבורכם עד {{4}}, ואחר כך יוצע לממתין הבא.

BUTTON   לתפיסת התור  →  https://www.bazman.app/w/{{1}}
```

| Component | Var     | Value                                    |
| --------- | ------- | ---------------------------------------- |
| header    | `{{1}}` | client name                              |
| body      | `{{1}}` | business name                            |
| body      | `{{2}}` | date phrase — `יום שלישי, 24/08/2026`    |
| body      | `{{3}}` | time phrase — `12:20`                    |
| body      | `{{4}}` | offer deadline time — `13:20`            |
| button    | `{{1}}` | bare invite token                        |

> **Implementation note.** `{{4}}` comes from `offerDeadline`, which returns the
> slot's own start when a shop sets `waitlist_offer_ttl_min = 0`. The copy would
> then read "held for you until 12:20" about a 12:20 slot — true, but odd. The
> cleanest handling is for `whatsappTemplateFor` to return `null` for
> `waitlist_invite` when the tenant's TTL is `0`, so those shops fall through to
> another channel rather than sending a line that reads wrong. One branch.

> **Approval risk — this is the one most likely to be rejected or reclassified.**
> The client did opt in by joining the queue, which is the Utility argument. But
> the message *offers* something, and Meta has reclassified messages like this
> as Marketing before. If it comes back Marketing, it needs an opt-out line and
> it stops being sendable to anyone who has opted out of marketing — which
> `lib/retention.ts` already tracks. Submit this one **first**, so the answer
> arrives before the others are locked.

---

### `cancellation_confirmation`

**Category:** Utility. **Button base:** `https://www.bazman.app/`

```
HEADER   שלום {{1}},

BODY     *התור ב{{1}} בוטל.*
         📅 {{2}}
         ⏰ {{3}}

BUTTON   לקביעת תור חדש  →  https://www.bazman.app/{{1}}
```

| Component | Var     | Value                          |
| --------- | ------- | ------------------------------ |
| header    | `{{1}}` | client name                    |
| body      | `{{1}}` | business name                  |
| body      | `{{2}}` | date phrase of the cancelled slot |
| body      | `{{3}}` | time phrase                    |
| button    | `{{1}}` | **tenant slug**, not a token   |

The button tail is the slug because the useful next step is booking again, not
managing something that no longer exists. It shares the base safely: a slug can
never be UUID-shaped, because `isManageTokenShape` refuses one at both forms
that let an owner choose a slug.

---

### `booking_pending`

**Category:** Utility. **Button base:** `https://www.bazman.app/`

```
HEADER   שלום {{1}},

BODY     *הבקשה לתור ב{{1}} התקבלה וממתינה לאישור.*
         📅 {{2}}
         ⏰ {{3}}
         המועד שמור עבורכם, ונעדכן אתכם ברגע שהבקשה תיענה.

BUTTON   לצפייה או ביטול הבקשה  →  https://www.bazman.app/{{1}}
```

| Component | Var     | Value                    |
| --------- | ------- | ------------------------ |
| header    | `{{1}}` | client name              |
| body      | `{{1}}` | business name            |
| body      | `{{2}}` | date phrase              |
| body      | `{{3}}` | time phrase              |
| button    | `{{1}}` | bare cancel token        |

> **The word `נקבע` must not appear.** A client told their appointment is set
> when it is not **turns up**. That is the entire reason this is a separate kind
> from `booking_confirmation` rather than one status-aware template. The line
> about the slot being held is true — `pending` is non-terminal, so the
> exclusion constraint blocks the time exactly as a confirmed booking would.

---

### `booking_approved` — already approved, kept for reference

> **Do not resubmit.** This is live in Hebrew on the Meta dashboard. The copy
> below is what this repository *would* have submitted; the approved artifact
> is the source of truth, and wiring it needs that artifact's exact component
> layout rather than this.

**Category:** Utility. **Button base:** `https://www.bazman.app/`

```
HEADER   שלום {{1}},

BODY     *הבקשה אושרה — התור ב{{1}} קבוע!*
         📅 {{2}}
         ⏰ {{3}}

BUTTON   ניהול התור  →  https://www.bazman.app/{{1}}
```

| Component | Var     | Value             |
| --------- | ------- | ----------------- |
| header    | `{{1}}` | client name       |
| body      | `{{1}}` | business name     |
| body      | `{{2}}` | date phrase       |
| body      | `{{3}}` | time phrase       |
| button    | `{{1}}` | bare cancel token |

---

### `booking_rejected` — already approved, kept for reference

> **Do not resubmit.** Live in Hebrew. Same note as above: wiring it needs the
> approved component layout, not this draft.

**Category:** Utility. **Button base:** `https://www.bazman.app/`

```
HEADER   שלום {{1}},

BODY     *הבקשה לתור ב{{1}} לא אושרה הפעם.*
         📅 {{2}}
         ⏰ {{3}}
         אפשר לבחור מועד אחר, ונשמח לראות אתכם.

BUTTON   לבחירת מועד אחר  →  https://www.bazman.app/{{1}}
```

| Component | Var     | Value                        |
| --------- | ------- | ---------------------------- |
| header    | `{{1}}` | client name                  |
| body      | `{{1}}` | business name                |
| body      | `{{2}}` | date phrase of the request   |
| body      | `{{3}}` | time phrase                  |
| button    | `{{1}}` | **tenant slug**, not a token |

> **The word `בוטל` must not appear** — it is wrong for something that was never
> confirmed. And the message has to end with a way forward: a refusal with no
> next step is where a client gives up on a shop that would happily see them an
> hour later.

---

### `booking_rescheduled` — a new kind, not just a new template

**Category:** Utility. **Button base:** `https://www.bazman.app/`

```
HEADER   שלום {{1}},

BODY     *התור ב{{1}} הועבר למועד חדש.*
         📅 {{2}}
         ⏰ {{3}}

BUTTON   ניהול התור  →  https://www.bazman.app/{{1}}
```

| Component | Var     | Value                       |
| --------- | ------- | --------------------------- |
| header    | `{{1}}` | client name                 |
| body      | `{{1}}` | business name               |
| body      | `{{2}}` | date phrase of the **new** slot |
| body      | `{{3}}` | time phrase of the **new** slot |
| button    | `{{1}}` | bare cancel token           |

This one needs **code as well as approval**, unlike the five above:

1. Add `booking_rescheduled` to the `notification_kind` enum — a migration.
2. Add a case to `renderNotification`, which is an exhaustive switch, so this
   is a compile error until it is handled.
3. Call `enqueueRescheduleNotification` from `rescheduleAppointmentAction`,
   after `deletePendingNotificationsForAppointment` and beside `enqueueReminder`.
4. Add the branch to `whatsappTemplateFor`.

**The old time is deliberately not in the copy.** Two more parameters is more
rejection surface, `AppointmentContext` does not carry the previous slot, and
the client's actual question is "when is it now". If a pilot shop asks for it,
it needs a context field first.

> **Do not ship step 3 before the template is approved.** The reschedule path is
> used constantly, and until Meta approves this, `whatsappTemplateFor` returns
> `null` for the kind — so on the Meta path every reschedule produces a *failed*
> outbox row and a `/master/alerts` entry, where today it produces silence. On
> Green API it would deliver as free text.

---

### Also missing: `client_winback`

Not on your list, but it is the sixth unsubmitted template and the only one with
different rules. **Category: Marketing**, not Utility. It needs the sender named
in the first line (דבר פרסומת identification), an in-message opt-out — a
one-word reply, honoured through `marketing_opt_outs` — and it is gated on three
separate consents in `lib/retention.ts`. The rendered copy in `templates.ts`
already carries all three; transcribe from there rather than from this file.

## 4. Every outgoing message, and what triggers it

Owner alerts are **email only** — `OWNER_CHANNEL` is hardcoded to `email`, so
they never touch WhatsApp and never cost a Meta message.

| Kind                        | Fires when                              | To     | Channel        | Template status |
| --------------------------- | --------------------------------------- | ------ | -------------- | --------------- |
| `booking_confirmation`      | booking created, approval **off**       | client | WA → SMS → email | ✅ approved     |
| `booking_pending`           | booking created, approval **on**        | client | WA → SMS → email | ⚠️ en, needs he |
| `booking_approved`          | owner approves a request                | client | WA → SMS → email | ⚠️ approved, unwired |
| `booking_rejected`          | owner rejects a request                 | client | WA → SMS → email | ⚠️ approved, unwired |
| `reminder`                  | scheduled at booking; **one per appointment** | client | WA → SMS → email | ✅ approved (both leads) |
| `cancellation_confirmation` | client link **or** owner cancels        | client | WA → SMS → email | ⚠️ en, needs he |
| `waitlist_invite`           | slot freed, **or** an offer lapses and cycles | client | WA → SMS → email | ❌ draft        |
| `client_winback`            | daily retention sweep                   | client | WhatsApp only  | ❌ draft (Marketing) |
| `booking_alert`             | booking created                         | owner  | **email**      | n/a             |
| `cancellation_alert`        | any cancellation                        | owner  | **email**      | n/a             |
| `trial_ending` / `trial_ended` / `payment_failed` / `payment_receipt` | billing sweep | owner | **email** | n/a |

Three things in that table are easy to get wrong:

- **No owner alert on approve or reject.** The owner is the one who just did it.
- **There *is* an owner alert when the owner cancels.** `cancellation_alert`
  fires from both cancellation paths, so an owner cancelling from the dashboard
  emails themselves. Harmless, free, and mildly silly.
- **No message at all when an appointment moves.** Until `booking_rescheduled`
  ships, the reschedule dialog says so in as many words.

### The channel walk

`clientDelivery` tries WhatsApp → SMS → email and takes the first that is both
entitled and live — **once, at enqueue time.** There is no second attempt at
dispatch: a kind whose template is missing fails on the channel already chosen
rather than falling back to the next one. See the audit note in §2. WhatsApp needs `canSendWhatsapp` (Pro) *and* credentials;
SMS needs `smsReminders` (Pro) *and* Twilio. A waitlist entry has **no email**,
so for the queue the walk is effectively WhatsApp → SMS → nothing.

## 5. Monthly volume

### The formula

Let:

| Symbol | Meaning                                    | Pilot value |
| ------ | ------------------------------------------ | ----------- |
| `A`    | appointments booked per working day        | 15–20       |
| `D`    | working days per month                     | ~26         |
| `p`    | `1` if the shop runs "תורים באישור", else `0` | 0 or 1   |
| `r`    | share of bookings that get a reminder      | ~0.85       |
| `c`    | cancellation rate                          | ~0.10       |
| `m`    | share of freed slots that match somebody waiting | ~0.40 |
| `k`    | offers per matched slot, incl. expiry cycling | ~1.5     |

**Client WhatsApp messages per month:**

```
M  =  A × D × [ 1 + p + r + c × (1 + m × k) ]
```

**Owner emails per month:**

```
E  =  A × D × (1 + c)          plus a handful of billing messages
```

Where the bracket comes from, per appointment: `1` confirmation or pending
request; `p` the approve/reject answer if the shop vets requests; `r` the single
reminder; `c` a cancellation message; and `c × m × k` the waitlist invites that
one freed slot generates.

### Worked, at 17.5/day × 26 days = 455 appointments

| Component                    | Approval off | Approval on |
| ---------------------------- | ------------ | ----------- |
| confirmation / pending       | 455          | 455         |
| approved or rejected         | —            | 455         |
| reminder (one each)          | 387          | 387         |
| cancellation                 | 46           | 46          |
| waitlist invites             | 27           | 27          |
| **Client WhatsApp / month**  | **~915**     | **~1,370**  |
| Owner emails / month         | ~500         | ~500        |

So budget **900–1,400 client WhatsApp messages per shop per month**, and treat
1,400 as the planning number — approval mode is the single biggest lever, worth
+50% on its own.

### Two caveats on turning that into money

**This is a count of messages, not of billable units.** Meta bills per
conversation window, and consecutive utility messages inside the same open
24-hour window are not each charged. `booking_pending` and `booking_approved`
very often land minutes apart, so approval mode costs far less than the +455
above implies. Treat `M` as an upper bound.

**Verify the current rate card before quoting anyone.** Meta has changed its
pricing model more than once — per-conversation, then per-message for some
categories, with utility often free inside a service window. Nothing in this
repo tracks it, and a number written here would be stale within a quarter.

### What scales worse than linearly

Waitlist cycling is the one component that is not proportional to bookings. A
shop with a long queue and a short `waitlist_offer_ttl_min` re-offers each freed
slot several times, so `k` climbs. At `k = 4` the waitlist line goes from 27 to
73 messages — still small, but it is the term to watch if a pilot shop turns the
window down to 15 minutes.
