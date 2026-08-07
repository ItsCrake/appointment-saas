import { Star } from "lucide-react";

import { averageRating, type Review } from "@/lib/branding";
import { cn } from "@/lib/utils";

/** Server component: testimonials are static content, so they ship no JS. */
export function BusinessReviews({ reviews }: { reviews: Review[] }) {
  const average = averageRating(reviews);
  if (average === null) return null;

  return (
    <section aria-labelledby="reviews-heading" className="px-5 pt-8">
      <h2
        id="reviews-heading"
        className="mb-3 text-base font-semibold text-zinc-900 dark:text-zinc-100"
      >
        מה הלקוחות אומרים
      </h2>

      <div className="mb-4 flex items-center gap-3 rounded-2xl border border-(--accent-soft-border) bg-(--accent-soft) px-4 py-3">
        <p className="text-2xl leading-none font-bold text-(--accent-on-soft) tabular-nums">
          {average.toFixed(1)}
        </p>
        <div>
          <Stars value={average} />
          <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
            {reviews.length} חוות דעת
          </p>
        </div>
      </div>

      <ul className="space-y-3">
        {reviews.map((review) => (
          <li
            key={review.id}
            className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="flex items-baseline justify-between gap-3">
              <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {review.clientName}
              </p>
              <time
                dateTime={review.date}
                className="shrink-0 text-xs text-zinc-400 tabular-nums"
              >
                {review.date.split("-").reverse().join("/")}
              </time>
            </div>

            <div className="mt-1">
              <Stars value={review.rating} size="sm" />
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
function Stars({ value, size = "md" }: { value: number; size?: "sm" | "md" }) {
  return (
    <span
      className="flex items-center gap-0.5"
      role="img"
      aria-label={`דירוג ${value} מתוך 5`}
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
