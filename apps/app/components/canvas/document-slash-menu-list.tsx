"use client"

import { Fragment, forwardRef, useImperativeHandle, useState } from "react"
import type { Editor } from "@tiptap/core"
import {
  type Icon,
  AtIcon,
  FileImageIcon,
  MinusIcon,
  UploadSimpleIcon,
} from "@workspace/ui/components/icons"
import { cn } from "@workspace/ui/lib/utils"
import { DOCUMENT_BLOCK_TYPES } from "@/lib/document-block-types"

/** The items that put an image in, which the Document picks a place for. */
export type DocumentImageItemKey = "upload-image" | "image-from-files"

export interface DocumentSlashItem {
  key: string
  label: string
  Icon: Icon
  group: "Format" | "Insert"
  /** The markdown you can type at the start of a line instead. */
  shortcut?: string
  /** Runs where the `/` was. Image items have none: the Document runs them. */
  run?: (editor: Editor) => void
}

const IMAGE_ITEMS: (DocumentSlashItem & { key: DocumentImageItemKey })[] = [
  {
    key: "upload-image",
    label: "Upload image",
    Icon: UploadSimpleIcon,
    group: "Insert",
  },
  {
    key: "image-from-files",
    label: "Image from files",
    Icon: FileImageIcon,
    group: "Insert",
  },
]

/** The formatting bar's Image button offers these. */
export const DOCUMENT_IMAGE_ITEMS = IMAGE_ITEMS

/** What a Document's `/` menu offers, in order. */
export const DOCUMENT_SLASH_ITEMS: DocumentSlashItem[] = [
  ...DOCUMENT_BLOCK_TYPES.map((type) => ({
    key: type.key,
    label: type.label,
    Icon: type.Icon,
    group: "Format" as const,
    shortcut: type.shortcut,
    run: type.run,
  })),
  {
    key: "divider",
    label: "Divider",
    Icon: MinusIcon,
    group: "Format",
    shortcut: "---",
    // With a line of its own after it to keep writing on, as Enter after
    // typing `---` gives.
    run: (editor) =>
      editor
        .chain()
        .focus()
        .insertContent([{ type: "horizontalRule" }, { type: "paragraph" }])
        .run(),
  },
  ...IMAGE_ITEMS,
  {
    key: "mention",
    label: "Mention",
    Icon: AtIcon,
    group: "Insert",
    shortcut: "@",
    // Typing the `@` opens the mention list, as typing it yourself does.
    run: (editor) => editor.chain().focus().insertContent("@").run(),
  },
]

export function isDocumentImageItem(key: string): key is DocumentImageItemKey {
  return IMAGE_ITEMS.some((item) => item.key === key)
}

export interface DocumentSlashMenuHandle {
  /** Forward an editor key event into the menu; true when it took it. */
  onKeyDown: (event: KeyboardEvent) => boolean
}

/**
 * The `/` menu's list, drawn like the app's dropdown menus (the inverted
 * surface, their labels, item rows and shortcuts) while the caret stays in
 * the Document: arrows move the highlight, Enter or Tab picks.
 */
export const DocumentSlashMenuList = forwardRef<
  DocumentSlashMenuHandle,
  {
    items: DocumentSlashItem[]
    command: (item: DocumentSlashItem) => void
  }
>(function DocumentSlashMenuList({ items, command }, ref) {
  const [highlight, setHighlight] = useState({ items, index: 0 })
  // A narrower query starts over at the top.
  const index = highlight.items === items ? highlight.index : 0

  useImperativeHandle(ref, () => ({
    onKeyDown: (event) => {
      if (items.length === 0) return false
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const step = event.key === "ArrowDown" ? 1 : -1
        setHighlight({
          items,
          index: (index + step + items.length) % items.length,
        })
        return true
      }
      if (event.key === "Enter" || event.key === "Tab") {
        const item = items[index]
        if (item) command(item)
        return true
      }
      return false
    },
  }))

  if (items.length === 0) return null
  return (
    <div
      role="menu"
      className="inverted w-max min-w-56 rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
    >
      {items.map((item, i) => {
        const startsGroup = items[i - 1]?.group !== item.group
        return (
          <Fragment key={item.key}>
            {startsGroup && i > 0 && (
              <div role="separator" className="-mx-1 my-1 h-px bg-border" />
            )}
            {startsGroup && (
              <div className="px-1.5 py-1 font-mono text-xs font-normal tracking-wider whitespace-nowrap text-muted-foreground uppercase">
                {item.group}
              </div>
            )}
            <div
              role="menuitem"
              data-highlighted={i === index ? "" : undefined}
              onMouseDown={(e) => {
                e.preventDefault()
                command(item)
              }}
              onMouseEnter={() => setHighlight({ items, index: i })}
              className={cn(
                "group/slash-item flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-sm whitespace-nowrap select-none [&_svg]:size-4 [&_svg]:shrink-0",
                "data-highlighted:bg-accent data-highlighted:text-accent-foreground"
              )}
            >
              <item.Icon />
              {item.label}
              {item.shortcut && (
                <span className="ml-auto pl-4 text-xs tracking-widest text-muted-foreground group-data-highlighted/slash-item:text-accent-foreground">
                  {item.shortcut}
                </span>
              )}
            </div>
          </Fragment>
        )
      })}
    </div>
  )
})
