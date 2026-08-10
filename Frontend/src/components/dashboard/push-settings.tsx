"use client";

import { useEffect, useState, useTransition } from "react";
import { AlertCircle, BellRing, Check, Smartphone } from "lucide-react";

import {
  sendTestPushAction,
  setPushEnabledAction,
  subscribeToPushAction,
  unsubscribeFromPushAction,
  type PushResult,
} from "@/app/dashboard/push-actions";
import { useToast } from "@/components/ui/toast";
import { useIsClient } from "@/lib/use-is-client";
import { cn } from "@/lib/utils";

import { btnPrimary, btnSecondary, cardClass } from "./ui";

/**
 * Push notifications, per device.
 *
 * ---------------------------------------------------------------------------
 * The state that matters is **this browser's**, not the tenant's, and the two
 * genuinely differ: an owner with notifications enabled on their phone opens
 * the dashboard on a laptop and has to be told this device is not registered
 * yet. A single tenant-level switch would show "on" and then never buzz.
 *
 * Permission is asked for **only on a tap**. A page that calls
 * `Notification.requestPermission()` on load gets refused by people who had no
 * idea what was being asked, and a refusal cannot be re-prompted — it has to be
 * undone in browser settings, which nobody finds.
 * ---------------------------------------------------------------------------
 */
export function PushSettings({ enabled }: { enabled: boolean }) {
  const { toast } = useToast();
  const isClient = useIsClient();
  const [pending, startTransition] = useTransition();

  const [supported, setSupported] = useState(false);
  const [permission, setPermission] =
    useState<NotificationPermission>("default");
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // Registration and the current subscription can only be read in the browser,
  // and both are async — hence an effect rather than derived state.
  useEffect(() => {
    let cancelled = false;

    async function check() {
      if (
        typeof window === "undefined" ||
        !("serviceWorker" in navigator) ||
        !("PushManager" in window)
      ) {
        if (!cancelled) setReady(true);
        return;
      }

      try {
        const registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          // Never serve the worker itself from the HTTP cache: a stale one
          // would keep handling pushes after a fix has shipped.
          updateViaCache: "none",
        });
        const existing = await registration.pushManager.getSubscription();

        if (cancelled) return;
        setSupported(true);
        setPermission(Notification.permission);
        setEndpoint(existing?.endpoint ?? null);
      } catch {
        // A blocked or unavailable service worker is not an error worth
        // showing — the feature simply is not available here.
      } finally {
        if (!cancelled) setReady(true);
      }
    }

    void check();
    return () => {
      cancelled = true;
    };
  }, []);

  function run(action: () => Promise<PushResult>, after?: () => void) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        toast(result.message ?? "נשמר", "success");
        after?.();
      } else {
        toast(result.error, "error");
      }
    });
  }

  async function enable() {
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        // Required by every browser: a push must always produce something the
        // person can see. Silent pushes are not available to web apps.
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(
          process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "",
        ),
      });

      setPermission(Notification.permission);
      setEndpoint(subscription.endpoint);

      const json = subscription.toJSON() as {
        endpoint?: string;
        keys?: { p256dh?: string; auth?: string };
      };

      run(() =>
        subscribeToPushAction({
          endpoint: json.endpoint,
          keys: json.keys,
          userAgent: navigator.userAgent.slice(0, 400),
        }),
      );
    } catch {
      toast("הדפדפן לא אישר התראות. אפשר לאשר בהגדרות האתר.", "error");
      setPermission(
        typeof Notification !== "undefined"
          ? Notification.permission
          : "denied",
      );
    }
  }

  async function disable() {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    const current = subscription?.endpoint ?? endpoint;

    await subscription?.unsubscribe();
    setEndpoint(null);

    if (current) run(() => unsubscribeFromPushAction(current));
  }

  // Rendered only after the client check, so the card never flashes "not
  // supported" on a browser that supports it perfectly well.
  if (!isClient || !ready) {
    return (
      <div className={cn(cardClass, "animate-shimmer h-32")} aria-hidden />
    );
  }

  if (!supported) {
    return (
      <div className={cn(cardClass, "p-5")}>
        <p className="flex items-start gap-2 text-sm text-zinc-600 dark:text-zinc-400">
          <AlertCircle
            className="mt-0.5 size-4 shrink-0 text-zinc-400"
            aria-hidden
          />
          <span>
            הדפדפן הזה לא תומך בהתראות. באייפון צריך קודם להוסיף את האפליקציה
            למסך הבית — אחר כך אפשר להפעיל התראות מכאן.
          </span>
        </p>
      </div>
    );
  }

  const registeredHere = Boolean(endpoint);
  const blocked = permission === "denied";

  return (
    <div className={cn(cardClass, "p-5")}>
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-full",
            registeredHere
              ? "bg-[image:var(--brand-gradient)] text-white"
              : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800",
          )}
        >
          <BellRing className="size-5" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {registeredHere
              ? "התראות פעילות במכשיר הזה"
              : "התראות על תורים חדשים"}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">
            {registeredHere
              ? "נודיע לכם ברגע שנקבע תור חדש או מתקבלת בקשה."
              : "הפעילו כדי לקבל התראה ברגע שנקבע תור חדש, גם כשהאפליקציה סגורה."}
          </p>
        </div>
      </div>

      {blocked && !registeredHere ? (
        <p className="mt-4 flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            הדפדפן חוסם התראות לאתר הזה. צריך לאשר אותן בהגדרות האתר בדפדפן —
            אחרי שנחסמו אי אפשר לבקש שוב מכאן.
          </span>
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {registeredHere ? (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={() => void disable()}
              className={cn(btnSecondary, "h-10 px-4 text-xs")}
            >
              כיבוי במכשיר הזה
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(sendTestPushAction)}
              className={cn(btnSecondary, "h-10 px-4 text-xs")}
            >
              <Smartphone className="size-4" aria-hidden />
              שליחת התראת בדיקה
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={pending || blocked}
            onClick={() => void enable()}
            className={cn(btnPrimary, "h-10 px-5 text-xs")}
          >
            הפעלת התראות
          </button>
        )}
      </div>

      {/* The tenant switch, shown only once at least one device is registered:
          before that it would be a control with nothing to control. */}
      {registeredHere ? (
        <label className="mt-4 flex items-center justify-between gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <span className="text-xs text-zinc-600 dark:text-zinc-400">
            שליחת התראות לכל המכשירים הרשומים
          </span>
          <input
            type="checkbox"
            checked={enabled}
            disabled={pending}
            onChange={(event) =>
              run(() => setPushEnabledAction(event.target.checked))
            }
            className="size-4 accent-zinc-900 dark:accent-zinc-100"
          />
        </label>
      ) : null}

      {enabled && registeredHere ? (
        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-emerald-700 dark:text-emerald-300">
          <Check className="size-3.5" aria-hidden />
          הכול מוכן
        </p>
      ) : null}
    </div>
  );
}

/**
 * The VAPID public key as the browser wants it.
 *
 * `applicationServerKey` takes raw bytes, and the key is distributed as
 * URL-safe base64 — the one conversion every Web Push integration needs and
 * the one nobody remembers.
 */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(normalised);

  // Backed by an explicit ArrayBuffer: `applicationServerKey` wants a
  // `BufferSource` over one, and a plain `new Uint8Array(n)` is typed as
  // possibly sitting on a SharedArrayBuffer, which it will not accept.
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}
