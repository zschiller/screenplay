import type { DetectFileSystem } from "@/lib/add-repo/detect-fs"
import type { DetectedSettings } from "@/lib/add-repo/resolver"
import { parseDevServerPort } from "@/lib/run-settings"

/**
 * Model-assisted settings detection: the second pass after the deterministic
 * `detectSettings` seam. Build-info recognizes a framework and its package
 * manager, but not what a project says about itself — a README that runs
 * `make dev`, a dev script pinned to `-p 4000`, a monorepo whose web app lives
 * in `apps/web`, a Rails or Django app. This pass hands a model the files a
 * person would skim (manifests, lockfile names, framework configs, the README)
 * plus the deterministic guess, and asks it for the same three run settings.
 *
 * Pure apart from the injected `runModel`: the file gathering and the answer
 * parsing are unit-tested over the in-memory FS, and the transport (hosted
 * provider or the desktop harness CLI) is the caller's. Every uncertainty —
 * no model, a malformed answer, a field that fails validation — falls back to
 * the deterministic value for that field, so this pass can only refine.
 */

/** Largest slice of any one file the model sees. */
const MAX_FILE_CHARS = 6000
/** Ceiling on everything gathered, so a huge repo can't blow the prompt up. */
const MAX_TOTAL_CHARS = 40_000
/** Workspace packages read in a monorepo (`apps/*`, `packages/*`, …). */
const MAX_WORKSPACE_PACKAGES = 8

/** Root files worth reading when present, most telling first. */
const ROOT_FILES = [
  "package.json",
  "README.md",
  "readme.md",
  "README",
  "pnpm-workspace.yaml",
  "turbo.json",
  "nx.json",
  "Makefile",
  "Procfile",
  "Procfile.dev",
  "docker-compose.yml",
  "docker-compose.yaml",
  "compose.yml",
  ".env.example",
  ".env.sample",
  ".nvmrc",
  ".node-version",
  ".tool-versions",
  "pyproject.toml",
  "requirements.txt",
  "Pipfile",
  "manage.py",
  "Gemfile",
  "go.mod",
  "Cargo.toml",
  "composer.json",
  "deno.json",
]

/** Framework configs, matched by prefix so any extension counts. */
const CONFIG_PREFIXES = [
  "next.config.",
  "vite.config.",
  "astro.config.",
  "nuxt.config.",
  "svelte.config.",
  "remix.config.",
  "gatsby-config.",
  "angular.json",
  "vue.config.",
  "webpack.config.",
  "rsbuild.config.",
]

/** Lockfiles are named, not read: the name alone says which manager. */
const LOCKFILES = [
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "bun.lockb",
  "bun.lock",
  "poetry.lock",
  "uv.lock",
  "Gemfile.lock",
  "Cargo.lock",
]

/** Directories a monorepo keeps its apps and packages in. */
const WORKSPACE_DIRS = ["apps", "packages", "services", "web"]

export interface GatheredProject {
  /** Root entries, directories suffixed with `/`. */
  listing: string[]
  /** Path (no leading slash) → contents, clipped to {@link MAX_FILE_CHARS}. */
  files: Record<string, string>
}

/**
 * Collect what the model reads: the root listing, the telling root files and
 * framework configs, and each workspace package's `package.json`. Unreadable
 * files are skipped; the total is capped.
 */
export async function gatherProjectFiles(
  fs: DetectFileSystem
): Promise<GatheredProject> {
  const root = await fs.readDir("/")
  const names = Object.keys(root).sort()
  const listing = names.map((name) =>
    root[name] === "directory" ? `${name}/` : name
  )

  const wanted = names.filter(
    (name) =>
      root[name] === "file" &&
      !LOCKFILES.includes(name) &&
      (ROOT_FILES.includes(name) ||
        CONFIG_PREFIXES.some((prefix) => name.startsWith(prefix)))
  )
  // Keep ROOT_FILES' priority order, configs after.
  wanted.sort((a, b) => rank(a) - rank(b))

  for (const dir of WORKSPACE_DIRS) {
    if (root[dir] !== "directory") continue
    const children = await fs.readDir(`/${dir}`)
    for (const child of Object.keys(children).sort()) {
      if (children[child] !== "directory") continue
      const manifest = `${dir}/${child}/package.json`
      if (await fs.fileExists(`/${manifest}`)) wanted.push(manifest)
    }
  }

  const files: Record<string, string> = {}
  let total = 0
  let packages = 0
  for (const path of wanted) {
    const isWorkspacePackage = path.includes("/")
    if (isWorkspacePackage && ++packages > MAX_WORKSPACE_PACKAGES) continue
    let contents: string
    try {
      contents = await fs.readFile(`/${path}`)
    } catch {
      continue
    }
    const clipped = contents.slice(0, MAX_FILE_CHARS)
    if (total + clipped.length > MAX_TOTAL_CHARS) break
    files[path] = clipped
    total += clipped.length
  }

  return { listing, files }
}

function rank(name: string): number {
  const index = ROOT_FILES.indexOf(name)
  return index === -1 ? ROOT_FILES.length : index
}

export const DETECTION_SYSTEM_PROMPT = `You work out how to run a web project's dev server so it can be previewed in a browser. You are given the project's root listing, some of its files, and a rule-based first guess.

Reply with only a JSON object, no prose and no code fence:
{"setupScript": string, "devScript": string, "devServerPort": number}

- setupScript: the shell command run once from the repository root after cloning, usually the package manager's install (e.g. "pnpm install"). Add a one-time step such as code generation only when the project's docs say it is required before the dev server can start. Use "" when nothing is needed.
- devScript: the long-running command, run from the repository root, that starts the dev server for the project's main web app. Prefer the project's own script (e.g. "pnpm dev") over calling a framework binary directly. In a monorepo, target the user-facing web app (e.g. "pnpm --filter web dev").
- devServerPort: the port that dev server listens on. Read it from the dev script's flags, framework config, or README before falling back to the framework's default.

Keep the first guess for any field the files give you no reason to change. Never invent secrets or environment values.`

/** The user turn: the listing, the files, and the rule-based guess. */
export function buildDetectionPrompt(
  project: GatheredProject,
  baseline: DetectedSettings
): string {
  const files = Object.entries(project.files)
    .map(([path, contents]) => `<file path="${path}">\n${contents}\n</file>`)
    .join("\n\n")
  const lockfiles = project.listing.filter((name) => LOCKFILES.includes(name))
  return [
    `<listing>\n${project.listing.join("\n")}\n</listing>`,
    lockfiles.length ? `Lockfiles present: ${lockfiles.join(", ")}` : "",
    files,
    `<first_guess>\n${JSON.stringify(baseline)}\n</first_guess>`,
  ]
    .filter(Boolean)
    .join("\n\n")
}

/**
 * Read the model's answer. The first JSON object in the text is taken (a model
 * that fences it anyway still parses); each field is validated on its own and
 * falls back to `baseline` when missing or malformed. `null` when there's no
 * usable object at all.
 */
export function parseDetectionReply(
  text: string | null,
  baseline: DetectedSettings
): DetectedSettings | null {
  if (!text) return null
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return null
  let raw: unknown
  try {
    raw = JSON.parse(match[0])
  } catch {
    return null
  }
  if (!raw || typeof raw !== "object") return null
  const reply = raw as Record<string, unknown>

  return {
    setupScript: command(reply.setupScript) ?? baseline.setupScript,
    devScript:
      command(reply.devScript, { allowEmpty: false }) ?? baseline.devScript,
    devServerPort: port(reply.devServerPort) ?? baseline.devServerPort,
  }
}

/** A single-line shell command of sane length, trimmed; `undefined` otherwise. */
function command(
  value: unknown,
  { allowEmpty = true }: { allowEmpty?: boolean } = {}
): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  if (!trimmed && !allowEmpty) return undefined
  if (trimmed.includes("\n") || trimmed.length > 300) return undefined
  return trimmed
}

function port(value: unknown): number | undefined {
  if (typeof value === "string") return parseDevServerPort(value)
  if (typeof value !== "number" || !Number.isInteger(value)) return undefined
  return parseDevServerPort(String(value))
}

/**
 * The whole pass: gather, ask, parse. `null` when the model couldn't be
 * reached or gave nothing usable, so the caller keeps the deterministic result.
 */
export async function detectSettingsWithModel(
  fs: DetectFileSystem,
  baseline: DetectedSettings,
  runModel: (opts: { system: string; prompt: string }) => Promise<string | null>
): Promise<DetectedSettings | null> {
  const project = await gatherProjectFiles(fs)
  if (!project.listing.length) return null
  const reply = await runModel({
    system: DETECTION_SYSTEM_PROMPT,
    prompt: buildDetectionPrompt(project, baseline),
  })
  return parseDetectionReply(reply, baseline)
}
