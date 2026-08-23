"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";

import {
  createBookingAction,
  fetchSlotsAction,
  type BookingConfirmation,
} from "@/app/[slug]/actions";
import type { SlotWithStaff } from "@/lib/availability";
import {
  previousStep as stepBefore,
  stepAfterSlot as nextStepAfterSlot,
  type BookingStep as Step,
} from "@/lib/booking-steps";
import { dateRange, todayInTimezone } from "@/lib/format";
import type { ClientDetails } from "@/lib/validation";

import { Confirmation } from "./confirmation";
import { WaitlistDialog } from "./waitlist-dialog";
import { DateTimeStep } from "./datetime-step";
import { DetailsStep } from "./details-step";
import { OnlyStaffStep } from "./only-staff-step";
import type { ServiceLayout } from "@/lib/appearance";

import { ServiceStep } from "./service-step";
import { StaffStep } from "./staff-step";
import { Stepper } from "./stepper";
import type { BookingBusiness, BookingService, BookingStaff } from "./types";

/** How many days the picker offers at once, capped by the business horizon. */
const VISIBLE_DAYS = 21;

type Props = {
  slug: string;
  business: BookingBusiness;
  services: BookingService[];
  /** Active providers, in display order. One entry for a single-staff shop. */
  staff: BookingStaff[];
  /**
   * Already resolved server-side (0027): `resolveServiceLayout` has downgraded
   * a `showcase` shop with no service pictures, so this is always a layout
   * worth rendering.
   */
  serviceLayout?: ServiceLayout;
};

export function BookingFlow({
  slug,
  business,
  services,
  staff,
  serviceLayout = "compact",
}: Props) {
  const today = todayInTimezone(business.timezone);
  const dates = dateRange(
    today,
    Math.max(1, Math.min(VISIBLE_DAYS, business.maxAdvanceDays + 1)),
  );

  const [step, setStep] = useState<Step>(1);
  const [service, setService] = useState<BookingService>();
  const [date, setDate] = useState(today);
  const [slot, setSlot] = useState<SlotWithStaff>();
  /** `null` is an explicit "anyone"; `undefined` is "not asked, or not chosen". */
  const [staffId, setStaffId] = useState<string | null>();
  const [startedAt, setStartedAt] = useState<number | null>(null);

  const [slots, setSlots] = useState<SlotWithStaff[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slotsError, setSlotsError] = useState<string>();

  /**
   * The queue is offered from two places: the empty-day state, which is where
   * the disappointment actually happens, and a standing link under the flow for
   * somebody whose chosen day *does* have slots but none that suit them.
   */
  const [waitlistOpen, setWaitlistOpen] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string>();
  const [confirmation, setConfirmation] = useState<BookingConfirmation>();

  const headingRef = useRef<HTMLDivElement>(null);
  // Guards against a slow response for an earlier date landing last.
  const requestId = useRef(0);

  const loadSlots = useCallback(
    async (serviceId: string, forDate: string) => {
      const id = ++requestId.current;
      setLoadingSlots(true);
      setSlotsError(undefined);

      const result = await fetchSlotsAction(slug, serviceId, forDate);
      if (id !== requestId.current) return; // a newer request already won

      if (result.ok) {
        setSlots(result.slots);
      } else {
        setSlots([]);
        setSlotsError(result.error);
      }
      setLoadingSlots(false);
    },
    [slug],
  );

  /**
   * Move to the top of each step so screen readers and thumbs agree — **on a
   * step change, and never on arrival.**
   *
   * `step` starts at 1, so this effect used to fire once on mount and scroll a
   * first-time visitor straight past the hero: the logo, the banner, the name,
   * the address and the opening hours all flicked by before they had seen any
   * of it. On the page whose second job is convincing a shop owner to sign up,
   * that was the worst possible opening frame, and it looked like a layout bug
   * rather than a decision.
   *
   * The guard is a ref rather than `step > 1`, because a client who reaches
   * step 2 and comes back to step 1 *should* be moved — they are navigating,
   * not arriving. Only the very first run is skipped.
   */
  const hasNavigated = useRef(false);
  useEffect(() => {
    if (!hasNavigated.current) {
      hasNavigated.current = true;
      return;
    }

    headingRef.current?.scrollIntoView({
      // Honoured here as well as in CSS: `scroll-behavior` does not apply to
      // a programmatic `scrollIntoView` that names its own behaviour, so a
      // visitor who asked for less motion would still get a smooth glide.
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "start",
    });
  }, [step]);

  // Slots are fetched from the handlers rather than an effect: the fetch is a
  // response to an interaction, not state that needs synchronising.
  function selectService(next: BookingService) {
    setService(next);
    setSlot(undefined);
    setStep(2);
    void loadSlots(next.id, date);
  }

  function selectDate(next: string) {
    setDate(next);
    setSlot(undefined);
    // A booking failure describes the slot they just lost, not this date.
    // Leaving it set kept the picker showing that error for every subsequent
    // date, with no way back to the grid short of reloading the page.
    setSubmitError(undefined);
    if (service) void loadSlots(service.id, next);
  }

  /**
   * Whether this tenant has a staff question at all.
   *
   * Both halves matter. `hasMultipleStaff` is the owner's answer to the setup
   * question, and `staff.length > 1` is whether it is currently true — an owner
   * who flipped the toggle before adding anybody would otherwise get a "only X
   * is available" card on every single slot, which says nothing.
   */
  const multiStaff = business.hasMultipleStaff && staff.length > 1;

  /** Providers free at a given slot, resolved against the roster for names. */
  function freeStaffFor(next: SlotWithStaff) {
    return staff.filter((member) => next.staffIds.includes(member.id));
  }

  /** Where a chosen slot sends the client, given who is free at it. */
  function stepAfterSlot(next: SlotWithStaff): Step {
    return nextStepAfterSlot({
      multiStaff,
      freeStaffCount: freeStaffFor(next).length,
    });
  }

  function selectSlot(next: SlotWithStaff) {
    setSlot(next);
    setSubmitError(undefined);

    const destination = stepAfterSlot(next);

    /**
     * A single-staff tenant resolves silently — the client never learns the
     * concept exists, which is the whole point of the binary setup question.
     *
     * A tenant that *does* have a team never skips silently, even when only one
     * person is free. Being quietly assigned somebody is the thing worth
     * avoiding: the client came to a shop with several barbers and has no way to
     * tell they were given the only one left, or that a different time would
     * have offered a choice.
     */
    if (destination === 3) {
      setStaffId(freeStaffFor(next)[0]?.id ?? null);
      setStep(3);
      // Event handler, so Date.now() is legitimate here. Measuring from slot
      // choice rather than form mount also matches what we actually care about:
      // how long a person spent on the final step.
      setStartedAt(Date.now());
      return;
    }

    setStaffId(undefined);
    setStep(destination);
  }

  function selectStaff(next: string) {
    setStaffId(next);
    setStep(3);
    setStartedAt(Date.now());
  }

  /** "Proceed with X" from the sole-provider card. */
  function acceptOnlyStaff(staffMemberId: string) {
    setStaffId(staffMemberId);
    setStep(3);
    setStartedAt(Date.now());
  }

  /** "Choose a different time" — back to the grid, with the slot released. */
  function chooseAnotherTime() {
    setSlot(undefined);
    setStaffId(undefined);
    setStep(2);
  }

  function back() {
    setSubmitError(undefined);
    const destination = stepBefore(step, {
      multiStaff,
      freeStaffCount: slot ? freeStaffFor(slot).length : 0,
      hasSlot: Boolean(slot),
    });
    if (destination !== null) setStep(destination);
  }

  async function submit(details: ClientDetails) {
    if (!service || !slot) return;

    setSubmitting(true);
    setSubmitError(undefined);

    const result = await createBookingAction({
      ...details,
      slug,
      serviceId: service.id,
      startsAt: slot.startsAt,
      // `null` — the explicit "anyone" — is sent as absent, which is what the
      // server reads as "pick the first free provider".
      staffId: staffId ?? undefined,
    });

    setSubmitting(false);

    if (result.ok) {
      setConfirmation(result.appointment);
      return;
    }

    setSubmitError(result.error);

    // The slot went while they were typing — send them back to pick another.
    if (result.code === "SLOT_TAKEN") {
      setSlot(undefined);
      setStep(2);
      // Discard the cached list first: it still contains the slot that was
      // just taken, and it is what the picker renders until the refetch lands.
      setSlots([]);
      setSlotsError(undefined);
      void loadSlots(service.id, date);
    }
  }

  function reset() {
    setConfirmation(undefined);
    setService(undefined);
    setSlot(undefined);
    setStaffId(undefined);
    setDate(today);
    setSlots([]);
    setSubmitError(undefined);
    setStep(1);
  }

  if (confirmation) {
    return (
      <div ref={headingRef}>
        <Confirmation appointment={confirmation} onBookAnother={reset} />
      </div>
    );
  }

  /**
   * The back button is named by **where it lands**, never by where it is. So
   * the details step in a team shop offers "בחירת נותן שירות" rather than
   * promising a calendar it is not returning to.
   */
  const BACK_LABELS: Record<Step, string> = {
    1: "בחירת שירות",
    2: "בחירת מועד",
    staff: "בחירת נותן שירות",
    only: "בחירת נותן שירות",
    3: "פרטים",
  };

  const destination = stepBefore(step, {
    multiStaff,
    freeStaffCount: slot ? freeStaffFor(slot).length : 0,
    hasSlot: Boolean(slot),
  });
  const backLabel = destination === null ? null : BACK_LABELS[destination];

  return (
    <div ref={headingRef}>
      {/* The staff question belongs to "choosing the appointment", so it shows
          as step 2 on the rail rather than adding a fourth marker. */}
      <Stepper current={step === "staff" || step === "only" ? 2 : step} />

      {/* Present on every step but the first, and it says where it goes.
          "חזרה" alone makes someone mid-form guess whether they are about to
          lose what they typed — naming the destination is the difference
          between a control people use and one they avoid. Nothing is
          discarded: the service, the date and the slot all stay in state. */}
      {backLabel ? (
        <div className="px-5 pb-3">
          <button
            type="button"
            onClick={back}
            aria-label={`חזרה ל${backLabel}`}
            className="inline-flex h-10 items-center gap-1 rounded-full bg-white ps-2 pe-3.5 text-sm font-medium text-zinc-600 ring-1 ring-zinc-900/8 transition-[background-color,box-shadow,color] duration-200 ring-inset hover:bg-zinc-50 hover:text-zinc-900 hover:ring-zinc-900/15 focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:outline-none dark:bg-zinc-900 dark:text-zinc-400 dark:ring-white/10 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            <ChevronRight className="size-4 shrink-0" aria-hidden />
            {backLabel}
          </button>
        </div>
      ) : null}

      {/* key forces the enter animation to replay on every step change */}
      <div key={step} className="animate-step pb-8">
        {step === 1 ? (
          <ServiceStep
            services={services}
            selectedId={service?.id}
            onSelect={selectService}
            layout={serviceLayout}
          />
        ) : null}

        {step === 2 && service ? (
          <DateTimeStep
            dates={dates}
            today={today}
            selectedDate={date}
            slots={slots}
            loading={loadingSlots}
            error={slotsError}
            notice={submitError}
            selectedSlot={slot}
            onSelectDate={selectDate}
            onSelectSlot={selectSlot}
            onJoinWaitlist={() => setWaitlistOpen(true)}
          />
        ) : null}

        {step === "only" && slot && freeStaffFor(slot)[0] ? (
          <OnlyStaffStep
            staff={freeStaffFor(slot)[0]}
            timeLabel={slot.label}
            onProceed={() => acceptOnlyStaff(freeStaffFor(slot)[0].id)}
            onChooseAnotherTime={chooseAnotherTime}
          />
        ) : null}

        {step === "staff" && slot ? (
          <StaffStep
            staff={freeStaffFor(slot)}
            timeLabel={slot.label}
            selectedId={staffId ?? undefined}
            onSelect={selectStaff}
          />
        ) : null}

        {step === 3 && service && slot ? (
          <DetailsStep
            service={service}
            slot={slot}
            timezone={business.timezone}
            submitting={submitting}
            serverError={submitError}
            startedAt={startedAt}
            askMarketingConsent={business.retentionEnabled}
            onSubmit={submit}
          />
        ) : null}
      </div>

      {/* The standing offer, for somebody whose day has slots but none that
          suit them — the empty-day button covers the other case. Quiet: it is
          the consolation prize, and it must not compete with booking. */}
      <button
        type="button"
        onClick={() => setWaitlistOpen(true)}
        className="mx-auto mt-6 block text-sm font-semibold text-zinc-500 underline underline-offset-4 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        אין תור פנוי? הצטרפו לרשימת ההמתנה
      </button>

      {waitlistOpen ? (
        <WaitlistDialog
          slug={slug}
          businessName={business.name}
          services={services.map((item) => ({ id: item.id, name: item.name }))}
          onClose={() => setWaitlistOpen(false)}
        />
      ) : null}
    </div>
  );
}
