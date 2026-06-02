"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowUp,
  Loader2,
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
import { getSkillMenuItems, type SkillMenuItem } from "@/lib/skills-store"
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
import { useAgentChat } from "@/hooks/use-agent-chat"
import { AgentMessageItem } from "./agent-message"
import type { AgentMessage } from "@/lib/agent/types"
import {
  buildReferencedDocsFooter,
  serializeMention,
  serializeSkill,
} from "@/lib/agent/message-markers"
import { inputStore } from "@/lib/input-store"
import {
  getDefaultModelId,
  getModels,
  type ModelInfo,
} from "@/lib/models-store"
import { useMarkdownLayers } from "@/lib/yjs/react"
import type { MarkdownLayerData } from "@/lib/types"

const LAST_MODEL_STORAGE_KEY = "agent-last-model"

function readStoredModel(): string | null {
  if (typeof window === "undefined") return null
  try {
    return window.localStorage.getItem(LAST_MODEL_STORAGE_KEY)
  } catch {
    return null
  }
}

function writeStoredModel(modelId: string) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(LAST_MODEL_STORAGE_KEY, modelId)
  } catch {}
}

/**
 * Group models by their origin provider (Anthropic, OpenAI, Vercel AI
 * Gateway, …) so the dropdown surfaces them under headings the user can
 * scan. Preserves the registry's order both at the group level (which
 * provider showed up first in `enumerateModels`) and within each group.
 */
function groupModelsByProvider(models: ModelInfo[]) {
  const order: string[] = []
  const byKey = new Map<
    string,
    { key: string; label: string; models: ModelInfo[] }
  >()
  for (const m of models) {
    let group = byKey.get(m.provider.key)
    if (!group) {
      group = { key: m.provider.key, label: m.provider.label, models: [] }
      byKey.set(m.provider.key, group)
      order.push(m.provider.key)
    }
    group.models.push(m)
  }
  return order.map((k) => byKey.get(k)!)
}

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
function extractTextAndMentions(json: JSONContent | undefined): {
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

interface AgentChatProps {
  chatId: string
  roomId: string
  /** Sandbox-backed target. Either this or `markdownLayerId` is set. */
  sandboxId?: string
  sandboxName?: string
  branch?: string
  /** Document-layer target. */
  markdownLayerId?: string
  isFirstChat?: boolean
  autoNamedBranch?: boolean
  planMode?: boolean
  onPlanModeChange?: (planMode: boolean) => void
  model?: string
  onModelChange?: (model: string) => void
  onBranchRename?: (branch: string) => void
  onChatRename?: (label: string) => void
}

export function AgentChat({
  chatId,
  roomId,
  sandboxName,
  branch,
  markdownLayerId,
  isFirstChat,
  autoNamedBranch,
  planMode,
  onPlanModeChange,
  model,
  onModelChange,
  onBranchRename,
  onChatRename,
}: AgentChatProps) {
  const { messages, isStreaming, isLoadingHistory, sendMessage, stopMessage } =
    useAgentChat({
      chatId,
      roomId,
      sandboxName,
      branch,
      markdownLayerId,
      isFirstChat,
      autoNamedBranch,
      planMode,
      onBranchRename,
      onChatRename,
    })

  const [models, setModels] = useState<ModelInfo[]>([])
  const [serverDefaultModel, setServerDefaultModel] = useState<string | null>(
    null
  )
  // Read the last-used model from localStorage during render (SSR-safe — the
  // reader returns null when `window` is undefined) rather than syncing it in
  // via an effect, which would trigger a cascading render on mount.
  const [storedModel, setStoredModel] = useState<string | null>(readStoredModel)
  const [hasContent, setHasContent] = useState(false)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const scrollContentRef = useRef<HTMLDivElement>(null)
  const editorContainerRef = useRef<HTMLDivElement>(null)

  const markdownLayers = useMarkdownLayers()

  // The `/` skill menu is scoped to sandbox-backed Agent chats: Document /
  // Markdown-Layer chats have no sandbox to enumerate, no `read_skill` tool,
  // and their toolset is editorial — so `/` stays a literal slash there.
  const isAgentChat = !markdownLayerId
  const composerPlaceholder = isAgentChat
    ? "Ask the agent... (@ document, / skill)"
    : "Ask the agent... (@ to mention a document)"

  // The Mention extension's `suggestion.items` callback runs inside a closure
  // captured at editor-construction time, so it can't read these arrays
  // directly — funnel through refs so the latest list is always visible.
  const markdownLayersRef = useRef<MarkdownLayerData[]>(markdownLayers)

  // Merged App ∪ Repo Skill index for the `/` menu, fetched once on chat open
  // (see effect below) and read through a ref for the same closure reason as
  // above. `skillsLoadingRef` drives the menu's loading state until the
  // per-Branch index lands.
  const skillsRef = useRef<SkillMenuItem[]>([])
  const skillsLoadingRef = useRef(true)

  // Tracks whether the mention popover is currently open. ProseMirror checks
  // direct `editorProps.handleKeyDown` before plugin props, so without this
  // flag our submit-on-Enter handler would fire before the Mention suggestion
  // plugin could consume the key to pick a doc.
  const mentionOpenRef = useRef(false)
  // Same idea for the `/` skill popover — Enter should pick the highlighted
  // skill, not submit the draft.
  const skillMentionOpenRef = useRef(false)

  // Keep the latest markdownLayers in a ref (written after commit, not during
  // render) so the editor's suggestion closures always see the current list.
  useEffect(() => {
    markdownLayersRef.current = markdownLayers
  })

  // Keep the message list pinned to the bottom as content resolves —
  // react-markdown / code blocks / streaming tokens all grow the height
  // asynchronously, so a single scrollTo after a `messages` update lands
  // short of the new bottom. A ResizeObserver on the content wrapper
  // catches every height change.
  //
  // The first reveal (initial mount, or the panel transitioning from a
  // collapsed 0px state to visible) jumps instantly so opening the chat
  // doesn't animate from the top. Subsequent growth scrolls smoothly,
  // but only when the user is already near the bottom — so manually
  // scrolling up to read history isn't yanked away by streaming output.
  useEffect(() => {
    const container = scrollContainerRef.current
    const content = scrollContentRef.current
    if (!container || !content) return
    let lastClientHeight = 0
    const observer = new ResizeObserver(() => {
      const clientHeight = container.clientHeight
      if (clientHeight === 0) {
        lastClientHeight = 0
        return
      }
      const isFirstReveal = lastClientHeight === 0
      lastClientHeight = clientHeight
      const distance =
        container.scrollHeight - container.scrollTop - clientHeight
      if (!isFirstReveal && distance > 64) return
      container.scrollTo({
        top: container.scrollHeight,
        behavior: isFirstReveal ? "auto" : "smooth",
      })
    })
    observer.observe(content)
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    let cancelled = false
    Promise.all([getModels(), getDefaultModelId()])
      .then(([list, def]) => {
        if (cancelled) return
        setModels(list)
        setServerDefaultModel(def)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // Load the merged App ∪ Repo Skill index once on chat open (Agent chats
  // only). Keyed by sandbox so reopening after editing a Repo Skill refetches
  // the Branch's current list.
  useEffect(() => {
    if (!isAgentChat) return undefined
    let cancelled = false
    skillsLoadingRef.current = true
    getSkillMenuItems(sandboxName)
      .then((skills) => {
        if (!cancelled) skillsRef.current = skills
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) skillsLoadingRef.current = false
      })
    return () => {
      cancelled = true
    }
  }, [isAgentChat, sandboxName])

  // Build the editor once. The mention extension's suggestion handler reads
  // through refs so it always sees the latest markdownLayers and submit handler.
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
        // and, in Agent chats only, `/` for explicit Skill invocation
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
          ...(isAgentChat
            ? [
                // Same deferred-read reasoning as the layer suggestion above:
                // these ref reads happen at suggestion-time, not during render.
                // eslint-disable-next-line react-hooks/refs
                buildSkillMentionSuggestion({
                  getSkills: () => skillsRef.current,
                  getLoading: () => skillsLoadingRef.current,
                  getAnchorRect: () =>
                    editorContainerRef.current?.getBoundingClientRect() ?? null,
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
          "tiptap min-h-[40px] max-h-48 overflow-y-auto px-3 py-2 text-xs focus:outline-none",
        "data-placeholder": composerPlaceholder,
      },
      handleKeyDown(_view, event) {
        if (event.key !== "Enter" || event.shiftKey) return false
        // ProseMirror checks direct editorProps before plugin props, so the
        // mention suggestion plugin hasn't had a chance to consume Enter
        // yet — bail so it can pick the highlighted doc instead of us
        // submitting the draft with a literal `@query` token.
        if (mentionOpenRef.current || skillMentionOpenRef.current) return false
        event.preventDefault()
        submitRef.current()
        return true
      },
    },
    onUpdate: ({ editor }) => {
      setHasContent(!editor.isEmpty)
    },
  })

  // Precedence: per-chat override (set by `onModelChange`) → user's stored
  // last-used model from localStorage → server-side default for the
  // configured provider set. The string is "" while the catalog is still
  // loading so the dropdown can render a "Loading…" placeholder rather than
  // a stale id from a different deployment's provider.
  const effectiveModel = model ?? storedModel ?? serverDefaultModel ?? ""

  const handleModelChange = useCallback(
    (m: string) => {
      writeStoredModel(m)
      setStoredModel(m)
      onModelChange?.(m)
    },
    [onModelChange]
  )

  const handleSubmit = useCallback(() => {
    if (!editor || isStreaming) return
    if (editor.isEmpty) return
    const json = editor.getJSON()
    const { text, mentions } = extractTextAndMentions(json)
    if (!text.trim()) return
    // Resolve each `@<title>` mention to its current title, then let the
    // Message Markers codec build the referenced-documents footer (a no-op
    // suffix when there are no mentions). Bodies are NOT inlined — the agent
    // loop fetches live state via `read_document(id)` on demand.
    const docs = mentions.map((m) => ({
      id: m.id,
      title: markdownLayersRef.current.find((d) => d.id === m.id)?.title,
    }))
    const decorated = text.trim() + buildReferencedDocsFooter(docs)
    sendMessage(decorated, { model: effectiveModel })
    editor.commands.clearContent()
    setHasContent(false)
  }, [editor, isStreaming, sendMessage, effectiveModel])

  // Stash the latest submit handler in a ref so the editor's
  // `handleKeyDown` (registered once at construction) always calls the
  // current closure.
  const submitRef = useRef(handleSubmit)
  useEffect(() => {
    submitRef.current = handleSubmit
  }, [handleSubmit])

  // Allow other parts of the app (e.g. the inspect tool) to append text
  // snippets to this chat's draft.
  useEffect(() => {
    if (!editor) return undefined
    return inputStore.subscribe(chatId, (text) => {
      const prefix = editor.isEmpty ? "" : "\n\n"
      editor.chain().focus("end").insertContent(`${prefix}${text}`).run()
    })
  }, [chatId, editor])

  // Allow shortcut actions (e.g. the Create PR button) to send a message directly.
  useEffect(() => {
    return inputStore.subscribeSend(chatId, (text) => {
      sendMessage(text, { model: effectiveModel })
    })
  }, [chatId, sendMessage, effectiveModel])

  // Once a chat has at least one message in its log, the model used for the
  // first turn is locked — switching mid-conversation can confuse the
  // existing tool-call/result message pairs.
  const modelLocked = messages.length > 0

  const currentModel = models.find((m) => m.id === effectiveModel) ?? {
    id: effectiveModel,
    label: effectiveModel || "Loading…",
  }

  const modelGroups = useMemo(() => groupModelsByProvider(models), [models])

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Messages */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
        <div ref={scrollContentRef} className="flex min-h-full flex-col p-3">
          {isLoadingHistory ? (
            <div className="m-auto">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : messages.length === 0 ? (
            <p className="m-auto text-center text-xs text-muted-foreground">
              Ask the AI to make changes to your app.
              <br />
              It can read, edit, and run commands in the sandbox.
            </p>
          ) : (
            <div className="space-y-3">
              {messages.map((msg, i) => {
                if (msg.role === "tool_use") {
                  const result = messages
                    .slice(i + 1)
                    .find(
                      (m): m is AgentMessage & { role: "tool_result" } =>
                        m.role === "tool_result" && m.name === msg.name
                    )
                  return (
                    <AgentMessageItem
                      key={i}
                      message={msg}
                      toolResult={result}
                      roomId={roomId}
                      chatId={chatId}
                    />
                  )
                }
                return (
                  <AgentMessageItem
                    key={i}
                    message={msg}
                    roomId={roomId}
                    chatId={chatId}
                  />
                )
              })}
              {isStreaming &&
                messages[messages.length - 1]?.role !== "assistant" && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Thinking...
                  </div>
                )}
            </div>
          )}
        </div>
      </div>

      {/* Input */}
      <div
        ref={editorContainerRef}
        className="relative border-t border-border p-3"
      >
        <InputGroup className="has-disabled:bg-transparent has-disabled:opacity-100 dark:has-disabled:bg-input/30">
          <EmptyAwarePlaceholder editor={editor} text={composerPlaceholder} />
          <EditorContent editor={editor} className="w-full" />
          <InputGroupAddon align="block-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <InputGroupButton
                  size="xs"
                  className="text-xs"
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
                          onSelect={() => handleModelChange(m.id)}
                        >
                          <span className="flex-1">{m.label}</span>
                          {m.id === effectiveModel && (
                            <Check className="size-3.5" />
                          )}
                        </DropdownMenuItem>
                      ))}
                    </div>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <InputGroupButton
              size="xs"
              variant={planMode ? "default" : "ghost"}
              onClick={() => onPlanModeChange?.(!planMode)}
              title={planMode ? "Plan mode enabled" : "Enable plan mode"}
              className="text-xs"
            >
              <ClipboardList />
              Plan
            </InputGroupButton>
            {isStreaming ? (
              <InputGroupButton
                size="icon-xs"
                variant="secondary"
                onClick={stopMessage}
                title="Stop"
                className="ml-auto"
              >
                <Square fill="currentColor" />
              </InputGroupButton>
            ) : (
              <InputGroupButton
                size="icon-xs"
                variant={hasContent ? "default" : "ghost"}
                onClick={handleSubmit}
                disabled={!hasContent}
                title="Send"
                className="ml-auto"
              >
                <ArrowUp />
              </InputGroupButton>
            )}
          </InputGroupAddon>
        </InputGroup>
      </div>
    </div>
  )
}

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
    <div className="pointer-events-none absolute top-0 left-0 px-3 py-2 text-xs text-muted-foreground">
      {text}
    </div>
  )
}
