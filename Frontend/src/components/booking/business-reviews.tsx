import { Star } from "lucide-react";

import { averageRating, type Review } from "@/lib/branding";
import { translate } from "@/lib/booking-copy";
import { DEFAULT_LOCALE, type Locale } from "@/lib/showcase";
import { cn } from "@/lib/utils";

/**
 * Server component: testimonials are static content, so they ship no JS.
 *
 * Which is why the language arrives as a prop rather than from `useCopy` — a
 * server component has no context to read, and paying for a client bundle to
 * translate two headings would undo the reason this one renders on the server.
 */
export function BusinessReviews({
  reviews,
  locale = DEFAULT_LOCALE,
}: {
  reviews: Review[];
  locale?: Locale;
}) {
  const t = (key: string, fallback: string) => translate(locale, key, fallback);
  const average = averageRating(reviews);
  if (average === null) return null;

  return (
    <section aria-labelledby="reviews-heading" className="px-5 pt-8">
      <h2
        id="reviews-heading"
        className="mb-4 text-[17px] font-semibold tracking-[-0.015em] text-zinc-900 dark:text-zinc-100"
      >
        {t("reviews.title", "מה הלקוחות אומרים")}
      </h2>

      <div className="shadow-lift mb-4 flex items-center gap-3.5 rounded-2xl bg-(--accent-soft) px-4 py-3.5 ring-1 ring-(--accent-soft-border) ring-inset">
        <p className="text-3xl leading-none font-bold tracking-[-0.03em] text-(--accent-on-soft) tabular-nums">
          {average.toFixed(1)}
        </p>
        <div>
          <Stars value={average} locale={locale} />
          <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
            {reviews.length} {t("reviews.count", "חוות דעת")}
          </p>
        </div>
      </div>

      <ul className="space-y-3">
        {reviews.map((review) => (
          <li
            key={review.id}
            className="shadow-lift rounded-2xl bg-white p-4 ring-1 ring-zinc-900/8 ring-inset dark:bg-zinc-900 dark:ring-white/10"
          >
            <div className="flex items-baseline justify-between gap-3">
              <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {review.clientName}
              </p>
              <time
                dateTime={review.date}
                className="shrink-0 text-xs text-zinc-500 tabular-nums"
              >
                {review.date.split("-").reverse().join("/")}
              </time>
            </div>

            <div className="mt-1">
              <Stars value={review.rating} size="sm" locale={locale} />
            </div>

            {review.comment ? (
              <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                {review.comment}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Five stars, filled up to `value`. The number is announced once via the label
 * rather than as five separate icons, which is what a screen reader would
 * otherwise read out.
 */
function Stars({
  value,
  size = "md",
  locale = DEFAULT_LOCALE,
}: {
  value: number;
  size?: "sm" | "md";
  locale?: Locale;
}) {
  return (
    <span
      className="flex items-center gap-0.5"
      role="img"
      aria-label={`${translate(locale, "reviews.rating", "דירוג")} ${value} ${translate(locale, "common.of", "מתוך")} 5`}
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          aria-hidden
          className={cn(
            size === "sm" ? "size-3.5" : "size-4",
            star <= Math.round(value)
              ? "fill-amber-400 text-amber-400"
              : "fill-zinc-200 text-zinc-200 dark:fill-zinc-700 dark:text-zinc-700",
          )}
        />
      ))}
    </span>
  );
}
