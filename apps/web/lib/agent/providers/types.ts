import "server-only"

import type { LanguageModel } from "ai"

export interface ModelInfo {
  /**
   * Fully-qualified model id used everywhere outside this module:
   * `<providerKey>:<provider-specific-model-id>`. The picker emits these
   * directly and the agent_chat table stores them verbatim.
   */
  id: string
  /** Human-readable label rendered in the model picker. */
  label: string
  /**
   * Origin provider — used by the client to group entries in the picker
   * by provider (Anthropic, OpenAI, Vercel AI Gateway, …) instead of by
   * model family (Opus/Sonnet/Haiku, which only made sense when the only
   * provider was Anthropic).
   */
  provider: {
    key: string
    label: string
  }
}

/**
 * The server-facing surface of a model provider. Each provider is one
 * concrete file under `lib/agent/providers/` (anthropic.ts, openai.ts, …);
 * `lib/agent/providers/index.ts` composes them into the active registry.
 *
 * Adding a new provider means dropping a sibling file that exports a
 * `ModelProvider` factory and adding it to the list in `index.ts`. There is
 * no global registration side-effect — the registry is the explicit array
 * in `index.ts`, the same shape `lib/sandbox/`, `lib/blob/`, and
 * `lib/yjs-host/` use.
 *
 * A provider self-detects whether it's enabled by inspecting env vars in
 * `isConfigured()`. Providers that aren't configured are skipped from the
 * picker but still callable if a stored chat references them — the failure
 * mode is a clear API-key error from the underlying SDK rather than a
 * silent reroute to a different provider.
 */
export interface ModelProvider {
  /**
   * Stable lowercase key used as the prefix in `<key>:<model>` ids. Must
   * not contain a colon. Once stored in `agent_chat`, this key is part of
   * the wire format — don't rename it after a deployment is live.
   */
  key: string

  /** Human-readable name shown in docs / config UIs. */
  label: string

  /**
   * True when the env vars this provider needs are present. Drives whether
   * its models appear in the picker.
   */
  isConfigured(): boolean

  /**
   * Models this provider exposes in the picker. Returns `[]` when not
   * configured. Returned ids are already prefixed with `key:`. The
   * `provider` field is filled in centrally by `enumerateModels`, so
   * implementations only need to return `{ id, label }`.
   */
  listModels(): Array<Omit<ModelInfo, "provider">>

  /**
   * Resolve a provider-specific model id (the part after `key:`) into an
   * AI SDK `LanguageModel`. Should throw if the provider isn't configured
   * — the caller already validated the prefix.
   */
  resolve(modelId: string): LanguageModel
}
