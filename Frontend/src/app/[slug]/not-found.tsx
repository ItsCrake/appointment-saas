import { BusinessNotFound } from "@/components/booking/business-not-found";

/**
 * The boundary for a `notFound()` thrown anywhere under `/[slug]`.
 *
 * In practice the proxy resolves an unknown slug before the render starts and
 * rewrites to `/business-not-found`, so this is the fallback for the cases it
 * cannot cover: a tenant deactivated between the proxy's cache and the query,
 * and any request that reached the page with the proxy skipped or failing open.
 */
export default function BusinessNotFoundPage() {
  return <BusinessNotFound />;
}
