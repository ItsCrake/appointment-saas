import { PageSkeleton } from "@/components/dashboard/page-skeleton";

/** Agenda: four stat tiles above the day's appointment rows. */
export default function Loading() {
  return <PageSkeleton cards={4} rows={5} height="h-20" />;
}
