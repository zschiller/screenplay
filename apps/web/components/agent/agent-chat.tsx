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
import { inputStore } from "@/lib/input-store"
import { getDefaultModelId, getModels, type ModelInfo } from "@/lib/models-store"
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
 *  - `text`: plain-text rendering, with each mention serialized as
 *    `[@<label>](mention:<id>)` so the user-message renderer can recover it
 *    as a chip.
 *  - `mentions`: deduplicated `{ id }` list.
 * Block boundaries (paragraphs, headings, list items) become newlines.
 */
function extractTextAndMentions(json: JSONContent | undefined): {
  text: string
  mentions: Array<{ id: string }>
} {
  if (!json) return { text: "", mentions: [] }
  const out: string[] = []
  const mentions: Array<{ id: string }> = []
  const seen = new Set<string>()

  const visit = (node: JSONContent, depth: number) => {
    if (node.type === "text") {
      if (typeof node.text === "string") out.push(node.text)
      return
    }
    if (node.type === "mention") {
      const id = node.attrs?.id as string | undefined
      const label = (node.attrs?.label as string | undefined) ?? id ?? ""
      out.push(`[@${label}](mention:${id ?? ""})`)
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
  return { text: out.join("").replace(/\n{3,}/g, "\n\n").trim(), mentions }
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
  const {
    messages,
    isStreaming,
    isLoadingHistory,
    sendMessage,
    stopMessage,
  } = useAgentChat({ chatId, roomId, sandboxName, branch, markdownLayerId, isFirstChat, autoNamedBranch, planMode, onBranchRename, onChatRename })

  const [models, setModels] = useState<ModelInfo[]>([])
  const [serverDefaultModel, setServerDefaultModel] = useState<string | null>(null)
  const [storedModel, setStoredModel] = useState<string | null>(null)
  const [hasContent, setHasContent] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const editorContainerRef = useRef<HTMLDivElement>(null)

  const markdownLayers = useMarkdownLayers()

  // The Mention extension's `suggestion.items` callback runs inside a closure
  // captured at editor-construction time, so it can't read these arrays
  // directly — funnel through refs so the latest list is always visible.
  const markdownLayersRef = useRef<MarkdownLayerData[]>(markdownLayers)
  markdownLayersRef.current = markdownLayers

  // Tracks whether the mention popover is currently open. ProseMirror checks
  // direct `editorProps.handleKeyDown` before plugin props, so without this
  // flag our submit-on-Enter handler would fire before the Mention suggestion
  // plugin could consume the key to pick a doc.
  const mentionOpenRef = useRef(false)

  useEffect(() => {
    setStoredModel(readStoredModel())
  }, [])

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

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
          const label = (node.attrs.label as string | undefined) ?? node.attrs.id
          return `@${label}`
        },
        renderHTML({ options, node }) {
          const label =
            (node.attrs.label as string | undefined) ?? (node.attrs.id as string)
          return ["span", options.HTMLAttributes, label]
        },
        deleteTriggerWithBackspace: true,
        suggestion: buildLayerMentionSuggestion({
          getMarkdownLayers: () => markdownLayersRef.current,
          getAnchorRect: () =>
            editorContainerRef.current?.getBoundingClientRect() ?? null,
          onOpenChange: (open) => {
            mentionOpenRef.current = open
          },
        }),
      }),
    ],
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          "tiptap min-h-[40px] max-h-48 overflow-y-auto px-3 py-2 text-xs focus:outline-none",
        "data-placeholder": "Ask the agent... (@ to mention a document)",
      },
      handleKeyDown(_view, event) {
        if (event.key !== "Enter" || event.shiftKey) return false
        // ProseMirror checks direct editorProps before plugin props, so the
        // mention suggestion plugin hasn't had a chance to consume Enter
        // yet — bail so it can pick the highlighted doc instead of us
        // submitting the draft with a literal `@query` token.
        if (mentionOpenRef.current) return false
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
    [onModelChange],
  )

  /**
   * Append a "Referenced layers" footer to the user message listing each
   * `@<title>` mention's id. Bodies are NOT inlined — the agent loop has the
   * `read_document` tool available across every chat target, so the model
   * fetches the live state on demand. This keeps chat history bounded and
   * avoids stale snapshots when a layer the user mentioned earlier is later
   * edited.
   */
  const formatMentionFooter = useCallback(
    (text: string, mentions: Array<{ id: string }>): string => {
      if (mentions.length === 0) return text
      const lines: string[] = []
      for (const m of mentions) {
        const title = markdownLayersRef.current.find((d) => d.id === m.id)?.title
        lines.push(`- markdown-layer ${m.id}: ${title || "Untitled"}`)
      }
      return [
        text,
        "",
        "---",
        "",
        "Referenced layers (call `read_document` with the id to load contents):",
        ...lines,
      ].join("\n")
    },
    [],
  )

  const handleSubmit = useCallback(() => {
    if (!editor || isStreaming) return
    if (editor.isEmpty) return
    const json = editor.getJSON()
    const { text, mentions } = extractTextAndMentions(json)
    if (!text.trim()) return
    const decorated = formatMentionFooter(text.trim(), mentions)
    sendMessage(decorated, { model: effectiveModel })
    editor.commands.clearContent()
    setHasContent(false)
  }, [editor, isStreaming, sendMessage, effectiveModel, formatMentionFooter])

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
      editor
        .chain()
        .focus("end")
        .insertContent(`${prefix}${text}`)
        .run()
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
      <div className="flex-1 overflow-y-auto p-3">
        {isLoadingHistory ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-center text-xs text-muted-foreground">
              Ask the AI to make changes to your app.
              <br />
              It can read, edit, and run commands in the sandbox.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((msg, i) => {
              if (msg.role === "tool_use") {
                const result = messages.slice(i + 1).find(
                  (m): m is AgentMessage & { role: "tool_result" } =>
                    m.role === "tool_result" && m.name === msg.name
                )
                return <AgentMessageItem key={i} message={msg} toolResult={result} roomId={roomId} chatId={chatId} />
              }
              return <AgentMessageItem key={i} message={msg} roomId={roomId} chatId={chatId} />
            })}
            {isStreaming && messages[messages.length - 1]?.role !== "assistant" && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Thinking...
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <div ref={editorContainerRef} className="relative border-t border-border p-3">
        <InputGroup className="has-disabled:bg-transparent has-disabled:opacity-100 dark:has-disabled:bg-input/30">
          <EmptyAwarePlaceholder editor={editor} />
          <EditorContent editor={editor} className="w-full" />
          <InputGroupAddon align="block-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <InputGroupButton
                  size="xs"
                  className="text-xs"
                  disabled={modelLocked}
                  title={modelLocked ? "Model is locked to this session" : "Change model"}
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
                          {m.id === effectiveModel && <Check className="size-3.5" />}
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
function EmptyAwarePlaceholder({ editor }: { editor: Editor | null }) {
  const [empty, setEmpty] = useState(true)

  useEffect(() => {
    if (!editor) return undefined
    setEmpty(editor.isEmpty)
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
    <div className="pointer-events-none absolute left-0 top-0 px-3 py-2 text-xs text-muted-foreground">
      Ask the agent... (@ to mention a document)
    </div>
  )
}
