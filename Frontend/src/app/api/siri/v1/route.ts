import { NextResponse, type NextRequest } from "next/server";
import { fromZonedTime } from "date-fns-tz";

import { db } from "@/db";
import {
  getBusinessBySiriToken,
  nextAppointment,
  searchUpcomingByClient,
  todaySummary,
} from "@/db/queries/siri";
import { todayInTimezone } from "@/lib/format";
import { reportError } from "@/lib/observability";
import {
  spokenNext,
  spokenSearch,
  spokenToday,
  type SpokenAppointment,
} from "@/lib/siri/speech";
import { readSiriToken } from "@/lib/siri/token";

/**
 * `/api/siri/v1` — the owner's calendar, in one spoken Hebrew sentence.
 *
 * ---------------------------------------------------------------------------
 * **The audience is a Shortcut, not a browser**, and that shapes every choice
 * here. There is no session and no cookie: a bearer token identifies the
 * business and nothing else does, which is what lets an owner ask Siri a
 * question mid-haircut without unlocking anything. Responses are small, flat
 * JSON with `spoken_text` at the top level, because a Shortcut reads one key
 * and any nesting becomes another tap in a visual editor.
 *
 * **It reads. It cannot write.** There is no verb here that changes anything —
 * no confirm, no cancel, no reschedule. A token pasted into a note, mailed to
 * the wrong person or left in a sold phone leaks a view of a calendar, which is
 * bad; it cannot cancel a client's appointment, which would be worse. Adding a
 * write action later is not a small change to this file — it is a different
 * threat model and wants a different credential.
 *
 * **GET, and deliberately so**, even though a token in a URL is normally a
 * smell. Shortcuts builds a URL in one action and needs a further step to
 * attach a header, and the header path *is* supported and preferred — see
 * `readSiriToken`. `next.config.ts` marks `/api/:path*` `no-store`; this route
 * adds `noindex` and never echoes the token back in a response or an error.
 *
 * **Speed is a feature, not a nicety.** Siri abandons a slow turn and says it
 * had a problem, so this does at most two indexed queries, selects three
 * columns, and skips the proxy entirely — the matcher in `proxy.ts` excludes
 * `api/`, so there is no Supabase `getUser()` round trip in front of it.
 * ---------------------------------------------------------------------------
 */
export const dynamic = "force-dynamic";
/** Postgres over TCP; the edge runtime cannot open the pool. */
export const runtime = "nodejs";

const ACTIONS = ["next", "today", "search"] as const;
type Action = (typeof ACTIONS)[number];

function isAction(value: string | null): value is Action {
  return ACTIONS.includes(value as Action);
}

/**
 * Every response carries the same envelope.
 *
 * `spoken_text` is present on failures too, and that is the point: a Shortcut
 * wired to speak `spoken_text` should say "the connection is not set up"
 * rather than fall silent and leave the owner tapping at a phone with wet
 * hands. Snake case because it is read in Shortcuts' visual editor beside
 * Apple's own snake-cased keys.
 */
function speak(
  spoken_text: string,
  extra: Record<string, unknown> = {},
  status = 200,
) {
  return NextResponse.json(
    { ok: status === 200, spoken_text, ...extra },
    {
      status,
      headers: {
        // `no-store` already comes from next.config; this is the half that
        // matters for a URL with a credential in it.
        "X-Robots-Tag": "noindex, nofollow",
        "Cache-Control": "private, no-store",
      },
    },
  );
}

export async function GET(request: NextRequest) {
  const token = readSiriToken(request);
  if (!token) {
    return speak(
      "החיבור ל-Siri לא מוגדר. צרו מפתח חדש בהגדרות של בזמן.",
      { error: "missing_or_malformed_token" },
      401,
    );
  }

  try {
    const business = await getBusinessBySiriToken(db, token);

    if (!business) {
      /**
       * One message for "no such token" and for "revoked", on purpose. The
       * difference is only useful to somebody probing, and the owner's next
       * step — generate a new one in settings — is the same either way.
       */
      return speak(
        "המפתח לא תקף יותר. אפשר ליצור מפתח חדש בהגדרות של בזמן.",
        { error: "invalid_token" },
        401,
      );
    }

    /**
     * A frozen tenant answers, and says so.
     *
     * `is_active` false means non-payment or an admin freeze: the public
     * booking page is already offline and the dashboard is read-only. Reading
     * one's own calendar is a read, so it is allowed — but going silent here
     * would look like a broken integration rather than an unpaid invoice.
     */
    const url = new URL(request.url);
    const action = url.searchParams.get("action") ?? "next";

    if (!isAction(action)) {
      return speak(
        "לא הבנתי מה לבדוק ביומן.",
        { error: "unknown_action", supported: ACTIONS },
        400,
      );
    }

    const now = new Date();
    const timezone = business.timezone;

    if (action === "next") {
      const next = await nextAppointment(db, business.id, now);
      return speak(spokenNext(next, now, timezone), {
        action,
        appointment: serialise(next, timezone),
      });
    }

    if (action === "today") {
      // "Today" is the *shop's* day. A server in another zone rolls over at a
      // different instant, and an owner asking at 23:30 must not be told about
      // tomorrow because a datacentre is already there.
      const day = todayInTimezone(timezone, now);
      const dayStart = fromZonedTime(`${day}T00:00:00`, timezone);
      const dayEnd = new Date(dayStart.getTime() + 86_400_000);

      const { total, next } = await todaySummary(
        db,
        business.id,
        dayStart,
        dayEnd,
        now,
      );

      return speak(spokenToday(total, next, timezone), {
        action,
        total,
        appointment: serialise(next, timezone),
      });
    }

    const name = (url.searchParams.get("name") ?? "").trim();
    if (name.length < 2) {
      // Dictation returns an empty string more often than a wrong one, and a
      // bare "%" search would otherwise read out the whole diary.
      return speak("לא שמעתי את השם. אפשר לנסות שוב?", {
        action,
        error: "missing_name",
      });
    }

    const matches = await searchUpcomingByClient(db, business.id, name, now);
    return speak(spokenSearch(name, matches, now, timezone), {
      action,
      matches: matches.length,
      appointment: serialise(matches[0] ?? null, timezone),
    });
  } catch (error) {
    // The token is never in the context: `observability` redacts any key
    // matching /token/i, and this does not hand it one to redact.
    reportError("siri.request", error);
    return speak(
      "לא הצלחתי להגיע ליומן כרגע. כדאי לנסות שוב עוד רגע.",
      { error: "internal" },
      500,
    );
  }
}

/**
 * The structured half, for a Shortcut that wants to build its own sentence.
 *
 * ISO plus a pre-formatted local time, because a Shortcut cannot convert zones
 * and an owner should not have to: `starts_at` is exact, `time` is what the
 * clock on the wall says.
 */
function serialise(
  appointment: SpokenAppointment | null,
  timezone: string,
): Record<string, string> | null {
  if (!appointment) return null;

  return {
    starts_at: appointment.startsAt.toISOString(),
    time: new Intl.DateTimeFormat("he-IL", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(appointment.startsAt),
    client_name: appointment.clientName,
    service_name: appointment.serviceName,
  };
}
