import { describe, expect, it, vi } from "vitest";

import { callAuthAction } from "./call-action";

/**
 * The bug this file exists to prevent: a *successful* sign-in showing the
 * connection-error toast.
 *
 * `redirect()` reports success by throwing, and that control-flow error reaches
 * the client — the action promise rejects while the router navigates. A bare
 * catch therefore turns every successful login into `{ ok: false }`, and the
 * reader is told the connection dropped while being taken to their dashboard.
 */
describe("callAuthAction", () => {
  it("passes a normal result straight through", async () => {
    await expect(
      callAuthAction(async () => ({ ok: true, message: "בדקו את המייל" })),
    ).resolves.toEqual({ ok: true, message: "בדקו את המייל" });
  });

  /**
   * The regression. Built with the real `redirect()` rather than a hand-made
   * error object, so it keeps testing the thing Next actually throws even if
   * the internal shape of that error changes.
   */
  it("lets a redirect through instead of reporting it as a failure", async () => {
    const { redirect } = await import("next/navigation");

    await expect(
      // `redirect` returns `never`, so returning it satisfies the signature
      // while still throwing exactly what Next throws.
      callAuthAction(async () => redirect("/dashboard")),
    ).rejects.toThrow();
  });

  it("does not log a redirect as an error", async () => {
    const { redirect } = await import("next/navigation");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    await callAuthAction(async () => redirect("/dashboard")).catch(() => {});

    // A successful login must not leave "auth action failed" in the console.
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  /**
   * The behaviour that must survive the fix: a genuine transport failure — the
   * platform returning an HTML error page where the action's reply belonged —
   * still becomes something a business owner can act on.
   */
  it("still turns a real transport failure into readable Hebrew", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await callAuthAction(async () => {
      throw new SyntaxError(
        `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`,
      );
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("רעננו את הדף");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
