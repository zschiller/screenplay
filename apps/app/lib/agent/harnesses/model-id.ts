import { HARNESS_ID_PREFIX } from "./types"

/**
 * A chat's stored model id, decoded: which Harness runs it (`key`) and,
 * optionally, which model of that Harness (`modelId`). `modelId` is undefined
 * for a bare `harness:<key>` id — "the Harness's own default" — which is what
 * every row stored before this codec existed means, so the old rows keep their
 * meaning untouched.
 */
export interface HarnessModelId {
  /** Harness catalog key (colon-free — see {@link isValidHarnessKey}). */
  key: string
  /**
   * Opaque ACP model id selecting a model within the Harness, or `undefined`
   * for the Harness's own default. May itself contain colons — the codec splits
   * only on the *first* colon after the key, so it survives intact.
   */
  modelId?: string
}

/**
 * The `Harness.key` invariant, made executable: a key is valid only when it is
 * non-empty and contains neither a comma nor a colon. The comma keeps it
 * unambiguous in the comma-separated `SANDBOX_HARNESSES` list; the colon keeps
 * the model-id codec unambiguous — because the key can't contain one, splitting
 * `harness:<key>:<modelId>` on its first colon always recovers the key whole, no
 * matter what the opaque `modelId` holds. Mirrors `ModelProvider.key`'s
 * colon-free invariant (`providers/types.ts`).
 */
export function isValidHarnessKey(key: string): boolean {
  return key.length > 0 && !key.includes(",") && !key.includes(":")
}

/**
 * Encode a Harness selection into the wire id stored on `agent_chat.model`:
 * `harness:<key>` for the Harness's own default, `harness:<key>:<modelId>` when
 * a specific model is chosen. Throws on a key that breaks the invariant rather
 * than emitting an id that wouldn't decode back to the same parts.
 */
export function encodeHarnessModelId(key: string, modelId?: string): string {
  if (!isValidHarnessKey(key)) {
    throw new Error(
      `Harness key "${key}" must be non-empty and contain no comma or colon.`
    )
  }
  return modelId
    ? `${HARNESS_ID_PREFIX}${key}:${modelId}`
    : `${HARNESS_ID_PREFIX}${key}`
}

/**
 * Decode a stored model id into its Harness selection, or `null` when it doesn't
 * name a Harness — a `provider:<model>` id, an empty/whitespace id, or a bare
 * `harness:` with no key all yield `null`, so the caller falls back to its
 * default rather than spawning a guessed adapter.
 *
 * The remainder after the `harness:` prefix is split on its **first** colon:
 * everything before is the (colon-free) key, everything after is the opaque
 * `modelId` kept intact (colons and all). With no second colon, `modelId` is
 * `undefined` — "the Harness's own default", preserving every pre-codec row.
 */
export function decodeHarnessModelId(
  id: string | undefined | null
): HarnessModelId | null {
  const trimmed = id?.trim()
  if (!trimmed || !trimmed.startsWith(HARNESS_ID_PREFIX)) return null

  const rest = trimmed.slice(HARNESS_ID_PREFIX.length)
  const colon = rest.indexOf(":")
  if (colon === -1) {
    const key = rest.trim()
    return key ? { key } : null
  }

  const key = rest.slice(0, colon).trim()
  if (!key) return null
  const modelId = rest.slice(colon + 1)
  // A trailing colon with nothing after it ("harness:<key>:") carries no model —
  // collapse it to the bare-key meaning rather than an empty-string model.
  return modelId ? { key, modelId } : { key }
}
