import "server-only"

import { claudeCodeHarness } from "./claude-code"
import { codexHarness } from "./codex"
import { setHostHarnesses } from "./index"
import { opencodeHostHarness, type OpencodeOptions } from "./opencode"
import type {
  AcpAdapter,
  HarnessModelList,
  HarnessProcessRunner,
  HostHarness,
} from "./types"

/**
 * The **Coding CLI** interface (spec #1923, #1926): a coding CLI that runs on
 * the host, on its own sign-in, and speaks ACP. It’s one of the four places a
 * company’s setup can differ, so it’s public: an extension implements it, and
 * every member is a compatibility promise, so it stays small. How the hosted
 * sandbox installs a CLI and brokers its key stays internal (`./types`'
 * `Harness`).
 */
export interface CodingCli {
  /**
   * The stable key chats and settings store it under. Non-empty, with no comma
   * or colon. Renaming it orphans the chats on it.
   */
  key: string
  /** The name the model menu and Settings show. */
  label: string
  /**
   * The command on the host’s `PATH`. Its presence lists the CLI; a terminal
   * runs it bare, and chat runs it with {@link CodingCliAcp.args}.
   */
  command: string
  /** How chat drives it over ACP. */
  acp: CodingCliAcp
  /** How Settings signs in to it, when it has a sign-in. */
  signIn?: CodingCliSignIn
  /**
   * How it lists the models it can run, for Choose models in Settings. Absent
   * ⇒ the model menu shows one default model and the CLI picks it.
   */
  modelList?: HarnessModelList
}

/**
 * The ACP launch details: the argv after the command and what the session
 * needs to know about the agent, which ACP has no way to advertise.
 */
export type CodingCliAcp = Pick<
  AcpAdapter,
  "args" | "modelOption" | "promptQueueing" | "plan" | "mcpToolName"
>

/** A CLI’s own sign-in, run in a terminal in Settings. */
export interface CodingCliSignIn {
  /** The argv that signs in, run in a visible terminal. */
  command: string[]
  /**
   * Whether it’s signed in, through the runner given. Absent ⇒ Settings can’t
   * tell, and still lists the CLI.
   */
  probe?(run: HarnessProcessRunner): Promise<boolean>
}

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
