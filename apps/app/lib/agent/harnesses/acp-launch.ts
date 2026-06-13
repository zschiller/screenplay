/**
 * The harness → ACP launch resolver (PRD #404, issue #414). The sibling of the
 * terminal's `resolveLaunchArgv`: where that maps a stored harness key to the
 * argv a *terminal tab* runs interactively, this maps a harness key to the argv
 * that spawns that harness's **ACP adapter** as a host subprocess over stdio —
 * the wire the production {@link import("../acp/spawn-session-factory").SpawnAcpSessionFactory}
 * speaks to. Both are key → argv lookups with graceful fall-through on an
 * unknown key, so a missing/typo'd harness degrades to "no ACP launch" rather
 * than a hard failure.
 *
 * The adapter argv now lives on the **one** Harness descriptor
 * (`Harness.acpAdapter`, read via {@link harnessAcpAdapter}) — there is no
 * separate adapter-key namespace: the same catalog key that names a terminal tab
 * (`claude-code`, `codex`) names its ACP adapter. The adapters and their spawn
 * quirks are the verified findings of spikes #405 / #408:
 *
 *  - `claude-code` → `npx -y @zed-industries/claude-code-acp` — rides the
 *    existing Claude Code login (no model key).
 *  - `codex`       → `npx -y @zed-industries/codex-acp` — rides `codex login` /
 *    `CODEX_API_KEY`.
 *  - A terminal-only harness (no `acpAdapter`, e.g. the opencode slots) and
 *    `gemini` (its native ACP support retired with no adapter successor, spike
 *    #405) both fall through like any unknown key.
 *
 * **Spawn-env quirk (load-bearing, spike #408).** The Claude adapter refuses to
 * launch inside an existing Claude Code session — it aborts with *"Claude Code
 * cannot be launched inside another Claude Code session"* when `CLAUDECODE` is
 * set. So the child env is the host env with `CLAUDECODE` and any nested
 * `CLAUDE_CODE_*` vars **stripped**; everything else passes through unchanged so
 * the adapter still finds the CLI's own login. The strip is applied for every
 * harness (it is inert for adapters that don't gate on it) so the resolver has
 * one env path, not a per-harness branch.
 */

import { harnessAcpAdapter } from "./index"

/** A resolved ACP spawn command: the argv, working directory, and child env. */
export interface AcpLaunch {
  /** Executable to spawn (e.g. `npx`). */
  command: string
  /** Arguments passed to {@link command}. */
  args: string[]
  /** Working directory for the child — the Branch's worktree root. */
  cwd: string
  /** The child process environment, with the Claude-Code session vars stripped. */
  env: Record<string, string>
}

/**
 * Build the child environment for an ACP adapter: a copy of `env` with every
 * `undefined` dropped and the Claude-Code session vars (`CLAUDECODE` and any
 * `CLAUDE_CODE_*`) removed, so the Claude adapter doesn't refuse to launch
 * "inside another Claude Code session" (spike #408). Pure — never mutates the
 * input.
 */
export function acpChildEnv(
  env: Record<string, string | undefined>
): Record<string, string> {
  const child: Record<string, string> = {}
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) continue
    if (name === "CLAUDECODE" || name.startsWith("CLAUDE_CODE_")) continue
    child[name] = value
  }
  return child
}

/**
 * Resolve a harness key → the ACP spawn command for its adapter, or `null` when
 * the key names no known adapter (unknown, dropped like `gemini`, or a
 * terminal-only harness whose descriptor carries no `acpAdapter`). The caller
 * falls back — to the in-process Engine or a clear error — rather than spawning
 * a guessed binary, exactly as the terminal resolver returns a plain shell on an
 * unknown key.
 *
 * `cwd` is the Branch's worktree root; `env` defaults to the host
 * `process.env`. The returned `env` is the host env with the Claude-Code
 * session vars stripped (see {@link acpChildEnv}).
 */
export function resolveAcpLaunch(
  harnessKey: string | null | undefined,
  opts: { cwd: string; env?: Record<string, string | undefined> }
): AcpLaunch | null {
  const adapter = harnessAcpAdapter(harnessKey)
  if (!adapter) return null
  return {
    command: adapter.command,
    args: [...adapter.args],
    cwd: opts.cwd,
    env: acpChildEnv(opts.env ?? process.env),
  }
}
