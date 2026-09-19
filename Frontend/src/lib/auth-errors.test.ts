import { describe, expect, it } from "vitest";

import {
  isAlreadyRegistered,
  isEmailSendFailure,
  isRateLimited,
  isServerFailure,
  readGotrueBody,
  usableMessage,
} from "@/lib/auth-errors";

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

describe("usableMessage", () => {
  it("rejects the `{}` the client builds from a 5xx", () => {
    /**
     * The exact string an owner photographed on the sign-up form. auth-js
     * stringifies the `Response` without reading it, and a `Response` has no
     * enumerable own properties — see the note on the function.
     */
    expect(usableMessage("{}")).toBeNull();
    expect(usableMessage(" {} ")).toBeNull();
    expect(usableMessage("[object Object]")).toBeNull();
  });

  it("treats nothing at all as nothing", () => {
    expect(usableMessage("")).toBeNull();
    expect(usableMessage("   ")).toBeNull();
    expect(usableMessage(undefined)).toBeNull();
    expect(usableMessage(null)).toBeNull();
  });

  it("keeps a message a reader could act on, trimmed", () => {
    expect(usableMessage("  Invalid login credentials ")).toBe(
      "Invalid login credentials",
    );
    // A body that happens to be JSON is still words on a screen.
    expect(usableMessage('{"msg":"nope"}')).toBe('{"msg":"nope"}');
  });
});

describe("isServerFailure", () => {
  it("claims every 5xx, which is what auth-js hides behind `{}`", () => {
    for (const status of [500, 502, 503, 504, 520]) {
      expect(isServerFailure({ status })).toBe(true);
    }
  });

  it("leaves a rejection of the request alone", () => {
    for (const status of [400, 401, 422, 429]) {
      expect(isServerFailure({ status })).toBe(false);
    }
    // A transport failure that never reached the server answers status 0.
    expect(isServerFailure({ status: 0 })).toBe(false);
    expect(isServerFailure({})).toBe(false);
  });
});

describe("readGotrueBody", () => {
  it("reads the shape GoTrue answers a failure with", () => {
    expect(
      readGotrueBody(
        '{"code":"unexpected_failure","msg":"Error sending confirmation email"}',
      ),
    ).toEqual({
      message: "Error sending confirmation email",
      code: "unexpected_failure",
    });
  });

  it("reads the older pair too", () => {
    expect(
      readGotrueBody(
        '{"error":"server_error","error_description":"Error sending confirmation email","error_code":"unexpected_failure"}',
      ),
    ).toEqual({
      message: "Error sending confirmation email",
      code: "unexpected_failure",
    });
  });

  it("answers nothing where there was nothing to read", () => {
    const nothing = { message: null, code: null };
    // A gateway's HTML page, an empty 502, and the empty object itself.
    expect(readGotrueBody("<html>504 Gateway Time-out</html>")).toEqual(
      nothing,
    );
    expect(readGotrueBody("{}")).toEqual(nothing);
    expect(readGotrueBody("")).toEqual(nothing);
    expect(readGotrueBody(undefined)).toEqual(nothing);
    expect(readGotrueBody("null")).toEqual(nothing);
  });
});

describe("isEmailSendFailure", () => {
  it("recognises the send that failed, whichever mail it was", () => {
    for (const message of [
      "Error sending confirmation email",
      "Error sending magic link email",
      "Error sending recovery email",
      "500: failed to make smtp connection",
    ]) {
      expect(isEmailSendFailure({ message, code: "unexpected_failure" })).toBe(
        true,
      );
    }
    expect(
      isEmailSendFailure({ message: null, code: "email_provider_disabled" }),
    ).toBe(true);
  });

  it("does not claim the other 500s", () => {
    // This one is a trigger on `auth.users`, and telling an owner to wait for
    // an email that was never the problem would send them nowhere.
    expect(
      isEmailSendFailure({
        message: "Database error saving new user",
        code: "unexpected_failure",
      }),
    ).toBe(false);
    expect(isEmailSendFailure({ message: null, code: null })).toBe(false);
  });
});
