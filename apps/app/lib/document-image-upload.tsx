"use client"

import { createRoot, type Root } from "react-dom/client"
import { nanoid } from "nanoid"
import { Extension, type Editor } from "@tiptap/core"
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state"
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view"
import { Spinner } from "@workspace/ui/components/spinner"
import { checkAttachment, MODEL_IMAGE_TYPES } from "@/lib/files/attachments"
import { imageAltFor } from "@/lib/document-image"

/**
 * Putting an image into a Document from the editor: a file pasted, dropped or
 * picked with Upload image goes into the canvas's files, and an image picked
 * from Files may be copied in first. Either way the Document holds a spinner
 * where the image goes until its file is saved, then the image replaces it.
 *
 * The spinner is a widget decoration: local to this editor, never written to
 * the shared document, and mapped through everyone's edits while it waits.
 */

/** A file saved into the canvas's files, or why it wasn't. */
export type SavedImage =
  { ok: true; path: string } | { ok: false; error: string }

export interface DocumentImageUploadOptions {
  /** Save one image into the canvas's files. */
  upload: (file: File) => Promise<SavedImage>
  /** Say why an image couldn't go in. */
  onError: (message: string) => void
}

type Meta =
  | { add: { id: string; pos: number; label: string | null } }
  | { remove: string }

interface PendingSpec {
  id: string
  roots: Root[]
}

const KEY = new PluginKey<DecorationSet>("documentImageUpload")

/** The spinner row shown where an image is about to go. */
function placeholderDom(spec: PendingSpec, label: string | null): HTMLElement {
  const el = document.createElement("div")
  el.setAttribute("data-image-pending", "")
  if (label === null) return el
  el.className =
    "my-2 flex h-24 items-center justify-center gap-2 rounded-md bg-muted text-xs text-muted-foreground"
  const root = createRoot(el)
  root.render(
    <>
      <Spinner className="size-3.5" />
      <span className="truncate">Uploading {label}…</span>
    </>
  )
  spec.roots.push(root)
  return el
}

function pendingPlugin() {
  return new Plugin<DecorationSet>({
    key: KEY,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, set) {
        let next = set.map(tr.mapping, tr.doc)
        const meta = tr.getMeta(KEY) as Meta | undefined
        if (meta && "add" in meta) {
          const { id, pos, label } = meta.add
          const spec: PendingSpec = { id, roots: [] }
          next = next.add(tr.doc, [
            Decoration.widget(pos, () => placeholderDom(spec, label), {
              ...spec,
              key: `image-pending-${id}`,
              side: -1,
              destroy: () => {
                // Unmounting during ProseMirror's own render warns in React.
                const roots = spec.roots.splice(0)
                queueMicrotask(() => roots.forEach((r) => r.unmount()))
              },
            }),
          ])
        } else if (meta && "remove" in meta) {
          next = next.remove(
            next.find(undefined, undefined, (s) => s.id === meta.remove)
          )
        }
        return next
      },
    },
    props: {
      decorations: (state) => KEY.getState(state),
    },
  })
}

/** Where a pending image is now, or null once its spot is gone. */
function pendingPos(editor: Editor, id: string): number | null {
  const found = KEY.getState(editor.state)?.find(
    undefined,
    undefined,
    (s) => s.id === id
  )
  return found?.[0]?.from ?? null
}

/**
 * Put an image node at `pos`. Never into the title: it goes after it. An
 * empty top-level paragraph is replaced, and inside text the paragraph splits
 * around it. An image that ends the Document gets an empty paragraph after
 * it, for the caret to carry on in.
 */
export function insertImageAt(
  tr: Transaction,
  pos: number,
  attrs: { src: string; alt: string }
): Transaction {
  const schema = tr.doc.type.schema
  const node = schema.nodes.image!.create(attrs)
  const $pos = tr.doc.resolve(Math.min(pos, tr.doc.content.size))
  if ($pos.depth >= 1 && $pos.index(0) === 0) {
    tr.insert($pos.after(1), node)
  } else if (
    $pos.depth === 1 &&
    $pos.parent.type.name === "paragraph" &&
    $pos.parent.content.size === 0
  ) {
    tr.replaceWith($pos.before(), $pos.after(), node)
  } else {
    tr.replaceRangeWith($pos.pos, $pos.pos, node)
  }
  if (tr.doc.lastChild?.type.name === "image") {
    tr.insert(tr.doc.content.size, schema.nodes.paragraph!.create())
  }
  return tr
}

/**
 * Hold a place at `pos` while something is on its way there: a spinner
 * saying `label` is uploading, or, with no label, an invisible marker (while
 * a file picker is open). The place moves with everyone's edits.
 */
export function markPlace(
  editor: Editor,
  pos: number,
  label: string | null
): string {
  const id = nanoid(8)
  editor.view.dispatch(
    editor.state.tr.setMeta(KEY, { add: { id, pos, label } })
  )
  return id
}

/**
 * Give up a place {@link markPlace} held, answering where it is now (null if
 * the editor or the place is gone). Pass `then` to put something there in
 * the same step.
 */
export function releasePlace(
  editor: Editor,
  id: string,
  then?: (tr: Transaction, pos: number) => void
): number | null {
  if (editor.isDestroyed) return null
  const pos = pendingPos(editor, id)
  const tr = editor.state.tr.setMeta(KEY, { remove: id })
  if (pos !== null) then?.(tr, pos)
  editor.view.dispatch(tr)
  return pos
}

/**
 * Hold a spinner saying `label` is uploading at `pos`, wait for `saved`, then
 * put the image there. A failure takes the spinner away and says why.
 */
export async function insertImageWhenSaved(
  editor: Editor,
  saved: Promise<SavedImage>,
  opts: {
    pos: number
    label: string
    onError: (message: string) => void
  }
): Promise<void> {
  const id = markPlace(editor, opts.pos, opts.label)
  const result = await saved.catch((): SavedImage => ({
    ok: false,
    error: "The image couldn’t be added. Try again.",
  }))
  releasePlace(editor, id, (tr, pos) => {
    if (result.ok) {
      insertImageAt(tr, pos, {
        src: result.path,
        alt: imageAltFor(result.path),
      })
    }
  })
  if (!result.ok) opts.onError(result.error)
}

/** Whether `file` is an image a Document shows, or the sentence saying why not. */
export function checkImageFile(file: File): string | null {
  const check = checkAttachment(file)
  if (!check.ok) return check.error
  if (!MODEL_IMAGE_TYPES.has(check.mediaType)) {
    return `${check.name} isn’t an image. Documents show PNG, JPEG, GIF and WebP images.`
  }
  return null
}

/** The images among `files`, saying why each other one was left out. */
export function imagesIn(
  files: FileList | null | undefined,
  onError: (message: string) => void
): File[] {
  const images: File[] = []
  for (const file of Array.from(files ?? [])) {
    const error = checkImageFile(file)
    if (error) onError(error)
    else images.push(file)
  }
  return images
}

/** Upload `files` at `pos`, each with its own spinner, in order. */
export function uploadImages(
  editor: Editor,
  files: File[],
  pos: number,
  options: DocumentImageUploadOptions
): void {
  for (const file of files) {
    void insertImageWhenSaved(editor, options.upload(file), {
      pos,
      label: file.name,
      onError: options.onError,
    })
  }
}

function hasFiles(transfer: DataTransfer | null): boolean {
  return !!transfer && Array.from(transfer.types).includes("Files")
}

/**
 * Paste and drop for images, and the pending-image spinners. Uploads go
 * through `upload`; `onError` says why one didn't.
 */
export const DocumentImageUpload = Extension.create<DocumentImageUploadOptions>(
  {
    name: "documentImageUpload",

    addOptions() {
      return {
        upload: async () => ({
          ok: false,
          error: "Images can’t be uploaded here.",
        }),
        onError: () => {},
      }
    },

    addProseMirrorPlugins() {
      const editor = this.editor
      const options = this.options
      const take = (view: EditorView, images: File[], pos: number) => {
        uploadImages(
          editor,
          images,
          Math.min(pos, view.state.doc.content.size),
          options
        )
      }
      return [
        pendingPlugin(),
        new Plugin({
          props: {
            handlePaste(view, event) {
              // A copied file can come with its name as text: with no image in
              // it, the paste stays ordinary.
              const images = Array.from(
                event.clipboardData?.files ?? []
              ).filter((f) => !checkImageFile(f))
              if (images.length === 0) return false
              take(view, images, view.state.selection.from)
              return true
            },
            handleDrop(view, event, _slice, moved) {
              if (moved || !hasFiles(event.dataTransfer)) return false
              const at = view.posAtCoords({
                left: event.clientX,
                top: event.clientY,
              })
              take(
                view,
                imagesIn(event.dataTransfer?.files, options.onError),
                at?.pos ?? view.state.selection.from
              )
              event.preventDefault()
              return true
            },
          },
        }),
      ]
    },
  }
)
