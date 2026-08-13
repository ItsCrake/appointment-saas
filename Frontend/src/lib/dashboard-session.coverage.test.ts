import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * ARCHITECTURE.md warned that a per-action write gate with partial coverage is
 * *worse* than no gate, because it looks safe. This test is the answer to that:
 * coverage is checked mechanically, so an action that forgets `requireWritable`
 * fails the build instead of quietly shipping a hole.
 *
 * It reads source text rather than importing the modules. A `"use server"` file
 * cannot be imported into a plain test environment, and more importantly the
 * property being checked is *syntactic* — "does every exported action name a
 * guard" — which is exactly what a reviewer would scan for and exactly what a
 * reviewer eventually misses.
 */

const APP_DIR = path.resolve(process.cwd(), "src/app");

/** Guards that count as gating a mutation. */
const WRITE_GUARDS = ["requireWritable", "requireSuperAdmin"];

/**
 * Actions allowed to run without a write guard, each with the reason it is
 * safe. **Adding a name here is the deliberate act** — the point is that
 * skipping the gate cannot happen by omission.
 */
const EXEMPT: Record<string, string> = {
  // Onboarding runs before a business can be frozen: `requireBusiness()` (and
  // therefore the freeze check) redirects an unfinished tenant into setup, so
  // gating setup on it would be circular. Guarded by requireUser /
  // requireBusinessForSetup instead.
  "dashboard/setup/actions.ts:saveBusinessDetailsAction": "onboarding",
  "dashboard/setup/actions.ts:saveStarterServicesAction": "onboarding",
  "dashboard/setup/actions.ts:saveSetupHoursAction": "onboarding",
  "dashboard/setup/actions.ts:savePlanAction": "onboarding",
  "dashboard/setup/actions.ts:completeOnboardingAction": "onboarding",

  // Public surfaces. Not session-guarded by design: the booking flow is
  // unauthenticated, and both resolve the tenant through
  // `getActiveBusinessBySlug`, which filters on is_active — so a frozen tenant
  // takes no new bookings either.
  "[slug]/actions.ts:fetchSlotsAction": "public booking flow",
  "[slug]/actions.ts:createBookingAction": "public booking flow",
  // Reads one client's own appointments at one shop. There is no session to
  // gate on — the phone number is the whole claim, which is why LOOKUP_RULES
  // is the tightest non-auth limit in the app. Writes nothing.
  "[slug]/my-appointments/actions.ts:lookupMyAppointmentsAction":
    "public client lookup",
  // Token-guarded: the cancel link is the credential.
  "b/[token]/actions.ts:cancelBookingAction": "signed cancel token",

  // A **read**, and the drawer that calls it is the clients page's own detail
  // view. Guarded by `requireBusiness()`, which resolves the tenant from the
  // session and scopes every query in it — so the write gate is the wrong
  // question. A frozen tenant keeps their records, and this writes nothing.
  "dashboard/clients/actions.ts:loadClientProfileAction": "tenant-scoped read",

  // Auth entry points. There is no session to gate on yet.
  "login/actions.ts:signInAction": "auth entry point",
  "login/actions.ts:signUpAction": "auth entry point",
  "login/actions.ts:signOutAction": "auth entry point",
  // Reset request is anonymous by necessity — the whole point is that the
  // caller cannot sign in. Guarded by AUTH_RULES instead.
  "login/actions.ts:requestPasswordResetAction": "auth entry point",
  // The emailed link is the credential, and it writes to auth.users rather
  // than to any tenant table, so a business write gate has nothing to say
  // about it. It re-checks the session itself via getUser().
  "login/actions.ts:updatePasswordAction": "auth entry point",

  // Only ever removes access, and requiring the role to *stop* impersonating
  // would strand an admin whose roster entry changed mid-session.
  "master/actions.ts:stopImpersonationAction": "drops privilege only",
};

function findActionFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) findActionFiles(full, acc);
    else if (/actions\.ts$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

/** Exported async functions and the body text up to the next export. */
function parseActions(source: string) {
  const pattern = /export\s+async\s+function\s+(\w+)/g;
  const found: { name: string; body: string }[] = [];
  const matches = [...source.matchAll(pattern)];

  matches.forEach((match, i) => {
    const start = match.index ?? 0;
    const end = matches[i + 1]?.index ?? source.length;
    found.push({ name: match[1], body: source.slice(start, end) });
  });

  return found;
}

describe("server action write-gate coverage", () => {
  const files = findActionFiles(APP_DIR);

  it("finds the action modules at all", () => {
    // A refactor that renames or relocates these files would otherwise make
    // this suite pass by checking nothing.
    expect(files.length).toBeGreaterThanOrEqual(8);
  });

  it("every exported server action is gated or explicitly exempt", () => {
    const ungated: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      if (!source.includes('"use server"')) continue;

      const rel = path.relative(APP_DIR, file).replace(/\\/g, "/");

      for (const action of parseActions(source)) {
        const key = `${rel}:${action.name}`;
        if (key in EXEMPT) continue;
        if (WRITE_GUARDS.some((guard) => action.body.includes(guard))) continue;
        ungated.push(key);
      }
    }

    // Named in the failure so the fix is obvious: add requireWritable, or add
    // the action to EXEMPT with a reason.
    expect(ungated).toEqual([]);
  });

  it("keeps the exemption list honest", () => {
    const seen = new Set<string>();

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const rel = path.relative(APP_DIR, file).replace(/\\/g, "/");
      for (const action of parseActions(source)) {
        seen.add(`${rel}:${action.name}`);
      }
    }

    // A stale exemption is how a gap reopens: the action gets rewritten, the
    // waiver outlives the reason, and nobody notices it is still granted.
    const stale = Object.keys(EXEMPT).filter((key) => !seen.has(key));
    expect(stale).toEqual([]);
  });

  it("gates every mutating dashboard action on requireWritable specifically", () => {
    const wrong: string[] = [];

    for (const file of files) {
      const rel = path.relative(APP_DIR, file).replace(/\\/g, "/");
      if (!rel.startsWith("dashboard/") || rel.includes("setup/")) continue;

      const source = readFileSync(file, "utf8");
      for (const action of parseActions(source)) {
        const key = `${rel}:${action.name}`;
        if (key in EXEMPT) continue;
        // requireBusiness alone is a read guard. Inside a dashboard mutation it
        // is the exact mistake this suite exists to catch, because it looks
        // right at a glance.
        if (!action.body.includes("requireWritable")) wrong.push(key);
      }
    }

    expect(wrong).toEqual([]);
  });
});
