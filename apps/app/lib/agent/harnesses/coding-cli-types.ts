import type {
  AcpAdapter,
  HarnessModelList,
  HarnessProcessRunner,
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
