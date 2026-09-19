import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  isEmailSendFailure,
  isServerFailure,
  readGotrueBody,
  usableMessage,
} from "@/lib/auth-errors";
import {
  keepingAuthFailures,
  type AuthServerFailure,
} from "@/lib/supabase/server";

/**
 * The reported sign-up bug, held against a stand-in for Supabase Auth.
 *
 * ---------------------------------------------------------------------------
 * **Both halves are pinned here because the first one is not ours.** From
 * auth-js 2.108 a 500 is treated as a transport failure and its body is never
 * read, so the error that reaches a Server Action says `{}` — no status text,
 * no cause, nothing to put in a log. A project whose SMTP is misconfigured
 * therefore fails every sign-up with two characters, which is exactly what an
 * owner photographed and sent us.
 *
 * A real client is used, against a real socket, because the whole point is the
 * behaviour of the library rather than of our code: an upgrade that starts
 * reading the body again would turn the first test red, which is the day the
 * wrapper can go.
 * ---------------------------------------------------------------------------
 */

/** What GoTrue answers with when the confirmation mail cannot be sent. */
const EMAIL_FAILED =
  '{"code":"unexpected_failure","msg":"Error sending confirmation email"}';

let server: Server;
let url: string;
let status = 500;
let body = EMAIL_FAILED;
/** Every request the stand-in received, so the sign-up's own query is readable. */
const seen: { path: string; query: string }[] = [];

beforeAll(async () => {
  server = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      const target = new URL(request.url ?? "/", "http://localhost");
      seen.push({ path: target.pathname, query: target.search });
      response.writeHead(status, { "content-type": "application/json" });
      response.end(body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
  status = 500;
  body = EMAIL_FAILED;
  seen.length = 0;
});

const client = (onFailure?: (failure: AuthServerFailure) => void) =>
  createClient(url, "stand-in-anon-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    ...(onFailure ? { global: { fetch: keepingAuthFailures(onFailure) } } : {}),
  });

describe("a 500 from Supabase Auth", () => {
  it("reaches the caller as `{}`, with nothing else to go on", async () => {
    const { data, error } = await client().auth.signUp({
      email: "owner@example.com",
      password: "Sufficiently-long-1",
    });

    expect(data.user).toBeNull();
    expect(error?.message).toBe("{}");
    expect(usableMessage(error?.message)).toBeNull();
    expect(isServerFailure({ status: error?.status })).toBe(true);
  });

  it("keeps the sentence behind it, and names the call that failed", async () => {
    const failures: AuthServerFailure[] = [];

    const { error } = await client((failure) =>
      failures.push(failure),
    ).auth.signUp({
      email: "owner@example.com",
      password: "Sufficiently-long-1",
    });

    // Untouched for the caller: the wrapper reads a clone.
    expect(error?.message).toBe("{}");

    expect(failures).toHaveLength(1);
    expect(failures[0].status).toBe(500);
    expect(failures[0].path).toBe("/auth/v1/signup");

    const said = readGotrueBody(failures[0].body);
    expect(said).toEqual({
      message: "Error sending confirmation email",
      code: "unexpected_failure",
    });
    // Which is the one 500 an owner can be told something true about.
    expect(isEmailSendFailure(said)).toBe(true);
  });

  it("sends the confirmation link back to our own handler", async () => {
    await client().auth.signUp({
      email: "owner@example.com",
      password: "Sufficiently-long-1",
      options: {
        emailRedirectTo: "https://bazman.app/auth/confirm?next=/dashboard",
      },
    });

    const signup = seen.find((request) => request.path === "/auth/v1/signup");
    expect(signup?.query).toContain(
      encodeURIComponent("https://bazman.app/auth/confirm?next=/dashboard"),
    );
  });

  it("leaves an ordinary rejection alone", async () => {
    status = 400;
    body = '{"code":"email_address_invalid","msg":"Email address is invalid"}';
    const failures: AuthServerFailure[] = [];

    const { error } = await client((failure) =>
      failures.push(failure),
    ).auth.signUp({
      email: "owner@example.com",
      password: "Sufficiently-long-1",
    });

    // The client reads the body itself at this status, so there is a message
    // to show and nothing for the wrapper to keep.
    expect(error?.message).toBe("Email address is invalid");
    expect(isServerFailure({ status: error?.status })).toBe(false);
    expect(failures).toEqual([]);
  });
});
