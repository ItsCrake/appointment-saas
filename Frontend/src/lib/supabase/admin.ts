import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseConfig } from "./config";

/**
 * The service-role client. **Server only, and it bypasses RLS entirely.**
 *
 * Used for exactly one thing today: minting a signed upload URL after
 * `requireWritable()` has already decided the caller may write to this tenant.
 * That is the whole reason it exists — the alternative was a storage RLS policy
 * re-deriving business ownership in SQL, a second copy of a rule that already
 * has one home (see `media-upload.ts` for the full argument).
 *
 * `admin-isolation.test.ts` fails the build if a `"use client"` module ever
 * imports this file, and the guard below is the runtime backstop for a path
 * that test cannot see. Neither is paranoia: the key here can read and write
 * every tenant's data, so "how would this ever reach a bundle" deserves an
 * answer that is not "nobody would do that".
 */
function assertServer() {
  if (typeof window !== "undefined") {
    throw new Error(
      "supabase/admin is server-only and must never reach the browser bundle.",
    );
  }
}

/**
 * Returns null when the key is not configured, rather than throwing.
 *
 * Same contract as `createSupabaseServerClient`: a deploy missing the key gets
 * a feature that says it is not set up, not a crash. Uploads are the only thing
 * that degrades, and the URL fields they replaced still work.
 */
export function createSupabaseAdminClient(): SupabaseClient | null {
  assertServer();

  const config = getSupabaseConfig();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!config || !serviceRoleKey) return null;

  return createClient(config.url, serviceRoleKey, {
    auth: {
      // There is no user here and nothing to persist. Left on, the client would
      // try to refresh a session it does not have on a server that has no
      // storage to keep one in.
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export function isUploadConfigured(): boolean {
  return Boolean(getSupabaseConfig() && process.env.SUPABASE_SERVICE_ROLE_KEY);
}
