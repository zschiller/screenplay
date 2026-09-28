import "server-only"

import { generateText } from "ai"

import { isLocalSandboxBackend } from "@/lib/sandbox/backend"
import { runHostModel } from "./host-model"
import { DEFAULT_MODEL, resolveLanguageModel } from "./providers"

/**
 * The one-shot model transport, shared by the naming paths (the v2 naming
 * module and the batch names endpoint) and model-assisted settings detection
 * on Add project. It hides the per-backend difference behind one call so each
 * caller stays "try model → parse → fall back" (#674):
 *
 *  - **hosted** shells the configured API-key provider through the AI SDK,
 *    exactly as before — unchanged and non-regressive;
 *  - **desktop** has no hosted key, so it reaches the user's own installed,
 *    signed-in harness CLI via {@link runHostModel} (`claude -p`), folding the
 *    system guidance into the single print-mode prompt.
 *
 * Returns the model's raw text, or `null` when there's no model to reach / the
 * call fails — so the caller falls back to its deterministic result. Never
 * throws: a model call must never block Workspace creation or an add.
 *
 * `isDesktop` and `hostModel` are injected (defaulting to the production seams)
 * so the desktop routing is unit-testable without a real subprocess or env.
 */
export async function runOneShotModel(opts: {
  system: string
  prompt: string
  /** Provider:model id for the hosted call. Defaults to `DEFAULT_MODEL`. */
  model?: string
  /** Give up after this long. Defaults: none hosted, the host CLI's own cap on desktop. */
  timeoutMs?: number
  isDesktop?: boolean
  hostModel?: (prompt: string) => Promise<string | null>
}): Promise<string | null> {
  const isDesktop = opts.isDesktop ?? isLocalSandboxBackend()

  if (isDesktop) {
    // Desktop: no hosted provider key. The print form takes a single prompt, so
    // fold the system guidance in ahead of the user's message. `runHostModel`
    // already collapses every failure to `null`.
    const hostModel =
      opts.hostModel ??
      ((prompt: string) => runHostModel(prompt, { timeoutMs: opts.timeoutMs }))
    return hostModel(`${opts.system}\n\n${opts.prompt}`)
  }

  // Hosted: the configured API-key provider, unchanged. A throw (e.g. no
  // provider configured) degrades to `null` like every other failure.
  try {
    const result = await generateText({
      model: resolveLanguageModel(opts.model ?? DEFAULT_MODEL),
      system: opts.system,
      prompt: opts.prompt,
      abortSignal: opts.timeoutMs
        ? AbortSignal.timeout(opts.timeoutMs)
        : undefined,
    })
    return result.text.trim()
  } catch (e) {
    console.error("one-shot model call failed:", e)
    return null
  }
}
