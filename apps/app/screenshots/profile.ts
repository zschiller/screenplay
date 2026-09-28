import { randomBytes } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * The **capture profile** — the screenshot harness's sibling of
 * `apps/desktop/desktop.env`.
 *
 * `desktop.env` selects every local backend for the *Tauri shell*; this selects
 * the same ones for a **web container with no shell** (issue #716), which is the
 * one difference that matters: the shell owns the machine-specific half of the
 * profile (a free port, the OS app-data dirs, minted secrets) and re-injects it
 * at sidecar spawn. Nothing injects it here, so this module computes that half
 * — deterministically, under one throwaway state dir — and every harness command
 * (`seed`, `boot`, `shots`, `video`) reads the profile from here so the seeder
 * and the server it later boots agree on the same database, the same Yjs
 * persistence dir, and the same encryption key.
 *
 * Two deliberate departures from `desktop.env`:
 *
 * - **`THUMBNAIL_CAPTURER` is left unset** (the default headless-Chromium
 *   capturer) rather than `tauri-webview`: there is no webview to ask. The
 *   fixture world seeds its Thumbnail Manifests directly, so the capturer is
 *   never exercised either way.
 * - **`SCREENPLAY_DESKTOP` is left unset**, so `next.config.mjs` doesn't switch
 *   to `output: "standalone"` — we run the app straight from the workspace
 *   (`next dev`, or `next start` after a normal build), not as a packed sidecar.
 */

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")

/** The harness's throwaway on-disk state, all under one gitignored root. */
const DEFAULT_STATE_ROOT = join(appRoot, ".screenshots")

/** Port the captured app is served on. Fixed (not OS-assigned) so a
 *  half-written capture run can be resumed against an already-booted server and
 *  so the docs can name one URL. Override with `SCREENSHOTS_PORT`. */
const DEFAULT_PORT = 3947

/** Port the fixture preview server binds, so Iframe Layers have something to
 *  load. Derived from the app port so one `SCREENSHOTS_PORT` moves both. */
const PREVIEW_PORT_OFFSET = 1

/** The hosted build's port, clear of the local build's pair so both can run. */
const DEFAULT_HOSTED_PORT = 3949

/**
 * Whether this run captures the **hosted build** instead of the local one
 * (`--hosted` on any harness command, which sets `SCREENSHOTS_HOSTED=1`). The
 * local build strips the multi-user surface — comments, sharing, sign-in — so
 * screens of those can only be shot here (#789).
 */
export function isHostedCapture(): boolean {
  return process.env.SCREENSHOTS_HOSTED === "1"
}

export interface CaptureProfile {
  /** Whether this is the hosted build (see {@link isHostedCapture}). */
  hosted: boolean
  /** Repo path of `apps/app`, the cwd every spawned command runs in. */
  appRoot: string
  /** Root of the harness's throwaway state (db, Y.Docs, blobs, secrets). */
  stateRoot: string
  /** Where capture sets are written (`<captureRoot>/<label>/…`). */
  captureRoot: string
  port: number
  /** Origin the harness drives, e.g. `http://127.0.0.1:3947`. */
  baseUrl: string
  previewPort: number
  /** Origin the fixture preview server serves Iframe Layer content from. */
  previewOrigin: string
  /** The full env the app server (and the seeder) must run with. */
  env: Record<string, string>
}

/**
 * Resolve the capture profile, creating the state dirs and — on first use — the
 * per-install secrets.
 *
 * The secrets (`ENCRYPTION_KEY`, `TERMINAL_AUTH_SECRET`) are *minted*, never
 * committed: the hosted deploy gets them from deployment config and the desktop
 * shell mints them on first launch, so a capture container has none either. They
 * are written to `<stateRoot>/secrets.env` because the seeder and the server are
 * separate processes — the seeder encrypts the fixture Project presets into
 * `kv_store` and the server has to decrypt them back — so a key regenerated
 * between the two would surface as presets that silently fail to load.
 */
export function resolveCaptureProfile(): CaptureProfile {
  const hosted = isHostedCapture()
  // The two builds keep separate state: their databases have different
  // schemas, and a world seeded for one would fail to boot the other.
  const stateRoot = process.env.SCREENSHOTS_STATE_DIR
    ? resolve(process.env.SCREENSHOTS_STATE_DIR)
    : hosted
      ? join(DEFAULT_STATE_ROOT, "hosted")
      : DEFAULT_STATE_ROOT
  const captureRoot = process.env.SCREENSHOTS_CAPTURE_DIR
    ? resolve(process.env.SCREENSHOTS_CAPTURE_DIR)
    : join(stateRoot, "captures")
  const port = Number(
    process.env.SCREENSHOTS_PORT ??
      (hosted ? DEFAULT_HOSTED_PORT : DEFAULT_PORT)
  )
  const previewPort = port + PREVIEW_PORT_OFFSET

  mkdirSync(stateRoot, { recursive: true })
  const secrets = ensureSecrets(join(stateRoot, "secrets.env"))
  const baseUrl = `http://127.0.0.1:${port}`

  return {
    hosted,
    appRoot,
    stateRoot,
    captureRoot,
    port,
    baseUrl,
    previewPort,
    previewOrigin: `http://127.0.0.1:${previewPort}`,
    env: {
      // --- the local-build switches, mirroring desktop.env ---
      NEXT_PUBLIC_SCREENPLAY_LOCAL: "1",
      NEXT_PUBLIC_YJS_HOST: "local",
      // Empty overrides any NEXT_PUBLIC_BASE_PATH a developer's .env.local sets
      // for hosted dev — the harness drives the app at the origin root.
      NEXT_PUBLIC_BASE_PATH: "",
      SANDBOX_BACKEND: "local",
      SCREENPLAY_DB: "pglite",
      BLOB_STORE: "local-fs",
      AGENT_ENGINE: "external",

      // --- the machine-specific half the Tauri shell would otherwise inject ---
      PGLITE_DATA_DIR: join(stateRoot, "pglite"),
      PGLITE_MIGRATIONS_DIR: join(appRoot, "drizzle", "local"),
      YJS_PERSISTENCE_DIR: join(stateRoot, "yjs"),
      LOCAL_BLOB_DIR: join(stateRoot, "blobs"),
      // Origin-relative on purpose (see `lib/blob/local-fs.ts`): the URL is
      // persisted into the fixture Thumbnail Manifests, so it must not bake in
      // a port.
      LOCAL_BLOB_BASE_URL: "/blobs",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      ...secrets,

      // --- capture-only ---
      // Tell the app it is serving a seeded world, not a real machine: it opens
      // the first-run setup gate and stops Sandbox Reconnect from reconciling
      // the fixture Workspaces out of existence. See `lib/fixture-world.ts`.
      NEXT_PUBLIC_SCREENPLAY_FIXTURE_WORLD: "1",
      // Fixed so `createdAt`/`updatedAt` formatting ("2 days ago") doesn't
      // depend on the capturing machine's zone — a diffable before/after set
      // needs the same clock on both sides.
      TZ: "UTC",

      ...(hosted ? hostedEnv(baseUrl, appRoot) : {}),
    },
  }
}

/**
 * What turns the profile above into the hosted build: the multi-user surface
 * back on, the hosted schema's migrations run into the same PGlite, and Better
 * Auth configured well enough to read the session the seeder writes. There's no
 * GitHub sign-in: the capture browser carries that session's cookie
 * (`./lib/hosted.ts`). Everything else stays local — the Yjs host, sandboxes,
 * blobs — since the build switch and the backend seams are independent.
 */
function hostedEnv(baseUrl: string, root: string): Record<string, string> {
  return {
    NEXT_PUBLIC_SCREENPLAY_LOCAL: "0",
    PGLITE_MIGRATIONS_DIR: join(root, "drizzle"),
    BETTER_AUTH_URL: baseUrl,
    BETTER_AUTH_PRODUCTION_URL: baseUrl,
    GITHUB_CLIENT_ID: "screenshot-fixture",
    GITHUB_CLIENT_SECRET: "screenshot-fixture",
    // So the server process resolves this same profile (`workspace-lifecycle`).
    SCREENSHOTS_HOSTED: "1",
  }
}

/** The env a spawned command gets: the caller's env with the profile layered on. */
export function captureEnv(profile: CaptureProfile): NodeJS.ProcessEnv {
  return { ...process.env, ...profile.env }
}

const SECRET_NAMES = [
  "ENCRYPTION_KEY",
  "TERMINAL_AUTH_SECRET",
  // Signs the hosted build's session cookie; unused by the local build.
  "BETTER_AUTH_SECRET",
] as const

function ensureSecrets(path: string): Record<string, string> {
  const existing = existsSync(path)
    ? parseEnvFile(readFileSync(path, "utf8"))
    : {}
  if (SECRET_NAMES.every((name) => existing[name])) return existing
  // Mint only what's missing, so a state dir from before a secret was added
  // keeps the keys its seeded data was written with.
  const secrets: Record<string, string> = { ...existing }
  for (const name of SECRET_NAMES) {
    secrets[name] ??= randomBytes(32).toString("hex")
  }
  writeFileSync(
    path,
    [
      "# Minted by the screenshot harness (apps/app/screenshots/profile.ts).",
      "# Throwaway, machine-local, and gitignored — delete the state dir to rotate.",
      ...Object.entries(secrets).map(([k, v]) => `${k}=${v}`),
      "",
    ].join("\n"),
    { mode: 0o600 }
  )
  return secrets
}

function parseEnvFile(contents: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of contents.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq === -1) continue
    out[trimmed.slice(0, eq)] = trimmed.slice(eq + 1)
  }
  return out
}
