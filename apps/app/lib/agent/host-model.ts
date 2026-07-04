import "server-only"

import {
  filterByCapability,
  harnessAvailability,
  type HarnessResolver,
} from "./harnesses/availability"
import { defaultHarnessProcessRunner } from "./harnesses/process-runner"
import type { HarnessProcessRunner } from "./harnesses/types"

/**
 * `runHostModel` — the reusable **desktop model-call seam** (#674). It runs a
 * one-shot prompt through the user's already-installed, already-authenticated
 * harness CLI in non-interactive print mode (`claude -p "<prompt>"`), so the
 * desktop build can reach a model with no hosted API key, on the user's own
 * subscription. It is the first place in the codebase that performs model
 * inference via a spawned host CLI; naming is its first consumer, but it's a
 * general primitive any future one-shot desktop model call can reach through.
 *
 * The resolver, process runner, and timeout are all injected (defaulting to the
 * production seams) so the whole thing is unit-testable with fakes — no real
 * subprocess. Server-only: it shells the host CLI.
 */

/**
 * Hard ceiling on the host-CLI call. A hung harness must never stall Workspace
 * creation, so the timeout collapses (like every other uncertainty) to `null`
 * and the caller falls back to the deterministic slug.
 */
export const DEFAULT_HOST_MODEL_TIMEOUT_MS = 20_000

/** Sentinel: the CLI call didn't produce a usable result (timeout or rejection). */
const NO_RESULT = Symbol("host-model-no-result")

/**
 * Race a runner call against a timeout. The timer winning, or the runner
 * rejecting (a spawn failure — the binary isn't there), both resolve to
 * {@link NO_RESULT}; only a clean resolution passes the value through. Never
 * rejects, so `runHostModel`'s single `null` contract holds.
 */
function raceRunner(
  call: Promise<{ exitCode: number; stdout: string }>,
  timeoutMs: number
): Promise<{ exitCode: number; stdout: string } | typeof NO_RESULT> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(NO_RESULT), timeoutMs)
    call.then(
      (result) => {
        clearTimeout(timer)
        resolve(result)
      },
      () => {
        clearTimeout(timer)
        resolve(NO_RESULT)
      }
    )
  })
}

/**
 * Run `prompt` through the first detected chat-capable harness's print mode and
 * return the model's text, or `null` on any failure.
 *
 * Resolution mirrors the model dropdown's desktop default (the first
 * chat-capable harness from the Harness Availability seam,
 * {@link harnessDefaultModelId}). Best-effort by contract: **every** uncertainty
 * — no chat-capable harness, a harness without a `printModel`, a spawn failure,
 * a non-zero exit, a timeout, or empty/unparseable output — collapses to
 * `null`, so a caller can treat a `null` as "no model available" and fall back
 * without a `try/catch`. Bounded by {@link DEFAULT_HOST_MODEL_TIMEOUT_MS} unless
 * overridden.
 */
export async function runHostModel(
  prompt: string,
  opts: {
    resolver?: HarnessResolver
    run?: HarnessProcessRunner
    timeoutMs?: number
  } = {}
): Promise<string | null> {
  const resolver = opts.resolver ?? harnessAvailability
  const run = opts.run ?? defaultHarnessProcessRunner
  const timeoutMs = opts.timeoutMs ?? DEFAULT_HOST_MODEL_TIMEOUT_MS

  try {
    const available = await resolver.list()
    const [first] = filterByCapability(available, "chat")
    if (!first) return null

    const printModel = first.harness.printModel
    if (!printModel) return null

    const [cmd, ...args] = printModel.buildArgv(prompt)
    if (!cmd) return null

    const result = await raceRunner(run(cmd, args), timeoutMs)
    if (result === NO_RESULT) return null
    if (result.exitCode !== 0) return null

    return printModel.parseOutput(result.stdout)
  } catch {
    // A resolver / builder throwing is itself an uncertainty — degrade to null.
    return null
  }
}
