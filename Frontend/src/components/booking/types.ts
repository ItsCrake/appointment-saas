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
