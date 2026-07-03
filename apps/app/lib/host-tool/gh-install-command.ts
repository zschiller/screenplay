/**
 * The inline-terminal command that installs the host `gh` CLI when it's absent,
 * and chains straight into the sign-in (ADR 0014, issue #649). Pure — it only
 * builds the shell command / argv, so the mapping from environment to command is
 * unit-testable without a process, and the host-session terminal runs it verbatim.
 *
 * macOS / Apple-Silicon only: the binary fallback targets `macOS_arm64`, so this
 * is not reached on other platforms (which the connection UI doesn't offer).
 */

import { buildGhAuthLoginArgv } from "@/lib/host-tool/gh-auth-command"

/**
 * Pinned `gh` version for the binary fallback — mirrors the ttyd/tmux
 * static-binary pins (`lib/sandbox/terminal.ts`). We own this version when we
 * install it; an old `gh` still runs `auth login` / `auth token` fine (ADR 0014),
 * so the stakes of a stale pin are low. A `brew` install ignores this entirely
 * and gets whatever `brew` resolves, upgradable in place.
 */
export const GH_INSTALL_VERSION = "2.96.0"

/**
 * The official GitHub CLI download for Apple-Silicon macOS. `gh` ships this
 * target as a `.zip` (there is no macOS tarball), whose single `gh` binary lives
 * at `gh_<ver>_macOS_arm64/bin/gh`.
 */
function ghDownloadUrl(version: string): string {
  return `https://github.com/cli/cli/releases/download/v${version}/gh_${version}_macOS_arm64.zip`
}

/**
 * The pure mapping from environment → install command run in the inline host
 * terminal:
 *
 * - **Homebrew present** → `brew install gh`, so the CLI is brew-managed and
 *   upgradable.
 * - **No Homebrew** → `curl` the official `macOS_arm64` build and drop `gh` into
 *   `~/.local/bin` — already on the sidecar's augmented `PATH`
 *   (`desktop/src-tauri/src/sidecar.rs`), so it resolves in this same session and
 *   every later one. No `sudo`: the install must never dead-end on a hidden admin
 *   prompt.
 *
 * The binary path is one `&&` chain into a scratch `mktemp` dir, so a failure at
 * any step (offline `curl`, a bad archive) stops the chain with its error still
 * on screen and never leaves a half-written binary.
 */
export function buildGhInstallCommand(brewPresent: boolean): string {
  if (brewPresent) return "brew install gh"
  const url = ghDownloadUrl(GH_INSTALL_VERSION)
  return (
    `mkdir -p "$HOME/.local/bin" && ` +
    `tmp="$(mktemp -d)" && ` +
    `curl -fsSL "${url}" -o "$tmp/gh.zip" && ` +
    `unzip -oq "$tmp/gh.zip" -d "$tmp" && ` +
    `cp "$tmp"/gh_*/bin/gh "$HOME/.local/bin/gh" && ` +
    `chmod +x "$HOME/.local/bin/gh" && ` +
    `rm -rf "$tmp"`
  )
}

/**
 * The argv for the not-installed state's one button: install `gh`, then — in the
 * **same** visible terminal session — chain straight into `gh auth login`, so the
 * user connects in a single action. Chained with `&&`, so a failed install stops
 * before auth and its error stays visible (the section then re-detects back to
 * "Not installed"). On success, the PTY exit re-detects to Connected.
 */
export function buildGhInstallAndAuthArgv(brewPresent: boolean): string[] {
  const install = buildGhInstallCommand(brewPresent)
  const auth = buildGhAuthLoginArgv().join(" ")
  return ["sh", "-c", `${install} && ${auth}`]
}
