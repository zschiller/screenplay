import "server-only"

import { homedir } from "node:os"

import type { DetectionResult } from "@/lib/host-tool/setup-step"
import { harnessAvailability, type HarnessResolver } from "./availability"
import {
  defaultHostBinaryProber,
  hostHarnesses,
  probeHostFacts,
  type HostBinaryProber,
} from "./host-binary"
import { HARNESSES } from "./index"
import { defaultHarnessProcessRunner } from "./process-runner"
import type {
  Harness,
  HarnessModelChoice,
  HarnessProcessRunner,
  HostFacts,
} from "./types"

/**
 * The **Harness Setup** module (ADR 0015): the one place that knows how the
 * desktop build installs and signs in a coding CLI. Everything the "Coding
 * agents" Settings panel and the first-run gate (ADR 0016) need sits behind three
 * calls — {@link HarnessSetup.rows}, {@link HarnessSetup.commandsFor},
 * {@link HarnessSetup.markConnected} — so both surfaces *render* setup rows and
 * hold no setup policy of their own.
 *
 * What it absorbs, each of which used to live in its own small module or inside
 * the panel component:
 *  - the **live** per-row read (host presence + each descriptor's own auth
 *    probe), fresh on every call — never the launch-memoized availability
 *    resolver, because reflecting a connect that just finished is the whole point
 *    of the setup surface;
 *  - the single dedupe-by-`hostBinary` rule ({@link distinctByHostBinary}), so
 *    the two opencode slots are one row;
 *  - host-facts probing, composed from the module's **own** injected prober
 *    ({@link probeHostFacts}) rather than a second `command -v` path;
 *  - the install → sign-in chaining a row's action runs in one PTY;
 *  - the **row policy**: which detection result a status maps to, which action to
 *    offer, and the row's state line.
 *
 * The host-binary prober and the process runner are **injected ports** (the same
 * two seams the descriptors were already written against), so every rule here is
 * unit-testable against a fake host: a prober that reports which binaries
 * "exist", a runner that returns canned credential replies. Nothing is memoized —
 * `rows()` re-probes on every call, by design.
 *
 * ADR 0015 holds unchanged: descriptors own `probeAuth` / `buildInstallCommand` /
 * `authCommand`, the reusable host-tool setup step drives each row, listing is
 * gated on **presence** while auth is only *surfaced*, and the help is
 * one-directional — install and launch a sign-in, never sign out or uninstall.
 */

/**
 * The action a setup row offers. `install` installs the CLI and chains straight
 * into its own sign-in; `auth` runs the bare sign-in (a signed-out CLI, or a
 * connected one refreshing a lapsed login).
 */
export type HarnessSetupActionKind = "install" | "auth"

/** A setup row's affordance: what it runs, how it's labelled, how it's weighted. */
export interface HarnessSetupAction {
  kind: HarnessSetupActionKind
  /** Button label. */
  label: string
  /** Whether it reads as the row's primary action (vs. a secondary re-run). */
  primary: boolean
}

/**
 * One setup row — everything a surface draws, already decided. One row per
 * distinct `hostBinary` (the dedupe rule), in catalog order, carrying the live
 * facts, the reusable setup step's {@link DetectionResult}, and the row policy's
 * output (dot, state line, action).
 */
export interface HarnessSetupRow {
  /** Representative harness key for this row (first catalog entry on the binary). */
  key: string
  /** Human-readable label shown on the row. */
  label: string
  /** The host binary this row installs / detects — the dedupe key, stable per row. */
  hostBinary: string
  /** Whether the binary is on the host `PATH` right now (probed live). */
  installed: boolean
  /**
   * Whether the CLI's own login is present: `boolean` when the representative
   * descriptor carries a `probeAuth` and the binary is installed, else `null`
   * ("not probed / can't tell"). Never used to gate listing — only to label the
   * row (the Harness Availability invariant: presence lists, auth is surfaced).
   */
  authenticated: boolean | null
  /** The live facts folded into the reusable setup step's detection result. */
  detection: DetectionResult
  /** Whether the row reads as connected (the green state chip). */
  connected: boolean
  /** The row's state, as its chip reads ("Signed in", "Not installed"). */
  state: string
  /**
   * The installed CLI's version (`2.1.4`), read from `<binary> --version`.
   * `null` when it isn't installed or the output carries no version.
   */
  version: string | null
  /** Where the binary resolves on `PATH`, `~`-abbreviated. `null` when absent. */
  path: string | null
  /** The action to offer, or `null` when this row has nothing runnable. */
  action: HarnessSetupAction | null
  /**
   * Whether the row offers Choose models: the CLI is installed and lists its
   * models for people to pick from (`Harness.modelList`, OpenCode, #1589).
   */
  choosesModels: boolean
}

/** What a row's action runs in the inline host terminal, and how it's narrated. */
export interface HarnessSetupRun {
  /** Argv for the inline host-session PTY. */
  command: string[]
  /** The status message shown above the live terminal. */
  message: string
}

/** The module's interface — the whole surface area of desktop harness setup. */
export interface HarnessSetup {
  /**
   * The live setup rows, one per distinct `hostBinary`, re-probed on every call.
   */
  rows(): Promise<HarnessSetupRow[]>
  /**
   * Just each row's install/auth pair — what the first-run gate folds — probed
   * live like {@link rows} but without the facts line's `--version` and
   * `command -v` reads. The gate runs on every hard load (app launch
   * included), so it skips work only Settings displays.
   */
  readiness(): Promise<Pick<HarnessSetupRow, "installed" | "authenticated">[]>
  /**
   * What harness `key`'s `kind` action runs in the inline terminal, resolved
   * against live host facts. `null` when the key is unknown or the harness has
   * no sign-in path (nothing this surface can run).
   */
  commandsFor(
    key: string,
    kind: HarnessSetupActionKind
  ): Promise<HarnessSetupRun | null>
  /**
   * Record that a setup run finished: bust the shared launch-memoized Harness
   * Availability memo so the model dropdown and new-tab picker re-probe the host
   * on their next read (ADR 0015), then hand back freshly probed rows. One call,
   * so a connect lands app-wide *and* the row updates without a reload.
   */
  markConnected(): Promise<HarnessSetupRow[]>
  /**
   * Every model harness `key` can run, as its CLI lists them right now, for
   * the row's Choose models. `null` when the key is unknown, it has no model
   * list, or the CLI didn't answer.
   */
  modelChoices(key: string): Promise<HarnessModelChoice[] | null>
}

/**
 * Build a Harness Setup module over its ports. Defaults are the production
 * catalog, the `command -v` host prober, the host process runner, and the shared
 * Harness Availability singleton; `facts` defaults to composing `probe` (so the
 * npm / brew presence behind an install command is probed the one way host
 * detection is) and is injectable on its own only so a test can pin `arch`.
 */
export function createHarnessSetup(
  opts: {
    harnesses?: Harness[]
    probe?: HostBinaryProber
    run?: HarnessProcessRunner
    availability?: HarnessResolver
    facts?: () => Promise<HostFacts>
  } = {}
): HarnessSetup {
  const harnesses = opts.harnesses ?? HARNESSES
  const probe = opts.probe ?? defaultHostBinaryProber
  const run = opts.run ?? defaultHarnessProcessRunner
  const availability = opts.availability ?? harnessAvailability
  const facts = opts.facts ?? (() => probeHostFacts(probe))

  const rows = () =>
    Promise.all(hostHarnesses(harnesses).map((harness) => resolveRow(harness)))

  /**
   * One row: probe presence, then — only for an installed binary whose
   * representative descriptor has a `probeAuth` — its own login. A not-installed
   * row is never auth-probed (`null`, moot: it reads "Not installed"), and a
   * descriptor without a probe is `null` ("can't tell"), which the row policy
   * treats as *not authed* (offer sign-in), never a false "connected".
   */
  async function resolveRow(harness: Harness): Promise<HarnessSetupRow> {
    const installed = await probe(harness.hostBinary)
    const [authenticated, version, path] = await Promise.all([
      installed && harness.probeAuth ? harness.probeAuth(run) : null,
      installed ? readVersion(run, harness.hostBinary) : null,
      installed ? locateBinary(run, harness.hostBinary) : null,
    ])
    return { ...describeRow(harness, installed, authenticated), version, path }
  }

  const readiness = () =>
    Promise.all(
      hostHarnesses(harnesses).map(async (harness) => {
        const installed = await probe(harness.hostBinary)
        const authenticated =
          installed && harness.probeAuth ? await harness.probeAuth(run) : null
        return { installed, authenticated }
      })
    )

  return {
    rows,
    readiness,

    async commandsFor(key, kind) {
      const harness = harnesses.find((h) => h.key === key)
      if (!harness?.authCommand) return null
      const authOnly = harness.authCommand
      // An `install` action on a harness with no in-app install path degrades to
      // the bare sign-in rather than offering nothing.
      const command =
        kind === "install" && harness.buildInstallCommand
          ? chainInstallIntoAuth(
              harness.buildInstallCommand(await facts()),
              authOnly
            )
          : authOnly
      return {
        command,
        message: runMessage(kind, harness.hostLabel ?? harness.label),
      }
    },

    async markConnected() {
      availability.invalidate()
      return rows()
    },

    async modelChoices(key) {
      const list = harnesses.find((h) => h.key === key)?.modelList
      const [cmd, ...args] = list?.argv ?? []
      if (!list || !cmd) return null
      try {
        const result = await run(cmd, args)
        return result.exitCode === 0 ? list.parse(result.stdout) : null
      } catch {
        return null
      }
    },
  }
}

/**
 * Chain an install straight into the CLI's own sign-in in one `sh -c`, so both
 * share one visible PTY. Chained with `&&`, so a failed install stops before the
 * sign-in with its error still on screen (the row then re-detects back to
 * "Not installed"); on success the PTY exit re-detects to Connected.
 */
function chainInstallIntoAuth(
  install: string,
  authCommand: string[]
): string[] {
  return ["sh", "-c", `${install} && ${authCommand.join(" ")}`]
}

/** The status message shown above the working terminal. */
function runMessage(kind: HarnessSetupActionKind, label: string): string {
  if (kind === "install") {
    return (
      `Installing ${label}, then signing you in. Follow the prompts below; ` +
      "this closes when you're done."
    )
  }
  return (
    `Signing in to ${label}. Follow the prompts below; this closes when ` +
    "you're done."
  )
}

/**
 * The **row policy**: live facts → the row a surface draws. Honest degradation
 * throughout — an unknown auth fact (`authenticated === null`, e.g. an
 * indeterminate probe) reads as *installed but signed out*, so the row offers a
 * sign-in rather than a false "connected". Help is one-directional (ADR 0015):
 * not-installed gets a primary **Install and sign in** (install chained into the
 * CLI's own sign-in); signed-out gets a primary **Sign in**; connected gets only
 * a secondary **Sign in again** to refresh a lapsed login. No sign-out, no
 * uninstall — ever. A descriptor with no `authCommand` has nothing this surface
 * can run, so it offers no action at all.
 */
function describeRow(
  harness: Harness,
  installed: boolean,
  authenticated: boolean | null
): Omit<HarnessSetupRow, "version" | "path"> {
  const base = {
    key: harness.key,
    label: harness.label,
    hostBinary: harness.hostBinary,
    installed,
    authenticated,
    choosesModels: installed && harness.modelList !== undefined,
  }
  const runnable = harness.authCommand !== undefined
  const action = (a: HarnessSetupAction) => (runnable ? a : null)

  if (!installed) {
    return {
      ...base,
      detection: "not-installed",
      connected: false,
      state: "Not installed",
      action: action({
        kind: "install",
        label: "Install and sign in",
        primary: true,
      }),
    }
  }
  if (authenticated === true) {
    return {
      ...base,
      detection: "authed",
      connected: true,
      state: "Signed in",
      action: action({ kind: "auth", label: "Sign in again", primary: false }),
    }
  }
  return {
    ...base,
    detection: "installed-not-authed",
    connected: false,
    state: "Signed out",
    action: action({ kind: "auth", label: "Sign in", primary: true }),
  }
}

/**
 * The installed CLI's version, for the row's facts line: the first
 * `major.minor.patch` in `<binary> --version` (CLIs print it with their own
 * name around it, e.g. `2.1.4 (Claude Code)`). Best effort — any failure, or
 * output with no version in it, is `null` and the row just leaves it out.
 */
async function readVersion(
  run: HarnessProcessRunner,
  binary: string
): Promise<string | null> {
  try {
    const { exitCode, stdout } = await run(binary, ["--version"])
    if (exitCode !== 0) return null
    return /\d+\.\d+\.\d+[\w.+-]*/.exec(stdout)?.[0] ?? null
  } catch {
    return null
  }
}

/**
 * Where `binary` resolves on `PATH` (`command -v`), with the home directory
 * shortened to `~`, for the row's facts line. Best effort, like
 * {@link readVersion}.
 */
async function locateBinary(
  run: HarnessProcessRunner,
  binary: string
): Promise<string | null> {
  try {
    const { exitCode, stdout } = await run("sh", [
      "-c",
      'command -v "$0"',
      binary,
    ])
    const path = stdout.trim()
    if (exitCode !== 0 || !path.startsWith("/")) return null
    return abbreviateHome(path, homedir())
  } catch {
    return null
  }
}

/** `path` with a leading `home` shortened to `~`. */
export function abbreviateHome(path: string, home: string): string {
  if (!home || home === "/") return path
  if (path === home) return "~"
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
}

/**
 * The production module: the real catalog through the production host prober,
 * process runner, and shared availability resolver. The server actions wrap it
 * behind the `isLocalBuild` gate.
 */
export const harnessSetup: HarnessSetup = createHarnessSetup()
