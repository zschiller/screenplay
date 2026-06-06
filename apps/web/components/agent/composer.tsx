"use client"

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  ArrowUp,
  ClipboardList,
  ChevronDown,
  Check,
  Square,
} from "lucide-react"
import { EditorContent, useEditor, type Editor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import Mention from "@tiptap/extension-mention"
import type { JSONContent } from "@tiptap/core"
import { buildLayerMentionSuggestion } from "@/lib/layer-mention-suggestion"
import { buildSkillMentionSuggestion } from "@/lib/skill-mention-suggestion"
import type { SkillMenuItem } from "@/lib/skills-store"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
} from "@workspace/ui/components/input-group"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  buildReferencedDocsFooter,
  serializeMention,
  serializeSkill,
} from "@/lib/agent/message-markers"
import type { ModelInfo } from "@/lib/models-store"
import { groupModelsByProvider } from "@/lib/model-selection"
import type { MarkdownLayerData } from "@/lib/types"

/**
 * Walk a TipTap JSON document and return:
 *  - `text`: plain-text rendering, with each `@` layer mention serialized via
 *    `serializeMention` and the single optional `/` skill chip serialized via
 *    `serializeSkill`, so the user-message renderer can recover them and the
 *    agent loop can act on the explicit invocation.
 *  - `mentions`: deduplicated `{ id }` list (layer mentions only).
 *  - `skill`: the picked Skill name, if any (at most one per message).
 * Block boundaries (paragraphs, headings, list items) become newlines.
 */
export function extractTextAndMentions(json: JSONContent | undefined): {
  text: string
  mentions: Array<{ id: string }>
  skill?: string
} {
  if (!json) return { text: "", mentions: [] }
  const out: string[] = []
  const mentions: Array<{ id: string }> = []
  const seen = new Set<string>()
  let skill: string | undefined

  const visit = (node: JSONContent, depth: number) => {
    if (node.type === "text") {
      if (typeof node.text === "string") out.push(node.text)
      return
    }
    if (node.type === "mention") {
      const id = node.attrs?.id as string | undefined
      const label = (node.attrs?.label as string | undefined) ?? id ?? ""
      // `/`-picked skills share the Mention node type but carry a `/`
      // suggestion char. They serialize to a `[skill: <name>]` marker the
      // agent prompt treats as a mandatory `read_skill` invocation.
      if (node.attrs?.mentionSuggestionChar === "/") {
        const name = id ?? label
        if (name && skill === undefined) skill = name
        out.push(serializeSkill(name))
        return
      }
      out.push(serializeMention(label, id ?? ""))
      if (id && !seen.has(id)) {
        seen.add(id)
        mentions.push({ id })
      }
      return
    }
    if (node.type === "hardBreak") {
      out.push("\n")
      return
    }
    if (node.content) {
      for (const child of node.content) visit(child, depth + 1)
    }
    // Add a newline after block-level container nodes so paragraphs don't
    // run together. The top-level `doc` node is depth 0 so we skip it.
    if (
      depth > 0 &&
      (node.type === "paragraph" ||
        node.type === "heading" ||
        node.type === "listItem" ||
        node.type === "blockquote" ||
        node.type === "codeBlock")
    ) {
      out.push("\n")
    }
  }
  visit(json, 0)
  return {
    text: out
      .join("")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
    mentions,
    skill,
  }
}

/**
 * Serialize the editor's current draft to the decorated wire body: the
 * extracted turn text with each `@`-Layer mention and the optional `/`-Skill
 * serialized inline, plus the referenced-documents footer for any mentioned
 * Layers. Bodies are never inlined — the agent loop fetches live state via
 * `read_document(id)` on demand. An empty draft serializes to `""`. Shared by
 * the submit path and the live `onChange` mirror so both see identical text.
 */
function serializeDraft(
  editor: Editor,
  markdownLayers: MarkdownLayerData[]
): string {
  const { text, mentions } = extractTextAndMentions(editor.getJSON())
  const trimmed = text.trim()
  if (!trimmed) return ""
  const docs = mentions.map((m) => ({
    id: m.id,
    title: markdownLayers.find((d) => d.id === m.id)?.title,
  }))
  return trimmed + buildReferencedDocsFooter(docs)
}

/** What a submit hands back: the decorated wire body and the chosen model. */
export interface ComposerSubmitPayload {
  /**
   * The Message-Markers wire body: the extracted turn text with each `@`-Layer
   * mention and the optional `/`-Skill serialized inline, plus the
   * referenced-documents footer for any mentioned Layers. Server-prepended
   * prefixes (plan/branch) are the caller's concern, not the Composer's.
   */
  text: string
  /** The model selected in the Composer at submit time. */
  model: string
}

/** Imperative handle for callers that need to drive the draft from outside. */
export interface ComposerHandle {
  /** Append `text` to the current draft and focus the editor. */
  insertText: (text: string) => void
  /** Focus the editor caret at the end of the draft. */
  focus: () => void
}

export interface ComposerProps {
  /**
   * `@`-mention source: the Room's Markdown Layers. Injected rather than read
   * from a Yjs hook so the Composer can mount before a Room/Sandbox exists.
   */
  markdownLayers: MarkdownLayerData[]
  /**
   * `/`-Skill source. App Skills only before a Sandbox exists, the merged
   * App ∪ Repo set once one is — resolved by the caller (see
   * `lib/skills/menu-source.ts`). Ignored unless `enableSkills` is set.
   */
  skills?: SkillMenuItem[]
  /** Whether the Skill index is still loading, for the `/` menu's spinner. */
  skillsLoading?: boolean
  /**
   * Enables the `/`-Skill picker. Off for Document/Markdown-Layer chats, which
   * have no `read_skill` tool, so `/` stays a literal slash there.
   */
  enableSkills?: boolean
  /** The loaded model catalog. Empty while still fetching. */
  models: ModelInfo[]
  /** The currently-selected model id (already resolved by the caller). */
  model: string
  /** Called when the user picks a different model from the dropdown. */
  onModelChange: (model: string) => void
  /**
   * Locks the model picker — e.g. once a chat has its first turn, the model is
   * pinned for the conversation.
   */
  modelLocked?: boolean
  /** Plan-mode toggle state. Omit `onPlanModeChange` to hide the toggle. */
  planMode?: boolean
  onPlanModeChange?: (planMode: boolean) => void
  /**
   * Which keystroke commits the draft — a per-mount choice, not a global of the
   * component (ADR 0004). `"enter"` (default) is chat's binding: Enter submits,
   * Shift+Enter inserts a newline. `"mod-enter"` is the seed binding used by the
   * `CreateBranchDialog`: ⌘/Ctrl+Enter creates and a bare Enter inserts a
   * newline (or fires {@link ComposerProps.onEnter} when given), so a stray
   * Enter can't fire the heavier, less-reversible Branch creation.
   */
  submitMode?: "enter" | "mod-enter"
  /**
   * Optional handler for a bare Enter in `mod-enter` mode. When given, a plain
   * Enter (no modifier, no Shift) fires this instead of inserting a newline —
   * the New Workspace dialog binds it to "Add another" so Enter stacks a row,
   * Shift+Enter is a newline, and ⌘/Ctrl+Enter creates. Ignored in `enter` mode.
   */
  onEnter?: () => void
  /**
   * Optional handler for Backspace/Delete on an already-empty draft. The New
   * Workspace dialog binds it to removing the row, so emptying a row and
   * hitting Delete once more pops it off the stack. Ignored while a mention or
   * skill popover is open. Omit it and Backspace on an empty draft is a no-op.
   */
  onRemoveWhenEmpty?: () => void
  /**
   * Allow committing an empty draft. Off in chat (an empty turn is
   * meaningless); on in the seed Composer, where an empty prompt is a
   * deliberate request for a bare scratch Branch.
   */
  allowEmptySubmit?: boolean
  /** Fired on submit with the decorated wire body and chosen model. */
  onSubmit: (payload: ComposerSubmitPayload) => void
  /**
   * Fired on every draft edit with the same decorated wire body `onSubmit`
   * would send. Lets a caller mirror the live draft into its own state — the
   * New Workspace dialog uses it to render a collapsed row's prompt preview
   * while that row's Composer stays mounted but hidden (#327). Omit it and the
   * Composer keeps its draft purely internal, as in chat.
   */
  onChange?: (payload: ComposerSubmitPayload) => void
  /**
   * Streaming state — while true the send button becomes a stop button (when
   * `onStop` is given) and submit is suppressed. Seed Composers omit this.
   */
  isStreaming?: boolean
  onStop?: () => void
  /**
   * Hide the trailing send button. The New Workspace dialog commits via its own
   * "Create" footer button (and ⌘↵), so an in-Composer send control would be a
   * redundant second submit affordance.
   */
  hideSend?: boolean
  /** Placeholder shown while the draft is empty. */
  placeholder?: string
  /** Outer container className. Defaults to the chat input frame. */
  className?: string
}

/**
 * The single chat-turn Composer.
 *
 * Lifted out of `agent-chat.tsx` so it has no dependency on the chat-session
 * hook or a live chat id: every input it needs (mention source, skill source,
 * model catalog + selection, plan-mode, submit) arrives as a prop, so it can
 * render inside a Chat Session today and as a Branch's seed prompt before a
 * Sandbox exists (per ADR 0004). It owns the TipTap editor, the `@`-Layer and
 * `/`-Skill pickers, the model dropdown, and serialization to Message Markers
 * via the one unchanged codec — but never decides *when* a turn is sent or what
 * happens to it; that is `onSubmit`'s job.
 */
export const Composer = forwardRef<ComposerHandle, ComposerProps>(
  function Composer(
    {
      markdownLayers,
      skills,
      skillsLoading,
      enableSkills = false,
      models,
      model,
      onModelChange,
      modelLocked = false,
      planMode,
      onPlanModeChange,
      submitMode = "enter",
      onEnter,
      onRemoveWhenEmpty,
      allowEmptySubmit = false,
      onSubmit,
      onChange,
      isStreaming = false,
      onStop,
      hideSend = false,
      placeholder = "Ask the agent...",
      className = "relative border-t border-border p-3",
    },
    ref
  ) {
    const [hasContent, setHasContent] = useState(false)
    const editorContainerRef = useRef<HTMLDivElement>(null)

    // The Mention extension's suggestion callbacks run inside closures captured
    // at editor-construction time, so they can't read these props directly —
    // funnel them through refs so the latest values are always visible.
    const markdownLayersRef = useRef<MarkdownLayerData[]>(markdownLayers)
    const skillsRef = useRef<SkillMenuItem[]>(skills ?? [])
    const skillsLoadingRef = useRef<boolean>(skillsLoading ?? false)

    // Tracks whether the mention popover is currently open. ProseMirror checks
    // direct `editorProps.handleKeyDown` before plugin props, so without this
    // flag our submit-on-Enter handler would fire before the Mention suggestion
    // plugin could consume the key to pick a doc.
    const mentionOpenRef = useRef(false)
    // Same idea for the `/` skill popover — Enter should pick the highlighted
    // skill, not submit the draft.
    const skillMentionOpenRef = useRef(false)

    // The keydown handler is captured once at editor construction, so the
    // current submit binding has to reach it through a ref rather than the prop.
    const submitModeRef = useRef(submitMode)
    useEffect(() => {
      submitModeRef.current = submitMode
    })

    // Same deferral for the bare-Enter handler: the keydown closure is captured
    // at construction, so the latest `onEnter` reaches it through a ref.
    const onEnterRef = useRef(onEnter)
    useEffect(() => {
      onEnterRef.current = onEnter
    })

    // Same deferral for the empty-Backspace handler.
    const onRemoveWhenEmptyRef = useRef(onRemoveWhenEmpty)
    useEffect(() => {
      onRemoveWhenEmptyRef.current = onRemoveWhenEmpty
    })

    // Whether the draft is currently empty — read synchronously by the
    // construction-time keydown handler (which can't see `editor` directly) to
    // decide if Backspace/Delete should pop the row.
    const isEmptyRef = useRef(true)

    // `onUpdate` is captured once at editor construction, so the live-draft
    // mirror reaches it through refs rather than the props directly — same
    // pattern as the submit handler below.
    const onChangeRef = useRef(onChange)
    useEffect(() => {
      onChangeRef.current = onChange
    })
    const modelRef = useRef(model)
    useEffect(() => {
      modelRef.current = model
    })

    // Keep the latest sources in refs (written after commit, not during render)
    // so the editor's suggestion closures always see the current lists.
    useEffect(() => {
      markdownLayersRef.current = markdownLayers
    })
    useEffect(() => {
      skillsRef.current = skills ?? []
    })
    useEffect(() => {
      skillsLoadingRef.current = skillsLoading ?? false
    })

    // Build the editor once. The mention extension's suggestion handlers read
    // through refs so they always see the latest sources and submit handler.
    const editor = useEditor({
      extensions: [
        StarterKit.configure({
          // Disable the marks/blocks we don't want to expose in the chat draft
          // — chat is plaintext on the wire, mentions are the only inline
          // structure we keep.
          heading: false,
          blockquote: false,
          bulletList: false,
          orderedList: false,
          listItem: false,
          codeBlock: false,
          horizontalRule: false,
          dropcursor: false,
        }),
        Mention.configure({
          HTMLAttributes: {
            class:
              "mention-doc-pill inline-flex items-center gap-1 rounded bg-primary/10 px-1 py-0.5 text-primary",
          },
          renderText({ node }) {
            const label =
              (node.attrs.label as string | undefined) ?? node.attrs.id
            if (node.attrs.mentionSuggestionChar === "/")
              return serializeSkill(label)
            return `@${label}`
          },
          renderHTML({ options, node }) {
            const label =
              (node.attrs.label as string | undefined) ??
              (node.attrs.id as string)
            if (node.attrs.mentionSuggestionChar === "/") {
              return [
                "span",
                {
                  ...options.HTMLAttributes,
                  class:
                    "mention-skill-pill inline-flex items-center gap-1 rounded bg-violet-500/15 px-1 py-0.5 font-medium text-violet-600 dark:text-violet-300",
                },
                `/${label}`,
              ]
            }
            return ["span", options.HTMLAttributes, label]
          },
          deleteTriggerWithBackspace: true,
          // Two pickers on one extension: `@` for canvas docs (fires anywhere)
          // and, when `enableSkills` is set, `/` for explicit Skill invocation
          // (start-of-input, one per message). v3 tags each node with the
          // matching `mentionSuggestionChar` so the renderers above can tell
          // them apart.
          suggestions: [
            // The getters below read these refs lazily — the Mention extension
            // invokes them at suggestion-time (long after commit), never during
            // render — so the ref reads are deferred and safe here.
            // eslint-disable-next-line react-hooks/refs
            buildLayerMentionSuggestion({
              getMarkdownLayers: () => markdownLayersRef.current,
              getAnchorRect: () =>
                editorContainerRef.current?.getBoundingClientRect() ?? null,
              onOpenChange: (open) => {
                mentionOpenRef.current = open
              },
            }),
            ...(enableSkills
              ? [
                  // Same deferred-read reasoning as the layer suggestion above:
                  // these ref reads happen at suggestion-time, not during render.
                  // eslint-disable-next-line react-hooks/refs
                  buildSkillMentionSuggestion({
                    getSkills: () => skillsRef.current,
                    getLoading: () => skillsLoadingRef.current,
                    getAnchorRect: () =>
                      editorContainerRef.current?.getBoundingClientRect() ??
                      null,
                    onOpenChange: (open) => {
                      skillMentionOpenRef.current = open
                    },
                  }),
                ]
              : []),
          ],
        }),
      ],
      immediatelyRender: false,
      editorProps: {
        attributes: {
          class:
            "tiptap min-h-[40px] max-h-48 overflow-y-auto px-2.5 py-2.5 text-sm focus:outline-none",
          "data-placeholder": placeholder,
        },
        handleKeyDown(_view, event) {
          // ProseMirror checks direct editorProps before plugin props, so the
          // mention suggestion plugin hasn't had a chance to consume the key
          // yet — bail so it can pick the highlighted doc / delete a trigger
          // instead of us acting on it.
          if (mentionOpenRef.current || skillMentionOpenRef.current)
            return false
          // Backspace/Delete on an already-empty draft pops the row (the New
          // Workspace dialog), so a cleared row is one keystroke from gone.
          if (
            (event.key === "Backspace" || event.key === "Delete") &&
            onRemoveWhenEmptyRef.current &&
            isEmptyRef.current
          ) {
            event.preventDefault()
            onRemoveWhenEmptyRef.current()
            return true
          }
          if (event.key !== "Enter") return false
          if (submitModeRef.current === "mod-enter") {
            // Seed binding: ⌘/Ctrl+Enter creates. A bare Enter fires the
            // optional `onEnter` (the dialog's "Add another"); Shift+Enter, or
            // no handler, falls through to ProseMirror as a newline.
            if (!event.metaKey && !event.ctrlKey) {
              if (event.shiftKey || !onEnterRef.current) return false
              event.preventDefault()
              onEnterRef.current()
              return true
            }
          } else if (event.shiftKey) {
            // Chat binding: Shift+Enter is a newline.
            return false
          }
          event.preventDefault()
          submitRef.current()
          return true
        },
      },
      onUpdate: ({ editor }) => {
        isEmptyRef.current = editor.isEmpty
        setHasContent(!editor.isEmpty)
        // Mirror the live draft to any caller tracking it (the New Workspace
        // dialog's collapsed-row preview). Reads markdownLayers/model through
        // refs so this construction-time closure always serializes the latest.
        onChangeRef.current?.({
          text: serializeDraft(editor, markdownLayersRef.current),
          model: modelRef.current,
        })
      },
    })

    const handleSubmit = useCallback(() => {
      if (!editor || isStreaming) return
      // An empty draft only submits where the caller opted in — the seed
      // Composer treats it as a deliberate request for a bare scratch Branch.
      if (editor.isEmpty && !allowEmptySubmit) return
      const decorated = serializeDraft(editor, markdownLayersRef.current)
      if (!decorated && !allowEmptySubmit) return
      onSubmit({ text: decorated, model })
      editor.commands.clearContent()
      isEmptyRef.current = true
      setHasContent(false)
    }, [editor, isStreaming, onSubmit, model, allowEmptySubmit])

    // Stash the latest submit handler in a ref so the editor's `handleKeyDown`
    // (registered once at construction) always calls the current closure.
    const submitRef = useRef(handleSubmit)
    useEffect(() => {
      submitRef.current = handleSubmit
    }, [handleSubmit])

    useImperativeHandle(
      ref,
      () => ({
        insertText: (text: string) => {
          if (!editor) return
          const prefix = editor.isEmpty ? "" : "\n\n"
          editor.chain().focus("end").insertContent(`${prefix}${text}`).run()
        },
        focus: () => editor?.chain().focus("end").run(),
      }),
      [editor]
    )

    const currentModel = models.find((m) => m.id === model) ?? {
      id: model,
      label: model || "Loading…",
    }

    const modelGroups = useMemo(() => groupModelsByProvider(models), [models])

    return (
      <div ref={editorContainerRef} className={className}>
        <InputGroup className="has-disabled:bg-transparent has-disabled:opacity-100 dark:has-disabled:bg-input/30">
          <EmptyAwarePlaceholder editor={editor} text={placeholder} />
          <EditorContent editor={editor} className="w-full" />
          <InputGroupAddon align="block-end" className="gap-0.5">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <InputGroupButton
                  size="xs"
                  className="-ml-1 text-xs"
                  disabled={modelLocked}
                  title={
                    modelLocked
                      ? "Model is locked to this session"
                      : "Change model"
                  }
                >
                  {currentModel.label}
                  <ChevronDown />
                </InputGroupButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                {models.length === 0 ? (
                  <DropdownMenuItem disabled>Loading…</DropdownMenuItem>
                ) : (
                  modelGroups.map((group, idx) => (
                    <div key={group.key}>
                      {idx > 0 && <DropdownMenuSeparator />}
                      <DropdownMenuLabel className="text-xs text-muted-foreground">
                        {group.label}
                      </DropdownMenuLabel>
                      {group.models.map((m) => (
                        <DropdownMenuItem
                          key={m.id}
                          onSelect={() => onModelChange(m.id)}
                        >
                          <span className="flex-1">{m.label}</span>
                          {m.id === model && <Check className="size-3.5" />}
                        </DropdownMenuItem>
                      ))}
                    </div>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            {onPlanModeChange && (
              <InputGroupButton
                size="xs"
                variant={planMode ? "default" : "ghost"}
                onClick={() => onPlanModeChange(!planMode)}
                title={planMode ? "Plan mode enabled" : "Enable plan mode"}
                className="text-xs"
              >
                <ClipboardList />
                Plan
              </InputGroupButton>
            )}
            {hideSend ? null : isStreaming && onStop ? (
              <InputGroupButton
                size="icon-xs"
                variant="secondary"
                onClick={onStop}
                title="Stop"
                className="ml-auto"
              >
                <Square fill="currentColor" />
              </InputGroupButton>
            ) : (
              <InputGroupButton
                size="icon-xs"
                variant={hasContent || allowEmptySubmit ? "default" : "ghost"}
                onClick={handleSubmit}
                disabled={(!hasContent && !allowEmptySubmit) || isStreaming}
                title="Send"
                className="ml-auto"
              >
                <ArrowUp />
              </InputGroupButton>
            )}
          </InputGroupAddon>
        </InputGroup>
      </div>
    )
  }
)

/**
 * Show the textarea-style placeholder when the TipTap editor is empty.
 * Rendered as a sibling so it can sit absolutely on top of the empty
 * editor without interfering with caret positioning. We attach our own
 * subscription to the editor's `update` event since the placeholder
 * extension's CSS approach doesn't compose with the prose styles.
 */
function EmptyAwarePlaceholder({
  editor,
  text,
}: {
  editor: Editor | null
  text: string
}) {
  const [empty, setEmpty] = useState(true)

  // Seed the empty state from the editor during render (and re-seed when the
  // editor instance changes) instead of in the effect, which would call
  // setState synchronously on mount. The subscription below keeps it in sync.
  const [lastEditor, setLastEditor] = useState(editor)
  if (editor !== lastEditor) {
    setLastEditor(editor)
    setEmpty(editor ? editor.isEmpty : true)
  }

  useEffect(() => {
    if (!editor) return undefined
    const update = () => setEmpty(editor.isEmpty)
    editor.on("update", update)
    editor.on("create", update)
    return () => {
      editor.off("update", update)
      editor.off("create", update)
    }
  }, [editor])

  if (!empty) return null
  return (
    <div className="pointer-events-none absolute top-0 left-0 px-2.5 py-2.5 text-sm text-muted-foreground">
      {text}
    </div>
  )
}
