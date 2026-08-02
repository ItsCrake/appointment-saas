"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

import type { Faq } from "@/lib/landing-content";
import { cn } from "@/lib/utils";

/**
 * Buttons + a controlled panel rather than <details>/<summary>: Safari does not
 * animate the native element's open state, and the marker is hard to restyle
 * consistently across engines. The panel stays in the DOM either way, so the
 * answers remain findable by in-page search and by crawlers.
 */
export function FaqAccordion({ items }: { items: Faq[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <ul className="divide-y divide-neutral-200 rounded-2xl border border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
      {items.map((item, index) => {
        const open = openIndex === index;
        const panelId = `faq-panel-${index}`;
        const buttonId = `faq-button-${index}`;

        return (
          <li key={item.question}>
            <h3>
              <button
                id={buttonId}
                type="button"
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => setOpenIndex(open ? null : index)}
                className="flex w-full items-center justify-between gap-4 px-5 py-4 text-start text-sm font-semibold text-neutral-900 transition-colors hover:text-teal-800 focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:outline-none dark:text-neutral-100 dark:hover:text-teal-300"
              >
                {item.question}
                <ChevronDown
                  aria-hidden
                  className={cn(
                    "size-4 shrink-0 text-neutral-400 transition-transform duration-200",
                    open && "rotate-180",
                  )}
                />
              </button>
            </h3>

            <div
              id={panelId}
              role="region"
              aria-labelledby={buttonId}
              hidden={!open}
              className="px-5 pb-4 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400"
            >
              {item.answer}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
