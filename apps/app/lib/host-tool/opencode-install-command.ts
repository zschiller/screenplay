/**
 * The inline-terminal commands that install the opencode CLI and run its
 * sign-in, for the desktop "Coding agents" setup surface (ADR 0015). Pure — they
 * only build the shell command / argv from host facts, so the mapping is
 * unit-testable without a process, and the host-session terminal runs them
 * verbatim. The sibling of `claude-code-install-command.ts`; the descriptor
 * (`opencode.ts`) points its `buildInstallCommand` / `authCommand` here so the
 * catalog stays "drop a descriptor in the array".
 */

import type { HostFacts } from "@/lib/agent/harnesses/types"
import { chainInstallThenAuth } from "@/lib/host-tool/install-and-auth"

/** The npm package the `npm install -g` path installs (the `opencode` binary). */
export const OPENCODE_INSTALL_PACKAGE = "opencode-ai"

/**
 * opencode's official no-`npm` installer. Piped to `bash`, it lands an `opencode`
 * binary in the install dir — no `sudo` — the same deterministic-path move
 * claude-code's and `gh`'s binary fallbacks use.
 */
export const OPENCODE_INSTALL_SCRIPT_URL = "https://opencode.ai/install"

/**
 * The install dir we hand opencode's installer via `OPENCODE_INSTALL_DIR` (its
 * highest-priority path override, ahead of its own `~/.opencode/bin` default) so
 * the binary lands in `~/.local/bin` — already on the sidecar's augmented `PATH`
 * (`desktop/src-tauri/src/sidecar.rs`), so it resolves in this same session and
 * every later one. `$HOME` is expanded by the shell running the command, so the
 * builder needs no home-dir lookup of its own.
 */
export const OPENCODE_INSTALL_DIR = "$HOME/.local/bin"

/**
 * The pure mapping from host facts → the install command run in the inline setup
 * terminal:
 *
 * - **`npm` present** → `npm install -g opencode-ai`, the global install that
 *   exposes `opencode` on `PATH` (the fallback path).
 * - **No `npm`** → opencode's own `curl … | bash` installer, so a host with no
 *   `node`/`npm` never dead-ends (ADR 0015: the vendor installer is the npm-free
 *   preference). `OPENCODE_INSTALL_DIR` pins the binary to `~/.local/bin`, no
 *   `sudo`.
 *
 * Only `npmPresent` is consulted today; the wider {@link HostFacts} is taken so
 * the signature matches the descriptor's `buildInstallCommand` and a later
 * arch-specific path can read `arch` without a shape change.
 */
export function buildOpencodeInstallCommand(facts: HostFacts): string {
  if (facts.npmPresent) return `npm install -g ${OPENCODE_INSTALL_PACKAGE}`
  return `OPENCODE_INSTALL_DIR="${OPENCODE_INSTALL_DIR}" curl -fsSL ${OPENCODE_INSTALL_SCRIPT_URL} | bash`
}

/**
 * opencode's own interactive login, run verbatim in the setup terminal's PTY.
 * `opencode auth login` runs the CLI's provider sign-in (a browser/OAuth or
 * device flow shown in the terminal) and exits when it resolves — the PTY exit is
 * the setup step's completion signal to re-detect. The credential it writes under
 * the opencode data dir is exactly what {@link
 * import("@/lib/agent/harnesses/opencode").probeOpencodeAuth} reads back.
 */
export function buildOpencodeAuthArgv(): string[] {
  return ["opencode", "auth", "login"]
}

/**
 * The argv for the not-installed state's one button: install opencode, then — in
 * the **same** visible terminal session — chain straight into its sign-in, so the
 * user connects in a single action. Chained with `&&` (exactly like
 * `buildClaudeCodeInstallAndAuthArgv`), so a failed install stops before sign-in
 * and its error stays visible (the row then re-detects back to "Not installed").
 * On success the PTY exit re-detects to Connected.
 */
export function buildOpencodeInstallAndAuthArgv(facts: HostFacts): string[] {
  return chainInstallThenAuth(
    buildOpencodeInstallCommand(facts),
    buildOpencodeAuthArgv()
  )
}
