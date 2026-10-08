import { accessSync, constants, existsSync } from "node:fs"
import path from "node:path"

/**
 * The setup check `pnpm headless` runs before it builds (#1930): each missing
 * prerequisite named on its own line, so the host fixes the box before
 * anything fails halfway.
 */

/** The oldest Node `pnpm headless` runs on. */
export const MIN_NODE_MAJOR = 22

export interface SetupFacts {
  /** `process.versions.node`. */
  nodeVersion: string
  /** Whether a command is on `PATH`. */
  onPath(command: string): boolean
  /** Whether node-pty's native build (`build/Release/pty.node`) exists. */
  ptyBuilt: boolean
  /** The Chrome thumbnails use, or null when none is installed. */
  chrome: string | null
}

export interface SetupNeeds {
  /** The coding CLIs' commands; any one is enough. */
  codingClis: string[]
  /** Whether GitHub access runs `gh` (`gh-cli`). */
  needsGh: boolean
}

/** Every missing prerequisite, one line each; empty when the box is ready. */
export function missingPrerequisites(
  facts: SetupFacts,
  needs: SetupNeeds
): string[] {
  const missing: string[] = []

  const major = Number(facts.nodeVersion.split(".")[0])
  if (!(major >= MIN_NODE_MAJOR)) {
    missing.push(
      `Node ${MIN_NODE_MAJOR} or later (this is ${facts.nodeVersion})`
    )
  }

  if (!facts.onPath("git")) missing.push("git, for every chat’s code")

  if (!facts.ptyBuilt) {
    const tools = ["make", "python3"].filter((t) => !facts.onPath(t))
    if (!facts.onPath("g++") && !facts.onPath("c++")) tools.push("g++")
    missing.push(
      tools.length > 0
        ? `A C++ toolchain for the terminal (${tools.join(", ")}), then pnpm install again`
        : "The terminal’s native build: run pnpm rebuild node-pty"
    )
  }

  if (!facts.chrome) {
    missing.push(
      "Chrome for thumbnails: set CHROMIUM_PATH, or run pnpm --filter app exec puppeteer browsers install chrome"
    )
  }

  if (!needs.codingClis.some((c) => facts.onPath(c))) {
    missing.push(`A coding CLI: one of ${needs.codingClis.join(", ")}`)
  }

  if (needs.needsGh && !facts.onPath("gh")) missing.push("The GitHub CLI, gh")

  return missing
}

/** Whether `command` is an executable on `PATH` (or a path to one). */
export function isOnPath(
  command: string,
  pathEnv: string = process.env.PATH ?? ""
): boolean {
  const candidates = command.includes("/")
    ? [command]
    : pathEnv
        .split(path.delimiter)
        .filter(Boolean)
        .map((dir) => path.join(dir, command))
  return candidates.some((file) => {
    try {
      accessSync(file, constants.X_OK)
      return existsSync(file)
    } catch {
      return false
    }
  })
}
