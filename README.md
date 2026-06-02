# Screenplay

A Next.js app that runs coding agents inside live development sandboxes with real-time collaboration on a shared canvas.

## Deployment

### Services you need

Before deploying, create accounts and projects for each of the following:

| Service | Used for | Where |
| --- | --- | --- |
| **Vercel** | Hosting the Next.js app. Also the default sandbox provider — each workspace gets its own `@vercel/sandbox` VM. Any sandbox backend works; see "Using a different sandbox provider" below to swap it. | https://vercel.com |
| **GitHub OAuth App** | Sign-in + `repo` scope so the app can clone private repos and push commits on the user's behalf | https://github.com/settings/developers |
| **Postgres** | Better Auth user/session storage, per-user organization state, the `kv_store` table used by `lib/kv` (cached agent/env IDs, encrypted workspace env vars, distributed locks), project rooms + members (`room`, `room_member`), and comment threads (`thread`, `comment`). Any Postgres works — the default factory in `lib/db/neon.ts` uses Neon's serverless HTTP driver, but you can swap in `postgres-js`, `node-postgres`, or any other Drizzle Postgres driver (see "Using a different Postgres driver" below). | anywhere you like — [Neon](https://console.neon.tech), [Vercel Postgres](https://vercel.com/postgres), [Supabase](https://supabase.com), a self-hosted server, etc. |
| **Yjs host** | Durable storage and realtime sync for the per-room [Yjs](https://yjs.dev) document that holds canvas state (workspaces, agents, artboards, text layers, chat sessions, plans), agent stream events, and Yjs awareness (cursors, viewport, selections). Any Yjs-compatible backend works — the default implementation targets Liveblocks via `lib/yjs-host/liveblocks-server.ts` (server) + `lib/yjs-host/liveblocks-client.tsx` (React client), each fronted by a thin re-export (`lib/yjs-host/index.ts` and `lib/yjs-host/client.tsx`) that makes the swap a one-line change. Dropping in Hocuspocus, y-websocket, Cloudflare Durable Objects, etc. means adding sibling `*-server.ts` / `*-client.tsx` files and pointing those two re-exports at them. | anywhere you like — [Liveblocks](https://liveblocks.io), [Hocuspocus](https://tiptap.dev/docs/hocuspocus), [y-websocket](https://github.com/yjs/y-websocket), Cloudflare Durable Objects, a self-hosted server, etc. |
| **Model provider** | Powers the in-sandbox coding agent. The agent loop is built on the [Vercel AI SDK](https://ai-sdk.dev), so any provider with an AI-SDK adapter works — Anthropic, OpenAI, Google, or any OpenAI-compatible gateway (OpenRouter, Groq, vLLM, LM Studio, …). At least one provider must be configured; see "Model providers" below to add or swap one. | anywhere you like — [Anthropic](https://console.anthropic.com), [OpenAI](https://platform.openai.com), [Google AI Studio](https://aistudio.google.com), [OpenRouter](https://openrouter.ai), [Groq](https://console.groq.com), a self-hosted vLLM/Ollama, etc. |

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

1. Provision a Postgres database anywhere (Neon, Vercel Postgres, Supabase, a self-hosted server — anything) and copy the connection string into `DATABASE_URL`. The default build targets Neon's serverless HTTP driver; see [Using a different Postgres driver](#using-a-different-postgres-driver) if your provider doesn't speak that protocol.
2. That's it. Checked-in SQL migrations under `apps/web/drizzle/` are applied automatically at build time — the `apps/web` `build` script is `drizzle-kit migrate && next build`, so every Vercel deploy lands any new migrations before starting the app. `drizzle-kit migrate` is idempotent (skips migrations already recorded in `__drizzle_migrations`).

Schema lives in `apps/web/lib/db/schema.ts`:
- Better Auth's `user` / `session` / `account` / `verification` tables, plus a per-user `organization` JSONB column for folders/pins.
- `kv_store` — backs `lib/kv` (TTL-aware key/value with distributed locks).
- `room` / `room_member` — project rooms and access control. Source of truth for who can open a canvas; the `/api/yjs/auth` route gates Yjs-host token issuance against `room_member`.
- `thread` / `comment` / `thread_read` — canvas comment threads plus per-user read markers. Realtime fanout rides a `meta.commentsRevision` counter inside the room's Y.Doc — server bumps it after any thread/comment change, clients subscribe via `useCommentsRevision` and refetch.
- `agent_chat` / `agent_message` / `agent_run` / `agent_pending_tool_call` — agent persistence behind the `streamText` tool loop in `lib/agent/engine.ts`: one chat per canvas chat session, an append-only `UIMessage` log, the run-state machine for each invocation, and tool calls parked awaiting user approval (e.g. `submit_plan`).
- `terminal_tab` — persisted Terminal Tabs, keyed by user + room + branch, recording each tab's identity/label/ordering and the harness key it launches into (never scrollback or conversation content).

#### Changing the schema

```bash
# 1. Edit apps/web/lib/db/schema.ts
# 2. Generate the migration (SQL file under apps/web/drizzle/)
cd apps/web && pnpm db:generate
# 3. Commit the generated .sql file alongside the schema change
# 4. The next deploy applies it via `drizzle-kit migrate`
```

For throwaway local experiments you can still use `pnpm db:push` to skip the migration file and sync the schema directly — don't commit the result.

> **Note on preview deploys:** by default every preview deploy runs `drizzle-kit migrate` against whatever `DATABASE_URL` is set to in Vercel's Preview scope. If you point preview at the same DB as production, a preview build will apply pending migrations to prod before the PR merges. If you need isolation, point previews at a separate database — e.g. [Neon's Vercel integration](https://neon.tech/docs/guides/vercel) gives you a per-preview branch automatically.

#### Using a different Postgres driver

`apps/web/lib/db/index.ts` picks the default driver via `createNeonDb()` in `neon.ts`. The exported `db` is typed as the driver-agnostic `DB` alias (`PgDatabase<PgQueryResultHKT, typeof schema>`), so any Drizzle Postgres driver is a drop-in replacement. To switch:

1. Install the driver package you want (`postgres`, `pg`, `@vercel/postgres`, …).
2. Add a sibling factory — e.g. `apps/web/lib/db/postgres-js.ts`:

   ```ts
   import postgres from "postgres"
   import { drizzle } from "drizzle-orm/postgres-js"
   import * as schema from "./schema"
   import type { DB } from "./types"

   export function createPostgresJsDb(): DB {
     if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set")
     return drizzle(postgres(process.env.DATABASE_URL), { schema })
   }
   ```

3. Change the single import in `index.ts` to point at your new factory.

`lib/kv` uses the same `db`, so nothing else in the app needs to change.

### Sandbox provider

Each workspace runs its coding agent and dev server inside a live sandbox VM. The default backend is [`@vercel/sandbox`](https://vercel.com/docs/vercel-sandbox) via `apps/web/lib/sandbox/vercel.ts`, fronted by a thin re-export in `apps/web/lib/sandbox/index.ts` that exposes a driver-agnostic `SandboxProvider` interface. Any backend that can provision a Linux VM, run commands, and read/write files can drop in — E2B, Modal, a remote Firecracker service, a local Docker daemon for development, etc.

#### Using a different sandbox provider

`apps/web/lib/sandbox/index.ts` picks the default provider via `getVercelSandboxProvider()` in `vercel.ts`. The exported `sandboxProvider` is typed as the backend-agnostic `SandboxProvider` interface defined in `apps/web/lib/sandbox/types.ts`, so any implementation of that interface is a drop-in replacement. To switch:

1. Install whatever SDK your backend needs.
2. Add a sibling factory — e.g. `apps/web/lib/sandbox/e2b.ts`:

   ```ts
   import "server-only"
   import type { SandboxProvider } from "./types"

   class E2BSandboxProvider implements SandboxProvider {
     async create(opts) { /* call your SDK, return a SandboxInstance */ }
     async get(opts)    { /* call your SDK, return a SandboxInstance */ }
   }

   export function getE2BSandboxProvider(): SandboxProvider {
     return new E2BSandboxProvider()
   }
   ```

3. Change the single import in `index.ts` to point at your new factory.

The `SandboxInstance` interface the provider must return is small (`runCommand`, `writeFiles`, `readFileToBuffer`, `domain`, `extendTimeout`, `name`, `status`, plus provider-supplied path seams like `worktreePath` / `homeDir`) — see `apps/web/lib/sandbox/types.ts` for the exact shape. Everything else in the app — the agent's tool executor, the logs SSE route, the terminal plumbing — is written against this interface and needs no changes when the backend swaps. Capabilities a backend can't offer (e.g. Hibernation) are guarded behind optional predicates rather than baked into the core interface; see [ADR 0003](apps/web/docs/adr/0003-honest-sandbox-provider-seam.md) for the portable-core-plus-optional-capability design.

### Blob store

Project thumbnails are screenshotted by a headless browser, resized, and uploaded to a public-readable blob store. The default backend is [`@vercel/blob`](https://vercel.com/docs/vercel-blob) via `apps/web/lib/blob/vercel.ts`, fronted by a thin re-export in `apps/web/lib/blob/index.ts` that exposes a backend-agnostic `BlobStore` interface. Any object store with a public-URL read path works — S3, R2, GCS, Supabase Storage, a self-hosted MinIO bucket, etc.

#### Using a different blob backend

`apps/web/lib/blob/index.ts` picks the default store via `getVercelBlobStore()` in `vercel.ts`. The exported `blobStore` is typed as the backend-agnostic `BlobStore` interface defined in `apps/web/lib/blob/types.ts`, so any implementation of that interface is a drop-in replacement. To switch:

1. Install whatever SDK your backend needs.
2. Add a sibling factory — e.g. `apps/web/lib/blob/s3.ts`:

   ```ts
   import "server-only"
   import type { BlobStore } from "./types"

   class S3BlobStore implements BlobStore {
     async put(key, body, opts) { /* call your SDK, return { url } */ }
   }

   export function getS3BlobStore(): BlobStore {
     return new S3BlobStore()
   }
   ```

3. Change the single import in `index.ts` to point at your new factory.

The `BlobStore` interface is intentionally tiny (`put(key, body, opts) → { url }`) — see `apps/web/lib/blob/types.ts` for the exact shape. Callers (`lib/thumbnail/capture.ts`) only ever see the abstract interface and need no changes when the backend swaps.

### Model providers

The agent loop is built on the [Vercel AI SDK](https://ai-sdk.dev). Each provider is one concrete file under `apps/web/lib/agent/providers/` (`anthropic`, `openai`, `google`, `vercel` for the AI Gateway, and `openai-compatible`), composed into the active set in `apps/web/lib/agent/providers/index.ts`. The shape mirrors `lib/sandbox/`, `lib/blob/`, and `lib/yjs-host/` — a `ModelProvider` interface in `types.ts`, one file per implementation, and an `index.ts` that picks which ones are live.

Model ids are fully qualified: `<provider>:<model>` (e.g. `anthropic:claude-sonnet-4-6`, `openai:gpt-4o`, `vercel:anthropic/claude-sonnet-4-6` for a model routed through the AI Gateway, `compat:llama-3.3-70b` for an OpenAI-compatible endpoint). Bare ids are rejected — provider routing is always explicit, so a deployment configured only for OpenAI never silently routes a stray `claude-*` id to Anthropic.

A provider self-detects whether it's enabled by inspecting env vars in `isConfigured()`. Providers without their key set are skipped from the picker but stay loaded in code, so chats that reference them surface a clear "API key not set" error rather than silently rerouting.

#### Configuring providers

At least one of these must be set:

Each provider's model list is populated live by hitting its discovery endpoint, filtered to chat-capable models, and cached for an hour in `lib/kv`. There's no static catalog to keep in sync — adding a model upstream surfaces in the picker on the next refresh.

- **Anthropic** — `ANTHROPIC_API_KEY`. Models discovered from `GET https://api.anthropic.com/v1/models`.
- **OpenAI** — `OPENAI_API_KEY`. Models discovered from `GET https://api.openai.com/v1/models`, filtered to chat-capable ids (excludes embeddings, dall-e, tts, whisper, etc.).
- **Google (Gemini)** — `GOOGLE_GENERATIVE_AI_API_KEY`. Models discovered from `GET https://generativelanguage.googleapis.com/v1beta/models`, filtered to those supporting `generateContent`.
- **Vercel AI Gateway** (provider key `vercel`) — `AI_GATEWAY_API_KEY`, generated from your project's AI Gateway dashboard. Routes through https://ai-gateway.vercel.sh and exposes hundreds of models behind a unified API with Vercel-specific features on top: budgets, per-user/tag analytics, automatic failover, and BYOK. Model ids are prefixed `vercel:` (e.g. `vercel:anthropic/claude-sonnet-4-6`). Models discovered via `gateway.getAvailableModels()` from the AI SDK, filtered to language models. Note: although Vercel injects an OIDC token on deploys, the gateway does **not** accept it in practice, so `AI_GATEWAY_API_KEY` must be set explicitly — even on Vercel — for this provider to be considered configured.
- **Generic OpenAI-compatible endpoint** — `OPENAI_COMPATIBLE_BASE_URL` (+ optional `OPENAI_COMPATIBLE_API_KEY`) point at any endpoint that speaks the OpenAI HTTP protocol: OpenRouter, Groq, Together, vLLM, LM Studio, an internal LiteLLM proxy, etc. Models discovered from `${BASE_URL}/v1/models`. For Vercel AI Gateway specifically, use the dedicated provider above instead — it uses Vercel's SDK and gets you the extra Gateway features. Example:

  ```bash
  OPENAI_COMPATIBLE_BASE_URL=https://openrouter.ai/api/v1
  OPENAI_COMPATIBLE_API_KEY=sk-or-...
  ```

Each provider falls back to a small curated list if its discovery call fails — typically when a key is invalid, the upstream is rate-limiting, or a self-hosted server doesn't implement `/v1/models`. The fallback is negative-cached for ~1 minute so a flapping upstream doesn't get hammered while still recovering quickly when it heals.

`AGENT_DEFAULT_MODEL` overrides the fallback used when a request doesn't pass a model. Default: `anthropic:claude-sonnet-4-6`. Set this to a provider you've actually configured — e.g. `openai:gpt-4o` if you're not running Anthropic at all.

#### Adding a new provider

1. Install the AI SDK adapter for your provider (e.g. `pnpm add @ai-sdk/mistral`).
2. Drop a sibling factory under `apps/web/lib/agent/providers/` modeled on the existing files:

   ```ts
   import "server-only"
   import { mistral } from "@ai-sdk/mistral"
   import type { ModelProvider } from "./types"

   class MistralProvider implements ModelProvider {
     key = "mistral"
     label = "Mistral"
     isConfigured() { return Boolean(process.env.MISTRAL_API_KEY) }
     listModels() {
       if (!this.isConfigured()) return []
       return [{ id: "mistral:mistral-large-latest", label: "Mistral Large" }]
     }
     resolve(modelId: string) { return mistral(modelId) }
   }

   export function getMistralProvider(): ModelProvider {
     return new MistralProvider()
   }
   ```

3. Import the factory and add it to the `PROVIDERS` array in `apps/web/lib/agent/providers/index.ts`.

The `ModelProvider` interface is small (`key`, `label`, `isConfigured`, `listModels`, `resolve`) — see `apps/web/lib/agent/providers/types.ts` for the exact shape. The agent engine, model picker, and `/api/agent/models` route are all written against this interface and need no changes.

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

# --- Postgres ---
# Used by Better Auth, Drizzle, and lib/kv. Any Postgres works — the default
# factory (lib/db/neon.ts) uses Neon's serverless HTTP driver; swap it for
# postgres-js / node-postgres if you're pointing at something else.
DATABASE_URL=postgres://...

# --- Yjs host ---
# Credentials for whatever Yjs host is configured. The default implementation
# targets Liveblocks and only needs a server-side secret key from
# https://liveblocks.io/dashboard — it's consumed by lib/yjs-host/liveblocks-server.ts
# and never leaves the server. To point at a different host, add sibling
# `*-server.ts` / `*-client.tsx` files under lib/yjs-host/, flip the re-exports
# in lib/yjs-host/index.ts + lib/yjs-host/client.tsx, and set whatever env
# vars that host needs instead of LIVEBLOCKS_SECRET_KEY.
LIVEBLOCKS_SECRET_KEY=sk_...

# --- Model providers (agent) ---
# At least one provider must be configured. See "Model providers" above.
# Each provider self-detects via the env vars below; unset providers are
# skipped from the picker. AGENT_DEFAULT_MODEL must reference a provider
# that's actually configured.
AGENT_DEFAULT_MODEL=anthropic:claude-sonnet-4-6
ANTHROPIC_API_KEY=sk-ant-...
# OPENAI_API_KEY=sk-...
# GOOGLE_GENERATIVE_AI_API_KEY=...
# AI_GATEWAY_API_KEY=...   # Vercel AI Gateway; required even on Vercel (the
#                          # injected OIDC token is not accepted by the gateway)
# OPENAI_COMPATIBLE_BASE_URL=https://openrouter.ai/api/v1
# OPENAI_COMPATIBLE_API_KEY=...

# --- BYO coding harnesses (terminal tabs) ---
# Comma-separated catalog keys of external coding CLIs to install into each
# sandbox for use in Terminal Tabs. Catalog keys: claude-code, codex,
# opencode-gateway, opencode-compat. Unset ⇒ no harness is installed. A key is
# only honored when its broker model provider above is configured AND
# header-brokerable. See "BYO coding harnesses" below.
# BREAKING CHANGE: there is no default anymore — set this to keep Claude Code.
# SANDBOX_HARNESSES=claude-code

# --- Env-var encryption ---
# 32 random bytes, hex-encoded (64 hex chars). Used to encrypt per-workspace
# env vars before storing them in Postgres (see lib/env-store.ts).
# Generate with: openssl rand -hex 32
ENCRYPTION_KEY=<64 hex chars>

# --- Thumbnail capture ---
# HMAC secret for the short-lived tokens that gate /[roomId]/render. The
# capture pipeline hits that route with a signed token because it can't carry
# a user session. Any long random string works.
# Generate with: openssl rand -hex 32
THUMBNAIL_RENDER_SECRET=<64 hex chars>

# --- Terminal access ---
# HMAC secret for the short-lived, per-session credentials that gate access to
# a sandbox's terminal daemon (Terminal Tabs). A room member POSTs
# /api/terminal/auth and gets a signed credential; the terminal-websocket proxy
# verifies it on connect so the in-sandbox root shell is never reachable on an
# open URL. Any long random string works.
# Generate with: openssl rand -hex 32
TERMINAL_AUTH_SECRET=<64 hex chars>

# --- Blob store ---
# Credentials for whatever blob store is configured. The default
# implementation (lib/blob/vercel.ts) wraps Vercel Blob and only needs a
# read/write token. On Vercel, connect a Blob store to your project and
# BLOB_READ_WRITE_TOKEN is injected automatically; locally, run
# `vercel env pull .env.local` after connecting the store. To point at a
# different backend, add a sibling factory under lib/blob/, flip the import
# in lib/blob/index.ts, and set whatever env vars that backend needs.
BLOB_READ_WRITE_TOKEN=...
```

#### BYO coding harnesses (`SANDBOX_HARNESSES`)

Beyond the owned agent loop, an operator can offer **bring-your-own coding CLIs** that run *inside* a sandbox's [Terminal Tab](apps/web/CONTEXT.md). Each is a descriptor in `apps/web/lib/agent/harnesses/`, keyed by a stable catalog key, and brokered through one of the model providers above. The current catalog:

| Key | CLI | Broker provider (gate var) |
| --- | --- | --- |
| `claude-code` | Claude Code (`@anthropic-ai/claude-code`) | `anthropic` (`ANTHROPIC_API_KEY`) |
| `codex` | Codex (`@openai/codex`) | `openai` (`OPENAI_API_KEY`) |
| `opencode-gateway` | opencode pointed at the Vercel AI Gateway | `vercel` (`AI_GATEWAY_API_KEY`) |
| `opencode-compat` | opencode pointed at an OpenAI-compatible endpoint | `compat` (`OPENAI_COMPATIBLE_API_KEY`) |

`SANDBOX_HARNESSES` is the comma-separated list of keys to install into every sandbox:

```bash
SANDBOX_HARNESSES=claude-code               # install Claude Code
# SANDBOX_HARNESSES=claude-code,codex       # several, in listed order
# SANDBOX_HARNESSES=opencode-gateway        # opencode via the AI Gateway
# (unset) ⇒ no harness is installed
```

Selection is a pure fold over the keys and your configured model providers (`apps/web/lib/agent/harnesses/index.ts`): a key is honored only when (a) it's a known catalog entry and (b) its broker model provider is configured **and** header-brokerable (`egress()` non-null) — e.g. `claude-code` needs `ANTHROPIC_API_KEY` set, `codex` needs `OPENAI_API_KEY`. Unknown keys and unconfigured/non-brokerable harnesses are silently dropped with a skip reason, never a hard failure. The harness never holds the real key: it boots against a dummy `brokered` placeholder and the sandbox firewall injects the operator's real key on egress — see [ADR 0002](apps/web/docs/adr/0002-byo-harness-terminal.md) for the trust boundary (single-trusted-operator, generalized egress injection, no per-tenant metering).

> ⚠️ **Breaking change for existing deployments.** There is **no longer a default harness.** Earlier versions always installed Claude Code into every sandbox; now nothing is installed unless `SANDBOX_HARNESSES` names it. **To keep today's behavior, set `SANDBOX_HARNESSES=claude-code`** (with `ANTHROPIC_API_KEY` configured) before upgrading — otherwise Claude Code disappears from your Terminal Tabs.

#### Sandbox provider credentials

The default sandbox provider is `@vercel/sandbox`, which authenticates via OIDC. In production on Vercel the OIDC token is injected automatically — no extra variables required. For local development, link the project once and pull a short-lived OIDC token into your env file:

```bash
vercel link
vercel env pull .env.local
```

This populates `VERCEL_OIDC_TOKEN` (valid for ~12 hours — re-run `vercel env pull` when it expires).

If you've swapped in a different provider under `apps/web/lib/sandbox/`, set whatever env vars that backend needs instead (e.g. `E2B_API_KEY`) and consume them inside the provider's factory function.

### Deploying to Vercel

1. Import the repo into a new Vercel project.
2. Add the environment variables listed above. Scope each one correctly:
   - `BETTER_AUTH_URL`: **Production only**, set to your custom domain (e.g. `https://build.screenplay.space`). Leave it unset on Preview so each preview deploy auto-uses `https://$VERCEL_URL`.
   - `BETTER_AUTH_PRODUCTION_URL`, `BETTER_AUTH_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`: **Production + Preview** (Vercel "all environments" scope). These must stay identical across every deploy — the oAuthProxy plugin signs state on production and verifies it on the preview that started the sign-in.
   - Everything else (`DATABASE_URL`, `LIVEBLOCKS_SECRET_KEY` (or whatever your Yjs host needs), whichever model-provider keys you've configured (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY` / `AI_GATEWAY_API_KEY` (must be set explicitly — the gateway doesn't accept Vercel's OIDC token) / `OPENAI_COMPATIBLE_*`), `AGENT_DEFAULT_MODEL`, `ENCRYPTION_KEY`, `THUMBNAIL_RENDER_SECRET`, `TERMINAL_AUTH_SECRET`, `BLOB_READ_WRITE_TOKEN` (or whatever your blob store needs), `SANDBOX_HARNESSES` (if you offer BYO coding CLIs)): **Production + Preview**.
3. Deploy. The first build runs the checked-in Drizzle migrations against your database, then runs `next build`.

### Running locally

```bash
pnpm install
cp apps/web/.env.local.example apps/web/.env.local   # then fill in values
cd apps/web && pnpm db:migrate                        # apply migrations to your database
pnpm dev
```

The app runs on http://localhost:3000.

## Development

```bash
pnpm dev         # start the Next.js dev server with Turbopack
pnpm build       # production build (runs drizzle-kit migrate, then next build)
pnpm lint        # ESLint
pnpm typecheck   # tsc --noEmit
pnpm format      # Prettier
pnpm test        # Vitest (run from apps/web for watch mode: pnpm test:watch)

# Database (run from apps/web)
pnpm db:generate # generate a new SQL migration from schema changes — commit the output
pnpm db:migrate  # apply committed migrations to $DATABASE_URL
pnpm db:push     # push the schema directly without a migration file (throwaway dev only)
pnpm db:studio   # open Drizzle Studio
```

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
