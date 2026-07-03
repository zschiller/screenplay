/**
 * The inline-terminal commands that install the Codex CLI and run its sign-in,
 * for the desktop "Coding agents" setup surface (ADR 0015). Pure — they only
 * build the shell command / argv from host facts, so the mapping is
 * unit-testable without a process, and the host-session terminal runs them
 * verbatim. The sibling of `claude-code-install-command.ts`; the descriptor
 * (`codex.ts`) points its `buildInstallCommand` / `authCommand` here so the
 * catalog stays "drop a descriptor in the array".
 *
 * Codex is the harness that exercises the full install-branch variety — the
 * reason {@link import("@/lib/agent/harnesses/types").HostFacts} carries
 * `brewPresent` and `arch` on top of `npmPresent`.
 */

import type { HostFacts } from "@/lib/agent/harnesses/types"
import { chainInstallThenAuth } from "@/lib/host-tool/install-and-auth"

/** The npm package the `npm install -g` path installs (the `codex` binary). */
export const CODEX_INSTALL_PACKAGE = "@openai/codex"

/**
 * Codex's GitHub release-download base — the `latest` channel, so the installer
 * tracks the newest release without pinning a dated tag.
 */
export const CODEX_RELEASE_BASE_URL =
  "https://github.com/openai/codex/releases/latest/download"

/**
 * The macOS release-asset target triple for a host `arch`. Codex ships one
 * self-contained binary per target; the primary desktop target is Apple-silicon
 * (`arm64` → `aarch64-apple-darwin`), with the Intel target for an `x64` host.
 * Anything else falls back to the arm64 asset — the surface is macOS-only, and
 * the arm64 build is the one the acceptance path exercises.
 */
function codexReleaseTarget(arch: string): string {
  return arch === "x64" ? "x86_64-apple-darwin" : "aarch64-apple-darwin"
}

/**
 * Codex's official no-`npm` install: download the macOS release binary and land
 * a `codex` executable in `~/.local/bin` — already on the sidecar's augmented
 * `PATH` (`desktop/src-tauri/src/sidecar.rs`), so it resolves in this same
 * session and every later one — with no `sudo`, the same deterministic-path move
 * Claude Code's and the `gh` binary fallbacks use. The release tarball holds a
 * single target-named binary, so it's renamed to the plain `codex` the launch
 * command runs.
 */
function buildCodexBinaryInstall(arch: string): string {
  const target = codexReleaseTarget(arch)
  const asset = `codex-${target}.tar.gz`
  const bin = `"$HOME/.local/bin"`
  return (
    `mkdir -p ${bin} && ` +
    `curl -fsSL ${CODEX_RELEASE_BASE_URL}/${asset} | tar xz -C ${bin} && ` +
    `mv ${bin}/codex-${target} ${bin}/codex && ` +
    `chmod +x ${bin}/codex`
  )
}

/**
 * The pure mapping from host facts → the install command run in the inline setup
 * terminal. Codex offers every branch, checked in host-fit order so a host never
 * dead-ends and no path needs `sudo`:
 *
 * - **Homebrew present** → `brew install codex`, the native macOS package path.
 * - **No `brew`, `npm` present** → `npm i -g @openai/codex`, the global install
 *   that exposes `codex` on `PATH`.
 * - **Neither** → Codex's own macOS release binary into `~/.local/bin` (ADR
 *   0015: the vendor's npm-free path), so a host with no `brew`/`npm` still
 *   installs, no `sudo`.
 */
export function buildCodexInstallCommand(facts: HostFacts): string {
  if (facts.brewPresent) return "brew install codex"
  if (facts.npmPresent) return `npm i -g ${CODEX_INSTALL_PACKAGE}`
  return buildCodexBinaryInstall(facts.arch)
}

/**
 * Codex's own interactive login, run verbatim in the setup terminal's PTY.
 * `codex login` runs the CLI's browser/device sign-in and exits when it resolves
 * — the PTY exit is the setup step's completion signal to re-detect. The stored
 * credential it writes (`~/.codex/auth.json`) is exactly what {@link
 * import("@/lib/agent/harnesses/codex").probeCodexAuth} reads back.
 */
export function buildCodexAuthArgv(): string[] {
  return ["codex", "login"]
}

/**
 * The argv for the not-installed state's one button: install Codex, then — in
 * the **same** visible terminal session — chain straight into `codex login`, so
 * the user connects in a single action. Chained with `&&` (exactly like the
 * Claude Code / `gh` equivalents), so a failed install stops before sign-in and
 * its error stays visible (the row then re-detects back to "Not installed"). On
 * success the PTY exit re-detects to Connected.
 */
export function buildCodexInstallAndAuthArgv(facts: HostFacts): string[] {
  return chainInstallThenAuth(
    buildCodexInstallCommand(facts),
    buildCodexAuthArgv()
  )
}
