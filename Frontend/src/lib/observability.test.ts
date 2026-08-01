import { afterEach, describe, expect, it, vi } from "vitest";

import { reportError, reportWarning } from "@/lib/observability";

afterEach(() => {
  vi.restoreAllMocks();
});

function captureError() {
  return vi.spyOn(console, "error").mockImplementation(() => {});
}

describe("reportError", () => {
  it("emits a single parseable JSON line", () => {
    const spy = captureError();
    reportError("booking.create", new Error("boom"));

    expect(spy).toHaveBeenCalledTimes(1);
    const line = spy.mock.calls[0][0] as string;
    expect(line.split("\n")).toHaveLength(1);

    const parsed = JSON.parse(line);
    expect(parsed).toMatchObject({
      severity: "error",
      scope: "booking.create",
      message: "boom",
    });
    expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("keeps the stack for real errors", () => {
    const spy = captureError();
    reportError("booking.create", new Error("boom"));
    expect(JSON.parse(spy.mock.calls[0][0] as string).stack).toContain("boom");
  });

  it("handles a thrown non-Error without crashing the reporter", () => {
    const spy = captureError();
    reportError("cron.dispatch", "just a string");
    expect(JSON.parse(spy.mock.calls[0][0] as string).message).toBe(
      "just a string",
    );
  });

  it("redacts client identifiers that reach the context by accident", () => {
    const spy = captureError();
    reportError("booking.create", new Error("boom"), {
      businessId: "abc-123",
      clientPhone: "0501234567",
      clientEmail: "someone@example.com",
      cancelToken: "secret-token",
      clientName: "דני",
      slotCount: 12,
    });

    const { context } = JSON.parse(spy.mock.calls[0][0] as string);
    expect(context.clientPhone).toBe("[redacted]");
    expect(context.clientEmail).toBe("[redacted]");
    expect(context.cancelToken).toBe("[redacted]");
    expect(context.clientName).toBe("[redacted]");
    // Non-identifying fields survive — they are the useful part.
    expect(context.businessId).toBe("abc-123");
    expect(context.slotCount).toBe(12);
  });

  it("routes warnings to console.warn", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = captureError();

    reportWarning("antispam.honeypot", "honeypot filled", { businessId: "b1" });

    expect(error).not.toHaveBeenCalled();
    expect(JSON.parse(warn.mock.calls[0][0] as string)).toMatchObject({
      severity: "warning",
      scope: "antispam.honeypot",
      message: "honeypot filled",
    });
  });
});
