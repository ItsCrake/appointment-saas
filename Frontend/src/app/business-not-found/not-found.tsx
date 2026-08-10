import { BusinessNotFound } from "@/components/booking/business-not-found";

/**
 * The boundary that catches this segment's own `notFound()`. Same UI as
 * `/[slug]/not-found.tsx` — a visitor must not be able to tell whether the
 * proxy resolved the miss or the page did.
 */
export default function BusinessNotFoundBoundary() {
  return <BusinessNotFound />;
}
