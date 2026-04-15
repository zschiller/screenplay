# Screenplay

A Next.js app that runs coding agents inside live development sandboxes with real-time collaboration on a shared canvas.

## Deployment

### Services you need

Before deploying, create accounts and projects for each of the following:

| Service | Used for | Where |
| --- | --- | --- |
| **Vercel** | Hosting the Next.js app and provisioning `@vercel/sandbox` VMs for each workspace | https://vercel.com |
| **Clerk** | User authentication, plus GitHub OAuth so the app can clone private repos and push commits on the user's behalf | https://clerk.com |
| **Liveblocks** | Real-time presence, cursors, comments, and shared workspace state on the canvas | https://liveblocks.io |
| **Anthropic API** | Powers the in-sandbox coding agent (Claude) via `@anthropic-ai/sdk` | https://console.anthropic.com |
| **Upstash Redis** (or Vercel KV) | Stores per-workspace env vars, agent session metadata, and cached agent/environment IDs | https://upstash.com — or add the Vercel Marketplace "Upstash KV" integration to your project |

### Clerk setup notes

The sandbox clones repos and pushes commits using a GitHub OAuth token pulled from Clerk (`clerkClient().users.getUserOauthAccessToken(userId, "github")`). In your Clerk dashboard:

1. Enable **GitHub** as a social connection.
2. Use custom credentials and request the `repo` scope so tokens can read private repos and push.
3. Add sign-in/sign-up routes for `/sign-in` and `/sign-up` (already wired up in `app/sign-in` and `app/sign-up`).

### Environment variables

Set these in Vercel (Project Settings → Environment Variables) and in a local `.env.local` for development:

```bash
# --- Clerk ---
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...

# --- Liveblocks ---
# Server-side secret key from https://liveblocks.io/dashboard
LIVEBLOCKS_SECRET_KEY=sk_...

# --- Anthropic ---
# Read automatically by the Anthropic SDK
ANTHROPIC_API_KEY=sk-ant-...

# --- Upstash Redis / Vercel KV ---
# If you add the Upstash integration on Vercel these are injected for you.
# Otherwise copy them from the Upstash Redis REST tab.
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
3. Add all the environment variables listed above.
4. Deploy. The standard `next build` / `next start` scripts in `package.json` are all Vercel needs.

### Running locally

```bash
npm install
cp .env.local.example .env.local   # if present, otherwise create one with the vars above
npm run dev
```

The app runs on http://localhost:3000.

## Development

```bash
npm run dev        # start the Next.js dev server with Turbopack
npm run build      # production build
npm run lint       # ESLint
npm run typecheck  # tsc --noEmit
npm run format     # Prettier
```

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
