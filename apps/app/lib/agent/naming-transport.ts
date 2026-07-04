import "server-only"

import { generateText } from "ai"

import { isLocalSandboxBackend } from "@/lib/sandbox/backend"
import { runHostModel } from "./host-model"
import { DEFAULT_MODEL, resolveLanguageModel } from "./providers"

/**
 * The one-shot naming model transport, shared by both naming paths (the v2
 * naming module and the batch names endpoint). It hides the per-backend
 * difference behind one call so the naming code stays "try model → parse two
 * lines → fall back" (#674):
 *
 *  - **hosted** shells the configured API-key provider through the AI SDK,
 *    exactly as before — unchanged and non-regressive;
 *  - **desktop** has no hosted key, so it reaches the user's own installed,
 *    signed-in harness CLI via {@link runHostModel} (`claude -p`), folding the
 *    system guidance into the single print-mode prompt.
 *
 * Returns the model's raw text, or `null` when there's no model to reach / the
 * call fails — so the caller falls back to the deterministic slug. Never throws:
 * naming must never block Workspace creation.
 *
 * `isDesktop` and `hostModel` are injected (defaulting to the production seams)
 * so the desktop routing is unit-testable without a real subprocess or env.
 */
export async function runNamingModel(opts: {
  system: string
  prompt: string
  /** Provider:model id for the hosted call. Defaults to `DEFAULT_MODEL`. */
  model?: string
  isDesktop?: boolean
  hostModel?: (prompt: string) => Promise<string | null>
}): Promise<string | null> {
  const isDesktop = opts.isDesktop ?? isLocalSandboxBackend()

  if (isDesktop) {
    // Desktop: no hosted provider key. The print form takes a single prompt, so
    // fold the system guidance in ahead of the user's message. `runHostModel`
    // already collapses every failure to `null`.
    const hostModel = opts.hostModel ?? runHostModel
    return hostModel(`${opts.system}\n\n${opts.prompt}`)
  }

  // Hosted: the configured API-key provider, unchanged. A throw (e.g. no
  // provider configured) degrades to `null` like every other failure.
  try {
    const result = await generateText({
      model: resolveLanguageModel(opts.model ?? DEFAULT_MODEL),
      system: opts.system,
      prompt: opts.prompt,
    })
    return result.text.trim()
  } catch (e) {
    console.error("naming model call failed:", e)
    return null
  }
}
