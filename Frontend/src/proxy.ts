import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

import { getSupabaseConfig } from "@/lib/supabase/config";
import { hardenCookieOptions } from "@/lib/supabase/cookies";

/**
 * Refreshes the auth cookie on every dashboard request and bounces anonymous
 * visitors to /login. The dashboard pages check again server-side — this is a
 * redirect convenience, not the security boundary.
 *
 * Named `proxy` (not `middleware`): the middleware file convention is
 * deprecated in Next 16.
 */
export async function proxy(request: NextRequest) {
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

export const config = {
  matcher: ["/dashboard/:path*", "/login"],
};
