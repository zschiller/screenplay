"use client"

import { Extension } from "@tiptap/core"
import { PluginKey } from "@tiptap/pm/state"
import { ReactRenderer } from "@tiptap/react"
import { Suggestion } from "@tiptap/suggestion"
import {
  DocumentSlashMenuList,
  DOCUMENT_SLASH_ITEMS,
  isDocumentImageItem,
  type DocumentImageItemKey,
  type DocumentSlashItem,
  type DocumentSlashMenuHandle,
} from "@/components/canvas/document-slash-menu-list"

export interface DocumentSlashMenuOptions {
  /** Put a picked image item in at `pos`, where the `/` and its query were. */
  onPick: (key: DocumentImageItemKey, pos: number) => void
}

const KEY = new PluginKey("documentSlashMenu")

/**
 * A Document's `/` menu: typed at the start of a line or after a space in the
 * body, it lists what the line can turn into (Format) and what can be put in
 * (Insert: images and mentions), narrowed by what follows the `/`. Never in
 * the title.
 */
export const DocumentSlashMenu = Extension.create<DocumentSlashMenuOptions>({
  name: "documentSlashMenu",

  addOptions() {
    return { onPick: () => {} }
  },

  addProseMirrorPlugins() {
    const options = this.options
    return [
      Suggestion<DocumentSlashItem, DocumentSlashItem>({
        editor: this.editor,
        char: "/",
        pluginKey: KEY,
        allow: ({ state, range }) => state.doc.resolve(range.from).index(0) > 0,
        items: ({ query }) => {
          const q = query.toLowerCase()
          return DOCUMENT_SLASH_ITEMS.filter((item) =>
            item.label.toLowerCase().includes(q)
          )
        },
        command: ({ editor, range, props }) => {
          editor.chain().focus().deleteRange(range).run()
          if (props.run) props.run(editor)
          else if (isDocumentImageItem(props.key))
            options.onPick(props.key, range.from)
        },
        render: () => {
          let component: ReactRenderer<DocumentSlashMenuHandle> | null = null
          let containerEl: HTMLDivElement | null = null

          const position = (rect: DOMRect | null | undefined) => {
            if (!containerEl || !rect) return
            containerEl.style.left = `${rect.left}px`
            containerEl.style.top = `${rect.bottom + 4}px`
          }

          return {
            onStart: (props) => {
              component = new ReactRenderer(DocumentSlashMenuList, {
                props: { items: props.items, command: props.command },
                editor: props.editor,
              })
              containerEl = document.createElement("div")
              // Outside the Document's DOM; marked so its pointer-down
              // doesn't count as a click away from the Document.
              containerEl.setAttribute("data-composer-popup", "")
              containerEl.style.position = "fixed"
              containerEl.style.zIndex = "60"
              containerEl.appendChild(component.element)
              document.body.appendChild(containerEl)
              position(props.clientRect?.())
            },
            onUpdate: (props) => {
              component?.updateProps({
                items: props.items,
                command: props.command,
              })
              position(props.clientRect?.())
            },
            onKeyDown: (props) => {
              if (props.event.key === "Escape") return false
              return component?.ref?.onKeyDown(props.event) ?? false
            },
            onExit: () => {
              containerEl?.remove()
              containerEl = null
              component?.destroy()
              component = null
            },
          }
        },
      }),
    ]
  },
})
