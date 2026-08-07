import { RouteProgress } from "@/components/ui/route-progress";

/**
 * Console fallback. Separate from the dashboard's because `/master` sits on a
 * dark surface — the tenant-facing shimmer is tuned for paper and reads as a
 * bright flash against slate.
 *
 * The console's queries are the heaviest in the app: they cross every tenant
 * and group over the appointments table. Those are exactly the routes where a
 * missing fallback is felt most.
 */
export function MasterSkeleton({
  cards = 0,
  rows = 4,
}: {
  cards?: number;
  rows?: number;
}) {
  return (
    <div>
      <RouteProgress />

      <div className="mb-5 space-y-2">
        <div className="h-6 w-44 rounded-lg bg-zinc-800" />
        <div className="h-4 w-60 rounded-md bg-zinc-800/70" />
      </div>

      {cards > 0 ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: cards }).map((_, i) => (
            <div key={i} className="h-24 rounded-xl bg-zinc-800/70" />
          ))}
        </div>
      ) : null}

      <div className="mt-6 space-y-2">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="h-14 rounded-xl bg-zinc-800/60" />
        ))}
      </div>

      <p role="status" className="sr-only">
        טוען…
      </p>
    </div>
  );
}
