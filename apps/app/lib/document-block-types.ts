import type { Editor } from "@tiptap/core"
import {
  type Icon,
  CodeBlockIcon,
  ListBulletsIcon,
  ListNumbersIcon,
  QuotesIcon,
  TextHOneIcon,
  TextHThreeIcon,
  TextHTwoIcon,
  TextTIcon,
} from "@workspace/ui/components/icons"

export interface DocumentBlockType {
  key: string
  label: string
  Icon: Icon
  /** The markdown you can type at the start of a line instead. */
  shortcut?: string
  run: (editor: Editor) => void
}

/** The block types a Document's body can switch between: the selection
 *  toolbar's "Turn into" dropdown and the `/` menu's Format group. `key`
 *  matches the `blockType` string the editor derives in `markdown-layer.tsx`;
 *  `run` converts the block the caret sits in.
 *
 *  Every command leads with `clearNodes()` — TipTap's "normalize to a simple
 *  paragraph" primitive — before applying the target. Without it these compose
 *  instead of replace: blockquote and lists are *wrapping* nodes, so e.g.
 *  `toggleBlockquote()` on an existing code block wraps it (a quoted code block)
 *  rather than turning it into a quote. `clearNodes()` first strips any current
 *  wrapper/type, so each pick is an exclusive "turn into". */
export const DOCUMENT_BLOCK_TYPES: DocumentBlockType[] = [
  {
    key: "paragraph",
    label: "Text",
    Icon: TextTIcon,
    run: (editor) => editor.chain().focus().clearNodes().run(),
  },
  {
    key: "h1",
    shortcut: "#",
    label: "Heading 1",
    Icon: TextHOneIcon,
    run: (editor) =>
      editor.chain().focus().clearNodes().setHeading({ level: 1 }).run(),
  },
  {
    key: "h2",
    shortcut: "##",
    label: "Heading 2",
    Icon: TextHTwoIcon,
    run: (editor) =>
      editor.chain().focus().clearNodes().setHeading({ level: 2 }).run(),
  },
  {
    key: "h3",
    shortcut: "###",
    label: "Heading 3",
    Icon: TextHThreeIcon,
    run: (editor) =>
      editor.chain().focus().clearNodes().setHeading({ level: 3 }).run(),
  },
  {
    key: "bulletList",
    shortcut: "-",
    label: "Bullet list",
    Icon: ListBulletsIcon,
    run: (editor) =>
      editor.chain().focus().clearNodes().toggleBulletList().run(),
  },
  {
    key: "orderedList",
    shortcut: "1.",
    label: "Numbered list",
    Icon: ListNumbersIcon,
    run: (editor) =>
      editor.chain().focus().clearNodes().toggleOrderedList().run(),
  },
  {
    key: "blockquote",
    shortcut: ">",
    label: "Quote",
    Icon: QuotesIcon,
    run: (editor) => editor.chain().focus().clearNodes().setBlockquote().run(),
  },
  {
    key: "codeBlock",
    shortcut: "```",
    label: "Code block",
    Icon: CodeBlockIcon,
    run: (editor) => editor.chain().focus().clearNodes().setCodeBlock().run(),
  },
]
