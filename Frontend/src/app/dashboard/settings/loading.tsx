import { PageSkeleton } from "@/components/dashboard/page-skeleton";

/** Two tall form cards: business details, then booking rules. */
export default function Loading() {
  return <PageSkeleton rows={2} height="h-64" />;
}
