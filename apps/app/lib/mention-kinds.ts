import {
  type Icon,
  ChatCircleIcon,
  FileTextIcon,
  ScribbleIcon,
} from "@workspace/ui/components/icons"
import { workspaceLabel } from "@/lib/workspace-label"
import type {
  BranchData,
  ChatSessionData,
  MarkdownLayerData,
  MockupLayerData,
} from "@/lib/types"

/**
 * **Mention kinds**: the one place that says what a Document mention can
 * point at. The `@` list, the pill's node view, the rendered HTML, the
 * Document Markdown codec (`document-markdown.ts`) and the agent tools'
 * descriptions all read {@link MENTION_KIND_REGISTRY}, so a new kind is one
 * entry here plus its icon mask in `globals.css`.
 *
 * Isomorphic: the editor and the agent tools both import it.
 */

/** Looks up the things a mention can point at, by id. */
export interface MentionTargets {
  document: (id: string) => { title: string } | undefined
  mockup: (id: string) => { title: string } | undefined
  workspace: (id: string) => { title?: string } | undefined
  chat: (id: string) => { label: string } | undefined
}

/**
 * A canvas's lists of the things a mention can point at. A list left out
 * offers nothing: the composer passes only its documents.
 */
export interface MentionSources {
  documents?: readonly Pick<MarkdownLayerData, "id" | "title">[]
  branches?: readonly Pick<BranchData, "id" | "title">[]
  chatSessions?: readonly Pick<ChatSessionData, "id" | "label" | "target">[]
  mockups?: readonly Pick<MockupLayerData, "id" | "title">[]
}

export interface MentionKindSpec {
  /** The kind's group heading in the `@` list. */
  heading: string
  /** The icon its rows in the `@` list show. */
  Icon: Icon
  /** The `.inline-ref` icon mask (`globals.css`) its pill draws. */
  mask: string
  /** How the kind reads in a mention's markdown: `mention:<name>:<id>`. */
  markdownName: string
  /** What a canvas offers to mention of this kind, as `{ id, label }`. */
  candidates: (sources: MentionSources) => { id: string; label: string }[]
  /** The live name of what a mention points at; undefined when it's gone. */
  labelOf: (id: string, targets: MentionTargets) => string | undefined
}

const registry = {
  "markdown-layer": {
    heading: "Documents",
    Icon: FileTextIcon,
    mask: "document",
    markdownName: "document",
    candidates: (s) =>
      (s.documents ?? []).map((d) => ({
        id: d.id,
        label: d.title || "Untitled",
      })),
    labelOf: (id, t) => t.document(id)?.title || undefined,
  },
  // A chat is a Workspace's (its id is the Branch's, named as the Chats menu
  // names it) or a chat with no repository (its own id). The Coordinator
  // isn't one.
  chat: {
    heading: "Chats",
    Icon: ChatCircleIcon,
    mask: "chat",
    markdownName: "chat",
    candidates: (s) => [
      ...(s.branches ?? []).map((b) => ({
        id: b.id,
        label: workspaceLabel(b),
      })),
      ...(s.chatSessions ?? [])
        .filter((c) => c.target === "sketch")
        .map((c) => ({ id: c.id, label: c.label })),
    ],
    labelOf: (id, t) => {
      const workspace = t.workspace(id)
      if (workspace) return workspaceLabel(workspace)
      return t.chat(id)?.label || undefined
    },
  },
  "mockup-layer": {
    heading: "Mockups",
    Icon: ScribbleIcon,
    mask: "mockup",
    markdownName: "mockup",
    candidates: (s) =>
      (s.mockups ?? []).map((m) => ({
        id: m.id,
        label: m.title || "Untitled",
      })),
    labelOf: (id, t) => t.mockup(id)?.title || undefined,
  },
} satisfies Record<string, MentionKindSpec>

/** What a mention points at: a document, a chat or a mockup. */
export type MentionKind = keyof typeof registry

/** Every mention kind, in the order the `@` list groups them. */
export const MENTION_KIND_REGISTRY: Record<MentionKind, MentionKindSpec> =
  registry

/** The registered kinds, in the `@` list's group order. */
export const MENTION_KINDS = Object.keys(registry) as MentionKind[]

/**
 * What a mention with no kind reads as: one saved before kinds existed, or
 * the composer's `[@<name>](mention:<id>)`.
 */
export const DEFAULT_MENTION_KIND: MentionKind = "markdown-layer"

function isMentionKind(kind: unknown): kind is MentionKind {
  return typeof kind === "string" && Object.hasOwn(registry, kind)
}

/** A mention node's kind; one with no known kind is a document. */
export function mentionKindOf(kind: unknown): MentionKind {
  return isMentionKind(kind) ? kind : DEFAULT_MENTION_KIND
}

/** The kind a markdown name (`document`, `chat`, …) stands for. */
export function mentionKindOfMarkdown(name: string): MentionKind | undefined {
  return MENTION_KINDS.find((k) => registry[k].markdownName === name)
}

/** The kinds' markdown names as prose: "`document`, `chat` or `mockup`". */
export function mentionMarkdownNames(): string {
  const names = MENTION_KINDS.map((k) => `\`${registry[k].markdownName}\``)
  return names.length > 1
    ? `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`
    : (names[0] ?? "")
}

/**
 * The live name of what a mention points at, so a mention follows a rename;
 * undefined when it's gone or unnamed.
 */
export function mentionTargetLabel(
  kind: MentionKind,
  id: string,
  targets: MentionTargets
): string | undefined {
  return registry[kind].labelOf(id, targets)
}

/** One thing a mention can point at, as the `@` list offers it. */
export interface MentionCandidate {
  kind: MentionKind
  id: string
  label: string
}

/**
 * Everything `sources` offers to mention, every kind in registry order,
 * leaving out `excludeId` (a Document never mentions itself).
 */
export function mentionCandidates(
  sources: MentionSources,
  { excludeId }: { excludeId?: string } = {}
): MentionCandidate[] {
  return MENTION_KINDS.flatMap((kind) =>
    registry[kind]
      .candidates(sources)
      .filter((c) => c.id !== excludeId)
      .map((c) => ({ kind, ...c }))
  )
}
