import { cache } from "react";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import { getSupabaseConfig } from "./config";
import { hardenCookieOptions } from "./cookies";

/** Returns null when auth is not configured yet, rather than throwing. */
export async function createSupabaseServerClient() {
  const config = getSupabaseConfig();
  if (!config) return null;

  const cookieStore = await cookies();

  return createServerClient(config.url, config.anonKey, {
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
