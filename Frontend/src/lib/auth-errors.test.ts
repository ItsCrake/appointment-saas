import { describe, expect, it } from "vitest";

import { isAlreadyRegistered, isRateLimited } from "@/lib/auth-errors";

describe("isRateLimited", () => {
  it("recognises the status, which is the stable signal", () => {
    expect(isRateLimited({ status: 429 })).toBe(true);
  });

  it("recognises the error codes Supabase sends", () => {
    expect(isRateLimited({ code: "over_email_send_rate_limit" })).toBe(true);
    expect(isRateLimited({ code: "over_request_rate_limit" })).toBe(true);
  });

  it("still matches the prose older versions send with a 400", () => {
    // The message is prose Supabase is free to reword, so it is the last
    // resort rather than the primary check — but dropping it would silently
    // reintroduce the bug on a project that has not been upgraded.
    expect(
      isRateLimited({
        status: 400,
        message:
          "For security purposes, you can only request this after 41 seconds",
      }),
    ).toBe(true);
    expect(isRateLimited({ message: "Email rate limit exceeded" })).toBe(true);
  });

  it("does not mistake an ordinary rejection for a throttle", () => {
    // Getting this wrong in this direction is the expensive one: it would tell
    // an owner to wait a few minutes for a failure that waiting cannot fix.
    expect(
      isRateLimited({ status: 400, message: "Invalid login credentials" }),
    ).toBe(false);
    expect(
      isRateLimited({ status: 422, message: "User already registered" }),
    ).toBe(false);
    expect(isRateLimited({})).toBe(false);
  });
});

describe("isAlreadyRegistered", () => {
  it("recognises both shapes Supabase uses for a duplicate address", () => {
    expect(isAlreadyRegistered({ code: "user_already_exists" })).toBe(true);
    expect(isAlreadyRegistered({ code: "email_exists" })).toBe(true);
    expect(
      isAlreadyRegistered({ status: 422, message: "User already registered" }),
    ).toBe(true);
  });

  it("does not fire on an unrelated rejection", () => {
    expect(
      isAlreadyRegistered({
        message: "Password should be at least 6 characters",
      }),
    ).toBe(false);
    expect(isAlreadyRegistered({})).toBe(false);
  });

  it("is disjoint from isRateLimited on every case either one claims", () => {
    // Both predicates run against the same error in signUp, in order. If they
    // ever overlapped, the reader would be told to wait for a problem that
    // waiting does not fix.
    const cases = [
      { status: 429 },
      { code: "over_email_send_rate_limit" },
      { code: "user_already_exists" },
      { status: 422, message: "User already registered" },
      { message: "Email rate limit exceeded" },
    ];

    for (const error of cases) {
      expect(isRateLimited(error) && isAlreadyRegistered(error)).toBe(false);
    }
  });
});
