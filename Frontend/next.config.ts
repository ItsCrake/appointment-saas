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
    /**
     * **`microphone=(self)`, and only microphone.**
     *
     * This read `microphone=()` — closed to everyone including this origin —
     * until Bazman Voice needed it. That is not a theoretical conflict: the
     * assistant's `getUserMedia` call was refused by our own header, and the
     * browser reported it as `Permissions policy violation` in the console
     * rather than as a permission prompt, so the feature failed in a way no
     * unit test could see. Libi never hit it because the Web Speech API is not
     * gated by this policy; `MediaRecorder` is.
     *
     * `(self)` rather than `*`: this origin may ask, an embedded third party
     * still may not. Camera and geolocation stay shut, because nothing here
     * has ever wanted them and an open policy is only ever noticed after it
     * is abused.
     */
    key: "Permissions-Policy",
    value: "camera=(), microphone=(self), geolocation=(), interest-cohort=()",
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
  images: {
    /**
     * **Without this, `quality={90}` was silently delivered as 75.**
     *
     * Next 16 changed `images.qualities` from "anything goes" to `[75]`, and a
     * value outside the list is not honoured: the optimizer rejects the URL
     * outright — `"q" parameter (quality) of 90 is not allowed`, HTTP 400 —
     * and `next/image` clamps the `q` it emits to the nearest allowed value
     * before that can happen. So the landing page kept rendering, kept looking
     * exactly as compressed as before, and the `quality={90}` on `PhoneFrame`
     * had no effect at all. Verified by reading the emitted `srcset`, which
     * carried `q=75`.
     *
     * 75 stays in the list because it is still the default every other image
     * uses; a one-value list of `[90]` would quietly re-encode those upward
     * for no reason.
     *
     * `formats` is deliberately left at its default (`webp`). AVIF would buy
     * roughly 20% smaller files at the same quality, but the complaint here is
     * sharpness rather than payload — and it costs about 50% more encode time
     * on a cold request and a second cached variant per rung. Worth doing on
     * purpose, not as a side effect of this.
     */
    qualities: [75, 90],
  },
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
