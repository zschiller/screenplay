"use client"

import { forwardRef, useImperativeHandle, useState } from "react"
import {
  type Icon,
  FileImageIcon,
  UploadSimpleIcon,
} from "@workspace/ui/components/icons"
import { cn } from "@workspace/ui/lib/utils"

export interface DocumentSlashItem {
  key: "upload-image" | "image-from-files"
  label: string
  Icon: Icon
}

/** What a Document's `/` menu offers, in order. */
export const DOCUMENT_SLASH_ITEMS: DocumentSlashItem[] = [
  { key: "upload-image", label: "Upload image", Icon: UploadSimpleIcon },
  { key: "image-from-files", label: "Image from files", Icon: FileImageIcon },
]

export interface DocumentSlashMenuHandle {
  /** Forward an editor key event into the menu; true when it took it. */
  onKeyDown: (event: KeyboardEvent) => boolean
}

/**
 * The `/` menu's list, drawn like the app's dropdown menus (the inverted
 * surface, their item rows) while the caret stays in the Document: arrows
 * move the highlight, Enter or Tab picks.
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
      {items.map((item, i) => (
        <div
          key={item.key}
          role="menuitem"
          data-highlighted={i === index ? "" : undefined}
          onMouseDown={(e) => {
            e.preventDefault()
            command(item)
          }}
          onMouseEnter={() => setHighlight({ items, index: i })}
          className={cn(
            "flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-sm whitespace-nowrap select-none [&_svg]:size-4 [&_svg]:shrink-0",
            "data-highlighted:bg-accent data-highlighted:text-accent-foreground"
          )}
        >
          <item.Icon />
          {item.label}
        </div>
      ))}
    </div>
  )
})
