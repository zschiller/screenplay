# Screenplay

A Next.js app that runs coding agents inside live development sandboxes with real-time collaboration on a shared canvas.

## Deployment

### Services you need

Before deploying, create accounts and projects for each of the following:

| Service | Used for | Where |
| --- | --- | --- |
| **Vercel** | Hosting the Next.js app and provisioning `@vercel/sandbox` VMs for each workspace | https://vercel.com |
| **Postgres** | Better Auth users/sessions/accounts, per-user app state, and the KV table (locks, caches, encrypted env-var blobs) | https://neon.tech or https://supabase.com |
| **GitHub OAuth App** | Sign-in + OAuth token used to clone private repos and push commits on the user's behalf | https://github.com/settings/developers |
| **Liveblocks** | Real-time presence, cursors, comments, and shared workspace state on the canvas | https://liveblocks.io |
| **Anthropic API** | Powers the in-sandbox coding agent (Claude) via `@anthropic-ai/sdk` | https://console.anthropic.com |

### Auth setup

Auth is handled by [Better Auth](https://better-auth.com) against the Postgres database pointed at by `DATABASE_URL`.

1. Provision a Postgres database and set `DATABASE_URL`.
2. Apply migrations in order:
   ```bash
   psql "$DATABASE_URL" -f apps/web/lib/migrations/0001_init.sql
   psql "$DATABASE_URL" -f apps/web/lib/migrations/0002_kv.sql
   ```
3. Create a GitHub OAuth App:
   - Homepage URL: your `BETTER_AUTH_URL` (e.g. `http://localhost:3000`)
   - Authorization callback URL: `<BETTER_AUTH_URL>/api/auth/callback/github`
   - The app requests the `repo` scope so sandboxes can clone private repos and push commits.
4. Copy the client ID + secret into `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`.

### Environment variables

Set these in Vercel (Project Settings → Environment Variables) and in a local `.env.local` for development:

```bash
# --- Better Auth ---
BETTER_AUTH_SECRET=<openssl rand -base64 32>
BETTER_AUTH_URL=http://localhost:3000

# --- Postgres ---
DATABASE_URL=postgres://...

# --- GitHub OAuth ---
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...

# --- Liveblocks ---
# Server-side secret key from https://liveblocks.io/dashboard
LIVEBLOCKS_SECRET_KEY=sk_...

# --- Anthropic ---
# Read automatically by the Anthropic SDK
ANTHROPIC_API_KEY=sk-ant-...

# --- Env-var encryption ---
# 32 random bytes, hex-encoded (64 hex chars). Used to encrypt per-workspace
# env vars stored in the kv table (see lib/env-store.ts).
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
2. Attach a Postgres database (Neon/Supabase marketplace integration, or set `DATABASE_URL` manually). Apply the migrations in `apps/web/lib/migrations/` against it.
3. Add all the environment variables listed above.
4. Deploy. The standard `next build` / `next start` scripts in `package.json` are all Vercel needs.

### Running locally

```bash
pnpm install
cp apps/web/.env.local.example apps/web/.env.local
# fill in the values, then apply the migrations against DATABASE_URL
pnpm dev
```

The app runs on http://localhost:3000.

## Development

```bash
pnpm dev        # start the Next.js dev server with Turbopack
pnpm build      # production build
pnpm lint       # ESLint
pnpm typecheck  # tsc --noEmit
pnpm format     # Prettier
```

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
