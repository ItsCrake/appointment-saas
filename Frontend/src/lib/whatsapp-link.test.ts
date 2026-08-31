import { describe, expect, it } from "vitest";

import { toE164 } from "@/lib/notifications/providers";
import { whatsappHref } from "./whatsapp-link";

describe("whatsappHref", () => {
  it("turns the stored local form into an international wa.me link", () => {
    expect(whatsappHref("0501234567")).toBe("https://wa.me/972501234567");
  });

  it("accepts every shape a person actually types", () => {
    // The booking form, the manual dialog and a pasted contact card all end up
    // in the same column, and they do not agree on separators.
    for (const typed of [
      "050-123-4567",
      "050 123 4567",
      "+972501234567",
      "00972501234567",
      "972501234567",
    ]) {
      expect(whatsappHref(typed)).toBe("https://wa.me/972501234567");
    }
  });

  it("does not staple a country code onto a number that has one", () => {
    // A foreign number normalises without a leading zero, and the old inline
    // rule would have left it alone too — but only by accident. This pins it.
    expect(whatsappHref("+441234567890")).toBe("https://wa.me/441234567890");
  });

  it("returns null rather than a link to nobody", () => {
    /**
     * A manual booking may carry no phone at all, on purpose — a walk-in
     * without a number is still a booking. A button that opens an error page
     * is worse than no button, so the caller gets something it can branch on.
     */
    for (const empty of [null, undefined, "", "   ", "abc", "12345"]) {
      expect(whatsappHref(empty)).toBeNull();
    }
  });

  it("agrees with toE164 on what the international number is", () => {
    /**
     * The guarantee that matters. These are two conversions of the same value
     * for two different consumers — Meta and Twilio want `+9725…`, `wa.me`
     * wants bare digits — and the moment they disagree, a client gets a
     * reminder on one number and the owner opens a chat with another.
     */
    for (const typed of ["0501234567", "+972501234567", "050-123-4567"]) {
      const href = whatsappHref(typed);
      expect(href).toBe(`https://wa.me/${toE164(typed).replace("+", "")}`);
    }
  });
});
