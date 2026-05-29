import "server-only"

import { redactSensitiveInfo } from "@/lib/agent/redact"
import { sandboxProvider } from "@/lib/sandbox"
import type { SandboxCommandResult, SandboxInstance } from "@/lib/sandbox/types"

/**
 * The single result contract every sandbox **command** action returns. The
 * error crosses the server-action boundary as a value (Next redacts thrown
 * errors in prod), so `error` is the only thing a failed action can surface to
 * the caller. `success` is the discriminant.
 */
export type SandboxActionResult<T = void> =
  | { success: true; value: T }
  | { success: false; error: string }

// Cap how much stderr rides along in an error. Long enough to be diagnostic,
// short enough not to flood the chat UI or a Liveblocks broadcast.
const MAX_STDERR_LENGTH = 2000

/**
 * Thrown by {@link step} when a command exits non-zero. Carries the command,
 * exit code, and stderr so {@link runSandboxAction} can surface a meaningful
 * failure. The `stderr` it holds is already safe to surface.
 */
export class SandboxStepError extends Error {
  constructor(
    readonly cmd: string,
    readonly exitCode: number,
    readonly stderr: string,
  ) {
    super(`Command \`${cmd}\` failed (exit ${exitCode}): ${stderr}`)
    this.name = "SandboxStepError"
  }
}

/**
 * Runs a single command in the sandbox, returning its result on success. Lets
 * actions read a step like a linear script: the non-zero-exit branch throws
 * rather than returning, so the body never hand-rolls per-step error handling.
 */
export async function step(
  sandbox: SandboxInstance,
  cmd: string,
  args: string[] = [],
): Promise<SandboxCommandResult> {
  const result = await sandbox.runCommand(cmd, args)
  if (result.exitCode !== 0) {
    // Redact before truncating: slicing first could split a token across the
    // cut and leave a fragment the patterns no longer match.
    const stderr = redactSensitiveInfo(await result.stderr()).slice(0, MAX_STDERR_LENGTH)
    throw new SandboxStepError(cmd, result.exitCode, stderr)
  }
  return result
}

/**
 * Resolves the named sandbox and runs `fn` against it, collapsing the outcome
 * into a {@link SandboxActionResult}. Any throw — from resolving the instance
 * or from the body — becomes `{success:false}`.
 */
export async function runSandboxAction<T>(
  name: string,
  fn: (sandbox: SandboxInstance) => Promise<T>,
): Promise<SandboxActionResult<T>> {
  try {
    const sandbox = await sandboxProvider.get({ name })
    const value = await fn(sandbox)
    return { success: true, value }
  } catch (error) {
    // Redact at the boundary: this is the last point before the failure leaves
    // the trusted layer, so a token spilled by any step is scrubbed regardless
    // of where in the body it originated.
    const message = error instanceof Error ? error.message : String(error)
    return { success: false, error: redactSensitiveInfo(message) }
  }
}
