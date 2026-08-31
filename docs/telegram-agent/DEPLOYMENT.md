# Deployment (Railway)

Deployed 2026-08-31, from the CLI directly (not GitHub-connected, by explicit choice —
`railway up` uploads the local directory and builds it, rather than deploying from a
pushed commit). This means **deploying a change requires manually running `railway up`
again** — pushing to GitHub does not trigger a Railway deploy. If that tradeoff becomes
annoying, `railway service source connect --repo Thatisshayan/job-search-dashboard
--branch main --service web` switches the `web` service to GitHub auto-deploy (this
needs Railway's GitHub App authorized for the repo first, from
https://railway.com/account/integrations — the earlier attempt failed with "User does
not have access to the repo" until that's done).

## Project

- Dashboard: https://railway.com/project/f01516b1-d814-422c-82a6-b5ff41a3470b
- Public URL: https://web-production-041dd.up.railway.app
- Two services: **`web`** (this app) and **`MySQL`** (Railway's MySQL template)

## Redeploying

```bash
railway up --service web --ci
```
Run from the repo root, with the project already linked (`.railway/` in this repo —
check it's not accidentally gitignored away, or re-link with `railway link`). This
uploads the current working directory, so commit/stage what you want deployed first,
or just run it against whatever's on disk for a quick fix.

## Why migrations run at container boot

Railway's MySQL is only reachable from its private network
(`mysql.railway.internal`) — not from a local machine. The normal fix would be `railway
ssh` into the `web` service (which *is* on that private network) and run
`drizzle-kit migrate` there, but the Railway CLI's SSH implementation failed host-key
verification in this environment (tried both v5.9.1 and the latest v5.45.10 — same
failure) and there's no exposed flag to bypass it. So instead, `package.json`'s `start`
script runs the migration every time the container boots:

```json
"start": "drizzle-kit migrate && NODE_ENV=production node dist/index.js"
```

`drizzle-kit migrate` only applies pending migrations already committed to
`drizzle/*.sql` (nothing is generated at boot) and is idempotent, so this is safe to run
on every restart. If a cleaner release-phase mechanism becomes available (Railway
supports a `preDeployCommand` in its service config — worth revisiting), this could
move there instead.

## Environment variables set on `web`

| Variable | Value | Note |
|---|---|---|
| `DATABASE_URL` | `${{MySQL.MYSQL_URL}}` | Railway variable reference — stays in sync if MySQL credentials ever rotate |
| `JWT_SECRET` | (generated, random) | **Different from any local dev value** — do not reuse `local-verify-secret-do-not-use-in-prod` from local testing |
| `OWNER_OPEN_ID` | `public-workspace-shayan-salimi` | Matches the auto-bootstrap fallback owner in `server/db.ts`, so the dashboard's public read-only view works without real OAuth configured |
| `OAUTH_SERVER_URL` | `https://oauth-not-configured.invalid` | Placeholder — **dashboard login does not work on this deployment**. Only the public read-only dashboard view and the Telegram bot work; anything requiring a real signed-in owner session (the website's owner-only controls) is not usable until real OAuth is wired up or replaced (see the earlier "decouple from Manus" discussion re: auth) |
| `VITE_APP_ID` | `job-search-dashboard-bot` | Placeholder, same reasoning as above |
| `NODE_ENV` | `production` | |
| `TELEGRAM_BOT_TOKEN` | (the real bot token) | Same bot used for local testing — its webhook now points at this deployment, not the local tunnel |
| `OPENROUTER_API_KEY` | (the real key) | |
| `PORT` | *(unset — Railway injects it)* | The app already reads `process.env.PORT` |

## Telegram webhook

Currently pointed at `https://web-production-041dd.up.railway.app/api/telegram/webhook`
with the secret token derived from the production `JWT_SECRET` (via
`getTelegramWebhookSecret()` in `server/telegram.ts` — HMAC of a fixed string, not a
separately stored secret). If `JWT_SECRET` is ever rotated, the webhook must be
re-registered with the newly derived secret, or Telegram's callbacks will get 401s.

To re-register manually:
```bash
railway variable list --service web --json > /tmp/vars.json
node -e "console.log(require('/tmp/vars.json').JWT_SECRET)"   # copy this
# then, with that value as JWT_SECRET locally:
node_modules/.bin/tsx -e "import('./server/telegram.ts').then(m => console.log(m.getTelegramWebhookSecret()))"
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://web-production-041dd.up.railway.app/api/telegram/webhook" \
  -d 'allowed_updates=["message","callback_query"]' \
  -d "secret_token=<computed secret>"
```

## Known gaps on this deployment

- **No real OAuth** — the website's owner-login flow doesn't work (placeholder
  `OAUTH_SERVER_URL`). Only the public dashboard view and the Telegram bot are usable.
  This isn't a regression — it's an explicit tradeoff for standing this up quickly
  without wiring a new auth provider first.
- **No CI/CD from git** — deploys are manual (`railway up`), by explicit choice (see
  top of this doc).
- **Single instance, no staging environment** — everything above targets Railway's
  default `production` environment directly.
