# Bazman — standing rules

Read this first, every session. It is the contract; everything else is detail.

The whole app lives in `Frontend/`, database layer included. There is no
separate backend tier.

## Before writing code

- **`Frontend/AGENTS.md`** — this is **Next 16**, not the Next.js in your
  training data. Read the relevant guide in `node_modules/next/dist/docs/`
  before using an API, and heed deprecation notices.
- **`docs/PROJECT_PLAN.md` §5** — the handover: what is green, what is applied,
  what is broken, and the traps that each cost a session. Read other sections
  with `grep` and offsets rather than loading whole files.
- **`docs/ARCHITECTURE.md`** — how a mechanism works, and why it is that way.

## Git

- **Commit and push straight to `main`.** No branches, no pull requests.
- **A push to `main` deploys.** Push order is deploy order.
- **Docs ship with the change, in the same push**: a `docs/PROJECT_PLAN.md` §4
  entry, §5 wherever it went stale, and `docs/ARCHITECTURE.md` for the
  mechanism. The repo is the handover between sessions; a change nobody wrote
  down costs the next session an hour.

## The database in `Frontend/.env.local` is LIVE PRODUCTION

- Reading is fine. Before anything destructive: **show the counts, say exactly
  what will change, and wait for an explicit OK.**
- `npm run db:seed` **destroys the demo tenants**. `db:purge:load-test`
  needs `-- --confirm`.
- Browser checks are **read-only by default** — abort Server Action POSTs in
  the spec. A real write needs its own OK, uses no-contact placeholders, and is
  deleted by id afterwards.

## Migrations: ask → apply → verify → then push

1. Write the SQL and its `meta/_journal.json` entry; prove it in PGlite tests.
2. **Ask before applying to production.**
3. Apply: `npm --prefix Frontend run db:migrate`.
4. **Read it back from the database** — the row count in
   `drizzle.__drizzle_migrations`, the column, the trigger, the values.
5. Only then push.

The ordering is not a preference: a bare `.select()` on `businesses` compiles
to every column in `schema.ts`, so code that knows about a column production
lacks breaks the public booking page and the whole dashboard.

## Tests: targeted first, then the whole thing

- **Targeted, while working**: `npx vitest run <paths you touched>`, plus
  `npx tsc --noEmit -p .` and `npx eslint <paths>`.
- **Then, before every push**: `npm --prefix Frontend run verify` — env check,
  lint, types, tests, production build — must be green.
- Temporary Playwright specs are named `e2e/zz-*.spec.ts` and must be **out of
  the repo before verify**.

## Verify in a browser; do not assert

Run the change and look at it: `preview_start` for the dev server, Playwright
where a session is needed. In specs, hide the cookie banner
(`[aria-label="הודעת עוגיות"]`) and `nextjs-portal` — the harness never accepts
the banner. Report what the screen actually showed, including the numbers.
