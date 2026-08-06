import { RouteProgress } from "@/components/ui/route-progress";

/**
 * The booking page is deliberately never cached, so without this a client
 * tapping a shared link waits on a cold server render with a blank screen.
 */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6">
      <RouteProgress />
      <div className="animate-shimmer h-32 rounded-2xl" />
      <div className="animate-shimmer mt-4 h-6 w-40 rounded-md" />
      <div className="mt-4 space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="animate-shimmer h-20 rounded-2xl" />
        ))}
      </div>
      <p role="status" className="sr-only">
        טוען…
      </p>
    </div>
  );
}
