import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The recovery callback, tested at the seam that actually broke in production.
 *
 * The bug this file exists to prevent is not "the exchange fails" — it is "the
 * exchange succeeds and the session does not survive the redirect". That is
 * invisible to a type checker and to every test that only asserts a status
 * code, and it costs the owner a **single-use token**: by the time they see
 * "link invalid", it is spent.
 *
 * `createServerClient` is mocked because the point is the cookie plumbing
 * around it, not Supabase's verification. The mock invokes `setAll` exactly the
 * way the real library does on a successful exchange.
 */

const setAllSpy = vi.hoisted(() => vi.fn());
const verifyOtp = vi.hoisted(() => vi.fn());
const exchangeCodeForSession = vi.hoisted(() => vi.fn());

vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    options: {
      cookies: {
        setAll: (
          list: { name: string; value: string; options: object }[],
        ) => void;
      };
    },
  ) => {
    setAllSpy.mockImplementation(options.cookies.setAll);
    return {
      auth: {
        verifyOtp: async (...args: unknown[]) => {
          const result = await verifyOtp(...args);
          // The real client writes the session through `setAll` on success.
          if (!result.error) {
            options.cookies.setAll([
              { name: "sb-access-token", value: "tok", options: {} },
              { name: "sb-refresh-token", value: "ref", options: {} },
            ]);
          }
          return result;
        },
        exchangeCodeForSession: async (...args: unknown[]) => {
          const result = await exchangeCodeForSession(...args);
          if (!result.error) {
            options.cookies.setAll([
              { name: "sb-access-token", value: "tok", options: {} },
            ]);
          }
          return result;
        },
      },
    };
  },
}));

vi.mock("@/lib/observability", () => ({
  reportWarning: vi.fn(),
  reportError: vi.fn(),
}));

const ORIGIN = "https://bazman.app";

async function call(query: string) {
  const { GET } = await import("./route");
  return GET(new NextRequest(`${ORIGIN}/auth/confirm${query}`));
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
});

describe("GET /auth/confirm", () => {
  it("carries the session cookies on the redirect it returns", async () => {
    verifyOtp.mockResolvedValue({ error: null });

    const response = await call("?token_hash=abc&type=recovery&next=/login/reset");

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/login/reset`);

    // The whole point: the session must be on *this* response. Writing it into
    // the ambient cookie store and signalling the redirect by throwing left it
    // depending on the framework flushing a mutated store onto a thrown
    // redirect — an implementation detail to stake a single-use token on.
    expect(response.cookies.get("sb-access-token")?.value).toBe("tok");
    expect(response.cookies.get("sb-refresh-token")?.value).toBe("ref");
  });

  it("hardens every cookie it writes", async () => {
    verifyOtp.mockResolvedValue({ error: null });

    const response = await call("?token_hash=abc&type=recovery");
    const cookie = response.cookies.get("sb-access-token");

    // A session minted from a recovery link must be no weaker than one minted
    // by signing in, so it goes through the same `hardenCookieOptions`.
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("lax");
    expect(cookie?.path).toBe("/");
  });

  it("defaults to the reset form when Supabase drops the next parameter", async () => {
    // Supabase rewrites `redirect_to` on its way through, so `next` is not
    // guaranteed to survive. Losing it must not strand the owner.
    verifyOtp.mockResolvedValue({ error: null });

    const response = await call("?token_hash=abc&type=recovery");
    expect(response.headers.get("location")).toBe(`${ORIGIN}/login/reset`);
  });

  it("refuses an off-origin next and still completes the exchange", async () => {
    verifyOtp.mockResolvedValue({ error: null });

    const response = await call(
      "?token_hash=abc&type=recovery&next=https://evil.example/steal",
    );

    expect(response.headers.get("location")).toBe(`${ORIGIN}/login/reset`);
  });

  it("accepts the PKCE code shape too", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });

    const response = await call("?code=pkce-code");

    expect(exchangeCodeForSession).toHaveBeenCalledWith("pkce-code");
    expect(response.headers.get("location")).toBe(`${ORIGIN}/login/reset`);
    expect(response.cookies.get("sb-access-token")?.value).toBe("tok");
  });

  it("sends a rejected link to the forgot page with no session on it", async () => {
    verifyOtp.mockResolvedValue({ error: { message: "Token has expired" } });

    const response = await call("?token_hash=stale&type=recovery");

    expect(response.headers.get("location")).toBe(
      `${ORIGIN}/login/forgot?error=link`,
    );
    // A half-written session on a failure would land the owner on a page that
    // looks signed in while the exchange did not happen.
    expect(response.cookies.get("sb-access-token")).toBeUndefined();
  });

  it("refuses a link type this app never issues", async () => {
    // `type` comes straight off the query string. Relaying an arbitrary value
    // to verifyOtp would let a link ask for a verification this app does not
    // mint.
    const response = await call("?token_hash=abc&type=phone_change");

    expect(verifyOtp).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      `${ORIGIN}/login/forgot?error=link`,
    );
  });

  it("says so plainly when Supabase is not configured", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;

    const response = await call("?token_hash=abc&type=recovery");

    expect(response.headers.get("location")).toBe(
      `${ORIGIN}/login/forgot?error=unconfigured`,
    );
  });
});
