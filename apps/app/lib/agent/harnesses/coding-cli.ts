import "server-only"

import { z } from "zod"

import { defineImplementation } from "@/lib/extensions/types"

import { claudeCodeHarness } from "./claude-code"
import { codexHarness } from "./codex"
import { setHostHarnesses } from "./index"
import { opencodeHostHarness, type OpencodeOptions } from "./opencode"
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

/** One config entry: which implementation to use, and its options. */
export interface CodingCliChoice {
  use: string
  [option: string]: unknown
}

/** An implementation by id: its options in, the host’s CLI out. */
export type CodingCliImplementation = (
  options: Record<string, unknown>
) => HostHarness

/**
 * The built-in implementations. Claude Code and Codex take no options; the
 * OpenCode one takes `key`, `label`, `command` and `listModels`, so an
 * internal fork under another command is configuration, not code.
 */
export const CODING_CLI_BUILT_INS: Record<string, CodingCliImplementation> = {
  "claude-code": () => claudeCodeHarness,
  codex: () => codexHarness,
  opencode: (options) => opencodeHostHarness(opencodeOptions(options)),
}

/** The OpenCode built-in’s options, checked, with a clear error when wrong. */
function opencodeOptions(options: Record<string, unknown>): OpencodeOptions {
  const out: OpencodeOptions = {}
  for (const name of ["key", "label", "command"] as const) {
    const value = options[name]
    if (value === undefined) continue
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(
        `Coding CLI "opencode": "${name}" must be a non-empty string.`
      )
    }
    out[name] = value
  }
  if (options.listModels !== undefined) {
    if (typeof options.listModels !== "boolean") {
      throw new Error(
        `Coding CLI "opencode": "listModels" must be true or false.`
      )
    }
    out.listModels = options.listModels
  }
  return out
}

/**
 * Resolve config entries to the host’s CLIs, against `implementations` (the
 * built-ins, plus any extensions). Throws on an id nothing implements.
 */
export function resolveCodingClis(
  choices: CodingCliChoice[],
  implementations: Record<
    string,
    CodingCliImplementation
  > = CODING_CLI_BUILT_INS
): HostHarness[] {
  return choices.map(({ use, ...options }) => {
    const implementation = Object.hasOwn(implementations, use)
      ? implementations[use]
      : undefined
    if (!implementation) {
      throw new Error(
        `Coding CLI "${use}" isn’t a built-in or an extension. Use one of: ${Object.keys(implementations).join(", ")}.`
      )
    }
    return implementation(options)
  })
}

/**
 * Make the host offer exactly the CLIs `choices` pick, in that order. Called
 * once at start with the Headless config’s entries.
 */
export function configureCodingClis(
  choices: CodingCliChoice[],
  implementations?: Record<string, CodingCliImplementation>
): void {
  setHostHarnesses(resolveCodingClis(choices, implementations))
}

/**
 * The built-ins' full host descriptors, by the {@link CodingCli} each returns.
 * A built-in carries more than the interface does (its curated models, how it
 * installs, its own Skills), so the host keeps the whole descriptor rather
 * than rebuilding a thinner one from the interface.
 */
const builtInHarnesses = new WeakMap<CodingCli, HostHarness>()

function asCodingCli(harness: HostHarness): CodingCli {
  const adapter = harness.acpAdapter
  if (!adapter) {
    throw new Error(`Coding CLI "${harness.key}" can’t back chat (no ACP).`)
  }
  const cli: CodingCli = {
    key: harness.key,
    label: harness.hostLabel ?? harness.label,
    command: harness.launchCommand,
    acp: {
      args: adapter.args,
      modelOption: adapter.modelOption,
      promptQueueing: adapter.promptQueueing,
      ...(adapter.plan && { plan: adapter.plan }),
      ...(adapter.mcpToolName && { mcpToolName: adapter.mcpToolName }),
    },
    ...(harness.authCommand && {
      signIn: { command: harness.authCommand, probe: harness.probeAuth },
    }),
    ...(harness.modelList && { modelList: harness.modelList }),
  }
  builtInHarnesses.set(cli, harness)
  return cli
}

/** The host descriptor for a configured CLI: a built-in's own, else built from the interface. */
export function hostHarnessOf(cli: CodingCli): HostHarness {
  return builtInHarnesses.get(cli) ?? codingCliHarness(cli)
}

/**
 * The built-ins as the config file's `codingCli` list names them
 * (`lib/extensions/interfaces.ts`). The schemas let the server check the file
 * before it starts.
 */
export const codingCliBuiltIns = {
  "claude-code": defineImplementation({
    options: z.object({}),
    create: () => asCodingCli(CODING_CLI_BUILT_INS["claude-code"]!({})),
  }),
  codex: defineImplementation({
    options: z.object({}),
    create: () => asCodingCli(CODING_CLI_BUILT_INS.codex!({})),
  }),
  opencode: defineImplementation({
    options: z.object({
      key: z.string().min(1).optional(),
      label: z.string().min(1).optional(),
      command: z.string().min(1).optional(),
      listModels: z.boolean().optional(),
    }),
    create: (options) => asCodingCli(CODING_CLI_BUILT_INS.opencode!(options)),
  }),
}
