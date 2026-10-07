import "server-only"

import { backendSwitch } from "@/lib/capabilities"

import { claudeCodeHarness } from "./claude-code"
import { codexHarness } from "./codex"
import { isValidHarnessKey } from "./model-id"
import { opencodeHostHarness } from "./opencode"
import type { CodingCli } from "./coding-cli-types"
import type { HostHarness } from "./types"

export type {
  CodingCli,
  CodingCliAcp,
  CodingCliSignIn,
} from "./coding-cli-types"

/** A {@link CodingCli} as the host catalog holds it. */
export function codingCliHarness(cli: CodingCli): HostHarness {
  return {
    key: cli.key,
    label: cli.label,
    launchCommand: cli.command,
    launchArgv: [cli.command],
    hostBinary: cli.command,
    acpAdapter: {
      command: cli.command,
      args: cli.acp.args,
      modelOption: cli.acp.modelOption,
      promptQueueing: cli.acp.promptQueueing,
      ...(cli.acp.plan && { plan: cli.acp.plan }),
      ...(cli.acp.mcpToolName && { mcpToolName: cli.acp.mcpToolName }),
    },
    ...(cli.signIn && {
      authCommand: cli.signIn.command,
      ...(cli.signIn.probe && { probeAuth: cli.signIn.probe }),
    }),
    ...(cli.modelList && { modelList: cli.modelList }),
  }
}

/** The built-ins `CODING_CLIS` can name, by id. */
const CODING_CLI_BUILT_INS: Record<string, () => HostHarness> = {
  "claude-code": () => claudeCodeHarness,
  codex: () => codexHarness,
  opencode: () => opencodeHostHarness(),
}

/**
 * Pick the Coding CLIs this host offers, in the order the model menu lists
 * them: `CODING_CLIS` (comma-separated built-in ids) when set, else `null`,
 * which keeps the whole catalog (`hostCatalog`), every profile's default. A
 * fork that runs its own CLI ({@link codingCliHarness}) or OpenCode under
 * another command ({@link opencodeHostHarness}'s options) changes this
 * function. Throws on an id it doesn't know or a key named twice.
 */
export function selectCodingClis(
  env: Record<string, string | undefined> = process.env
): HostHarness[] | null {
  const ids = backendSwitch("CODING_CLIS", env)
    ?.split(",")
    .map((id) => id.trim())
    .filter(Boolean)
  if (!ids?.length) return null
  return checkKeys(
    ids.map((id) => {
      const builtIn = Object.hasOwn(CODING_CLI_BUILT_INS, id)
        ? CODING_CLI_BUILT_INS[id]
        : undefined
      if (!builtIn) {
        throw new Error(
          `CODING_CLIS "${id}" isn’t known (known: ${Object.keys(CODING_CLI_BUILT_INS).join(", ")})`
        )
      }
      return builtIn()
    })
  )
}

/**
 * Refuse a key the model-id codec can't carry, or one named twice, so a bad
 * pick fails loudly rather than half-working.
 */
export function checkKeys(harnesses: HostHarness[]): HostHarness[] {
  const seen = new Set<string>()
  for (const { key } of harnesses) {
    if (!isValidHarnessKey(key)) {
      throw new Error(
        `Coding CLI key "${key}" must be non-empty and contain no comma or colon.`
      )
    }
    if (seen.has(key)) {
      throw new Error(`Coding CLI key "${key}" is used more than once.`)
    }
    seen.add(key)
  }
  return harnesses
}
