/**
 * What this build of the app can do, read in one place (#1924, spec #1923).
 *
 * A **build profile** names one of the three ways to run Screenplay and sets
 * every capability and backend switch together, so nobody assembles a
 * combination by hand:
 *
 * | Profile    | Identity  | Multi-user surface | Mac shell | Viewers |
 * | ---------- | --------- | ------------------ | --------- | ------- |
 * | `hosted`   | `account` | on                 | off       | off     |
 * | `desktop`  | `host`    | off                | on        | off     |
 * | `headless` | `host`    | on                 | off       | on      |
 *
 * - **Identity**: who writes. `account` is many people signed in with GitHub,
 *   each with their own token. `host` is one person, the host, who runs the
 *   server on their own machine: no sign-in, a single seeded local user
 *   (`@/lib/local-user`), and the machine's own git, `gh`, coding CLIs and
 *   folders.
 * - **Multi-user surface**: `room_member` membership, persisted comment
 *   threads, chat senders and remote presence. Off, those tables aren't even
 *   created (`lib/db/schema-multiuser.ts`).
 * - **Mac shell**: the Tauri window around the app: traffic lights, native
 *   dialogs, opening files in Finder, cheap webview thumbnails, Frame Drive in
 *   your own canvas.
 * - **Viewers**: people who watch a canvas by link on the viewer listener
 *   (Sharing). Nothing reads it yet.
 *
 * Set `NEXT_PUBLIC_SCREENPLAY_PROFILE` at build time. Unset means `hosted`,
 * and the older `NEXT_PUBLIC_SCREENPLAY_LOCAL=1` still means `desktop`. It is a
 * `NEXT_PUBLIC_` variable so the same constants are inlined into the server and
 * the client bundle, and the bundler dead-code-eliminates the other profiles'
 * branches. Keep every capability a plain comparison of the inlined profile so
 * that elimination keeps working; never read them from a table.
 */

export type BuildProfile = "hosted" | "desktop" | "headless"

/** The env var a build sets to pick its profile. */
export const PROFILE_ENV_VAR = "NEXT_PUBLIC_SCREENPLAY_PROFILE"

function readProfile(): BuildProfile {
  const raw = process.env.NEXT_PUBLIC_SCREENPLAY_PROFILE
  if (raw === "hosted" || raw === "desktop" || raw === "headless") return raw
  if (raw) {
    throw new Error(
      `Unknown ${PROFILE_ENV_VAR} "${raw}" (expected "hosted", "desktop" or "headless")`
    )
  }
  return process.env.NEXT_PUBLIC_SCREENPLAY_LOCAL === "1" ? "desktop" : "hosted"
}

/** This build's profile. */
export const buildProfile: BuildProfile = readProfile()

/** Who writes: GitHub accounts (`account`) or the machine's host (`host`). */
export const buildIdentity: "account" | "host" =
  buildProfile === "hosted" ? "account" : "host"

/** Membership, persisted comments, chat senders and remote presence. */
export const multiUserSurface: boolean = buildProfile !== "desktop"

/** The Tauri window around the app (the Mac app). */
export const macShell: boolean = buildProfile === "desktop"

/** People watching a canvas by link on the viewer listener (Sharing). */
export const viewers: boolean = buildProfile === "headless"

/**
 * The backend switches each profile implies. A switch set in the environment
 * still wins, so one seam can be overridden alone; unset, it falls back to the
 * profile's value. Hosted sets none: every seam keeps its hosted default.
 *
 * `THUMBNAIL_CAPTURER` isn't here: every profile captures with headless Chrome
 * except inside the Mac shell, which sets `tauri-webview` itself at launch,
 * since that capturer needs the shell's control server.
 */
export const PROFILE_BACKENDS = {
  hosted: {},
  desktop: {
    SANDBOX_BACKEND: "local",
    SCREENPLAY_DB: "pglite",
    BLOB_STORE: "local-fs",
    AGENT_ENGINE: "external",
    NEXT_PUBLIC_YJS_HOST: "local",
  },
  headless: {
    SANDBOX_BACKEND: "local",
    SCREENPLAY_DB: "pglite",
    BLOB_STORE: "local-fs",
    AGENT_ENGINE: "external",
    NEXT_PUBLIC_YJS_HOST: "local",
  },
} as const satisfies Record<
  BuildProfile,
  Partial<Record<BackendSwitch, string>>
>

export type BackendSwitch =
  | "SANDBOX_BACKEND"
  | "SCREENPLAY_DB"
  | "BLOB_STORE"
  | "AGENT_ENGINE"
  | "NEXT_PUBLIC_YJS_HOST"

/**
 * A backend switch's value: the environment's when set, else this profile's.
 * Server-side only; the client reads `NEXT_PUBLIC_YJS_HOST` through
 * {@link yjsHostDefault}, since a browser bundle has no `process.env` to index.
 */
export function backendSwitch(
  name: BackendSwitch,
  env: Record<string, string | undefined> = process.env
): string | undefined {
  const backends: Partial<Record<BackendSwitch, string>> =
    PROFILE_BACKENDS[buildProfile]
  return env[name] || backends[name]
}

/** This profile's Yjs host when `NEXT_PUBLIC_YJS_HOST` is unset. */
export const yjsHostDefault: string | undefined =
  buildProfile === "hosted" ? undefined : "local"
