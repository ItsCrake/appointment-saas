# Current state

**Commit** `00e919c` (last functional change) · **Build** green — `npm run verify`: lint, types, **1919 tests across 115 files**, production build. **37 migrations (0000–0036) applied to production**; `main` is deployed.

**All five tasks below shipped in `38bb874` (2026-09-22)** — listed with what is actually left:

| Task | Shipped | Left |
| --- | --- | --- |
| WhatsApp toggle | per-business switch in `/master`, migration 0036 (guard trigger included) | owners can still rewrite the *other* `businesses` columns through PostgREST — needs its own migration |
| ליבי UI redesign | CSS orb and glow; `thinking-orbs` and `voice-glow` uninstalled | never seen on a real iPhone (Safari) |
| New Event menu split | חסימת זמן / תור ידני behind "אירוע חדש" | — |
| Edit Mode indicator | violet frame, dot canvas, banner, filled toggle | — |
| Landing mockup | calendar phone rebuilt on the calendar's own layout functions | — |

**Also open:** sign-up fails until Supabase Auth can send mail (unverified Resend domain); 148 load-test bookings in `demo-barber`; region decision (fra1 vs Seoul); `ELEVENLABS_MODEL_ID` on Vercel.
