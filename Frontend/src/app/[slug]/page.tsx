import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BookingFlow } from "@/components/booking/booking-flow";
import { BusinessHeader } from "@/components/booking/business-header";
import { db } from "@/db";
import {
  getActiveBusinessBySlug,
  listServices,
  listWorkingHours,
} from "@/db/queries";
import { isDemoBusiness } from "@/lib/demo";
import { todayInTimezone } from "@/lib/format";

// Availability changes by the minute — never serve this from a static cache.
export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const business = await getActiveBusinessBySlug(db, slug);

  if (!business) {
    return { title: "העסק לא נמצא", robots: { index: false, follow: false } };
  }

  // Absolute title: a business page should not carry the platform's suffix.
  const title = `${business.name} — קביעת תור אונליין`;
  const description =
    business.description ??
    `קביעת תור אונליין אצל ${business.name}. בחרו שירות, יום ושעה — בלי טלפונים ובלי הרשמה.`;
  const url = `/${slug}`;

  return {
    title: { absolute: title },
    description,
    alternates: { canonical: url },
    keywords: [business.name, "קביעת תור", "תורים אונליין", "יומן תורים"],
    openGraph: {
      title,
      description,
      url,
      type: "website",
      locale: "he_IL",
      siteName: business.name,
    },
    twitter: { card: "summary", title, description },
    // Follow, so the landing page's demo links are not treated as dead ends,
    // but never index a shop that does not exist.
    ...(isDemoBusiness(slug) ? { robots: { index: false, follow: true } } : {}),
  };
}

/**
 * schema.org LocalBusiness. Gives search engines the opening hours and contact
 * details directly, which is what surfaces a small business in local results.
 */
function buildStructuredData(
  business: {
    name: string;
    slug: string;
    description: string | null;
    phone: string | null;
    address: string | null;
    logoUrl: string | null;
  },
  services: { name: string; priceCents: number; currency: string }[],
  hours: { weekday: number; startTime: string; endTime: string }[],
  appUrl: string,
) {
  const DAYS = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];

  return {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: business.name,
    url: `${appUrl}/${business.slug}`,
    ...(business.description ? { description: business.description } : {}),
    ...(business.phone ? { telephone: business.phone } : {}),
    ...(business.logoUrl ? { image: business.logoUrl } : {}),
    ...(business.address
      ? {
          address: {
            "@type": "PostalAddress",
            streetAddress: business.address,
          },
        }
      : {}),
    openingHoursSpecification: hours.map((shift) => ({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: DAYS[shift.weekday],
      opens: shift.startTime.slice(0, 5),
      closes: shift.endTime.slice(0, 5),
    })),
    makesOffer: services.map((service) => ({
      "@type": "Offer",
      itemOffered: { "@type": "Service", name: service.name },
      price: (service.priceCents / 100).toFixed(2),
      priceCurrency: service.currency,
    })),
  };
}

export default async function BusinessPage({ params }: PageProps) {
  const { slug } = await params;

  const business = await getActiveBusinessBySlug(db, slug);
  if (!business) notFound();

  const [services, hours] = await Promise.all([
    listServices(db, business.id),
    listWorkingHours(db, business.id),
  ]);

  // The demo shop's address, phone and prices are invented. Publishing them as
  // LocalBusiness data would assert a real trader at a real street address.
  const structuredData = isDemoBusiness(slug)
    ? null
    : buildStructuredData(
        business,
        services,
        hours.filter((h) => !h.isClosed),
        process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
      );

  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col">
      {structuredData ? (
        <script
          type="application/ld+json"
          // Serialised from our own database, not user-controlled markup.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
      ) : null}
      <BusinessHeader
        name={business.name}
        description={business.description}
        logoUrl={business.logoUrl}
        address={business.address}
        phone={business.phone}
        hours={hours.map((h) => ({
          weekday: h.weekday,
          startTime: h.startTime,
          endTime: h.endTime,
          isClosed: h.isClosed,
        }))}
        // Resolved server-side in the business timezone, so "today" matches the
        // shop's day rather than the visitor's device.
        todayWeekday={new Date(
          `${todayInTimezone(business.timezone)}T00:00:00Z`,
        ).getUTCDay()}
      />

      {services.length === 0 ? (
        <p className="px-5 py-16 text-center text-sm text-neutral-500">
          העסק עדיין לא הגדיר שירותים לקביעת תור.
        </p>
      ) : (
        <BookingFlow
          slug={slug}
          business={{
            id: business.id,
            name: business.name,
            timezone: business.timezone,
            maxAdvanceDays: business.maxAdvanceDays,
          }}
          services={services.map((s) => ({
            id: s.id,
            name: s.name,
            description: s.description,
            durationMin: s.durationMin,
            priceCents: s.priceCents,
            currency: s.currency,
            imageUrl: s.imageUrl,
          }))}
        />
      )}

      <footer className="mt-auto px-5 py-8 text-center text-xs text-neutral-400">
        מופעל על ידי מערכת זימון התורים
      </footer>
    </div>
  );
}
