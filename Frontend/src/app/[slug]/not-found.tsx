import Link from "next/link";
import { CalendarX2 } from "lucide-react";

export default function BusinessNotFound() {
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-20">
      <div className="w-full max-w-sm text-center">
        <div
          aria-hidden
          className="mx-auto mb-6 flex size-16 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800"
        >
          <CalendarX2 className="size-7 text-neutral-400" />
        </div>

        <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-50">
          העמוד לא נמצא
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
          לא מצאנו עסק בכתובת הזו. ייתכן שהקישור שגוי או שהעסק אינו פעיל כרגע.
        </p>

        <Link
          href="/"
          className="mt-6 inline-flex h-11 items-center justify-center rounded-xl bg-neutral-900 px-5 text-sm font-semibold text-white transition-colors hover:bg-neutral-800 focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2 focus-visible:outline-none dark:bg-neutral-100 dark:text-neutral-900"
        >
          חזרה לדף הבית
        </Link>
      </div>
    </main>
  );
}
