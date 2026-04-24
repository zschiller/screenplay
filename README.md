# Screenplay

A Next.js app that runs coding agents inside live development sandboxes with real-time collaboration on a shared canvas.

## Deployment

### Services you need

Before deploying, create accounts and projects for each of the following:

| Service | Used for | Where |
| --- | --- | --- |
| **Vercel** | Hosting the Next.js app and provisioning `@vercel/sandbox` VMs for each workspace | https://vercel.com |
| **GitHub OAuth App** | Sign-in + `repo` scope so the app can clone private repos and push commits on the user's behalf | https://github.com/settings/developers |
| **Neon** (Postgres) | User/session storage for Better Auth and per-user organization state via Drizzle | https://console.neon.tech |
| **Liveblocks** | Real-time presence, cursors, comments, and shared workspace state on the canvas | https://liveblocks.io |
| **Anthropic API** | Powers the in-sandbox coding agent (Claude) via `@anthropic-ai/sdk` | https://console.anthropic.com |
| **Upstash Redis** (or Vercel KV) | Stores per-workspace env vars, agent session metadata, and cached agent/environment IDs | https://upstash.com — or add the Vercel Marketplace "Upstash KV" integration to your project |

### GitHub OAuth app setup

Auth is handled by [Better Auth](https://www.better-auth.com) with GitHub as the only provider. The sandbox clones repos and pushes commits using the OAuth access token Better Auth stores in the `account` table (keyed by `providerId = 'github'`).

1. Create a new OAuth App at https://github.com/settings/developers.
2. Set the **Authorization callback URL** to `$BETTER_AUTH_PRODUCTION_URL/api/auth/callback/github` (e.g. `https://build.screenplay.space/api/auth/callback/github`). Preview deploys route through this same callback via Better Auth's `oAuthProxy` plugin, then bounce back to the preview URL — one OAuth app is enough for production and every preview.
3. Copy the Client ID + Secret into `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`.
4. The app requests `repo`, `read:user`, and `user:email` on first sign-in — no extra GitHub-side config needed.

#### Secret sharing across environments

Because the oAuthProxy plugin signs state on production and verifies it on the preview deploy that started the sign-in, **production and every preview deployment must share the same `BETTER_AUTH_SECRET`**. Set it in Vercel with the env scope set to "Production, Preview, and Development" so the value stays in sync everywhere. The same goes for `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` and `BETTER_AUTH_PRODUCTION_URL`.

For local development you have two choices:

- **Option A — share the production secret** (simplest). Copy `BETTER_AUTH_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and `BETTER_AUTH_PRODUCTION_URL` into `apps/web/.env.local`. Sign-ins locally take a detour through the production callback and bounce back to `localhost`.
- **Option B — dev-only OAuth app**. Create a second OAuth app with callback `http://localhost:3000/api/auth/callback/github`. In `.env.local` set `BETTER_AUTH_PRODUCTION_URL=http://localhost:3000`, the dev app's client id / secret, and any random `BETTER_AUTH_SECRET` — the proxy is a no-op because `currentURL === productionURL`, so GitHub redirects straight to `localhost` and no production secret ever touches your machine.

### Database setup

1. Create a Postgres database on Neon and copy the connection string into `DATABASE_URL`.
2. Push the Drizzle schema from `apps/web`:

```bash
cd apps/web
pnpm db:push
```

Schema lives in `apps/web/lib/db/schema.ts` — Better Auth's `user`/`session`/`account`/`verification` tables, plus a per-user `organization` JSONB column for folders/pins.

### Environment variables

Set these in Vercel (Project Settings → Environment Variables) and in a local `.env.local` for development:

```bash
# --- Better Auth ---
# URL for the current deployment. Required in production. Optional locally —
# we default to http://localhost:$PORT (3000 if PORT unset). On Vercel preview
# deploys, leave unset and we fall back to https://$VERCEL_URL.
# BETTER_AUTH_URL=http://localhost:3000
# Stable URL registered with the GitHub OAuth app. Same value in production
# and on every preview deploy — the oAuthProxy plugin needs it to route
# preview sign-ins through the production callback.
BETTER_AUTH_PRODUCTION_URL=https://build.screenplay.space
# 32 random bytes, hex-encoded. `openssl rand -hex 32`. MUST be identical
# across production and all preview deploys (see "Secret sharing" above).
BETTER_AUTH_SECRET=...

# --- GitHub OAuth App ---
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...

# --- Neon Postgres ---
DATABASE_URL=postgres://...

# --- Liveblocks ---
# Server-side secret key from https://liveblocks.io/dashboard
LIVEBLOCKS_SECRET_KEY=sk_...

# --- Anthropic ---
# Read automatically by the Anthropic SDK
ANTHROPIC_API_KEY=sk-ant-...

# --- Upstash Redis / Vercel KV ---
# If you add the Upstash integration on Vercel these are injected for you.
# Otherwise copy them from the Upstash Redis REST tab.
# To use a different KV provider on a fork, swap the default export in
# `apps/web/lib/kv/index.ts` — see `apps/web/lib/kv/types.ts` for the contract.
KV_REST_API_URL=https://<your-db>.upstash.io
KV_REST_API_TOKEN=...

# --- Env-var encryption ---
# 32 random bytes, hex-encoded (64 hex chars). Used to encrypt per-workspace
# env vars stored in Redis (see lib/env-store.ts).
# Generate with: openssl rand -hex 32
ENCRYPTION_KEY=<64 hex chars>
```

#### Vercel Sandbox

`@vercel/sandbox` authenticates via OIDC. In production on Vercel the OIDC token is injected automatically — no extra variables required. For local development, link the project once and pull a short-lived OIDC token into your env file:

```bash
vercel link
vercel env pull .env.local
```

This populates `VERCEL_OIDC_TOKEN` (valid for ~12 hours — re-run `vercel env pull` when it expires).

### Deploying to Vercel

1. Import the repo into a new Vercel project.
2. Add the Upstash Redis integration (or set `KV_REST_API_*` manually).
3. Add the environment variables listed above. Scope each one correctly:
   - `BETTER_AUTH_URL`: **Production only**, set to your custom domain (e.g. `https://build.screenplay.space`). Leave it unset on Preview so each preview deploy auto-uses `https://$VERCEL_URL`.
   - `BETTER_AUTH_PRODUCTION_URL`, `BETTER_AUTH_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`: **Production + Preview** (Vercel "all environments" scope). These must stay identical across every deploy — the oAuthProxy plugin signs state on production and verifies it on the preview that started the sign-in.
   - Everything else (`DATABASE_URL`, `LIVEBLOCKS_SECRET_KEY`, `ANTHROPIC_API_KEY`, `KV_REST_API_*`, `ENCRYPTION_KEY`): **Production + Preview**.
4. Push the Drizzle schema to Neon: `cd apps/web && pnpm db:push`.
5. Deploy. The standard `next build` / `next start` scripts in `package.json` are all Vercel needs.

### Running locally

```bash
pnpm install
cp apps/web/.env.local.example apps/web/.env.local   # then fill in values
cd apps/web && pnpm db:push                           # one-time: create tables in Neon
pnpm dev
```

The app runs on http://localhost:3000.

## Development

```bash
pnpm dev         # start the Next.js dev server with Turbopack
pnpm build       # production build
pnpm lint        # ESLint
pnpm typecheck   # tsc --noEmit
pnpm format      # Prettier

# Database (run from apps/web)
pnpm db:generate # generate a new migration from schema changes
pnpm db:push     # push the schema directly (dev)
pnpm db:studio   # open Drizzle Studio
```

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
