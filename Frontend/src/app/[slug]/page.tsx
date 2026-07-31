import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MapPin, Phone } from "lucide-react";

import { BookingFlow } from "@/components/booking/booking-flow";
import { db } from "@/db";
import { getActiveBusinessBySlug, listServices } from "@/db/queries";

// Availability changes by the minute — never serve this from a static cache.
export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const business = await getActiveBusinessBySlug(db, slug);

  if (!business) return { title: "העסק לא נמצא" };

  const title = `${business.name} — קביעת תור אונליין`;
  const description =
    business.description ?? `קביעת תור אונליין אצל ${business.name}`;

  return {
    title,
    description,
    openGraph: { title, description, type: "website" },
  };
}

export default async function BusinessPage({ params }: PageProps) {
  const { slug } = await params;

  const business = await getActiveBusinessBySlug(db, slug);
  if (!business) notFound();

  const services = await listServices(db, business.id);

  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col">
      <header className="px-5 pt-8 pb-6 text-center">
        {business.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- remote host is per-tenant and not known at build time
          <img
            src={business.logoUrl}
            alt=""
            className="mx-auto mb-4 size-20 rounded-full object-cover ring-1 ring-black/5"
          />
        ) : (
          <div
            aria-hidden
            className="mx-auto mb-4 flex size-20 items-center justify-center rounded-full bg-neutral-900 text-2xl font-bold text-white"
          >
            {business.name.trim().charAt(0)}
          </div>
        )}

        <h1 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
          {business.name}
        </h1>

        {business.description ? (
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
            {business.description}
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-neutral-500">
          {business.address ? (
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="size-3.5 shrink-0" aria-hidden />
              {business.address}
            </span>
          ) : null}
          {business.phone ? (
            <a
              href={`tel:${business.phone}`}
              className="inline-flex items-center gap-1.5 hover:text-neutral-900 dark:hover:text-neutral-200"
            >
              <Phone className="size-3.5 shrink-0" aria-hidden />
              {business.phone}
            </a>
          ) : null}
        </div>
      </header>

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
