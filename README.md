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

1. Provision a Postgres database, set `DATABASE_URL`, and run
   `pnpm --filter web db:push` to sync the schema (defined in
   `apps/web/lib/db/schema.ts`) via drizzle-kit. Re-run after schema changes.
2. Create a single GitHub OAuth App used by production, preview, and local dev:
   - Homepage URL: your production URL (e.g. `https://yourapp.com`)
   - Authorization callback URL: `<production-url>/api/auth/callback/github`
   - The app requests the `repo` scope so sandboxes can clone private repos and push commits.
   - Preview deployments have dynamic per-deploy URLs — they can't be pre-registered with GitHub. The `oAuthProxy` plugin (configured in `apps/web/lib/auth.ts`) handles this by routing every preview's OAuth flow through the production callback, then bouncing a signed payload back to the originating preview so the session cookie ends up on the preview's own origin.
3. Copy the client ID + secret into `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`. Set these in Vercel under **all three** environment scopes (Production, Preview, Development) so every deploy uses the same app.

### Environment variables

Set these in Vercel (Project Settings → Environment Variables) and in a local `.env.local` for development:

```bash
# --- Better Auth ---
# Required. Must be the same value in Production, Preview, and Development
# scopes on Vercel so preview deployments can decrypt the oAuthProxy payload
# issued by production.
BETTER_AUTH_SECRET=<openssl rand -base64 32>
# Optional. Derived automatically — localhost in dev, VERCEL_URL on preview
# deploys, VERCEL_PROJECT_PRODUCTION_URL on prod. Only set if you host
# somewhere exotic.
# BETTER_AUTH_URL=

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
2. Attach a Postgres database (Neon/Supabase marketplace integration, or set `DATABASE_URL` manually). Run `pnpm --filter web db:push` to sync the schema.
3. Add all the environment variables listed above.
4. Deploy. The standard `next build` / `next start` scripts in `package.json` are all Vercel needs.

### Running locally

```bash
pnpm install
cp apps/web/.env.local.example apps/web/.env.local
# fill in the values, then sync the schema:
pnpm --filter web db:push
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
