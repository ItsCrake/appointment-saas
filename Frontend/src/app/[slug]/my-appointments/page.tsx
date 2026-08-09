import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { MyAppointments } from "@/components/booking/my-appointments";
import { db } from "@/db";
import { getActiveBusinessBySlug } from "@/db/queries";
import { toThemeColor } from "@/lib/branding";

type PageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const business = await getActiveBusinessBySlug(db, slug);

  return {
    title: business ? `התורים שלי · ${business.name}` : "התורים שלי",
    // Nothing here is worth indexing and the page only ever shows one person's
    // data, so keep it out of search results entirely.
    robots: { index: false, follow: false },
  };
}

/**
 * A client's own appointments at this business.
 *
 * Dynamic and uncached: the whole page is one person's data, keyed on a phone
 * number they type. Nothing about it may be shared between two visitors.
 */
export const dynamic = "force-dynamic";

export default async function MyAppointmentsPage({ params }: PageProps) {
  const { slug } = await params;
  const business = await getActiveBusinessBySlug(db, slug);
  if (!business) notFound();

  return (
    // Same accent plumbing as the booking page, so this does not look like a
    // different product from the one they booked on.
    <div
      data-accent={toThemeColor(business.themeColor)}
      className="mx-auto flex w-full max-w-lg flex-1 flex-col"
    >
      <MyAppointments slug={slug} businessName={business.name} />
    </div>
  );
}
