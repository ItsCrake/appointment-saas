import webpush from "web-push";

/**
 * `npm run push:keys` — generates a VAPID key pair for web push.
 *
 * A one-off per deployment: the pair identifies this server to every push
 * service, and **rotating it invalidates every existing subscription**. Every
 * owner who had enabled notifications would silently stop receiving them and
 * would have to opt in again, which is a prompt most people only accept once.
 * Generate once, store both, and leave them alone.
 *
 * Beside the other operational scripts rather than in `lib/`, for the same
 * reason `check-env.ts` is: it is something an operator runs, not something the
 * app imports.
 */
const { publicKey, privateKey } = webpush.generateVAPIDKeys();

const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const RESET = "\x1b[0m";

console.log(`\n${GREEN}✓ VAPID key pair generated${RESET}\n`);
console.log("Add these to .env.local and to your host's environment:\n");
console.log(`NEXT_PUBLIC_VAPID_PUBLIC_KEY="${publicKey}"`);
console.log(`VAPID_PRIVATE_KEY="${privateKey}"`);
console.log(`VAPID_SUBJECT="mailto:you@yourdomain.com"`);
console.log(
  `\n${DIM}Rotating these invalidates every existing subscription — every owner${RESET}` +
    `\n${DIM}who enabled notifications would have to opt in again. Generate once.${RESET}\n`,
);
