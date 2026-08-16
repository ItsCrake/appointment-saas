import { describe, expect, it } from "vitest";

import {
  EMPTY_DRAFT,
  fallbackPrompt,
  libiExtractionSchema,
  mergeDraft,
  missingFieldsFor,
  REQUIRED_FIELDS,
  splitLocal,
} from "./libi-schema";

/**
 * The rules that decide what a Hebrew utterance *means*, tested without an API
 * key. The model call is not exercised here on purpose — mocking it would prove
 * only that the mock returns what it was told to.
 */

describe("missingFieldsFor", () => {
  it("names every required field on an empty draft", () => {
    expect(missingFieldsFor(EMPTY_DRAFT)).toEqual([...REQUIRED_FIELDS]);
  });

  it("returns nothing when the draft is complete", () => {
    expect(
      missingFieldsFor({
        serviceId: "svc-1",
        startLocal: "2026-08-20T10:00",
        clientName: "דני",
        clientPhone: "0501234567",
      }),
    ).toEqual([]);
  });

  it("treats a blank string as missing, not as an answer", () => {
    // A model that returns "" rather than null would otherwise produce a
    // booking with an empty client name, which the action would then reject
    // with a validation error the owner cannot act on.
    expect(
      missingFieldsFor({
        serviceId: "svc-1",
        startLocal: "2026-08-20T10:00",
        clientName: "   ",
        clientPhone: "0501234567",
      }),
    ).toEqual(["clientName"]);
  });

  it("asks in a fixed order, so the conversation is predictable", () => {
    expect(missingFieldsFor(EMPTY_DRAFT)).toEqual([
      "serviceId",
      "startLocal",
      "clientName",
      "clientPhone",
    ]);
  });
});

describe("mergeDraft", () => {
  it("fills a field the previous turn did not have", () => {
    const merged = mergeDraft(
      { ...EMPTY_DRAFT, clientName: "דני" },
      { serviceId: "svc-1", clientName: null },
    );
    expect(merged.clientName).toBe("דני");
    expect(merged.serviceId).toBe("svc-1");
  });

  /**
   * The property the whole multi-turn flow rests on. The second utterance
   * ("לתספורת") mentions nothing but the service, so every other field comes
   * back null — and if null cleared the draft, the conversation could never
   * reach a complete booking.
   */
  it("never lets a null erase a value already gathered", () => {
    const previous = {
      clientName: "דני",
      clientPhone: "0501234567",
      serviceId: "svc-1",
      startLocal: "2026-08-20T10:00",
      notes: "ליד החלון",
    };
    expect(mergeDraft(previous, { ...EMPTY_DRAFT })).toEqual(previous);
  });

  it("lets a later utterance correct an earlier field", () => {
    // "לא, בשתיים" has to be able to overwrite the time.
    const merged = mergeDraft(
      { ...EMPTY_DRAFT, startLocal: "2026-08-20T10:00" },
      { startLocal: "2026-08-20T14:00" },
    );
    expect(merged.startLocal).toBe("2026-08-20T14:00");
  });

  it("ignores a whitespace-only correction", () => {
    const merged = mergeDraft(
      { ...EMPTY_DRAFT, clientName: "דני" },
      { clientName: "  " },
    );
    expect(merged.clientName).toBe("דני");
  });
});

describe("the extraction schema", () => {
  const valid = {
    clientName: "דני",
    clientPhone: null,
    serviceId: "svc-1",
    startLocal: "2026-08-20T10:00",
    notes: null,
    confidence: "high",
    missingFields: ["clientPhone"],
    feedbackMessage: "מה הטלפון של דני?",
  };

  it("accepts a partial extraction — the normal case, not an error", () => {
    expect(libiExtractionSchema.safeParse(valid).success).toBe(true);
  });

  /**
   * The regex is what stops the model handing back an instant with an offset.
   * Timezone arithmetic belongs to `fromZonedTime` at the server boundary; a
   * model doing it would be wrong twice a year, silently.
   */
  it("rejects an ISO instant in place of a local wall clock", () => {
    const withOffset = { ...valid, startLocal: "2026-08-20T10:00:00+03:00" };
    expect(libiExtractionSchema.safeParse(withOffset).success).toBe(false);
  });

  it("rejects an impossible wall-clock time", () => {
    expect(
      libiExtractionSchema.safeParse({
        ...valid,
        startLocal: "2026-08-20T25:00",
      }).success,
    ).toBe(false);
  });

  it("rejects a confidence value outside the three it may return", () => {
    expect(
      libiExtractionSchema.safeParse({ ...valid, confidence: "certain" })
        .success,
    ).toBe(false);
  });
});

describe("splitLocal", () => {
  it("splits into the two fields the booking action takes", () => {
    expect(splitLocal("2026-08-20T14:30")).toEqual({
      date: "2026-08-20",
      time: "14:30",
    });
  });
});

describe("fallbackPrompt", () => {
  it("asks for the first missing field in Hebrew", () => {
    expect(fallbackPrompt(["clientPhone"])).toContain("מספר טלפון");
  });

  it("does not ask anything when nothing is missing", () => {
    expect(fallbackPrompt([])).not.toContain("מה ");
  });
});
