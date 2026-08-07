import type { MetadataRoute } from "next";

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        // Owner-only surfaces.
        "/dashboard",
        "/dashboard/",
        // Prefix match, so /login/forgot and /login/reset are covered too.
        "/login",
        // The recovery-link exchange. Nothing to index, and a crawler
        // following a link out of a mailbox would burn its single use.
        "/auth/",
        // Booking-management links are unguessable but must never be indexed:
        // the token is the only credential protecting a client's details.
        "/b/",
      ],
    },
    sitemap: `${appUrl}/sitemap.xml`,
  };
}
