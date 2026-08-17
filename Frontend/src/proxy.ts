import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

import { db } from "@/db";
import { activeBusinessSlugExists } from "@/db/queries";
import { reportError } from "@/lib/observability";
import { classifyPublicPath } from "@/lib/public-slug";
import { createSlugCache } from "@/lib/slug-cache";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { hardenCookieOptions } from "@/lib/supabase/cookies";

/**
 * Two jobs, and they share nothing but the entry point:
 *
 * 1. **Public pages** — resolve `/[slug]` before it renders, so an unknown shop
 *    gets a real 404 instead of a streamed 200. See {@link resolvePublicSlug}.
 * 2. **Dashboard** — refresh the auth cookie and bounce anonymous visitors to
 *    `/login`. The dashboard pages check again server-side; this is a redirect
 *    convenience, not the security boundary.
 *
 * They are kept apart deliberately: a public booking page must not pay for a
 * Supabase `getUser()` round trip it has no use for. That call is now reached
 * only on the paths that were matched before this file grew a second job.
 *
 * Named `proxy` (not `middleware`): the middleware file convention is
 * deprecated in Next 16. Proxy runs in the Node.js runtime by default there,
 * which is what makes the database handle below usable at all.
 */

/**
 * Per-instance and derived from the database, never authoritative — see
 * `lib/slug-cache.ts` for why the proxy is allowed to hold state at all.
 */
const slugCache = createSlugCache();

/**
 * Rewritten, not redirected: the visitor keeps the URL they typed, which is
 * what a 404 is supposed to describe. The destination is synchronous and has no
 * `loading.tsx`, so nothing streams and its `notFound()` still owns the status
 * line.
 */
function notFound(request: NextRequest) {
  return NextResponse.rewrite(new URL("/business-not-found", request.url));
}

/**
 * Sends a bare cancel token at the root to the page that serves it.
 *
 * **Redirected, not rewritten** — and this is the one decision in this function.
 * `next.config.ts` attaches `noindex, nofollow` and `private, no-store` by
 * matching the request path against `/b/:path*`. A rewrite keeps the visitor on
 * `/<token>`, so those headers would not match, and a client's appointment —
 * their name, their time, a live cancellation control — would sit at a
 * cacheable, indexable URL. The address bar changing is the smaller cost.
 *
 * 308 rather than 307 because the mapping is permanent by construction: the
 * base URL is frozen inside an approved Meta template and cannot be edited
 * without a fresh review.
 */
function manageRedirect(request: NextRequest, token: string) {
  const url = request.nextUrl.clone();
  url.pathname = `/b/${token}`;
  return NextResponse.redirect(url, 308);
}

/**
 * Answers "should this render, or 404?" for a tenant path.
 *
 * **Fails open.** If the lookup throws — pooler down, connection exhausted, a
 * cold start that times out — the request is let through to render exactly as
 * it did before this guard existed. Taking every tenant's booking page offline
 * because one query failed is far worse than the soft 404 this replaces, and it
 * is the same rule the rate limiter already follows.
 */
async function resolvePublicSlug(request: NextRequest, slug: string) {
  const cached = slugCache.get(slug);
  if (cached === true) return NextResponse.next();
  if (cached === false) return notFound(request);

  try {
    const exists = await activeBusinessSlugExists(db, slug);
    slugCache.set(slug, exists);
    return exists ? NextResponse.next() : notFound(request);
  } catch (error) {
    reportError("proxy.slug-lookup", error, { slug });
    return NextResponse.next();
  }
}

/** The original dashboard guard, unchanged. */
async function refreshSession(request: NextRequest) {
  const config = getSupabaseConfig();

  // Without keys there is no session to refresh; let the page render its own
  // "auth not configured" notice instead of redirect-looping.
  if (!config) return NextResponse.next();

  let response = NextResponse.next({ request });

  const supabase = createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          // Same hardening as the server client. This is the path that
          // actually refreshes the session on most requests, so a weaker
          // cookie written here would undo the other one.
          response.cookies.set(name, value, hardenCookieOptions(options));
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (!user && pathname.startsWith("/dashboard")) {
    // Carry the query, not just the path: a tier picked on the landing page
    // arrives as /dashboard/setup?plan=pro, and dropping the search string
    // silently loses that choice across the sign-in round trip.
    const target = `${pathname}${request.nextUrl.search}`;

    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // clone() brings the original query with it, which would both leak those
    // params onto /login and duplicate them inside `next`.
    url.search = "";
    url.searchParams.set("next", target);
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const verdict = classifyPublicPath(pathname);
  if (verdict.kind === "tenant") {
    return resolvePublicSlug(request, verdict.slug);
  }
  if (verdict.kind === "manage-token")
    return manageRedirect(request, verdict.token);
  if (verdict.kind === "impossible") return notFound(request);

  if (pathname === "/login" || pathname.startsWith("/dashboard")) {
    return refreshSession(request);
  }

  return NextResponse.next();
}

export const config = {
  /**
   * Broad on purpose. `/[slug]` is a root-level dynamic segment, so the set of
   * paths that could be a tenant is "almost everything" — and the authoritative
   * list of what is *not* a tenant has to live in `RESERVED_SEGMENTS`, because
   * Next requires matcher patterns to be statically analysable literals and a
   * second copy in a regex here would drift from it silently.
   *
   * What the pattern still carries is the part that can never be a page and is
   * pure waste to invoke a function for: framework internals, route handlers,
   * and anything with a file extension (`/sw.js`, `/icon.svg`,
   * `/manifest.webmanifest`, everything in `public/`). `.+` rather than `.*`
   * excludes `/` itself — the landing page is the highest-traffic route in the
   * product and has nothing here to gain.
   */
  matcher: ["/((?!api/|_next/|.*\\.).+)"],
};
