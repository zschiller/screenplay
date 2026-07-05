"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { createPortal } from "react-dom"
import {
  Bold,
  Check,
  ChevronDown,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  List,
  ListOrdered,
  SquareCode,
  Strikethrough,
  TextQuote,
  Type,
  type LucideIcon,
} from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import type { Editor } from "@tiptap/core"
import {
  EditorContent,
  ReactNodeViewRenderer,
  useEditor,
  useEditorState,
} from "@tiptap/react"
import { Extension } from "@tiptap/core"
import StarterKit from "@tiptap/starter-kit"
import Document from "@tiptap/extension-document"
import Collaboration from "@tiptap/extension-collaboration"
import CollaborationCaret from "@tiptap/extension-collaboration-caret"
import Mention from "@tiptap/extension-mention"
import Placeholder from "@tiptap/extension-placeholder"
import { useCanvasAnchoredPortal } from "@/hooks/use-canvas-anchored-portal"
import { type ResizeEdge } from "@/hooks/use-layer-resize"
import { useDocumentFragment, useYjs } from "@/lib/yjs/context"
import { useMarkdownLayers } from "@/lib/yjs/react"
import { buildLayerMentionSuggestion } from "@/lib/layer-mention-suggestion"
import { MarkdownLayerMentionNodeView } from "@/components/canvas/markdown-layer-mention-node"
import { MENTION_TEXT_CLASS } from "@/lib/mention-styles"
import { LayerTitleText } from "@/components/canvas/layer-title-bar"
import { LayerShell } from "@/components/canvas/layer-shell"
import { DocumentCommentsExtension } from "@/lib/document-comments-extension"
import type { MarkdownLayerData } from "@/lib/types"

export interface InlineCommentDraft {
  documentId: string
  anchorStart: string
  anchorEnd: string
  quotedText: string
  lineFrom: number
  lineTo: number
  /** Where to anchor the composer's pin in canvas space — at the right edge
   *  of the doc tile, vertically aligned with the start of the selection. */
  canvasX: number
  canvasY: number
}

/** Forces every doc to start with a heading — that heading is the title.
 *  Body blocks follow. Mirrors how Notion's page model is shaped: there's
 *  always a title slot at the top, body comes after. */
const DocumentWithTitle = Document.extend({
  content: "heading block*",
})

/** Enter inside the title shouldn't split it into a second heading (the
 *  default ProseMirror behavior would leave you with two H1s, the second
 *  empty). Match Notion: drop the cursor into a new paragraph below. */
const TitleEnterBehavior = Extension.create({
  name: "titleEnterBehavior",
  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { state } = this.editor
        const { $from, empty } = state.selection
        if ($from.depth < 1) return false
        // Only intercept when the cursor is inside the doc's first child —
        // the title heading. Body headings keep the default split behavior.
        if ($from.index(0) !== 0) return false
        if (!empty) return false
        const titleEnd = $from.after(1)
        // Use the existing paragraph below (created on doc seed) when the
        // title is the only block; otherwise insert one and land on it.
        const after = state.doc.resolve(titleEnd).nodeAfter
        if (after && after.type.name === "paragraph") {
          return this.editor
            .chain()
            .setTextSelection(titleEnd + 1)
            .focus()
            .run()
        }
        return this.editor
          .chain()
          .insertContentAt(titleEnd, { type: "paragraph" })
          .setTextSelection(titleEnd + 1)
          .focus()
          .run()
      },
    }
  },
})

/** One button in the selection toolbar. Fires on `mousedown` (not click) with
 *  `preventDefault` so toggling a format never blurs the editor or collapses
 *  the selection before the command runs — the same discipline the old
 *  send-to-agent bubble used. */
function FormatButton({
  label,
  active,
  onRun,
  children,
}: {
  label: string
  active: boolean
  onRun: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={label}
      aria-pressed={active}
      title={label}
      onMouseDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onRun()
      }}
      className={`flex size-7 items-center justify-center rounded transition-colors hover:bg-accent hover:text-foreground ${
        active ? "bg-accent text-foreground" : "text-muted-foreground"
      }`}
    >
      {children}
    </button>
  )
}

/** The block types the selection toolbar's "Turn into" dropdown can switch
 *  between. `key` matches the `blockType` string derived from the editor in
 *  {@link MarkdownLayer}; `run` converts the block the caret sits in.
 *
 *  Every command leads with `clearNodes()` — TipTap's "normalize to a simple
 *  paragraph" primitive — before applying the target. Without it these compose
 *  instead of replace: blockquote and lists are *wrapping* nodes, so e.g.
 *  `toggleBlockquote()` on an existing code block wraps it (a quoted code block)
 *  rather than turning it into a quote. `clearNodes()` first strips any current
 *  wrapper/type, so each pick is an exclusive "turn into". */
const NODE_TYPES: {
  key: string
  label: string
  Icon: LucideIcon
  run: (editor: Editor) => void
}[] = [
  {
    key: "paragraph",
    label: "Text",
    Icon: Type,
    run: (editor) => editor.chain().focus().clearNodes().run(),
  },
  {
    key: "h1",
    label: "Heading 1",
    Icon: Heading1,
    run: (editor) =>
      editor.chain().focus().clearNodes().setHeading({ level: 1 }).run(),
  },
  {
    key: "h2",
    label: "Heading 2",
    Icon: Heading2,
    run: (editor) =>
      editor.chain().focus().clearNodes().setHeading({ level: 2 }).run(),
  },
  {
    key: "h3",
    label: "Heading 3",
    Icon: Heading3,
    run: (editor) =>
      editor.chain().focus().clearNodes().setHeading({ level: 3 }).run(),
  },
  {
    key: "bulletList",
    label: "Bullet list",
    Icon: List,
    run: (editor) =>
      editor.chain().focus().clearNodes().toggleBulletList().run(),
  },
  {
    key: "orderedList",
    label: "Numbered list",
    Icon: ListOrdered,
    run: (editor) =>
      editor.chain().focus().clearNodes().toggleOrderedList().run(),
  },
  {
    key: "blockquote",
    label: "Quote",
    Icon: TextQuote,
    run: (editor) => editor.chain().focus().clearNodes().setBlockquote().run(),
  },
  {
    key: "codeBlock",
    label: "Code block",
    Icon: SquareCode,
    run: (editor) => editor.chain().focus().clearNodes().setCodeBlock().run(),
  },
]

/** "Turn into" block-type selector for the selection toolbar — the shared
 *  shadcn {@link DropdownMenu}, for visual/keyboard consistency with the rest
 *  of the app. `modal={false}` keeps Radix from locking body pointer-events (so
 *  the canvas/editor stay live underneath) and avoids focus-trapping the menu.
 *  Radix portals the menu content to `<body>`, outside the doc's `bubbleRef`;
 *  the doc's outside-pointerdown guard is taught to ignore clicks inside the
 *  Radix popper wrapper so picking a type doesn't blur the editor mid-select.
 *  Each `onSelect` re-focuses the editor, which restores the (still-live)
 *  ProseMirror selection the command then transforms. */
function NodeTypeDropdown({
  editor,
  blockType,
}: {
  editor: Editor
  blockType: string
}) {
  const current = NODE_TYPES.find((t) => t.key === blockType) ?? NODE_TYPES[0]
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          tabIndex={-1}
          title="Turn into"
          className="flex h-7 items-center gap-1 rounded px-1.5 text-xs text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
        >
          <current.Icon className="size-3.5" />
          <span className="whitespace-nowrap">{current.label}</span>
          <ChevronDown className="size-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {NODE_TYPES.map((t) => (
          <DropdownMenuItem
            key={t.key}
            onSelect={() => t.run(editor)}
            className={
              t.key === blockType ? "text-foreground" : "text-muted-foreground"
            }
          >
            <t.Icon />
            <span className="whitespace-nowrap">{t.label}</span>
            {t.key === blockType && (
              <Check className="ml-auto size-3.5 text-foreground" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

interface MarkdownLayerProps {
  layer: MarkdownLayerData
  zoom: number
  selected: boolean
  multiSelected: boolean
  editing: boolean
  spaceHeld: boolean
  userName: string
  userColor: string
  /** Notify the canvas when this doc's editor instance is created/destroyed
   *  so threads anchored inside the doc can find their highlight target. */
  onEditorReady?: (id: string, editor: Editor | null) => void
  /** User clicked the inline "Comment" button on a non-empty selection. */
  onStartInlineComment?: (draft: InlineCommentDraft) => void
  /** User clicked an existing inline-comment highlight inside the doc. */
  onSelectInlineThread?: (threadId: string) => void
  /**
   * Absolute world-space position of this layer's top-left. Layers render as
   * flat, absolutely-positioned siblings (not nested in a per-group flex row),
   * so moving one between groups never reparents its React subtree — the
   * TipTap editor isn't remounted. Position comes from
   * `effectiveIframeLayerLayouts` and already bakes in the pop-out offset.
   */
  worldX: number
  worldY: number
  /** Paint order, projected from the group's sidebar position (higher = on top). */
  zIndex?: number
  /** In-flow reorder translate, applied when this doc is being dragged in-flow. */
  dragTranslateX?: number
  dragTranslateY?: number
  /** True while this doc is the one being "popped" out at the cursor; its
   *  float position is baked into `worldX/worldY`. */
  dragPopped?: boolean
  /** Group display name — only set on the leftmost member of a multi-member group. */
  groupLabel?: string
  /** True when the parent group is selected. Drives label color, frame
   *  highlight, and click behavior (clicks are a no-op while the group owns
   *  the selection — same as IframeLayer). */
  groupSelected?: boolean
  /** Color of a remote user who has this doc selected — tints the name to
   *  match their selection rect. Ignored while locally selected. */
  remoteSelectedColor?: string
  /** Color of a remote user who has this doc's group selected — tints the
   *  group label. Only meaningful on the leftmost member. */
  remoteGroupSelectedColor?: string
  /** Click handler for the group label. */
  onSelectGroup?: (shiftKey: boolean) => void
  /** Inline rename for the group label. */
  onRenameGroup?: (next: string) => void
  /**
   * Ask the canvas to start a reorder drag from this doc's title bar. Returns
   * `true` for multi-member groups (canvas owns the gesture), `false` for
   * single-member groups so the caller falls back to a regular group-move drag.
   */
  onRequestReorderDrag?: (layerId: string, e: React.PointerEvent) => boolean
  onSelect: (id: string, shiftKey: boolean) => void
  /** Move the parent group by (dx, dy) — same contract as IframeLayer.onMoveGroup. */
  onMoveGroup: (
    dx: number,
    dy: number,
    totalDx: number,
    totalDy: number,
    metaKey: boolean
  ) => void
  onMoveSelected: (
    dx: number,
    dy: number,
    totalDx: number,
    totalDy: number,
    metaKey: boolean
  ) => void
  /** Fires once when a group-move drag begins (after the move threshold). */
  onGroupDragStart?: () => void
  /** Fires once when a group-move drag ends. metaKey is the cmd state at release. */
  onGroupDragEnd?: (metaKey: boolean) => void
  /** Adjust this doc's own width/height; the group anchor (x/y) shifts in the
   *  parent when the drag came from the left/top edge. */
  onResize: (id: string, dx: number, dy: number, dw: number, dh: number) => void
  onTitleChange: (id: string, title: string) => void
  /** Inline rename from the title bar. Unlike `onTitleChange` (cache-only,
   *  driven by the editor) this must also write into the editor's first
   *  heading so every peer's view updates. */
  onRename?: (id: string, title: string) => void
  onStartEdit: (id: string) => void
  onStopEdit: () => void
}

/**
 * A Notion-style document tile — the Markdown Layer, refit as a content adapter
 * plugged into the shared {@link LayerShell}. The Shell owns the world-space
 * frame, selection, drag (group-move / merge routing plus deferred
 * click-to-select), and resize; this adapter supplies the title row
 * (`renderTitle`) and the body (`children`) and keeps all content-specific
 * behavior: the TipTap editor bound to a Yjs XmlFragment (`markdown-layer-${id}`)
 * for collaborative editing with live remote cursors, title sync, edit-mode
 * focus, the inline-comment bubble, outside-click blur, and doc-scroll wheel
 * handling.
 */
export function MarkdownLayer({
  layer,
  zoom,
  selected,
  multiSelected,
  editing,
  spaceHeld,
  userName,
  userColor,
  worldX,
  worldY,
  zIndex,
  dragTranslateX,
  dragTranslateY,
  dragPopped,
  groupLabel,
  groupSelected,
  remoteSelectedColor,
  remoteGroupSelectedColor,
  onSelectGroup,
  onRenameGroup,
  onRequestReorderDrag,
  onSelect,
  onMoveGroup,
  onMoveSelected,
  onGroupDragStart,
  onGroupDragEnd,
  onResize,
  onTitleChange,
  onRename,
  onStartEdit,
  onStopEdit,
  onEditorReady,
  onSelectInlineThread,
}: MarkdownLayerProps) {
  const { awareness } = useYjs()
  const provider = useMemo(() => ({ awareness }), [awareness])
  const fragment = useDocumentFragment(layer.id)
  const rootRef = useRef<HTMLDivElement>(null)

  // Mention suggestion needs the live layer lists every keystroke, but the
  // editor closes over its initial config. Funnel through refs so the
  // popover always reflects the current titles and excludes self-references.
  const markdownLayers = useMarkdownLayers()
  const markdownLayersRef = useRef<MarkdownLayerData[]>(markdownLayers)
  const layerIdRef = useRef(layer.id)

  // Title cache lives on `MarkdownLayerData.title` — sidebar rows, mentions,
  // agent context all read it. The editor's first heading is the source of
  // truth; this callback is what writes derived title text back to the cache.
  // Stash on a ref so the editor closure doesn't capture a stale handler.
  const onTitleChangeRef = useRef(onTitleChange)
  const titleCacheRef = useRef(layer.title)

  // Refresh the editor-facing refs after each commit (never during render).
  // The editor closes over its initial config, so these refs are how the
  // mention popover and title-writeback see current values every keystroke.
  useEffect(() => {
    markdownLayersRef.current = markdownLayers
    layerIdRef.current = layer.id
    onTitleChangeRef.current = onTitleChange
    titleCacheRef.current = layer.title
  })

  // Coords of the double-click that started edit mode, captured so the next
  // focus effect can land the cursor where the user clicked instead of at
  // the doc's end. Cleared after one consumption.
  const pendingFocusCoordsRef = useRef<{ left: number; top: number } | null>(
    null
  )

  // Anchor for the floating selection toolbar — the start of the current
  // non-empty text selection, in pre-zoom layer coords.
  const [bubbleAnchor, setBubbleAnchor] = useState<{
    left: number
    top: number
  } | null>(null)
  const bubbleRef = useRef<HTMLDivElement>(null)

  // Portal target lives outside the world transform so the bubble can sit
  // above the SelectionOverlay (z-30 sibling vs. the TransformWrapper's
  // stacking context, where an internal z-index would be capped). Resolved
  // lazily during render — it's only read once `bubbleAnchor` is set by a user
  // interaction, well after the ancestor portal node has mounted, and
  // getElementById returns a stable node reference so dependents don't churn.
  const bubblePortalTarget =
    typeof document !== "undefined"
      ? document.getElementById("inline-comment-bubble-portal")
      : null

  const onSelectInlineThreadRef = useRef(onSelectInlineThread)
  useEffect(() => {
    onSelectInlineThreadRef.current = onSelectInlineThread
  })

  const editor = useEditor(
    {
      extensions: [
        // Disable StarterKit's TrailingNode: it auto-appends an empty node
        // of the schema's default type at the end of the doc, and our
        // schema (`heading block*`) makes that default a heading — leaving
        // an invisible trailing H1 stuck at the bottom of every doc.
        StarterKit.configure({
          undoRedo: false,
          document: false,
          trailingNode: false,
        }),
        DocumentWithTitle,
        TitleEnterBehavior,
        Placeholder.configure({
          // Only the title slot gets a placeholder — empty body blocks stay
          // visually quiet (no "Type heading…" hint), matching Notion.
          placeholder: ({ pos }) => (pos === 0 ? "Untitled" : ""),
          showOnlyCurrent: false,
          // Show "Untitled" on the canvas tile even when the editor is in
          // read-only (non-editing) mode — without this the placeholder is
          // suppressed unless the user has double-clicked into the doc.
          showOnlyWhenEditable: false,
          includeChildren: false,
        }),
        Collaboration.configure({ fragment }),
        CollaborationCaret.configure({
          provider,
          user: { name: userName || "Anonymous", color: userColor },
        }),
        Mention.extend({
          addNodeView() {
            return ReactNodeViewRenderer(MarkdownLayerMentionNodeView, {
              as: "span",
            })
          },
          addAttributes() {
            return {
              ...this.parent?.(),
              kind: {
                default: "markdown-layer",
                parseHTML: (el) =>
                  el.getAttribute("data-kind") ?? "markdown-layer",
                renderHTML: (attrs) =>
                  attrs.kind ? { "data-kind": attrs.kind as string } : {},
              },
            }
          },
        }).configure({
          // The node view (MarkdownLayerMentionNodeView) drives the in-editor
          // render; these attrs cover the serialized/static-render path.
          HTMLAttributes: {
            class: MENTION_TEXT_CLASS,
          },
          renderText({ node }) {
            const label =
              (node.attrs.label as string | undefined) ?? node.attrs.id
            return `@${label}`
          },
          renderHTML({ options, node }) {
            const label =
              (node.attrs.label as string | undefined) ??
              (node.attrs.id as string)
            return ["span", options.HTMLAttributes, `@${label}`]
          },
          deleteTriggerWithBackspace: true,
          // These getters read refs, but TipTap only invokes them while the
          // user types (suggestion lookup) — never during render — so the
          // deferred ref access is safe. The lint rule can't see that the
          // closures are deferred past render, so it's suppressed here.
          // eslint-disable-next-line react-hooks/refs
          suggestion: buildLayerMentionSuggestion({
            getMarkdownLayers: () => markdownLayersRef.current,
            getExcludeId: () => layerIdRef.current,
            getAnchorRect: () =>
              rootRef.current?.getBoundingClientRect() ?? null,
          }),
        }),
        // onSelectThread reads a ref, but TipTap only invokes it when a
        // comment thread is clicked, never during render — the deferred ref
        // access is safe and the rule can't see that.
        // eslint-disable-next-line react-hooks/refs
        DocumentCommentsExtension.configure({
          onSelectThread: (threadId) =>
            onSelectInlineThreadRef.current?.(threadId),
        }),
      ],
      editable: editing,
      immediatelyRender: false,
      editorProps: {
        attributes: {
          class:
            "tiptap tiptap-document prose prose-sm prose-neutral dark:prose-invert max-w-none focus:outline-none",
        },
      },
    },
    [fragment, provider]
  )

  // Keep the cached title (sidebar/mention label) in sync with the editor's
  // first heading. Debounced so a flurry of keystrokes only writes once;
  // idempotent so it's safe for every connected client to run — the LWW
  // collection skips writes that match the current value.
  useEffect(() => {
    if (!editor) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const sync = () => {
      const first = editor.state.doc.firstChild
      const headingText =
        first && first.type.name === "heading" ? first.textContent : ""
      if (headingText === titleCacheRef.current) return
      onTitleChangeRef.current(layerIdRef.current, headingText)
    }
    const onUpdate = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(sync, 200)
    }
    editor.on("update", onUpdate)
    sync()
    return () => {
      if (timer) clearTimeout(timer)
      editor.off("update", onUpdate)
    }
  }, [editor])

  useEffect(() => {
    if (!editor) return
    editor.setEditable(editing)
    if (editing) {
      const coords = pendingFocusCoordsRef.current
      pendingFocusCoordsRef.current = null
      requestAnimationFrame(() => {
        if (coords) {
          const hit = editor.view.posAtCoords(coords)
          if (hit) {
            editor.chain().focus().setTextSelection(hit.pos).run()
            return
          }
        }
        editor.commands.focus("end")
      })
    }
  }, [editing, editor])

  useEffect(() => {
    if (!editor) return
    editor.commands.updateUser({
      name: userName || "Anonymous",
      color: userColor,
    })
  }, [editor, userName, userColor])

  // Register / unregister the editor with the canvas so doc-anchored
  // threads can paint highlights and project pins to the right margin.
  useEffect(() => {
    if (!editor || !onEditorReady) return
    onEditorReady(layer.id, editor)
    return () => {
      onEditorReady(layer.id, null)
    }
  }, [editor, layer.id, onEditorReady])

  // Drive the selection toolbar: anchor a small floating bar to the start of
  // any non-empty text selection. Local coords (relative to the doc tile) so
  // the wrapping `transform: scale(1/zoom)` keeps the bar at a constant screen
  // size regardless of canvas zoom.
  //
  // Visibility is tied to selection emptiness only — *not* to focus. If we hid
  // the bar on blur, mousing onto a button (which momentarily shifts focus
  // despite our preventDefault) would unmount it before the command fires and
  // the gesture would silently no-op.
  useEffect(() => {
    if (!editor) return
    const update = () => {
      const { from, to, empty } = editor.state.selection
      if (empty) {
        setBubbleAnchor(null)
        return
      }
      // Never show the toolbar over the title: the doc's first block is a
      // forced heading (the page title), so formatting / "turn into" there is
      // meaningless — the schema (`heading block*`) pins it as a heading. Match
      // TitleEnterBehavior's check: index 0 at depth 0 is the title.
      if (editor.state.doc.resolve(from).index(0) === 0) {
        setBubbleAnchor(null)
        return
      }
      const rect = rootRef.current?.getBoundingClientRect()
      if (!rect) return
      const fromCoords = editor.view.coordsAtPos(from)
      const toCoords = editor.view.coordsAtPos(to)
      const localLeft = (fromCoords.left + toCoords.left) / 2 - rect.left
      const localTop = Math.min(fromCoords.top, toCoords.top) - rect.top
      // Convert from on-screen pixels back into pre-zoom layer coords so the
      // absolute-positioned bar lines up regardless of canvas zoom (the
      // bounding rect we just measured is post-zoom).
      setBubbleAnchor({ left: localLeft / zoom, top: localTop / zoom })
    }
    editor.on("selectionUpdate", update)
    update()
    return () => {
      editor.off("selectionUpdate", update)
    }
  }, [editor, zoom])

  // Active-format flags for the toolbar. `useEditorState` re-renders only when
  // the selected snapshot changes, so toggling bold/italic/etc. repaints the
  // pressed states without wiring a manual transaction subscription.
  const activeFormats = useEditorState({
    editor,
    selector: ({ editor }) =>
      editor
        ? {
            bold: editor.isActive("bold"),
            italic: editor.isActive("italic"),
            strike: editor.isActive("strike"),
            code: editor.isActive("code"),
            bulletList: editor.isActive("bulletList"),
            orderedList: editor.isActive("orderedList"),
            blockType: editor.isActive("heading", { level: 1 })
              ? "h1"
              : editor.isActive("heading", { level: 2 })
                ? "h2"
                : editor.isActive("heading", { level: 3 })
                  ? "h3"
                  : editor.isActive("codeBlock")
                    ? "codeBlock"
                    : editor.isActive("blockquote")
                      ? "blockquote"
                      : editor.isActive("bulletList")
                        ? "bulletList"
                        : editor.isActive("orderedList")
                          ? "orderedList"
                          : "paragraph",
          }
        : null,
  })

  // Keep the portaled bubble anchored to the start of the selection.
  useCanvasAnchoredPortal({
    enabled: !!bubbleAnchor && editing && !!bubblePortalTarget,
    anchorRef: rootRef,
    targetRef: bubbleRef,
    getOffset: (rr, cw) => ({
      x: rr.left - cw.left + (bubbleAnchor?.left ?? 0) * zoom,
      y: rr.top - cw.top + (bubbleAnchor?.top ?? 0) * zoom,
    }),
  })

  useEffect(() => {
    if (!editing) return
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current) return
      const target = e.target as Node
      if (rootRef.current.contains(target)) return
      // The floating selection toolbar is portaled out of the doc's DOM tree
      // (so it can paint above the SelectionOverlay), but interactions with
      // it should not count as clicking outside the doc — that would blur
      // the editor and clear the selection before the command can fire.
      if (bubbleRef.current?.contains(target)) return
      // The node-type dropdown is the shared shadcn menu, which Radix portals
      // straight to <body> — outside both refs above. Treat a click inside its
      // popper wrapper the same as a click on the toolbar so choosing a block
      // type doesn't blur the editor and tear the toolbar down mid-select.
      const el = target instanceof Element ? target : target.parentElement
      if (el?.closest("[data-radix-popper-content-wrapper]")) return
      onStopEdit()
    }
    window.addEventListener("pointerdown", onDown, true)
    return () => window.removeEventListener("pointerdown", onDown, true)
  }, [editing, onStopEdit])

  // Wheel inside a doc should scroll the doc, not pan the canvas — but only
  // while the doc is selected (or being edited). The canvas attaches a
  // non-passive wheel listener on its wrapper that always preventDefaults, so
  // when we stop propagation here the event never reaches it and the doc's
  // inner overflow scroller runs natively. When the doc is NOT selected we let
  // the event fall through: the canvas preventDefaults (cancelling the doc's
  // own scroll) and pans instead, so an unselected doc behaves like canvas.
  // Cmd/Ctrl+wheel always falls through so the canvas can still zoom.
  const wheelActive = selected || editing
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) return
      if (!wheelActive) return
      e.stopPropagation()
    }
    root.addEventListener("wheel", onWheel)
    return () => root.removeEventListener("wheel", onWheel)
  }, [wheelActive])

  // The Shell drives resize with a (layerId, edge, …) signature shared with the
  // Iframe Layer; a doc snaps on neither axis, so drop the edge and forward the
  // deltas to the doc's own resize contract.
  const handleResize = useCallback(
    (
      id: string,
      _edge: ResizeEdge,
      dx: number,
      dy: number,
      dw: number,
      dh: number
    ) => {
      onResize(id, dx, dy, dw, dh)
    },
    [onResize]
  )

  return (
    <LayerShell
      layerId={layer.id}
      width={layer.width}
      height={layer.height}
      worldX={worldX}
      worldY={worldY}
      zIndex={zIndex}
      dragTranslateX={dragTranslateX}
      dragTranslateY={dragTranslateY}
      dragPopped={dragPopped}
      containerId={`markdown-layer-${layer.id}`}
      // No overflow-hidden on the root — the group label sits above the tile
      // via `bottom-full` and would be clipped. The outer root stays open and
      // pushes overflow clipping to the inner body: `data-markdown-layer-scroll`
      // (overflow-y-auto) clips vertically and the body padding constrains
      // horizontal layout.
      containerClassName="absolute flex flex-col rounded-md bg-background"
      containerRef={rootRef}
      containerProps={{
        "data-markdown-layer": "",
        "data-doc-id": layer.id,
        onDoubleClick: (e) => {
          e.stopPropagation()
          pendingFocusCoordsRef.current = { left: e.clientX, top: e.clientY }
          onStartEdit(layer.id)
        },
      }}
      zoom={zoom}
      selected={selected}
      groupSelected={groupSelected}
      multiSelected={multiSelected}
      spaceHeld={spaceHeld}
      onSelect={onSelect}
      onMoveGroup={onMoveGroup}
      onMoveSelected={onMoveSelected}
      onGroupDragStart={onGroupDragStart}
      onGroupDragEnd={onGroupDragEnd}
      onRequestReorderDrag={onRequestReorderDrag}
      // Detach the title bar's drag while the user holds space to pan (the body
      // overlay's own drag is gated on `spaceHeld` by the Shell).
      titleDragDisabled={spaceHeld}
      onResize={handleResize}
      // Suppress the resize handles while editing so they don't fight the text
      // caret / selection at the doc's edges.
      resizable={!editing}
      groupLabel={groupLabel}
      remoteGroupSelectedColor={remoteGroupSelectedColor}
      onSelectGroup={onSelectGroup}
      onRenameGroup={onRenameGroup}
      renderTitle={(api) => (
        // Flex-row wrapper with an explicit max-width so `truncate` on the
        // title span has something to clip against — without it, the
        // LayerTitleBar's `items-start` lets the child size to its (nowrap)
        // content and the title runs past the tile's right edge. Mirrors
        // the equivalent row in IframeLayerLabel.
        <div
          className="flex min-h-[18px] max-w-full items-center"
          style={{ maxWidth: layer.width * zoom }}
        >
          <LayerTitleText
            title={layer.title}
            placeholder="Untitled"
            selected={selected || groupSelected}
            color={remoteSelectedColor}
            onSelectLayer={(shiftKey) => {
              // Defer to the group's selection while the group is selected
              // (shift drills through to additive doc selection). Mirrors
              // IframeLayerLabel.onSelectFrame.
              if (selected && !shiftKey) return
              if (groupSelected && !shiftKey) return
              api.deferSelect(shiftKey)
            }}
            onRename={onRename ? (next) => onRename(layer.id, next) : undefined}
          />
        </div>
      )}
    >
      {(api) => (
        <>
          {/* The Shell-owned title bar is purely a display/drag affordance —
           *  the source of truth is still the editor's first heading, which is
           *  the cached `layer.title` field. The wrapper below holds the editor
           *  itself (title heading + body) in a Notion-style stacked surface. */}
          <div
            data-markdown-layer-scroll
            className="relative flex-1 overflow-y-auto"
          >
            <div
              // `relative` + `z-10` lifts the editor above the layer-selection
              // overlay below so comment-highlight spans (which set their own
              // `pointer-events: auto`) sit on top and catch clicks even when
              // the doc isn't being edited. Empty editor space stays
              // `pointer-events: none`, falling through to the overlay so
              // clicking blank prose still selects/drags the doc tile.
              className="relative z-10 px-6 py-5"
              style={{ pointerEvents: editing ? "auto" : "none" }}
            >
              <EditorContent editor={editor} />
            </div>

            {!editing && (
              <div
                className="absolute inset-0 touch-none"
                style={{ cursor: "inherit" }}
                {...api.bodyDragHandlers}
                onPointerDownCapture={api.onBodyPointerDownCapture}
              />
            )}
          </div>

          {bubbleAnchor &&
            editing &&
            editor &&
            bubblePortalTarget &&
            createPortal(
              // Floating markdown toolbar anchored above the start of the user's
              // selection — Google-Docs style. Portaled out of the world transform
              // so it sits above the SelectionOverlay (see canvas.tsx for the
              // portal target). Positioned every frame by the rAF loop above
              // (translate is set imperatively from the tile's client rect), so
              // it tracks pan/zoom/drag without needing inverse-scale tricks.
              // Each button fires on mousedown (not click) with preventDefault so
              // running a format command never blurs the editor or collapses the
              // selection before the command lands — see FormatButton.
              <div
                ref={bubbleRef}
                className="pointer-events-none absolute top-0 left-0"
              >
                <div
                  className="pointer-events-auto flex items-center gap-0.5 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
                  style={{
                    transform: "translate(-50%, -100%) translateY(-6px)",
                    transformOrigin: "bottom center",
                  }}
                >
                  <NodeTypeDropdown
                    editor={editor}
                    blockType={activeFormats?.blockType ?? "paragraph"}
                  />
                  <div className="mx-0.5 h-5 w-px bg-border" />
                  <FormatButton
                    label="Bold"
                    active={!!activeFormats?.bold}
                    onRun={() => editor.chain().focus().toggleBold().run()}
                  >
                    <Bold className="size-3.5" />
                  </FormatButton>
                  <FormatButton
                    label="Italic"
                    active={!!activeFormats?.italic}
                    onRun={() => editor.chain().focus().toggleItalic().run()}
                  >
                    <Italic className="size-3.5" />
                  </FormatButton>
                  <FormatButton
                    label="Strikethrough"
                    active={!!activeFormats?.strike}
                    onRun={() => editor.chain().focus().toggleStrike().run()}
                  >
                    <Strikethrough className="size-3.5" />
                  </FormatButton>
                  <FormatButton
                    label="Code"
                    active={!!activeFormats?.code}
                    onRun={() => editor.chain().focus().toggleCode().run()}
                  >
                    <Code className="size-3.5" />
                  </FormatButton>
                  <div className="mx-0.5 h-5 w-px bg-border" />
                  <FormatButton
                    label="Bullet list"
                    active={!!activeFormats?.bulletList}
                    onRun={() => editor.chain().focus().toggleBulletList().run()}
                  >
                    <List className="size-3.5" />
                  </FormatButton>
                  <FormatButton
                    label="Numbered list"
                    active={!!activeFormats?.orderedList}
                    onRun={() =>
                      editor.chain().focus().toggleOrderedList().run()
                    }
                  >
                    <ListOrdered className="size-3.5" />
                  </FormatButton>
                </div>
              </div>,
              bubblePortalTarget
            )}
        </>
      )}
    </LayerShell>
  )
}
