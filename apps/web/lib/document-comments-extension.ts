import { Extension } from "@tiptap/core"
import { Plugin, PluginKey } from "@tiptap/pm/state"
import type { EditorState } from "@tiptap/pm/state"
import type { Node as PMNode } from "@tiptap/pm/model"
import { Decoration, DecorationSet } from "@tiptap/pm/view"

export interface DocumentCommentRange {
  id: string
  from: number
  to: number
  active?: boolean
}

interface DocumentCommentsState {
  ranges: DocumentCommentRange[]
  deco: DecorationSet
}

interface DocumentCommentsOptions {
  /** Called when the user clicks on a highlighted comment span. */
  onSelectThread?: (threadId: string) => void
}

const DOC_COMMENTS_KEY = new PluginKey<DocumentCommentsState>(
  "documentComments"
)

/** Replace the active set of comment highlights for a given editor. */
export function setDocumentCommentRanges(
  view: { state: EditorState; dispatch: (tr: EditorState["tr"]) => void },
  ranges: DocumentCommentRange[]
): void {
  const tr = view.state.tr.setMeta(DOC_COMMENTS_KEY, { ranges })
  view.dispatch(tr)
}

function buildDeco(doc: PMNode, ranges: DocumentCommentRange[]): DecorationSet {
  if (ranges.length === 0) return DecorationSet.empty
  const size = doc.content.size
  const decorations: Decoration[] = []
  for (const r of ranges) {
    const from = Math.max(0, Math.min(r.from, size))
    const to = Math.max(0, Math.min(r.to, size))
    if (from >= to) continue
    decorations.push(
      Decoration.inline(from, to, {
        class:
          "doc-comment-highlight" +
          (r.active ? " doc-comment-highlight-active" : ""),
        "data-comment-thread": r.id,
      })
    )
  }
  return DecorationSet.create(doc, decorations)
}

/**
 * ProseMirror plugin that paints inline comment-highlight decorations and
 * routes clicks back to the host React tree. The set of ranges is pushed
 * in via `setDocumentCommentRanges` whenever the canvas's threads list
 * changes; positions are mapped through doc edits in between updates so
 * the highlight tracks the underlying text even before the next refresh.
 */
export const DocumentCommentsExtension =
  Extension.create<DocumentCommentsOptions>({
    name: "documentComments",

    addOptions() {
      return {
        onSelectThread: undefined,
      }
    },

    addProseMirrorPlugins() {
      const onSelectThread = () => this.options.onSelectThread
      return [
        new Plugin<DocumentCommentsState>({
          key: DOC_COMMENTS_KEY,
          state: {
            init: () => ({ ranges: [], deco: DecorationSet.empty }),
            apply(tr, old, _oldState, newState) {
              const meta = tr.getMeta(DOC_COMMENTS_KEY) as
                | { ranges?: DocumentCommentRange[] }
                | undefined
              if (meta?.ranges) {
                return {
                  ranges: meta.ranges,
                  deco: buildDeco(newState.doc, meta.ranges),
                }
              }
              if (tr.docChanged) {
                return {
                  ranges: old.ranges,
                  deco: old.deco.map(tr.mapping, tr.doc),
                }
              }
              return old
            },
          },
          props: {
            decorations(state) {
              return DOC_COMMENTS_KEY.getState(state)?.deco
            },
            handleClick(_view, _pos, event) {
              const target = event.target as HTMLElement | null
              if (!target) return false
              const el = target.closest(
                "[data-comment-thread]"
              ) as HTMLElement | null
              if (!el) return false
              const id = el.getAttribute("data-comment-thread")
              if (!id) return false
              const handler = onSelectThread()
              if (!handler) return false
              handler(id)
              event.stopPropagation()
              return true
            },
          },
        }),
      ]
    },
  })
