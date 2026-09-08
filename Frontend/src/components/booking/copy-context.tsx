"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

import { showcaseContent, translate } from "@/lib/booking-copy";
import { DEFAULT_LOCALE, type Locale } from "@/lib/showcase";

/**
 * The booking flow's language, for the client half of it.
 *
 * ---------------------------------------------------------------------------
 * **Context rather than a prop, because the alternative is twenty files of
 * plumbing for a showcase.** The flow is a stepper five components deep with
 * dialogs hanging off it; threading a `copy` prop through all of it would touch
 * every signature on the page and give every one of them a chance to be wrong.
 *
 * **The default is Hebrew and the default is safe.** A component rendered
 * outside a provider — a test, a route that has not been wired, anything added
 * later — gets `he`, and `he` returns the literal the caller passed. There is
 * no configuration under which this can blank a string.
 * ---------------------------------------------------------------------------
 */
const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

export function BookingCopyProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}) {
  return (
    <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>
  );
}

/**
 * The language this subtree is being read in.
 *
 * Needed by the handful of things that are formatted rather than looked up —
 * a duration, a weekday — where the string does not exist until a number has
 * been turned into words. Everything else should use `useCopy`.
 */
export function useLocale(): Locale {
  return useContext(LocaleContext);
}

/** One interface string: `t("service.title", "בחרו שירות")`. */
export type CopyFn = (key: string, fallback: string) => string;

/**
 * The translator for this subtree.
 *
 * **The second argument is the Hebrew that is on the page today**, and it is
 * what renders for every locale that has no answer. Calling this can change a
 * string; it cannot remove one.
 *
 * A plain function rather than one carrying properties: attaching `content` and
 * `locale` to it meant mutating a value created inside `useMemo`, which the
 * repository's immutability rule rejects and is right to — a memo that hands
 * back something it has modified is a memo whose identity no longer describes
 * its contents. The shop's own words have their own hook below.
 */
export function useCopy(): CopyFn {
  const locale = useContext(LocaleContext);

  return useMemo(
    () => (key: string, fallback: string) => translate(locale, key, fallback),
    [locale],
  );
}

/**
 * The shop's own words — a business name, a service — for a showcase address.
 *
 * Separate from `useCopy` because it is a different kind of string: that one
 * translates the product's chrome, this one re-renders a *tenant's* data, and
 * only ever for an alias. See `showcaseContent`.
 */
export function useShowcaseContent(): (value: string) => string {
  const locale = useContext(LocaleContext);

  return useMemo(
    () => (value: string) => showcaseContent(locale, value),
    [locale],
  );
}
