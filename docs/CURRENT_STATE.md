# Current state

**Last functional change:** the 2026-10-03 review batch (see PROJECT_PLAN §4, *A booking page that says "press"…*) · **Build** green — `npm run verify`: lint, types, **1932 tests across 115 files**, production build. **37 migrations (0000–0036) applied to production**; none pending. `main` is deployed.

**Shipped 2026-10-03, with what is actually left:**

| Change | Left |
| --- | --- |
| Landing: Hebrew wordmark, week calendar as the hero, screens before the proof strip and "איך זה עובד" | — |
| Booking page: service cards with a round action disc; stepper as a quiet progress line | — |
| Settings: black swatch; surfaces מוגבה / זכוכית, corners מעוגל / רך מאוד | — |
| SMS off Pro, the FAQ and billing; Twilio optional | the legal terms still name SMS in a heading — for the lawyer |
| 30-day trial; the two live trials extended on production | — |
| Client drawer opens on the tap | — |
| Functions moved to `icn1` (Seoul), next to the database | measure a dashboard action on production after deploy |

**Still open:** owners can rewrite the *other* `businesses` columns through PostgREST (needs its own migration); ליבי never seen on a real iPhone; sign-up fails until Supabase Auth can send mail (unverified Resend domain); 148 load-test bookings in `demo-barber`; `ELEVENLABS_MODEL_ID` on Vercel.
