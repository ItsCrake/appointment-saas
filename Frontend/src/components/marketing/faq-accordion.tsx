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
    // Hairlines only, no surrounding box: the questions are already a list,
    // and a bordered card around them adds a frame nothing needed.
    <ul className="divide-y divide-zinc-200 border-y border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
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
                className="flex w-full items-center justify-between gap-4 py-5 text-start text-sm font-bold text-zinc-950 transition-colors hover:text-zinc-500 focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:outline-none dark:text-zinc-50 dark:hover:text-zinc-400 dark:focus-visible:ring-white"
              >
                {item.question}
                <ChevronDown
                  aria-hidden
                  className={cn(
                    "size-4 shrink-0 text-zinc-400 transition-transform duration-200",
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
              className="max-w-[65ch] pb-5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400"
            >
              {item.answer}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
