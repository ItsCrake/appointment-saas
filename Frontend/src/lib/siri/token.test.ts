import { describe, expect, it } from "vitest";

import {
  generateSiriToken,
  looksLikeSiriToken,
  readSiriToken,
  SIRI_TOKEN_PREFIX,
} from "./token";

/**
 * The credential itself: its shape, and where a request is allowed to carry it.
 *
 * This token reads a business's whole upcoming calendar with no session behind
 * it, so the two properties that matter are that it is unguessable and that a
 * near-miss is refused rather than rounded to a lookup.
 */
describe("generateSiriToken", () => {
  it("is prefixed, so a leaked one is identifiable", () => {
    // Four characters buys the thing a secret scanner needs: a shape. A bare
    // random string in a paste is indistinguishable from any other id.
    expect(generateSiriToken().startsWith(SIRI_TOKEN_PREFIX)).toBe(true);
  });

  it("carries 192 bits in a URL-safe alphabet", () => {
    /**
     * `base64url` rather than hex: the same entropy in two thirds the
     * characters, and no escaping when Apple Shortcuts concatenates it into a
     * query string. 24 bytes is 32 characters.
     */
    const token = generateSiriToken();
    expect(token).toHaveLength(SIRI_TOKEN_PREFIX.length + 32);
    expect(token.slice(SIRI_TOKEN_PREFIX.length)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("does not repeat", () => {
    const many = new Set(Array.from({ length: 500 }, generateSiriToken));
    expect(many.size).toBe(500);
  });
});

describe("looksLikeSiriToken", () => {
  it("accepts what the generator makes", () => {
    expect(looksLikeSiriToken(generateSiriToken())).toBe(true);
  });

  it.each([
    ["", "empty"],
    ["admin", "a guess"],
    ["bzm_", "prefix only"],
    ["bzm_short", "too short"],
    [`${SIRI_TOKEN_PREFIX}${"a".repeat(33)}`, "too long"],
    [`${SIRI_TOKEN_PREFIX}${"a".repeat(31)}+`, "an alphabet it does not use"],
    [`xyz_${"a".repeat(32)}`, "the wrong prefix"],
  ])("refuses %s (%s)", (value) => {
    expect(looksLikeSiriToken(value)).toBe(false);
  });

  it("refuses anything that is not a string", () => {
    // A query string always yields strings, but the header path and a future
    // JSON body do not, and `null` reaching a database lookup as a value is
    // how a `WHERE token IS NULL` match gets invented.
    for (const value of [null, undefined, 42, {}, []]) {
      expect(looksLikeSiriToken(value)).toBe(false);
    }
  });
});

/** A minimal stand-in for the shape `readSiriToken` accepts. */
const request = (options: { auth?: string; query?: string }) => ({
  headers: { get: (name: string) => (name === "authorization" ? (options.auth ?? null) : null) },
  url: `https://bazman.app/api/siri/v1${options.query ?? ""}`,
});

describe("readSiriToken", () => {
  const token = generateSiriToken();

  it("prefers the header, which is the one that stays out of logs", () => {
    expect(readSiriToken(request({ auth: `Bearer ${token}` }))).toBe(token);
  });

  it("accepts a bare token in the header", () => {
    // Half the Shortcuts tutorials omit the scheme, and an owner who pastes
    // the token alone should get their calendar rather than a 401 they have no
    // way to debug.
    expect(readSiriToken(request({ auth: token }))).toBe(token);
  });

  it("falls back to the query string, which is what Shortcuts builds", () => {
    expect(readSiriToken(request({ query: `?token=${token}` }))).toBe(token);
  });

  it("takes the header over the query when both are present", () => {
    const other = generateSiriToken();
    expect(
      readSiriToken(request({ auth: `Bearer ${token}`, query: `?token=${other}` })),
    ).toBe(token);
  });

  it("returns null rather than a malformed value", () => {
    /**
     * The gate in front of the database. A scanner spraying `?token=admin`
     * should cost a regex, not an indexed lookup — and more importantly, a
     * malformed value must never reach a query where an empty string could
     * match a column that happens to be empty.
     */
    expect(readSiriToken(request({}))).toBeNull();
    expect(readSiriToken(request({ query: "?token=" }))).toBeNull();
    expect(readSiriToken(request({ query: "?token=admin" }))).toBeNull();
    expect(readSiriToken(request({ auth: "Bearer nope" }))).toBeNull();
  });

  it("ignores surrounding whitespace, which a paste brings along", () => {
    expect(readSiriToken(request({ auth: `Bearer   ${token}  ` }))).toBe(token);
  });
});
