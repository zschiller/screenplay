"use client"

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { createPortal } from "react-dom"
import type { EditableTextHandle } from "@workspace/ui/components/editable-text"
import {
  CaretDownIcon,
  ChatIcon,
  CheckIcon,
  CodeIcon,
  ImageIcon,
  PencilSimpleIcon,
  QuotesIcon,
  TextBIcon,
  TextItalicIcon,
  TextStrikethroughIcon,
} from "@workspace/ui/components/icons"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { Button } from "@workspace/ui/components/button"
import {
  FloatingToolbar,
  FloatingToolbarButton,
  FloatingToolbarSeparator,
} from "@workspace/ui/components/floating-toolbar"
import type { Editor } from "@tiptap/core"
import {
  EditorContent,
  ReactNodeViewRenderer,
  useEditor,
  useEditorState,
} from "@tiptap/react"
import { Extension } from "@tiptap/core"
import Collaboration from "@tiptap/extension-collaboration"
import CollaborationCaret from "@tiptap/extension-collaboration-caret"
import Placeholder from "@tiptap/extension-placeholder"
import { useCanvasAnchoredPortal } from "@/hooks/use-canvas-anchored-portal"
import { type ResizeEdge } from "@/hooks/use-layer-resize"
import { useDocumentFragment, useRoomId, useYjs } from "@/lib/yjs/context"
import { useCanvasFiles } from "@/lib/yjs/react"
import { presenceInkClass } from "@/lib/canvas/presence-ink"
import { buildLayerMentionSuggestion } from "@/lib/layer-mention-suggestion"
import { DOCUMENT_BLOCK_TYPES } from "@/lib/document-block-types"
import { useMentionCandidates } from "@/lib/document-mentions"
import { editorAwareness } from "@/lib/yjs/editor-awareness"
import { DocumentMention, documentExtensions } from "@/lib/document-markdown"
import { MENTION_KIND_REGISTRY, mentionKindOf } from "@/lib/mention-kinds"
import { MarkdownLayerMentionNodeView } from "@/components/canvas/markdown-layer-mention-node"
import { DocumentImageNodeView } from "@/components/canvas/document-image-node"
import { DocumentEmbedHostContext } from "@/components/canvas/mockup-embed"
import {
  DocumentImagePicker,
  type PickedImage,
} from "@/components/canvas/document-image-picker"
import {
  DocumentImage,
  imageAltFor,
  releaseImageSelection,
} from "@/lib/document-image"
import {
  DocumentImageUpload,
  imagesIn,
  insertImageAt,
  insertImageWhenSaved,
  markPlace,
  releasePlace,
  uploadImages,
  type DocumentImageUploadOptions,
} from "@/lib/document-image-upload"
import { DocumentSlashMenu } from "@/lib/document-slash-menu"
import {
  DOCUMENT_IMAGE_ITEMS,
  type DocumentImageItemKey,
} from "@/components/canvas/document-slash-menu-list"
import { uploadAttachment } from "@/lib/chat-attachments"
import {
  copyAccountImageToCanvas,
  listAccountFiles,
} from "@/lib/files/account-actions"
import { MODEL_IMAGE_TYPES } from "@/lib/files/attachments"
import { baseName } from "@/lib/files/paths"
import { toast } from "sonner"
import { LabelChat } from "@/components/canvas/label-chat"
import { useLayerToolbar } from "@/components/canvas/use-layer-toolbar"
import { useToolbarReveal } from "@/components/canvas/use-toolbar-reveal"
import { LayerLabelRow } from "@/components/canvas/layer-title-bar"
import {
  LayerMenu,
  useRegisterLayerMenu,
  type LayerMenuActions,
} from "@/components/canvas/layer-menu"
import {
  LayerShell,
  type LayerPlacement,
} from "@/components/canvas/layer-shell"
import { DocumentCommentsExtension } from "@/lib/document-comments-extension"
import {
  encodeAnchor,
  getLineNumbers,
  getQuotedText,
} from "@/lib/document-comments"
import type { ChatQuote } from "@/lib/chat-quote-store"
import type { MarkdownLayerData } from "@/lib/types"
import { multiUserSurface } from "@/lib/capabilities"
import { cn } from "@workspace/ui/lib/utils"
import type { GroupLabelValue } from "@/components/canvas/group-label"
import {
  WorkingChatMention,
  type WorkingChat,
} from "@/components/canvas/working-chat"
import { useViewing } from "@/lib/viewer/context"

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

/**
 * The inline-comment draft for the body text between `from` and `to`, or null
 * when nothing commentable is left. Title text is never commented (the toolbar
 * hides over it too), so a range reaching into the title is clamped to the
 * body. `root` is the doc tile, which the composer's pin is placed against.
 */
function inlineCommentDraft(
  editor: Editor,
  documentId: string,
  layerWidth: number,
  zoom: number,
  root: HTMLElement,
  range: { from: number; to: number }
): InlineCommentDraft | null {
  const doc = editor.state.doc
  const titleEnd = doc.firstChild ? doc.firstChild.nodeSize : 0
  const from = Math.max(range.from, titleEnd)
  const to = Math.min(range.to, doc.content.size)
  if (from >= to || !doc.textBetween(from, to).trim()) return null
  const anchorStart = encodeAnchor(editor, from)
  const anchorEnd = encodeAnchor(editor, to)
  if (!anchorStart || !anchorEnd) return null
  const { lineFrom, lineTo } = getLineNumbers(doc, from, to)
  const top = editor.view.coordsAtPos(from).top
  return {
    documentId,
    anchorStart,
    anchorEnd,
    quotedText: getQuotedText(doc, from, to),
    lineFrom,
    lineTo,
    canvasX: layerWidth,
    canvasY: (top - root.getBoundingClientRect().top) / zoom,
  }
}

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
 *  send-to-agent bubble used. A pressed format takes the stock `Toggle`
 *  on-state (muted fill), not the tool modes' solid fill, so the formats a
 *  selection already has stay quiet. */
function FormatButton({
  label,
  active,
  disabled,
  shortcut,
  onRun,
  children,
}: {
  label: string
  /** Whether the format is on. Omit for an action, which has no on-state. */
  active?: boolean
  disabled?: boolean
  /** Shortcut shown in the tooltip, one `Kbd` per key. */
  shortcut?: string
  onRun: () => void
  children: ReactNode
}) {
  return (
    <FloatingToolbarButton
      label={label}
      shortcut={shortcut}
      pressed={active}
      disabled={disabled}
      variant="ghost"
      className="aria-pressed:bg-muted aria-pressed:text-foreground dark:aria-pressed:hover:bg-muted"
      tabIndex={-1}
      onMouseDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onRun()
      }}
    >
      {children}
    </FloatingToolbarButton>
  )
}

/** "Turn into" block-type selector for the bar under the page — the shared
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
  disabled,
}: {
  editor: Editor
  blockType: string
  disabled?: boolean
}) {
  const current =
    DOCUMENT_BLOCK_TYPES.find((t) => t.key === blockType) ??
    DOCUMENT_BLOCK_TYPES[0]
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" tabIndex={-1} disabled={disabled}>
          <span className="whitespace-nowrap">{current.label}</span>
          <CaretDownIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {DOCUMENT_BLOCK_TYPES.map((t) => (
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
              <CheckIcon className="ml-auto size-3.5 text-foreground" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The bar's Image button: the `/` menu's image items, put in after the
 *  block the caret or selection ends in. Same non-modal Radix menu as
 *  {@link NodeTypeDropdown}, so picking one doesn't blur the editor. */
function ImageDropdown({
  onPick,
}: {
  onPick: (key: DocumentImageItemKey) => void
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <FloatingToolbarButton label="Image" variant="ghost" tabIndex={-1}>
          <ImageIcon />
        </FloatingToolbarButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {DOCUMENT_IMAGE_ITEMS.map((item) => (
          <DropdownMenuItem key={item.key} onSelect={() => onPick(item.key)}>
            <item.Icon />
            <span className="whitespace-nowrap">{item.label}</span>
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
  /** The Comment tool is on: body text selects without editing, and a
   *  released selection opens the inline-comment composer (#1244). */
  commentMode?: boolean
  spaceHeld: boolean
  userName: string
  userColor: string
  /** Notify the canvas when this doc's editor instance is created/destroyed
   *  so threads anchored inside the doc can find their highlight target. */
  onEditorReady?: (id: string, editor: Editor | null) => void
  /** User asked to comment on a non-empty text selection: Comment in the
   *  selection toolbar, or a drag under the Comment tool. */
  onStartInlineComment?: (draft: InlineCommentDraft) => void
  /** User clicked an existing inline-comment highlight inside the doc. */
  onSelectInlineThread?: (threadId: string) => void
  /** User clicked Quote in chat on a non-empty selection (#1243). */
  onReplyInChat?: (quote: ChatQuote) => void
  /**
   * Where the doc sits and how dragging it moves things. Layers render as
   * flat, absolutely-positioned siblings (not nested in a per-group flex row),
   * so moving one between groups never reparents its React subtree — the
   * TipTap editor isn't remounted.
   */
  placement: LayerPlacement
  /** The group label — only set on the leftmost member of a multi-member group. */
  groupLabel?: GroupLabelValue
  /**
   * The chat working on it right now (#1726), named after the title with the
   * 9-dot. Unset while nobody is: an idle layer shows only its title.
   */
  workingChat?: WorkingChat
  /** True when the parent group is selected. Drives label color, frame
   *  highlight, and click behavior (clicks are a no-op while the group owns
   *  the selection — same as IframeLayer). */
  groupSelected?: boolean
  /** Color of a remote user who has this doc selected — tints the name to
   *  match their selection rect. Ignored while locally selected. */
  remoteSelectedColor?: string
  onSelect: (id: string, shiftKey: boolean) => void
  /** Adjust this doc's own width/height; the group anchor (x/y) shifts in the
   *  parent when the drag came from the left/top edge. */
  onResize: (id: string, dx: number, dy: number, dw: number, dh: number) => void
  onTitleChange: (id: string, title: string) => void
  /** Inline rename from the title bar. Unlike `onTitleChange` (cache-only,
   *  driven by the editor) this must also write into the editor's first
   *  heading so every peer's view updates. */
  onRename?: (id: string, title: string) => void
  /** The menu's Remove, the same removal as the Delete key: only this view
   *  goes (⌘Z undoes it). */
  onRemove?: (id: string) => void
  /** The menu's Duplicate: another view of the file (#1884). */
  onDuplicate?: (id: string) => void
  /** The menu's Duplicate as new file: a copy of the file. */
  onDuplicateAsNewFile?: (id: string) => void
  /** The menu's Delete file: the file and every view of it (⌘Z undoes it). */
  onDeleteFile?: (id: string) => void
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
function MarkdownLayerImpl({
  layer,
  zoom,
  selected,
  multiSelected,
  editing,
  commentMode = false,
  spaceHeld,
  userName,
  userColor,
  placement,
  groupLabel,
  workingChat,
  groupSelected,
  remoteSelectedColor,
  onSelect,
  onResize,
  onTitleChange,
  onRename,
  onRemove,
  onDuplicate,
  onDuplicateAsNewFile,
  onDeleteFile,
  onStartEdit,
  onStopEdit,
  onEditorReady,
  onStartInlineComment,
  onSelectInlineThread,
  onReplyInChat,
}: MarkdownLayerProps) {
  const { awareness } = useYjs()
  // Its menu (I7) ends the bar under the page, as on a frame or Mockup, and
  // its sidebar row opens the same one.
  const titleEditableRef = useRef<EditableTextHandle>(null)
  const menuActions: LayerMenuActions = {
    noun: "document",
    onDuplicate: onDuplicate ? () => onDuplicate(layer.id) : undefined,
    onDuplicateAsNewFile: onDuplicateAsNewFile
      ? () => onDuplicateAsNewFile(layer.id)
      : undefined,
    moveTo: { kind: "layer", id: layer.id },
    onDelete: onRemove ? () => onRemove(layer.id) : undefined,
    onDeleteFile: onDeleteFile ? () => onDeleteFile(layer.id) : undefined,
  }
  useRegisterLayerMenu(layer.id, menuActions)
  // Carets only: the pointer moving changes the awareness on every move.
  const provider = useMemo(
    () => ({ awareness: editorAwareness(awareness) }),
    [awareness]
  )
  // The body is the file's (#1883): every view of it edits the same one.
  const fragment = useDocumentFragment(layer.fileId ?? layer.id)
  const rootRef = useRef<HTMLDivElement>(null)

  // The bar under the page while it alone is selected: Edit and ⋯, and while
  // editing the block controls between them (block type, lists, Image).
  const toolbarRef = useRef<HTMLDivElement>(null)
  const toolbarTarget = useLayerToolbar({
    show: selected && !multiSelected,
    anchorRef: rootRef,
    toolbarRef,
  })
  // The block controls grow out from between Edit and ⋯ as editing starts,
  // and fold back away when it stops.
  const blockControlsRef = useRef<HTMLDivElement>(null)
  const blockControlsMounted = useToolbarReveal(editing, blockControlsRef)
  // A viewer (#1933) reads the Document and never edits it.
  const watching = !!useViewing()

  // Images: paste, drop and Upload image save into the canvas's files under
  // `uploads/`, as chat attachments do, and Image from files picks one there
  // (or in your account's files, copied in). The `/` menu's two picks hold
  // their place in the body while their picker is open.
  const roomId = useRoomId()
  const canvasFiles = useCanvasFiles()
  const imageOptions = useMemo<DocumentImageUploadOptions>(
    () => ({
      upload: async (file) => {
        const result = await uploadAttachment(roomId, file)
        return result.ok ? { ok: true, path: result.attachment.path } : result
      },
      onError: (message) => toast(message),
    }),
    [roomId]
  )
  const imageInputRef = useRef<HTMLInputElement>(null)
  const imagePlaceRef = useRef<string | null>(null)
  const [imagePickerOpen, setImagePickerOpen] = useState(false)
  const onSlashPickRef = useRef<
    (key: DocumentImageItemKey, pos: number) => void
  >(() => {})

  // Mention suggestion needs the live layer lists every keystroke, but the
  // editor closes over its initial config. Funnel through refs so the
  // popover always reflects the current titles and excludes self-references.
  const mentionItems = useMentionCandidates({ excludeId: layer.id })
  const mentionItemsRef = useRef(mentionItems)
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
    mentionItemsRef.current = mentionItems
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
  // Quote in chat, for the selection bar's button and ⌘L: true when it
  // quoted something. Set once the editor exists (below).
  const quoteInChatRef = useRef<() => boolean>(() => false)

  // Portal target lives outside the world transform so the bubble can sit
  // above the SelectionOverlay (popovers-layer sibling vs. the TransformWrapper's
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
        // The Document's schema, as the server reads and writes its markdown
        // (`document-markdown.ts`), with node views on mentions and images.
        ...documentExtensions({
          mention: DocumentMention.extend({
            addNodeView() {
              return ReactNodeViewRenderer(MarkdownLayerMentionNodeView, {
                as: "span",
              })
            },
          }).configure({
            // The node view (MarkdownLayerMentionNodeView) drives the in-editor
            // render; these attrs cover the serialized/static-render path.
            HTMLAttributes: { class: "inline-ref" },
            renderText({ node }) {
              const label =
                (node.attrs.label as string | undefined) ?? node.attrs.id
              return `@${label}`
            },
            renderHTML({ options, node }) {
              const label =
                (node.attrs.label as string | undefined) ??
                (node.attrs.id as string)
              return [
                "span",
                {
                  ...options.HTMLAttributes,
                  "data-inline-ref-mask":
                    MENTION_KIND_REGISTRY[mentionKindOf(node.attrs.kind)].mask,
                },
                ["span", { class: "inline-ref-label" }, label],
              ]
            },
            deleteTriggerWithBackspace: true,
            // These getters read refs, but TipTap only invokes them while the
            // user types (suggestion lookup) — never during render — so the
            // deferred ref access is safe. The lint rule can't see that the
            // closures are deferred past render, so it's suppressed here.
            // eslint-disable-next-line react-hooks/refs
            suggestion: buildLayerMentionSuggestion({
              getItems: () => mentionItemsRef.current,
              below: true,
              getAnchorRect: () =>
                rootRef.current?.getBoundingClientRect() ?? null,
            }),
          }),
          image: DocumentImage.extend({
            addNodeView() {
              return ReactNodeViewRenderer(DocumentImageNodeView)
            },
          }),
        }),
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
          // The extension's default caret, with the label's ink picked for
          // contrast against the presence colour instead of always white.
          render: (user: { name: string; color: string }) => {
            const caret = document.createElement("span")
            caret.classList.add("collaboration-carets__caret")
            caret.setAttribute("style", `border-color: ${user.color}`)
            const label = document.createElement("div")
            label.classList.add(
              "collaboration-carets__label",
              presenceInkClass(user.color)
            )
            label.setAttribute("style", `background-color: ${user.color}`)
            label.append(document.createTextNode(user.name))
            caret.append(label)
            return caret
          },
        }),
        DocumentImageUpload.configure(imageOptions),
        // onPick reads a ref, but only when a `/` menu item is picked, never
        // during render.
        // eslint-disable-next-line react-hooks/refs
        DocumentSlashMenu.configure({
          onPick: (key, pos) => onSlashPickRef.current(key, pos),
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
        handleKeyDown(_view, event) {
          // ⌘L is Quote in chat, as the selection bar's tooltip says.
          if (
            (event.metaKey || event.ctrlKey) &&
            !event.shiftKey &&
            !event.altKey &&
            event.key.toLowerCase() === "l"
          ) {
            return quoteInChatRef.current()
          }
          return false
        },
      },
    },
    [fragment, provider, imageOptions]
  )

  useEffect(() => {
    quoteInChatRef.current = () => {
      if (!editor || !onReplyInChat) return false
      const { from, to, empty } = editor.state.selection
      // The bar never shows over the title, so neither does the shortcut.
      if (empty || editor.state.doc.resolve(from).index(0) === 0) return false
      const doc = editor.state.doc
      onReplyInChat({
        documentId: layer.id,
        documentTitle: layer.title || null,
        quotedText: getQuotedText(doc, from, to),
        ...getLineNumbers(doc, from, to),
      })
      // Typing now belongs to the chat, never the selection, even before its
      // composer is ready. The toolbar goes too, as it does for Comment, so it
      // doesn't sit over the Document while you type.
      editor.commands.blur()
      setBubbleAnchor(null)
      return true
    }
  })

  // The `/` menu's and the Image button's picks: hold the place, then open
  // the file chooser (Upload image) or the picker (Image from files).
  useEffect(() => {
    onSlashPickRef.current = (key, pos) => {
      if (!editor) return
      if (imagePlaceRef.current) releasePlace(editor, imagePlaceRef.current)
      imagePlaceRef.current = markPlace(editor, pos, null)
      if (key === "upload-image") imageInputRef.current?.click()
      else setImagePickerOpen(true)
    }
  })

  /** Take the place the `/` menu held, if it's still held. */
  const takeImagePlace = () => {
    const id = imagePlaceRef.current
    imagePlaceRef.current = null
    return editor && id ? { editor, id } : null
  }

  const onImageFilesChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const images = imagesIn(e.target.files, imageOptions.onError)
    e.target.value = ""
    const place = takeImagePlace()
    if (!place) return
    const pos = releasePlace(place.editor, place.id)
    if (pos !== null && images.length > 0) {
      uploadImages(place.editor, images, pos, imageOptions)
    }
  }

  const onImagePicked = (image: PickedImage) => {
    const place = takeImagePlace()
    if (!place) return
    if (image.scope === "canvas") {
      releasePlace(place.editor, place.id, (tr, pos) =>
        insertImageAt(tr, pos, {
          src: image.path,
          alt: imageAltFor(image.path),
        })
      )
      return
    }
    const pos = releasePlace(place.editor, place.id)
    if (pos === null) return
    void insertImageWhenSaved(
      place.editor,
      copyAccountImageToCanvas(roomId, image.path),
      { pos, label: baseName(image.path), onError: imageOptions.onError }
    )
  }

  const onImagePickerOpenChange = (open: boolean) => {
    setImagePickerOpen(open)
    if (open) return
    const place = takeImagePlace()
    if (place) releasePlace(place.editor, place.id)
  }

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
    if (!editing) releaseImageSelection(editor)
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
            // The title is always a heading: blocks can't change there.
            inTitle:
              editor.state.doc.resolve(editor.state.selection.from).index(0) ===
              0,
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

  // Comment in the selection toolbar: hand the canvas the selection's anchors,
  // quote and line numbers, and a composer position at the doc's right edge
  // level with the top of the selection (where the thread's pin will sit).
  // The canvas holds the passage highlighted while the composer is open.
  const startInlineComment = () => {
    if (!editor || !rootRef.current) return
    const draft = inlineCommentDraft(
      editor,
      layer.id,
      layer.width,
      zoom,
      rootRef.current,
      editor.state.selection
    )
    if (!draft) return
    onStartInlineComment?.(draft)
    setBubbleAnchor(null)
  }

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
      // the editor and clear the selection before the command can fire. The
      // bar under the page is the same, and its Edit stops editing itself.
      if (bubbleRef.current?.contains(target)) return
      if (toolbarRef.current?.contains(target)) return
      // The node-type dropdown is the shared shadcn menu, which Radix portals
      // straight to <body> — outside both refs above. Treat a click inside its
      // popper wrapper the same as a click on the toolbar so choosing a block
      // type doesn't blur the editor and tear the toolbar down mid-select.
      // The same goes for the `/` menu, portaled to <body> too, and the
      // Image from files picker it opens.
      const el = target instanceof Element ? target : target.parentElement
      if (
        el?.closest(
          "[data-radix-popper-content-wrapper], [data-composer-popup], [data-document-image-picker]"
        )
      ) {
        return
      }
      onStopEdit()
    }
    window.addEventListener("pointerdown", onDown, true)
    return () => window.removeEventListener("pointerdown", onDown, true)
  }, [editing, onStopEdit])

  // Comment tool over a read-only doc (#1244): the body text takes the pointer
  // so a drag selects it natively, and the release opens the composer for that
  // span. A release without a selection is a plain click, which bubbles to the
  // canvas and drops today's point pin; the click that follows a selecting drag
  // is swallowed so it doesn't drop one as well. The release is heard on the
  // window, since a drag can end outside the doc.
  const textSelectable = commentMode && !editing && !spaceHeld
  const handleCommentPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const onUp = () => {
      if (!editor || !rootRef.current || !onStartInlineComment) return
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed || !sel.anchorNode || !sel.focusNode) return
      const dom = editor.view.dom
      if (!dom.contains(sel.anchorNode) || !dom.contains(sel.focusNode)) return
      let a: number
      let b: number
      try {
        a = editor.view.posAtDOM(sel.anchorNode, sel.anchorOffset)
        b = editor.view.posAtDOM(sel.focusNode, sel.focusOffset)
      } catch {
        return
      }
      const draft = inlineCommentDraft(
        editor,
        layer.id,
        layer.width,
        zoom,
        rootRef.current,
        { from: Math.min(a, b), to: Math.max(a, b) }
      )
      // The pending highlight takes over from the native selection.
      sel.removeAllRanges()
      const swallow = (ev: MouseEvent) => ev.stopPropagation()
      window.addEventListener("click", swallow, { capture: true, once: true })
      setTimeout(() => window.removeEventListener("click", swallow, true))
      if (draft) onStartInlineComment(draft)
    }
    window.addEventListener("pointerup", onUp, { capture: true, once: true })
  }

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
      placement={placement}
      containerId={`markdown-layer-${layer.id}`}
      // No overflow-hidden on the root — the group label sits above the tile
      // via `bottom-full` and would be clipped. The outer root stays open and
      // pushes overflow clipping to the inner body: `data-markdown-layer-scroll`
      // (overflow-y-auto) clips vertically and the body padding constrains
      // horizontal layout.
      containerClassName="absolute flex flex-col bg-background"
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
      // Detach the title bar's drag while the user holds space to pan (the body
      // overlay's own drag is gated on `spaceHeld` by the Shell).
      titleDragDisabled={spaceHeld}
      onResize={handleResize}
      // Suppress the resize handles while editing so they don't fight the text
      // caret / selection at the doc's edges.
      resizable={!editing}
      groupLabel={groupLabel}
      renderTitle={(api) => (
        <LayerLabelRow
          title={layer.title}
          placeholder="Untitled"
          selected={selected || groupSelected}
          color={remoteSelectedColor}
          onSelectLayer={api.deferSelect}
          onRename={onRename ? (next) => onRename(layer.id, next) : undefined}
          editableRef={titleEditableRef}
          trailing={
            workingChat && (
              <LabelChat>
                <WorkingChatMention chat={workingChat} />
              </LabelChat>
            )
          }
        />
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
              // Under the Comment tool the text takes the pointer too, so it
              // can be selected without editing (#1244).
              className={cn(
                "relative z-10 px-6 py-5",
                textSelectable && "doc-comment-selectable"
              )}
              style={{
                pointerEvents: editing || textSelectable ? "auto" : "none",
              }}
              onPointerDown={
                textSelectable ? handleCommentPointerDown : undefined
              }
            >
              {/* Its Mockup embeds (#1888) draw at the canvas zoom and,
                  at rest, press through to the Document as its text does. */}
              <DocumentEmbedHostContext.Provider
                value={{
                  zoom,
                  body: editing
                    ? undefined
                    : {
                        bodyDragHandlers: api.bodyDragHandlers,
                        onBodyPointerDownCapture: api.onBodyPointerDownCapture,
                      },
                }}
              >
                <EditorContent editor={editor} />
              </DocumentEmbedHostContext.Provider>
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

          <input
            ref={imageInputRef}
            type="file"
            accept={[...MODEL_IMAGE_TYPES].join(",")}
            multiple
            hidden
            onChange={onImageFilesChosen}
          />
          <DocumentImagePicker
            open={imagePickerOpen}
            onOpenChange={onImagePickerOpenChange}
            roomId={roomId}
            canvasFiles={canvasFiles}
            listAccountFiles={listAccountFiles}
            onPick={onImagePicked}
          />

          {toolbarTarget &&
            createPortal(
              <FloatingToolbar
                ref={toolbarRef}
                aria-label="Document"
                // Positioned every frame by useLayerToolbar, outside the world
                // transform, so it's already at constant screen size.
                className="absolute top-0 left-0"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
              >
                {!watching && (
                  <FloatingToolbarButton
                    label="Edit"
                    shortcut={editing ? ["Esc"] : undefined}
                    pressed={editing}
                    // On, it takes Interact's selection fill, like the 2px ring
                    // around the page.
                    className={
                      editing
                        ? "bg-canvas-selection-fill text-black hover:bg-canvas-selection-fill/90 hover:text-black dark:hover:bg-canvas-selection-fill/90"
                        : undefined
                    }
                    onClick={() =>
                      editing ? onStopEdit() : onStartEdit(layer.id)
                    }
                  >
                    <PencilSimpleIcon />
                  </FloatingToolbarButton>
                )}
                {blockControlsMounted && editor && (
                  <div
                    ref={blockControlsRef}
                    // Folding away after editing stops: no longer pressable.
                    inert={!editing}
                    className="flex shrink-0 items-center gap-1 overflow-hidden *:shrink-0"
                  >
                    <FloatingToolbarSeparator />
                    <NodeTypeDropdown
                      editor={editor}
                      blockType={activeFormats?.blockType ?? "paragraph"}
                      disabled={activeFormats?.inTitle}
                    />
                    <ImageDropdown
                      onPick={(key) => {
                        const { $to } = editor.state.selection
                        // After the top-level block the selection ends in; a
                        // selected image is one itself.
                        onSlashPickRef.current(
                          key,
                          $to.depth > 0 ? $to.after(1) : $to.pos
                        )
                      }}
                    />
                    {onRemove && <FloatingToolbarSeparator />}
                  </div>
                )}
                {onRemove && (
                  <LayerMenu
                    placement="toolbar"
                    actions={menuActions}
                    onRename={
                      onRename
                        ? () => titleEditableRef.current?.startEditing()
                        : undefined
                    }
                  />
                )}
              </FloatingToolbar>,
              toolbarTarget
            )}

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
              // selection before the command lands — see FormatButton. It holds
              // only what styles a passage, Comment and Quote in chat; block
              // controls are in the bar under the page.
              <div
                ref={bubbleRef}
                className="pointer-events-none absolute top-0 left-0"
              >
                <FloatingToolbar
                  aria-label="Formatting"
                  style={{
                    transform: "translate(-50%, -100%) translateY(-6px)",
                    transformOrigin: "bottom center",
                  }}
                >
                  <FormatButton
                    label="Bold"
                    active={!!activeFormats?.bold}
                    onRun={() => editor.chain().focus().toggleBold().run()}
                  >
                    <TextBIcon />
                  </FormatButton>
                  <FormatButton
                    label="Italic"
                    active={!!activeFormats?.italic}
                    onRun={() => editor.chain().focus().toggleItalic().run()}
                  >
                    <TextItalicIcon />
                  </FormatButton>
                  <FormatButton
                    label="Strikethrough"
                    active={!!activeFormats?.strike}
                    onRun={() => editor.chain().focus().toggleStrike().run()}
                  >
                    <TextStrikethroughIcon />
                  </FormatButton>
                  <FormatButton
                    label="Code"
                    active={!!activeFormats?.code}
                    onRun={() => editor.chain().focus().toggleCode().run()}
                  >
                    <CodeIcon />
                  </FormatButton>
                  {((multiUserSurface && onStartInlineComment) ||
                    onReplyInChat) && <FloatingToolbarSeparator />}
                  {multiUserSurface && onStartInlineComment && (
                    <FloatingToolbarButton
                      label="Comment"
                      variant="ghost"
                      tabIndex={-1}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        startInlineComment()
                      }}
                    >
                      <ChatIcon />
                    </FloatingToolbarButton>
                  )}
                  {onReplyInChat && (
                    <FormatButton
                      label="Quote in chat"
                      shortcut="⌘L"
                      onRun={() => quoteInChatRef.current()}
                    >
                      <QuotesIcon />
                    </FormatButton>
                  )}
                </FloatingToolbar>
              </div>,
              bubblePortalTarget
            )}
        </>
      )}
    </LayerShell>
  )
}

/**
 * Memoized: the canvas re-renders its member list on every pointer move of a
 * drag, marquee or draw, and `CanvasMemberLayer` keeps each Document's props
 * identical unless they change, so only the Documents that changed render.
 */
export const MarkdownLayer = memo(MarkdownLayerImpl)
