# Frontend — Appointment SaaS

Next.js 16 (App Router) + TypeScript + Tailwind CSS v4. RTL/Hebrew by default.

See [`../docs/PROJECT_PLAN.md`](../docs/PROJECT_PLAN.md) for scope and roadmap.

## Setup

```bash
npm install
cp .env.example .env.local   # then fill in Supabase values
npm run dev
```

## Scripts

| Script                 | Purpose                                              |
| ---------------------- | ---------------------------------------------------- |
| `npm run verify`       | **The gate.** env → lint → typecheck → tests → build |
| `npm run dev`          | Dev server (Turbopack)                               |
| `npm run build`        | Production build                                     |
| `npm run test`         | Vitest against PGlite, one pass                      |
| `npm run test:e2e`     | Playwright (needs a live server + DB)                |
| `npm run lint`         | ESLint                                               |
| `npm run typecheck`    | `tsc --noEmit`                                       |
| `npm run format`       | Prettier write                                       |
| `npm run format:check` | Prettier check (CI)                                  |

The full script list, including the database and environment commands, is in
the [root README](../README.md#scripts).

## Conventions

- All timestamps stored in UTC; rendered in the business timezone.
- Use `cn()` from `src/lib/utils.ts` to compose class names.
- Prefer RTL-safe logical utilities (`ms-*`/`me-*`, `ps-*`/`pe-*`, `start-*`/`end-*`)
  over directional ones (`ml-*`, `pr-*`, `left-*`).
- Availability is computed **server-side only**, and every write re-derives it.
- Read the relevant guide in `node_modules/next/dist/docs/` before writing
  Next 16 code — see [AGENTS.md](AGENTS.md). This is not the Next.js most
  references describe.
