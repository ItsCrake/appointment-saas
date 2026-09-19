import { cache } from "react";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import { getSupabaseConfig } from "./config";
import { hardenCookieOptions } from "./cookies";

/** A 5xx from Supabase Auth, with the body the client does not keep. */
export type AuthServerFailure = {
  status: number;
  /** `/auth/v1/signup`, `/auth/v1/token` — which call failed. */
  path: string;
  /** The first 500 characters of whatever GoTrue answered with. */
  body: string;
};

/**
 * A `fetch` that keeps what a failing auth call said.
 *
 * ---------------------------------------------------------------------------
 * auth-js throws away the body of every 5xx — see `usableMessage` — so a
 * project whose SMTP is misconfigured reports sign-up failures as `{}` on the
 * form *and* `{}` in the log, which is how this went a month without anybody
 * being able to name the cause. The response is cloned before the client reads
 * it, so the failure the caller gets back is untouched.
 *
 * Exported for `auth-failure.test.ts`, which holds a real client to a stand-in
 * auth server and pins both halves: that a 500 arrives as `{}`, and that this
 * keeps the sentence behind it.
 * ---------------------------------------------------------------------------
 */
export function keepingAuthFailures(
  onFailure: (failure: AuthServerFailure) => void,
): typeof fetch {
  return async (input, init) => {
    const response = await fetch(input, init);
    if (response.status < 500) return response;

    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (!url.includes("/auth/v1/")) return response;

    const body = await response
      .clone()
      .text()
      .catch(() => "");
    onFailure({
      status: response.status,
      path: new URL(url).pathname,
      body: body.slice(0, 500),
    });
    return response;
  };
}

/** Returns null when auth is not configured yet, rather than throwing. */
export async function createSupabaseServerClient(options?: {
  /** Called with the body of any 5xx the auth server answers with. */
  onAuthServerFailure?: (failure: AuthServerFailure) => void;
}) {
  const config = getSupabaseConfig();
  if (!config) return null;

  const cookieStore = await cookies();
  const watch = options?.onAuthServerFailure;

  return createServerClient(config.url, config.anonKey, {
    ...(watch ? { global: { fetch: keepingAuthFailures(watch) } } : {}),
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, hardenCookieOptions(options));
          }
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // Middleware refreshes the session, so this is safe to ignore.
        }
      },
    },
  });
}

/**
 * The signed-in owner, or null.
 *
 * ---------------------------------------------------------------------------
 * **Wrapped in React `cache`, and that is a performance fix rather than tidiness.**
 *
 * `getUser()` revalidates against the Supabase auth server — a real network
 * round trip, not a cookie parse. That is deliberate and stays: `getSession()`
 * trusts the cookie, which is spoofable.
 *
 * But a single dashboard render called it *twice* — once in the layout's freeze
 * check and once in the page's `requireBusiness()` — so every arrow click, view
 * switch and status button paid for two round trips to answer one question.
 * `cache` dedupes within a render pass, which is exactly the scope of "who is
 * this request from".
 *
 * It does **not** cache across requests, so this weakens nothing: each new
 * request still revalidates the session against the auth server before anything
 * is shown or written.
 * ---------------------------------------------------------------------------
 */
export const getCurrentUser = cache(async () => {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user;
});
