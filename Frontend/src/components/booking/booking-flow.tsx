"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";

import {
  createBookingAction,
  fetchSlotsAction,
  type BookingConfirmation,
} from "@/app/[slug]/actions";
import type { SlotWithStaff } from "@/lib/availability";
import { dateRange, todayInTimezone } from "@/lib/format";
import type { ClientDetails } from "@/lib/validation";

import { Confirmation } from "./confirmation";
import { DateTimeStep } from "./datetime-step";
import { DetailsStep } from "./details-step";
import { OnlyStaffStep } from "./only-staff-step";
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
};

/**
 * `"staff"` and `"only"` sit between choosing a time and entering details —
 * pick from several free providers, or acknowledge the one free provider — but
 * the Stepper still shows three. Picking who performs the service is part of
 * choosing the appointment, not a fourth thing to do, and a rail that grew a
 * marker only for some tenants would make the flow look longer than it is.
 */
type Step = 1 | 2 | "staff" | "only" | 3;

export function BookingFlow({ slug, business, services, staff }: Props) {
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

  // Move focus to the top of each step so screen readers and thumbs agree.
  useEffect(() => {
    headingRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
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
    if (!multiStaff) return 3;
    return freeStaffFor(next).length > 1 ? "staff" : "only";
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

  function selectStaff(next: string | null) {
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
    setStep((s) => {
      if (s === 3) {
        // Back from the details form returns to whichever question was asked,
        // and straight to the grid when none was.
        return slot ? stepAfterSlot(slot) : 2;
      }
      return s === "staff" || s === "only" ? 2 : 1;
    });
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

  return (
    <div ref={headingRef}>
      {/* The staff question belongs to "choosing the appointment", so it shows
          as step 2 on the rail rather than adding a fourth marker. */}
      <Stepper current={step === "staff" || step === "only" ? 2 : step} />

      {step !== 1 ? (
        <div className="px-5 pb-3">
          <button
            type="button"
            onClick={back}
            className="-me-2 inline-flex items-center gap-1 rounded-lg py-1 pe-2 text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:outline-none dark:hover:text-zinc-100"
          >
            <ChevronRight className="size-4" aria-hidden />
            חזרה
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
            selectedId={staffId}
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
            onSubmit={submit}
          />
        ) : null}
      </div>
    </div>
  );
}
