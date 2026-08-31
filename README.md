# Job Search Dashboard

A single-owner dashboard that collects, scores, and shortlists construction-industry job
postings for the Toronto/GTA market from authorized sources only, and routes each
candidate application through an explicit Telegram approval step before ever opening the
employer's own application form. The system never submits an application on the
owner's behalf — every apply action ends with the owner opening the original posting
in a browser and submitting it themselves.

## Stack

- **Client**: React 19, Vite, Wouter (routing), TanStack Query, Tailwind v4, shadcn/radix UI
- **Server**: Express 4, tRPC v11, Drizzle ORM (MySQL via `mysql2`)
- **Integrations**: Telegram Bot API (approval workflow), AWS S3 (file storage)
- **Tooling**: TypeScript (strict), Vitest, Prettier, pnpm

## Getting started

```bash
pnpm install
cp .env.example .env   # fill in the values described below
pnpm dev                # runs the Express + Vite dev server on the first free port from 3000
```

Other scripts:

- `pnpm check` — type-check the project (`tsc --noEmit`)
- `pnpm test` — run the Vitest suite (server-side only today; live-integration tests
  under `*.live.test.ts` are skipped unless `LIVE_TELEGRAM_E2E=1` is set)
- `pnpm build` — build the client bundle and bundle the server for production
- `pnpm start` — run the production build (`dist/index.js`)
- `pnpm format` — apply Prettier
- `pnpm db:generate` — generate a Drizzle migration from the current schema diff
- `pnpm db:migrate` — apply generated migrations to `DATABASE_URL`

## Required environment variables

| Variable           | Purpose                                                              |
| ------------------ | -------------------------------------------------------------------- |
| `DATABASE_URL`     | MySQL connection string used by Drizzle                              |
| `JWT_SECRET`       | Secret used to sign/verify the session cookie                        |
| `OWNER_OPEN_ID`    | The identity that is granted owner/admin access to private mutations |
| `OAUTH_SERVER_URL` | OAuth provider base URL used for sign-in                             |
| `VITE_APP_ID`      | Client-side app identifier used by the OAuth flow                    |

The server validates these at startup and will refuse to boot with a clear error if any
are missing — see `server/_core/env.ts`.

Additional variables consumed directly (not through `ENV`, and not validated at startup):

| Variable                                            | Purpose                                                                                                                                                                                                       |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN`                                | Bot token used for the approval workflow (`server/telegram.ts`) — the webhook secret and single-use approval nonces are derived from `JWT_SECRET`, not a separate variable                                    |
| `BUILT_IN_FORGE_API_URL` / `BUILT_IN_FORGE_API_KEY` | Backing storage proxy used by `server/_core/storageProxy.ts` for presigned file access                                                                                                                        |
| `OPENROUTER_API_KEY` / `OPENROUTER_BASE_URL`        | LLM provider used by `server/_core/llm.ts` (`invokeLLM`/`listLLMModels`), an OpenAI-compatible client against [OpenRouter](https://openrouter.ai). Not required to boot today; needed for the Telegram-agent work described in `docs/telegram-agent/`. |
| `PORT`                                              | Preferred port for the dev/prod server (defaults to `3000`, auto-increments if busy)                                                                                                                          |
| `VITE_FRONTEND_FORGE_API_KEY`                       | Client-side key for the Google Maps JS API proxy used by the Shortlist Map page (`client/src/components/Map.tsx`, `client/src/pages/ShortlistMap.tsx`). Optional — the map page shows a placeholder if unset. |
| `VITE_FRONTEND_FORGE_API_URL`                       | Base URL for the maps proxy (defaults to the platform's Forge proxy)                                                                                                                                          |

## Architecture overview

```
client/src/        React app (pages, components, tRPC client)
server/_core/       Framework/infra layer: env, cookies, oauth, tRPC setup, vite/static serving
server/             Domain logic: db access, scoring, Telegram bot + webhook,
                     application workflow, verified-listing import
shared/             Types and constants shared between client and server
drizzle/            Drizzle schema and generated migrations
```

- `server/routers.ts` defines the tRPC API. Read-only dashboard data
  (`overview`, `shortlist`, `history`, `runs`, `profile`, `settings`) is public; every
  mutation and the score-preview/import tools are restricted to the configured owner via
  `ownerProcedure`.
- `server/scoring.ts` implements a deterministic, evidence-based fit score
  (role/skills/seniority/location/quality/recency, 30/25/15/10/10/10 weights) with
  explicit penalties and "notable gaps" rather than inferred qualifications.
- `server/telegram.ts` / `server/telegramWebhook.ts` implement the per-application
  approval flow: HMAC-signed, single-use, time-boxed approval callbacks that end in a
  browser-review link — never an automatic form submission.

See `todo.md` for the running list of completed and in-flight work.

## Platform-specific dev tooling

This project was scaffolded on the Manus app-building platform, and two dev-only
pieces of that platform's tooling remain:

- `vite-plugin-manus-runtime` (devDependency) and the `manus-debug-collector` Vite
  plugin in `vite.config.ts` inject `client/public/__manus__/debug-collector.js` into
  the page and collect browser console/network logs to `.manus-logs/` **only when
  `NODE_ENV !== "production"`** (see `transformIndexHtml` in `vite.config.ts`). It is
  inert in production builds — the script tag is never injected and the log-collection
  endpoint isn't registered outside Vite's dev server.
- The plugin's `allowedHosts` list includes several `*.manus*.computer` domains, needed
  only if you continue developing/previewing through that platform.

Both are safe to remove if you move off the Manus platform; neither affects production
behavior today.

## Planned but not yet wired up

- `client/src/components/AIChatBox.tsx` — a complete chat UI component, not imported by
  any route. Reserved for a future "ask about this shortlist/profile" assistant once a
  server-side LLM endpoint exists to back it. **Not dead code** — keep it until that
  feature is built or explicitly cancelled.
