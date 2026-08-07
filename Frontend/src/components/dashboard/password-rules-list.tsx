"use client";

import { Check } from "lucide-react";

import { PASSWORD_RULES } from "@/lib/auth-validation";

/**
 * The live strength checklist, rendered from the same constant the server
 * validates against.
 *
 * Shared by sign-up and by the reset form because those are the only two
 * places a password is *chosen*, and a hint that ticks every box on a password
 * the server then rejects is worse than no hint at all. Two copies of this list
 * is exactly how that drift starts.
 */
export function PasswordRulesList({ value }: { value: string }) {
  return (
    <ul className="mt-2 space-y-1">
      {PASSWORD_RULES.map((rule) => {
        const met = rule.test(value);
        return (
          <li
            key={rule.id}
            className={`flex items-center gap-1.5 text-xs ${
              met
                ? "text-emerald-700 dark:text-emerald-400"
                : "text-neutral-500"
            }`}
          >
            <Check
              className={`size-3 shrink-0 ${met ? "opacity-100" : "opacity-30"}`}
              aria-hidden
            />
            {rule.label}
          </li>
        );
      })}
    </ul>
  );
}
