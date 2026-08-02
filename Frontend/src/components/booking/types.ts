export type BookingBusiness = {
  id: string;
  name: string;
  timezone: string;
  maxAdvanceDays: number;
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
