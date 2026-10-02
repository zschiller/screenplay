/**
 * Claude models that think on every turn even when the request leaves
 * `thinking` out: Claude 5 and later, Opus, Sonnet, Fable and Mythos alike.
 * Older ones (Opus 4.8 and below) don't think unless asked, and Haiku 4.5
 * rejects adaptive thinking, so they're left alone.
 */
const THINKS_BY_DEFAULT =
  /^claude-(?:opus|sonnet|fable|mythos)-(?:[5-9]|\d{2,})(?!\d)/

const SUMMARIZED_THINKING = {
  anthropic: { thinking: { type: "adaptive", display: "summarized" } },
} as const

/**
 * Provider options that make a hosted chat's reasoning readable. These Claude
 * models default thinking `display` to `"omitted"`: the stream still opens a
 * thinking block, but its text is empty, so the Reasoning disclosure renders
 * with nothing inside. Asking for `"summarized"` returns the summary the
 * model already produces; it changes what we see, not how much it thinks.
 *
 * Takes the fully-qualified `<provider>:<model>` id. Claude reached through the
 * Vercel AI Gateway (`vercel:anthropic/claude-opus-5.5`) gets the same options;
 * the gateway forwards `providerOptions.anthropic` and spells versions with dots.
 */
export function thinkingProviderOptions(modelId: string) {
  const idx = modelId.indexOf(":")
  const providerKey = modelId.slice(0, idx)
  const model = modelId.slice(idx + 1)
  const claude =
    providerKey === "anthropic"
      ? model
      : providerKey === "vercel" && model.startsWith("anthropic/")
        ? model.slice("anthropic/".length).replaceAll(".", "-")
        : null
  if (!claude || !THINKS_BY_DEFAULT.test(claude)) return undefined
  return SUMMARIZED_THINKING
}
