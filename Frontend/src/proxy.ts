import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

import { getSupabaseConfig } from "@/lib/supabase/config";

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
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (!user && pathname.startsWith("/dashboard")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
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
