export type BookingBusiness = {
  id: string;
  name: string;
  timezone: string;
  maxAdvanceDays: number;
  /** When false the staff step never renders and the sole provider is implicit. */
  hasMultipleStaff: boolean;
};

/** A provider, as the public picker needs them. No ids beyond the one. */
export type BookingStaff = {
  id: string;
  name: string;
  title: string | null;
};

export type BookingService = {
  id: string;
  name: string;
  description: string | null;
  durationMin: number;
  priceCents: number;
  currency: string;
  imageUrl: string | null;
};

/** The subset of a working_hours row the public page renders. */
export type BookingHours = {
  weekday: number;
  /** Wall-clock "HH:mm:ss" in the business timezone. */
  startTime: string;
  endTime: string;
  isClosed: boolean;
};
