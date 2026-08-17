import dotenv from "dotenv";

import { checkEnv, ENV_VARS } from "@/lib/env";
// Safe to import above `dotenv.config()` below: nothing in that module reads
// the environment at load time — `describeWhatsApp` resolves the backend on
// every call, which is the same property that lets the runtime pick one up
// from a variable added after boot.
import { describeWhatsApp } from "@/lib/notifications/whatsapp";

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

/**
 * WhatsApp is the client channel on this deployment, so "which backend" is the
 * single most useful line in this section — and it was the one missing. The
 * variable list above cannot answer it: three different credential sets resolve
 * here, they have a precedence order, and an unconfigured channel falls through
 * to the console provider that reports success and delivers nothing.
 */
const whatsapp = describeWhatsApp();
if (report.whatsappSuppressed) {
  // Stated before the backend line and in the loudest colour available: this
  // is the only variable whose presence silences the product while every
  // screen still looks like it worked.
  const mark = production ? `${RED}✗${RESET}` : `${YELLOW}!${RESET}`;
  const colour = production ? RED : YELLOW;
  console.log(
    `  ${mark} whatsapp → ${colour}SUPPRESSED by DISABLE_WHATSAPP_DISPATCH${RESET}\n` +
      `      ${DIM}No message reaches Meta and no charge is incurred. Outbox rows${RESET}\n` +
      `      ${DIM}are marked skipped. Backend that would have sent: ${whatsapp.provider ?? "none"}.${RESET}`,
  );
} else if (whatsapp.provider) {
  console.log(
    `  ${GREEN}✓${RESET} whatsapp → ${whatsapp.provider} ${DIM}(messages are delivered)${RESET}` +
      (whatsapp.needsTemplateApproval
        ? `\n      ${DIM}Official API: only Meta-approved templates send. Kinds without${RESET}` +
          `\n      ${DIM}one are refused rather than dropped silently.${RESET}`
        : `\n      ${DIM}Unofficial gateway driving the shop's own account — no template${RESET}` +
          `\n      ${DIM}approval, and no Meta support if it stops.${RESET}`),
  );
} else {
  console.log(
    `  ${YELLOW}!${RESET} whatsapp → off ${DIM}(clients fall back to SMS, then email)${RESET}\n` +
      `      ${DIM}Set WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN for the${RESET}\n` +
      `      ${DIM}Meta Cloud API, or the GREEN_API_* pair for the unofficial one.${RESET}`,
  );
}

// Push is the one channel whose absence an owner cannot see from the product:
// the settings card says "not configured", but a *half*-configured trio looks
// identical while refusing at runtime. Say which it is.
if (report.pushLive) {
  console.log(
    `  ${GREEN}✓${RESET} push → live ${DIM}(owners are notified on their devices)${RESET}`,
  );
} else {
  console.log(
    `  ${YELLOW}!${RESET} push → off ${DIM}(owners rely on email alerts)${RESET}\n` +
      `      ${DIM}Needs all three VAPID variables. Generate with: npm run push:keys${RESET}`,
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
