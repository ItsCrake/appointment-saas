import { RouteProgress } from "@/components/ui/route-progress";

/**
 * The shape every dashboard `loading.tsx` renders.
 *
 * Deliberately mirrors the real page's layout rather than showing a spinner:
 * a fallback that occupies the same space as the content swaps for it without
 * anything jumping, which is the difference between "loading" and "flickering".
 *
 * All of this is static markup, so it is part of the *prefetched* payload.
 * That is the point — a dynamic route with no `loading.tsx` cannot be
 * prefetched at all, so the browser sits on the old page until the server
 * finishes its database work. With one, the skeleton is already in the client
 * and the transition starts on the click.
 */
export function PageSkeleton({
  rows = 4,
  height = "h-20",
  cards = 0,
}: {
  rows?: number;
  /** Match the real row height, or the swap will shift the page. */
  height?: string;
  /** Stat tiles above the list, when the page has them. */
  cards?: number;
}) {
  return (
    <div>
      <RouteProgress />

      {/* Header block: title width and the subtitle beneath it. */}
      <div className="mb-5 space-y-2">
        <div className="animate-shimmer h-7 w-40 rounded-lg" />
        <div className="animate-shimmer h-4 w-56 rounded-md" />
      </div>

      {cards > 0 ? (
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: cards }).map((_, i) => (
            <div key={i} className="animate-shimmer h-24 rounded-2xl" />
          ))}
        </div>
      ) : null}

      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className={`animate-shimmer rounded-2xl ${height}`} />
        ))}
      </div>

      {/* Screen readers get a status rather than a wall of empty boxes. */}
      <p role="status" className="sr-only">
        טוען…
      </p>
    </div>
  );
}
