import * as Y from "yjs"
import { getSchema, type AnyExtension, type JSONContent } from "@tiptap/core"
import StarterKit from "@tiptap/starter-kit"
import Document from "@tiptap/extension-document"
import Mention from "@tiptap/extension-mention"
import { MarkdownManager } from "@tiptap/markdown"
import {
  prosemirrorJSONToYXmlFragment,
  yXmlFragmentToProsemirrorJSON,
} from "@tiptap/y-tiptap"
import { DocumentImage, liftImagesFromParagraphs } from "@/lib/document-image"
import { mockupEmbedId } from "@/lib/document-embed"
import {
  DEFAULT_MENTION_KIND,
  MENTION_KIND_REGISTRY,
  MENTION_KINDS,
  type MentionKind,
  type MentionTargets,
  mentionKindOf,
  mentionKindOfMarkdown,
  mentionTargetLabel,
} from "@/lib/mention-kinds"
import type { RoomCollections } from "@/lib/yjs/schema"
import { layerFileOf } from "@/lib/yjs/file-views"
import type { LayerFileKind } from "@/lib/types"

/**
 * **Document Markdown**: the one way a Document's body becomes markdown and
 * back. Agents read a body with {@link readDocumentBody} and write one with
 * {@link writeDocumentMarkdown} / {@link appendDocumentMarkdown}; comment
 * line numbers count the lines of the same text (`document-comments.ts`).
 *
 * Both directions run Tiptap's `MarkdownManager` over
 * {@link documentExtensions}, the extension list the editor is built from, so
 * whatever a Document can hold has one markdown form: marks, lists, images,
 * Mockup embeds, which read as `![<name>](mockup:<id>)`, and mentions, which
 * read as `[@<name>](mention:<kind>:<id>)`.
 *
 * Isomorphic: the editor and the agent tools both import it.
 */

/** Every Document starts with a heading, its title; body blocks follow. */
export const DocumentWithTitle = Document.extend({
  content: "heading block*",
})

/**
 * A mention as markdown: `[@<name>](mention:<kind>:<id>)`, where kind is
 * its registered markdown name (`mention-kinds.ts`). The composer's `[@<name>](mention:<id>)`
 * (no kind) reads as a document.
 */
export function mentionMarkdown(
  kind: MentionKind,
  id: string,
  label: string
): string {
  return `[@${label.replace(/[[\]]/g, "")}](mention:${MENTION_KIND_REGISTRY[kind].markdownName}:${id})`
}

const MENTION_RE = new RegExp(
  String.raw`^\[@([^\]\n]*)\]\(mention:(?:(${MENTION_KINDS.map(
    (k) => MENTION_KIND_REGISTRY[k].markdownName
  ).join("|")}):)?([^)\s]+)\)`
)

/**
 * A mention pill in a Document: what it points at (`kind`, `id`) and the name
 * it had when inserted (`label`); the editor and {@link readDocumentBody}
 * show the current name.
 */
export const DocumentMention = Mention.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      kind: {
        default: DEFAULT_MENTION_KIND,
        parseHTML: (el) => el.getAttribute("data-kind") ?? DEFAULT_MENTION_KIND,
        renderHTML: (attrs) =>
          attrs.kind ? { "data-kind": attrs.kind as string } : {},
      },
    }
  },
  markdownTokenizer: {
    name: "mention",
    level: "inline",
    start: (src) => src.search(/\[@[^\]\n]*\]\(mention:/),
    tokenize(src) {
      const match = MENTION_RE.exec(src)
      if (!match) return undefined
      return {
        type: "mention",
        raw: match[0],
        attributes: {
          label: match[1],
          kind:
            (match[2] && mentionKindOfMarkdown(match[2])) ??
            DEFAULT_MENTION_KIND,
          id: match[3],
        },
      }
    },
  },
  parseMarkdown: (token, h) => h.createNode("mention", token.attributes),
  renderMarkdown: (node) =>
    mentionMarkdown(
      mentionKindOf(node.attrs?.kind),
      (node.attrs?.id as string | undefined) ?? "",
      (node.attrs?.label as string | undefined) ??
        (node.attrs?.id as string | undefined) ??
        ""
    ),
})

/**
 * The extensions a Document's schema and markdown come from. The editor
 * passes its own `mention` and `image` (these with a node view and
 * suggestion added) and appends its behaviour-only extensions; the server
 * uses the defaults.
 */
export function documentExtensions({
  mention = DocumentMention,
  image = DocumentImage,
}: { mention?: AnyExtension; image?: AnyExtension } = {}): AnyExtension[] {
  return [
    // StarterKit's TrailingNode would append an empty node of the schema's
    // default type, which `heading block*` makes a heading: an invisible
    // trailing H1 at the bottom of every Document.
    StarterKit.configure({
      undoRedo: false,
      document: false,
      trailingNode: false,
    }),
    DocumentWithTitle,
    mention,
    image,
  ]
}

const extensions = documentExtensions()
const schema = getSchema(extensions)
const markdown = new MarkdownManager({ extensions })

/** The current name of what a mention points at; undefined when it's gone. */
export type MentionLabelOf = (
  kind: MentionKind,
  id: string
) => string | undefined

/** {@link MentionLabelOf} over a Room's collections. */
export function roomMentionLabels(
  c: Pick<
    RoomCollections,
    | "markdownLayers"
    | "mockupLayers"
    | "layerFiles"
    | "branches"
    | "chatSessions"
  >
): MentionLabelOf {
  // A view's id or its file's (#1883): the name is the file's.
  const fileOfKind = (kind: LayerFileKind, id: string) => {
    const file = layerFileOf(c, id)
    return file?.kind === kind ? file : undefined
  }
  const targets: MentionTargets = {
    document: (id) => fileOfKind("document", id),
    mockup: (id) => fileOfKind("mockup", id),
    workspace: (id) => c.branches.get(id),
    chat: (id) => c.chatSessions.get(id),
  }
  return (kind, id) => mentionTargetLabel(kind, id, targets)
}

/**
 * A Document's body as markdown: everything below the title. Each mention
 * reads with `labelOf`'s current name, or the one it was inserted with.
 */
export function readDocumentBody(
  fragment: Y.XmlFragment,
  labelOf?: MentionLabelOf
): string {
  return documentBodyMarkdown(
    yXmlFragmentToProsemirrorJSON(fragment) as JSONContent,
    labelOf
  )
}

/**
 * The body of a Document's JSON (its `doc` node, title first) as markdown.
 * {@link readDocumentBody} reads a fragment through it, and comment line
 * numbers an editor's doc, so both count the same lines.
 */
export function documentBodyMarkdown(
  doc: JSONContent,
  labelOf?: MentionLabelOf
): string {
  const blocks = doc.content ?? []
  const body = blocks[0]?.type === "heading" ? blocks.slice(1) : blocks
  const content = labelOf ? body.map((b) => relabel(b, labelOf)) : body
  return markdown.serialize({ type: "doc", content }).trimEnd()
}

function relabel(node: JSONContent, labelOf: MentionLabelOf): JSONContent {
  // A Mockup embed (#1888) names the Mockup as it's called now, too.
  const embedded =
    node.type === "image" ? mockupEmbedId(node.attrs?.src as string) : null
  if (embedded) {
    const alt = labelOf("mockup-layer", embedded)
    return alt ? { ...node, attrs: { ...node.attrs, alt } } : node
  }
  if (node.type === "mention") {
    const id = node.attrs?.id as string | undefined
    const label = id ? labelOf(mentionKindOf(node.attrs?.kind), id) : undefined
    return label ? { ...node, attrs: { ...node.attrs, label } } : node
  }
  if (!node.content) return node
  return { ...node, content: node.content.map((c) => relabel(c, labelOf)) }
}

/**
 * Write markdown into a Document in one transaction. With `keepTitle` (the
 * agent tools) the markdown is the body and the title heading stays as it
 * is; without, the markdown is the whole Document, its leading `#` heading
 * the title.
 */
export function writeDocumentMarkdown(
  fragment: Y.XmlFragment,
  text: string,
  { keepTitle }: { keepTitle: boolean }
): void {
  const doc = fragment.doc
  if (!doc) return
  doc.transact(() => {
    if (keepTitle) {
      if (!isHeading(fragment.get(0))) fragment.insert(0, [titleHeading()])
      fragment.delete(1, fragment.length - 1)
      fragment.push(parseBlocks(text))
    } else {
      fragment.delete(0, fragment.length)
      const blocks = parseBlocks(text)
      if (!isHeading(blocks[0])) blocks.unshift(titleHeading())
      fragment.push(blocks)
    }
    // The cursor needs a body block to land in.
    if (fragment.length === 1) fragment.push([new Y.XmlElement("paragraph")])
  })
}

/**
 * Add markdown to the end of a Document's body. What's already there is
 * untouched, so its mentions and marks stay as they are.
 */
export function appendDocumentMarkdown(
  fragment: Y.XmlFragment,
  text: string
): void {
  const doc = fragment.doc
  if (!doc) return
  doc.transact(() => {
    if (!isHeading(fragment.get(0))) fragment.insert(0, [titleHeading()])
    // A lone empty paragraph is the seeded cursor slot, not content.
    if (fragment.length === 2 && isEmptyParagraph(fragment.get(1))) {
      fragment.delete(1, 1)
    }
    fragment.push(parseBlocks(text))
    if (fragment.length === 1) fragment.push([new Y.XmlElement("paragraph")])
  })
}

/**
 * Markdown as Document blocks, detached and ready to push into a fragment.
 * They're built in a throwaway `Y.Doc`, under a title heading so they fit the
 * schema, because `prosemirrorJSONToYXmlFragment` rewrites the fragment it's
 * given and the live one may be taking a person's keystrokes.
 */
function parseBlocks(text: string): Y.XmlElement[] {
  const parsed = liftImagesFromParagraphs(markdown.parse(text))
  const json = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 1 } },
      ...(parsed.content ?? []),
    ],
  }
  const temp = new Y.Doc().getXmlFragment("temp")
  prosemirrorJSONToYXmlFragment(schema, json, temp)
  return temp
    .toArray()
    .slice(1)
    .filter((n): n is Y.XmlElement => n instanceof Y.XmlElement)
    .map((n) => n.clone())
}

function isHeading(node: unknown): boolean {
  return node instanceof Y.XmlElement && node.nodeName === "heading"
}

function isEmptyParagraph(node: unknown): boolean {
  return (
    node instanceof Y.XmlElement &&
    node.nodeName === "paragraph" &&
    node.length === 0
  )
}

/** Heading nodes must store `level` as a number: Tiptap checks it against
 *  `[1..6]`, and a string `"1"` falls back silently. */
export function titleHeading(): Y.XmlElement {
  const heading = new Y.XmlElement("heading")
  ;(heading as Y.XmlElement<{ level: number }>).setAttribute("level", 1)
  return heading
}
