import "server-only"

import { execFile } from "node:child_process"
import { promisify } from "node:util"

import type { HarnessProcessRunner } from "./types"

const execFileAsync = promisify(execFile)

/**
 * The production {@link HarnessProcessRunner} a harness's `probeAuth` shells
 * through on the desktop host — the same shape (and the same ENOENT handling) as
 * the `gh` adapter's `defaultRunner`. A numeric exit code is a real status (the
 * process ran but failed); a string code (ENOENT) means the binary isn't there,
 * which is rethrown so the probe's own `catch` maps it to *not authed* like any
 * other spawn failure.
 */
export const defaultHarnessProcessRunner: HarnessProcessRunner = async (
  cmd,
  args
) => {
  try {
    const { stdout } = await execFileAsync(cmd, args, { timeout: 10_000 })
    return { exitCode: 0, stdout }
  } catch (err) {
    const e = err as { code?: number | string; stdout?: string }
    if (typeof e.code === "number") {
      return { exitCode: e.code, stdout: e.stdout ?? "" }
    }
    throw err
  }
}

/**
 * Run one credential probe through the injected runner, collapsing every
 * uncertainty to a boolean: a process that ran and satisfied `ok` → `true`;
 * anything else — a non-zero exit, output `ok` rejects, or a spawn failure (the
 * binary isn't there / the file is absent) — → `false`. This is the
 * honest-degradation rule shared by every harness's {@link
 * import("./types").Harness.probeAuth} (ADR 0015): a probe that can't confirm a
 * login reports *not authed*, so the worst case is offering a sign-in the user
 * didn't strictly need, never a false "connected".
 */
export async function probeOk(
  run: HarnessProcessRunner,
  cmd: string,
  args: string[],
  ok: (result: { exitCode: number; stdout: string }) => boolean
): Promise<boolean> {
  try {
    const result = await run(cmd, args)
    return result.exitCode === 0 && ok(result)
  } catch {
    return false
  }
}
