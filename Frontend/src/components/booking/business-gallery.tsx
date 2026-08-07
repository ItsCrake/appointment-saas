"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

export function BusinessGallery({ images }: { images: string[] }) {
  const [openAt, setOpenAt] = useState<number | null>(null);
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  const isOpen = openAt !== null;
  const count = images.length;

  const step = useCallback(
    (delta: number) => {
      // Wraps, so the arrows never dead-end on the first or last image.
      setOpenAt((current) =>
        current === null ? null : (current + delta + count) % count,
      );
    },
    [count],
  );

  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenAt(null);
      // RTL: the physical right arrow moves towards the *next* item, matching
      // the visual order the thumbnails are laid out in.
      if (event.key === "ArrowRight") step(1);
      if (event.key === "ArrowLeft") step(-1);
    };

    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    closeRef.current?.focus();

    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen, step]);

  if (count === 0) return null;

  return (
    <section aria-labelledby="gallery-heading" className="px-5 pt-8">
      <h2
        id="gallery-heading"
        className="mb-3 text-base font-semibold text-zinc-900 dark:text-zinc-100"
      >
        מהעבודות שלנו
      </h2>

      <ul className="grid grid-cols-3 gap-2">
        {images.map((url, index) => (
          <li key={`${url}-${index}`}>
            <button
              type="button"
              onClick={() => setOpenAt(index)}
              aria-label={`הגדלת תמונה ${index + 1} מתוך ${count}`}
              className="group block aspect-square w-full overflow-hidden rounded-xl bg-zinc-100 transition-all duration-150 hover:shadow-md focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2 focus-visible:outline-none active:scale-95 dark:bg-zinc-800"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- per-tenant remote host, unknown at build time */}
              <img
                src={url}
                alt=""
                loading="lazy"
                className="size-full object-cover transition-transform duration-200 group-hover:scale-105"
              />
            </button>
          </li>
        ))}
      </ul>

      {isOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="animate-fade fixed inset-0 z-50 flex flex-col bg-black/90"
        >
          <div className="flex items-center justify-between px-4 py-3 text-white">
            <p id={titleId} className="text-sm font-medium tabular-nums">
              {openAt + 1} / {count}
            </p>
            <button
              ref={closeRef}
              type="button"
              onClick={() => setOpenAt(null)}
              aria-label="סגירה"
              className="-me-2 rounded-lg p-2 transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
            >
              <X className="size-6" aria-hidden />
            </button>
          </div>

          {/* Backdrop click closes. A button rather than a div so it is
              reachable and announced, but kept out of the tab order since the
              close control above already does the job. */}
          <button
            type="button"
            tabIndex={-1}
            aria-label="סגירה"
            onClick={() => setOpenAt(null)}
            className="flex flex-1 cursor-default items-center justify-center overflow-hidden p-4"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- per-tenant remote host, unknown at build time */}
            <img
              src={images[openAt]}
              alt=""
              className="max-h-full max-w-full rounded-lg object-contain"
            />
          </button>

          {count > 1 ? (
            <div className="flex items-center justify-center gap-3 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <NavButton label="הקודם" onClick={() => step(-1)}>
                <ChevronRight className="size-6" aria-hidden />
              </NavButton>
              <NavButton label="הבא" onClick={() => step(1)}>
                <ChevronLeft className="size-6" aria-hidden />
              </NavButton>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function NavButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex size-12 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none active:scale-95"
    >
      {children}
    </button>
  );
}
