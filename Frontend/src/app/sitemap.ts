import type { MetadataRoute } from "next";

import { db } from "@/db";
import { listActiveBusinessSlugs } from "@/db/queries";
import { reportError } from "@/lib/observability";

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

// The list of businesses changes without a redeploy, so this must not be baked
// in at build time.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const root: MetadataRoute.Sitemap = [
    {
      url: appUrl,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 1,
    },
  ];

  try {
    const businesses = await listActiveBusinessSlugs(db);

    return [
      ...root,
      ...businesses.map((business) => ({
        url: `${appUrl}/${business.slug}`,
        lastModified: business.createdAt,
        changeFrequency: "daily" as const,
        priority: 0.8,
      })),
    ];
  } catch (error) {
    // A database blip must not fail the whole build or request.
    reportError("sitemap.businesses", error);
    return root;
  }
}
