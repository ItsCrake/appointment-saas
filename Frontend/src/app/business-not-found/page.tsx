import type { Metadata } from "next";
import { notFound } from "next/navigation";

export const metadata: Metadata = {
  title: "העמוד לא נמצא",
  robots: { index: false, follow: false },
};

/**
 * The proxy's 404 destination for a slug that does not exist.
 *
 * It looks pointless — a page whose only job is to throw — and the reason it
 * exists is the whole point of this route. `/[slug]` has a `loading.tsx`, which
 * means its response is **streamed**: the headers are flushed the moment the
 * Suspense fallback renders, long before the database says the business is
 * missing, so the `notFound()` in that page can only ever produce a 200 with
 * the not-found UI inside it. Next documents this exactly
 * (`file-conventions/loading` § Status Codes) and its own advice is to resolve
 * the resource in the proxy and rewrite.
 *
 * So this route is deliberately the opposite of that page: **synchronous, with
 * no `loading.tsx` and nothing to await.** Nothing suspends, no fallback
 * renders, the response is never streamed, and the status line is still ours to
 * set when `notFound()` throws. That is what turns the soft 404 into a real one.
 *
 * Removing the `loading.tsx` from `/[slug]` would also work and costs far more:
 * Next skips prefetching a dynamic route that has no fallback, which is the
 * regression the navigation-performance pass was built to fix.
 */
export default function BusinessNotFoundRoute(): never {
  notFound();
}
