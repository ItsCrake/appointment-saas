import type { NextConfig } from "next";

/**
 * Security headers live here rather than in vercel.json so they apply in
 * `next dev`, `next start`, on Vercel, and on any other host — which also
 * makes them testable locally instead of only observable after a deploy.
 */
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

/** Owner-only and token-only surfaces: never indexed, never cached. */
const PRIVATE_HEADERS = [
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
  { key: "Cache-Control", value: "private, no-store" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      { source: "/b/:path*", headers: PRIVATE_HEADERS },
      { source: "/dashboard/:path*", headers: PRIVATE_HEADERS },
      // Credential surfaces. `/login/reset` renders the owner's own address
      // and is reached by a single-use link, so `no-store` matters here for
      // the same reason it does on `/b/` — a cached copy outlives the token.
      { source: "/login", headers: PRIVATE_HEADERS },
      { source: "/login/:path*", headers: PRIVATE_HEADERS },
      { source: "/auth/:path*", headers: PRIVATE_HEADERS },
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
};

export default nextConfig;
