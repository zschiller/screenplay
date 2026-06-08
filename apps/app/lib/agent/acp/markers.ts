import { serializeMention } from "../message-markers"
import { blockText, textBlock, type ContentBlock } from "./schema"

/**
 * Message Markers ⟷ ACP content blocks (ADR 0006, PRD #375).
 *
 * screenplay smuggles a turn's metadata into the user-message *string* via
 * Message Markers (`message-markers.ts`). ACP's prompt model is instead a list
 * of typed {@link ContentBlock}s. This module reconciles the two:
 *
 *   - **Markers with a native ACP slot ride content blocks.** An `@`-mention
 *     `[@title](mention:id)` is a reference to a document — exactly an ACP
 *     `resource_link` (a baseline block type every ACP agent must support). So
 *     a mention becomes a `resource_link` block (`uri: "mention:id"`,
 *     `name: title`); a real ACP client would emit it natively.
 *   - **Markers with no ACP slot stay an in-band screenplay convention.** The
 *     `[plan mode: enabled]`, `[branch: …]`, and `[skill: …]` markers have no
 *     ACP equivalent, so they remain literal characters inside `text` blocks —
 *     the one layer a real ACP client won't emit on its own (PRD design goal 1).
 *
 * The conversion is **lossless both ways**: {@link contentBlocksToWire} of
 * {@link wireToContentBlocks} reproduces the original wire string byte-for-byte,
 * because mention serialization is deterministic and all other text is carried
 * verbatim. That round-trip is what lets the seam move metadata onto ACP blocks
 * without dropping the in-band layer.
 */

// `[@label](mention:id)` — the same inline form `serializeMention` emits. The
// label stops at the first `]`, the id at the first `)`, so a mention stays
// self-contained. Global so every mention in the body is split out.
const MENTION_RE = /\[@([^\]]*)\]\(mention:([^)]*)\)/g

/**
 * Split a wire user-message string into ACP content blocks. `@`-mentions become
 * `resource_link` blocks (their native ACP slot); every other run of text —
 * including the in-band plan/branch/skill markers — stays a `text` block.
 *
 * Adjacent text is coalesced and empty text blocks are dropped, so a message
 * that is a single mention yields exactly one `resource_link` block and a
 * message with no mentions yields a single `text` block.
 */
export function wireToContentBlocks(wire: string): ContentBlock[] {
  const blocks: ContentBlock[] = []
  let lastIndex = 0
  const pushText = (text: string) => {
    if (text.length === 0) return
    blocks.push(textBlock(text))
  }

  for (const match of wire.matchAll(MENTION_RE)) {
    const [token, label = "", id = ""] = match
    pushText(wire.slice(lastIndex, match.index))
    blocks.push({ type: "resource_link", uri: `mention:${id}`, name: label })
    lastIndex = match.index + token.length
  }
  pushText(wire.slice(lastIndex))

  // An empty message still round-trips through a single empty text block, so the
  // caller always gets at least one block to send.
  return blocks.length > 0 ? blocks : [textBlock("")]
}

/**
 * Reassemble the wire user-message string from ACP content blocks — the inverse
 * of {@link wireToContentBlocks}. `resource_link` blocks whose `uri` is a
 * `mention:` reference render back to their `[@label](mention:id)` marker (via
 * the one Message Markers encoder, so the form can't drift); `text` blocks are
 * emitted verbatim; any other block type contributes its text, if any.
 */
export function contentBlocksToWire(blocks: ContentBlock[]): string {
  return blocks
    .map((block) => {
      if (block.type === "resource_link" && block.uri.startsWith("mention:")) {
        return serializeMention(block.name, block.uri.slice("mention:".length))
      }
      return blockText(block)
    })
    .join("")
}
