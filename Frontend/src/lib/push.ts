import webpush from "web-push";

import type { Database } from "@/db/types";
import {
  listPushSubscriptions,
  markPushSubscriptionExpired,
} from "@/db/queries/push";
import { validateVapidSubject } from "@/lib/env";
import { reportError } from "@/lib/observability";

/**
 * Web push for business owners.
 *
 * ---------------------------------------------------------------------------
 * This is **not** part of the notification outbox, and the difference is
 * deliberate. The outbox exists so a client's confirmation survives a crash, a
 * retry and a redeploy — it is a promise to somebody outside the company. A
 * push to the owner's own phone is a nudge: if it fails, the booking is still
 * on their dashboard, the email alert still arrives, and nothing is lost that
 * mattered. Putting it in the outbox would mean retries, a dedupe key and a
 * `notification_kind` for a message whose entire value expires in a minute.
 *
 * So it sends inline, best-effort, and every caller wraps it in a try/catch
 * that never turns a successful booking into an error.
 * ---------------------------------------------------------------------------
 */

export type PushPayload = {
  title: string;
  body: string;
  /** Where tapping it should land. Defaults to the dashboard. */
  url?: string;
  /** Collapses repeats in the notification shade. */
  tag?: string;
};

let configured: boolean | null = null;

/**
 * Configures VAPID once per process, and reports whether it could.
 *
 * Cached because `setVapidDetails` validates its arguments and throws on a
 * malformed one — doing that per send would turn a typo in an environment
 * variable into an exception on every booking.
 */
function ensureConfigured(): boolean {
  if (configured !== null) return configured;

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim();

  if (!publicKey || !privateKey || !subject) {
    configured = false;
    return configured;
  }

  /**
   * **No default subject.** This used to fall back to a hard-coded
   * `mailto:` address, which is the wrong shape of guess in three ways: the
   * `sub` claim is how a push service reaches *the operator* when a deployment
   * misbehaves (RFC 8292 §2.1), so an address nobody reads is worse than an
   * error; the domain in it may not even belong to whoever deployed this; and
   * it made a missing variable invisible, so the first sign of trouble would
   * be a push service quietly dropping traffic.
   *
   * Validated with the same function `check:env` uses, so a deploy that passes
   * the check cannot fail here.
   */
  const problem = validateVapidSubject(subject);
  if (problem) {
    reportError("push.configure", new Error(`VAPID_SUBJECT ${problem}`), {});
    configured = false;
    return configured;
  }

  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    configured = true;
  } catch (error) {
    // A malformed key pair is a deployment mistake, and one that would
    // otherwise surface as a failed booking rather than as a log line.
    reportError("push.configure", error, {});
    configured = false;
  }

  return configured;
}

/** Test seam: the cache above is per-process and would outlive an env change. */
export function resetPushConfigForTests() {
  configured = null;
}

export function isPushConfigured(): boolean {
  return ensureConfigured();
}

/**
 * Sends to every live device a tenant has registered.
 *
 * Returns how many got through rather than throwing: the caller has already
 * committed a booking, and there is no useful decision to make from a failure.
 *
 * A `404` or `410` from the push service means the subscription is gone for
 * good — the browser was reinstalled, or permission was revoked. Those rows are
 * marked expired rather than retried, because every future send to them would
 * fail identically and slow the ones that work.
 */
export async function sendPushToBusiness(
  db: Database,
  businessId: string,
  payload: PushPayload,
): Promise<{ sent: number; failed: number }> {
  if (!ensureConfigured()) return { sent: 0, failed: 0 };

  const devices = await listPushSubscriptions(db, businessId);
  if (devices.length === 0) return { sent: 0, failed: 0 };

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url ?? "/dashboard",
    tag: payload.tag ?? "booking",
  });

  let sent = 0;
  let failed = 0;

  // In parallel: a shop with a phone and a laptop should not wait for the
  // slower push service before the booking action returns.
  await Promise.all(
    devices.map(async (device) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: device.endpoint,
            keys: { p256dh: device.p256dh, auth: device.auth },
          },
          body,
        );
        sent += 1;
      } catch (error) {
        failed += 1;
        const status = (error as { statusCode?: number }).statusCode;

        if (status === 404 || status === 410) {
          await markPushSubscriptionExpired(db, device.endpoint);
          return;
        }

        reportError("push.send", error, { businessId, status: status ?? null });
      }
    }),
  );

  return { sent, failed };
}
