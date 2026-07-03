/**
 * The inline-terminal commands that install the Claude Code CLI and run its
 * sign-in, for the desktop "Coding agents" setup surface (ADR 0015). Pure — they
 * only build the shell command / argv from host facts, so the mapping is
 * unit-testable without a process, and the host-session terminal runs them
 * verbatim. The sibling of `gh-install-command.ts`; the descriptor
 * (`claude-code.ts`) points its `buildInstallCommand` / `authCommand` here so
 * the catalog stays "drop a descriptor in the array".
 */

import type { HostFacts } from "@/lib/agent/harnesses/types"
import { chainInstallThenAuth } from "@/lib/host-tool/install-and-auth"

/** The npm package the `npm install -g` path installs (the `claude` binary). */
export const CLAUDE_CODE_INSTALL_PACKAGE = "@anthropic-ai/claude-code"

/**
 * Claude Code's official no-`npm` installer. Landing a `claude` binary in
 * `~/.local/bin` — already on the sidecar's augmented `PATH`
 * (`desktop/src-tauri/src/sidecar.rs`), so it resolves in this same session and
 * every later one — with no `sudo`, the same deterministic-path move the `gh`
 * binary fallback uses.
 */
export const CLAUDE_CODE_INSTALL_SCRIPT_URL = "https://claude.ai/install.sh"

/**
 * The pure mapping from host facts → the install command run in the inline setup
 * terminal:
 *
 * - **`npm` present** → `npm install -g @anthropic-ai/claude-code`, the global
 *   install that exposes `claude` on `PATH`.
 * - **No `npm`** → Claude Code's own `curl … | bash` installer, so a host with
 *   no `node`/`npm` never dead-ends (ADR 0015: the vendor installer is the
 *   npm-free path). It drops the binary in `~/.local/bin`, no `sudo`.
 *
 * Only `npmPresent` is consulted today; the wider {@link HostFacts} is taken so
 * the signature matches the descriptor's `buildInstallCommand` and a later
 * arch-specific path can read `arch` without a shape change.
 */
export function buildClaudeCodeInstallCommand(facts: HostFacts): string {
  if (facts.npmPresent) return `npm install -g ${CLAUDE_CODE_INSTALL_PACKAGE}`
  return `curl -fsSL ${CLAUDE_CODE_INSTALL_SCRIPT_URL} | bash`
}

/**
 * Claude Code's own interactive login, run verbatim in the setup terminal's PTY.
 * `claude /login` runs the CLI's browser sign-in and exits when it resolves —
 * the PTY exit is the setup step's completion signal to re-detect. The stored
 * credential it writes is exactly what {@link
 * import("@/lib/agent/harnesses/claude-code").probeClaudeCodeAuth} reads back.
 */
export function buildClaudeCodeAuthArgv(): string[] {
  return ["claude", "/login"]
}

/**
 * The argv for the not-installed state's one button: install Claude Code, then —
 * in the **same** visible terminal session — chain straight into its sign-in, so
 * the user connects in a single action. Chained with `&&` (exactly like
 * `buildGhInstallAndAuthArgv`), so a failed install stops before sign-in and its
 * error stays visible (the row then re-detects back to "Not installed"). On
 * success the PTY exit re-detects to Connected.
 */
export function buildClaudeCodeInstallAndAuthArgv(facts: HostFacts): string[] {
  return chainInstallThenAuth(
    buildClaudeCodeInstallCommand(facts),
    buildClaudeCodeAuthArgv()
  )
}
