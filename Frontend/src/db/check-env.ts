import dotenv from "dotenv";

import { checkEnv, ENV_VARS } from "@/lib/env";

dotenv.config({ path: ".env.local", quiet: true });

/**
 * `npm run check:env` — verifies local config.
 * `npm run check:env -- --production` — applies the stricter production rules
 * without needing NODE_ENV set, for checking a deployment's variables.
 */
const production = process.argv.includes("--production");
const report = checkEnv(process.env, { production });

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

console.log(
  `\nEnvironment check ${DIM}(${production ? "production" : "development"} rules)${RESET}\n`,
);

const groups = [...new Set(ENV_VARS.map((v) => v.group))];

for (const group of groups) {
  console.log(`${DIM}${group}${RESET}`);

  for (const spec of ENV_VARS.filter((v) => v.group === group)) {
    const issue = report.issues.find((i) => i.name === spec.name);
    const mark = !issue
      ? `${GREEN}✓${RESET}`
      : issue.level === "error"
        ? `${RED}✗${RESET}`
        : `${YELLOW}!${RESET}`;

    const note = issue
      ? ` ${issue.level === "error" ? RED : YELLOW}${issue.reason}${RESET}`
      : "";

    console.log(`  ${mark} ${spec.name}${note}`);
    if (issue) console.log(`      ${DIM}${issue.howTo}${RESET}`);
  }
  console.log("");
}

const errors = report.issues.filter((i) => i.level === "error");
const warnings = report.issues.filter((i) => i.level === "warning");

// The variable list alone does not say whether clients actually receive
// anything — the console provider fails silently and marks messages sent.
// State the resolved channel outright.
console.log(`${DIM}Delivery${RESET}`);
if (report.emailChannel === "resend") {
  console.log(
    `  ${GREEN}✓${RESET} email → resend ${DIM}(messages are delivered)${RESET}`,
  );
} else {
  const mark = production ? `${RED}✗${RESET}` : `${YELLOW}!${RESET}`;
  const colour = production ? RED : YELLOW;
  console.log(
    `  ${mark} email → console ${colour}nothing is delivered${RESET}\n` +
      `      ${DIM}Messages are logged and marked sent. Set RESEND_API_KEY and${RESET}\n` +
      `      ${DIM}NOTIFICATIONS_FROM_EMAIL to send real mail.${RESET}`,
  );
}

// Stated rather than left to be discovered by a tenant clicking a disabled
// button. Not an error: no provider exists to configure until stage 8d, and
// the console provider refuses in production rather than faking a payment.
if (report.billingLive) {
  console.log(
    `  ${GREEN}✓${RESET} billing → live ${DIM}(payments are collected)${RESET}`,
  );
} else {
  console.log(
    `  ${YELLOW}!${RESET} billing → console ${YELLOW}no payments are collected${RESET}\n` +
      `      ${DIM}Checkout is refused in production until a provider is wired up.${RESET}`,
  );
}
console.log("");

if (report.ok) {
  console.log(
    `${GREEN}✓ Ready${RESET} — ${report.present.length} variables set` +
      (warnings.length ? `, ${warnings.length} optional not configured` : "") +
      "\n",
  );
} else {
  console.log(
    `${RED}✗ ${errors.length} problem${errors.length === 1 ? "" : "s"} must be fixed before deploying${RESET}\n`,
  );
  process.exitCode = 1;
}
