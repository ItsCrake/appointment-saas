import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarClock } from "lucide-react";

import { BookingFlow } from "@/components/booking/booking-flow";
import { BusinessGallery } from "@/components/booking/business-gallery";
import { BusinessHeader } from "@/components/booking/business-header";
import { BusinessReviews } from "@/components/booking/business-reviews";
import { db } from "@/db";
import {
  getActiveBusinessBySlug,
  listServices,
  listWorkingHours,
} from "@/db/queries";
import { listActiveStaff, primaryStaff } from "@/db/queries/staff";
import { buildSocialLinks } from "@/lib/social-links";
import {
  isSafeMediaUrl,
  parseGallery,
  parseReviews,
  toThemeColor,
  type HeroMediaType,
} from "@/lib/branding";
import { BRAND } from "@/lib/brand";
import { isDemoBusiness } from "@/lib/demo";
import { getCurrentUser } from "@/lib/supabase/server";
import { PreviewBar } from "@/components/booking/preview-bar";
import { todayInTimezone } from "@/lib/format";

// Availability changes by the minute — never serve this from a static cache.
export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ preview?: string }>;
};

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

export default async function BusinessPage({
  params,
  searchParams,
}: PageProps) {
  const { slug } = await params;

  const business = await getActiveBusinessBySlug(db, slug);
  if (!business) notFound();

  /**
   * The preview bar, gated on ownership rather than on the query string.
   *
   * The parameter is checked *first* purely as a cost gate: without it this
   * page never calls `getUser()`, which is a network round trip to the auth
   * server and would otherwise be paid by every client opening a booking link.
   * With it, the session is what actually decides — a stranger who guesses
   * `?preview=1` resolves to no user, or to a user who owns a different shop,
   * and sees the ordinary page.
   */
  const { preview } = await searchParams;
  let previewFor: string | null = null;

  if (preview) {
    const viewer = await getCurrentUser();
    if (viewer && viewer.id === business.ownerUserId) {
      previewFor = business.name;
    }
  }

  const [services, hours, activeStaff] = await Promise.all([
    listServices(db, business.id),
    listWorkingHours(db, business.id),
    listActiveStaff(db, business.id),
  ]);

  // The same rule the availability engine applies, for the same reason. A shop
  // that answered "no" to the multi-staff question can still hold other active
  // rows — people who have booking history and so cannot be deleted — and none
  // of them is bookable here. Sending their names to the browser would ship a
  // roster of staff this shop does not present, for a picker that never renders.
  const primary = primaryStaff(activeStaff);
  const team = business.hasMultipleStaff || !primary ? activeStaff : [primary];

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

  // Every branding column is validated on read: these are jsonb and varchar,
  // so a value written by a seed or by psql could be any shape at all, and the
  // public page must render regardless.
  const gallery = parseGallery(business.galleryUrls);
  const reviews = parseReviews(business.reviews);
  const heroMediaType =
    business.heroMediaType === "image" || business.heroMediaType === "video"
      ? (business.heroMediaType as HeroMediaType)
      : null;

  return (
    // data-accent resolves the --accent custom properties for everything below
    // it. Tailwind cannot build a class from a runtime value, so the owner's
    // colour arrives as an attribute and the components stay static.
    <div
      data-accent={toThemeColor(business.themeColor)}
      className="mx-auto flex w-full max-w-lg flex-1 flex-col"
    >
      {previewFor ? <PreviewBar businessName={previewFor} /> : null}
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
        heroMediaUrl={business.heroMediaUrl}
        heroMediaType={heroMediaType}
        // Validated on read like every other owner-supplied column: a value
        // written past the app by a seed or psql must not produce a broken
        // link, so anything that does not parse simply yields no icon.
        socialLinks={buildSocialLinks({
          instagram: business.socialInstagram,
          facebook: business.socialFacebook,
          tiktok: business.socialTiktok,
          whatsapp: business.socialWhatsapp,
          website: business.websiteUrl,
        })}
      />

      {/* Directly under the header, above the flow.

          It used to sit below the booking steps, where a first-time visitor
          reached it only after they had already decided. The work is what
          convinces somebody to book at all, so it belongs where they are still
          deciding — and it costs a returning client one short rail to scroll
          past on their way to the services. */}
      <BusinessGallery images={gallery} />

      {services.length === 0 ? (
        <p className="px-5 py-16 text-center text-sm text-zinc-500">
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
            hasMultipleStaff: business.hasMultipleStaff,
            retentionEnabled: business.retentionEnabled,
          }}
          // The roster is only ever used to put names on ids the availability
          // engine returned, so nothing here decides who is bookable.
          staff={team.map((member) => ({
            id: member.id,
            name: member.name,
            title: member.title,
            // Checked here rather than in the picker, so the component never
            // has to defend against a column written past the app.
            imageUrl:
              member.imageUrl && isSafeMediaUrl(member.imageUrl)
                ? member.imageUrl
                : null,
          }))}
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

      <BusinessReviews reviews={reviews} />

      {/* Below the booking flow, not above it. A returning client will look for
          it; a first-time visitor should meet the thing this page is for
          before an entrance that has nothing behind it for them. */}
      <div className="px-5 pt-4 pb-6">
        <Link
          href={`/${slug}/my-appointments`}
          className="flex h-13 w-full items-center justify-center gap-2 rounded-full text-sm font-semibold text-zinc-700 ring-1 ring-zinc-900/12 transition-colors ring-inset hover:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:outline-none dark:text-zinc-300 dark:ring-white/15 dark:hover:bg-zinc-800"
        >
          <CalendarClock className="size-4" aria-hidden />
          צפייה בתורים שלי
        </Link>
      </div>

      {/* Last on the page, and now a designed panel rather than a text link.

          This is the platform advertising to the tenant's customers on the
          tenant's own page — a real trade the shop makes in exchange for the
          page being free to run. It used to be deliberately the quietest thing
          here, on the grounds that it should be invisible to everyone but the
          one visitor who is themselves a business owner. **That call has been
          reversed**: `/[slug]` is now treated as genuinely dual-purpose, since
          shop owners meet this product by receiving a competitor's booking
          link, and a 12px underlined link is not something anyone arrives at.

          What has *not* changed is the ordering rule that keeps it honest. It
          is still below the booking flow, still below the client's own
          "my appointments" entrance, and still monochrome — the tenant's accent
          never touches it, so it cannot compete with the shop's own call to
          action for a client who came here to book. It is the last thing on the
          page, given weight rather than volume. */}
      <footer className="mt-auto px-5 pt-2 pb-8">
        <div className="rounded-3xl bg-zinc-50 px-5 py-6 text-center ring-1 ring-zinc-900/8 ring-inset dark:bg-zinc-900/50 dark:ring-white/10">
          {/* The clickable surface is exactly what it was — this one link, and
              nothing around it. The card is a container, not a target. */}
          <Link
            href="/"
            className="shadow-lift hover:shadow-raise inline-flex h-12 items-center justify-center rounded-full bg-white px-6 text-sm font-semibold text-zinc-900 ring-1 ring-zinc-900/10 transition-[box-shadow,background-color] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] ring-inset focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:outline-none dark:bg-zinc-800 dark:text-zinc-100 dark:ring-white/10"
          >
            רוצה עמוד כזה לעסק שלך? לחץ כאן
          </Link>
          <p className="mt-3 text-xs text-zinc-500">
            מופעל על ידי {BRAND.name}
          </p>
        </div>
      </footer>
    </div>
  );
}
