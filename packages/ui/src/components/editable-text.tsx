"use client"

import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"

export type EditableTextHandle = {
  startEditing: () => void
  stopEditing: (commit?: boolean) => void
  isEditing: () => boolean
}

type ElementTag = "span" | "div" | "h1" | "h2" | "h3" | "h4" | "p"

export type EditableTextProps = {
  value: string
  onCommit: (next: string) => void
  placeholder?: string
  className?: string
  /** Inline styles applied in both view and edit modes. Merged ahead of the
   *  component's own inline styles (e.g. the edit-mode locked max-width). Use
   *  for dynamic values that can't be expressed as a class, like a remote
   *  user's selection color. */
  style?: React.CSSProperties
  /** Extra classes applied only in view (non-editing) mode. Use for things
   *  like `truncate` that should clip the read-only label but not the
   *  caret/text while the user is typing. */
  viewClassName?: string
  /** Extra classes applied only in edit mode. */
  editClassName?: string
  disabled?: boolean
  /** Default true. Strips newlines, commits on Enter. */
  singleLine?: boolean
  /** Default true. Selects all text when entering edit mode. */
  selectAllOnEdit?: boolean
  /** Default true. Treats empty commit as cancel. */
  revertOnEmpty?: boolean
  /** Default "doubleClick". "manual" requires using the ref handle. */
  editTrigger?: "doubleClick" | "click" | "manual"
  /** Default false. When true, and the view element is being truncated at
   *  edit-start, the edit element is given a `max-width` equal to the
   *  view element's visible width — so the input matches the truncated
   *  label it replaces (with internal scroll, via the consumer's
   *  `overflow-x-auto`) but still shrinks if the user shortens the value.
   *  When the view wasn't truncated, no width is applied. */
  lockWidthOnEdit?: boolean
  onEditStart?: () => void
  onEditEnd?: () => void
  /** Default "span". The element renders identically in view and edit modes
   *  so the surrounding layout/typography is preserved. */
  as?: ElementTag
  /** Forwarded to the element only while in view mode — typically used so a
   *  parent can select/activate on the same pointer-down it would have got
   *  from a plain `<span>`. Editing mode owns its own pointer events so
   *  contenteditable selection works. */
  onPointerDown?: (e: React.PointerEvent<HTMLElement>) => void
}

const EditableText = React.forwardRef<EditableTextHandle, EditableTextProps>(
  function EditableText(
    {
      value,
      onCommit,
      placeholder,
      className,
      style,
      viewClassName,
      editClassName,
      disabled,
      singleLine = true,
      selectAllOnEdit = true,
      revertOnEmpty = true,
      editTrigger = "doubleClick",
      lockWidthOnEdit = false,
      onEditStart,
      onEditEnd,
      as = "span",
      onPointerDown,
    },
    ref
  ) {
    const [isEditing, setIsEditing] = React.useState(false)
    const elRef = React.useRef<HTMLElement | null>(null)
    const isComposingRef = React.useRef(false)
    // Snapshot of value at edit-start so we can ignore no-op commits.
    const originalRef = React.useRef(value)
    // Pixel max-width captured from the view element at edit-start when
    // `lockWidthOnEdit` is on AND the view was truncated; applied as
    // inline max-width on the edit element so shorter values still shrink.
    const lockedWidthRef = React.useRef<number | null>(null)
    // Pointerdown-based double-click detection. We can't rely on the
    // browser's `dblclick` event because ancestors (e.g. drag handlers) often
    // call `preventDefault()` on `pointerdown`, which suppresses the
    // synthesized click/dblclick chain.
    const lastPointerDownTimeRef = React.useRef(0)

    // Mirror `isEditing` in a ref so the callbacks below can guard against
    // re-entry without reading state inside `setIsEditing`'s updater (updaters
    // must be pure — calling onCommit/onEditStart/onEditEnd inside one risks
    // re-invocation during render and triggers "setState during render" warnings).
    const isEditingRef = React.useRef(false)

    const startEditing = React.useCallback(() => {
      if (disabled) return
      if (isEditingRef.current) return
      isEditingRef.current = true
      originalRef.current = value
      if (lockWidthOnEdit) {
        const el = elRef.current
        // Only pin when the view label is actually truncated — otherwise
        // let the edit element shrink/grow naturally with the value.
        lockedWidthRef.current =
          el && el.scrollWidth > el.clientWidth ? el.clientWidth : null
      }
      setIsEditing(true)
      onEditStart?.()
    }, [disabled, lockWidthOnEdit, onEditStart, value])

    const stopEditing = React.useCallback(
      (commit: boolean = true) => {
        if (!isEditingRef.current) return
        isEditingRef.current = false
        const el = elRef.current
        let toCommit: string | null = null
        if (commit && el) {
          const raw = el.textContent ?? ""
          const next = singleLine ? raw.replace(/\s+/g, " ").trim() : raw
          const shouldCommit =
            (next !== "" || !revertOnEmpty) && next !== originalRef.current
          if (shouldCommit) toCommit = next
        }
        setIsEditing(false)
        // Drop any text-selection range still inside our element so the
        // highlight doesn't linger over the now read-only label when focus
        // leaves to a non-text target (e.g. a button) that wouldn't collapse
        // it on its own.
        const sel = window.getSelection()
        if (sel && el && el.contains(sel.anchorNode)) sel.removeAllRanges()
        if (toCommit !== null) onCommit(toCommit)
        onEditEnd?.()
      },
      [onCommit, onEditEnd, revertOnEmpty, singleLine]
    )

    React.useImperativeHandle(
      ref,
      () => ({
        startEditing,
        stopEditing,
        isEditing: () => isEditing,
      }),
      [isEditing, startEditing, stopEditing]
    )

    // Seed the contentEditable element and focus/select on entering edit mode.
    // We deliberately do NOT sync `value` into the DOM while editing — that would
    // fight the user's typing and reset the caret on every keystroke.
    React.useLayoutEffect(() => {
      if (!isEditing) return
      const el = elRef.current
      if (!el) return
      el.textContent = originalRef.current
      el.focus()
      const range = document.createRange()
      range.selectNodeContents(el)
      if (!selectAllOnEdit) range.collapse(false)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
    }, [isEditing, selectAllOnEdit])

    // When leaving edit mode the same DOM node is reused for the view element,
    // so any horizontal scroll the caret left behind (caret pushed to the end
    // of a long value) persists. The view element clips with `overflow:hidden`,
    // so a non-zero scrollLeft would leave the label scrolled out of sight —
    // appearing blank. Reset it whenever we're not editing.
    React.useLayoutEffect(() => {
      if (isEditing) return
      const el = elRef.current
      if (el) el.scrollLeft = 0
    }, [isEditing, value])

    const handleKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
      if (isComposingRef.current) return
      if (e.key === "Escape") {
        e.preventDefault()
        e.stopPropagation()
        stopEditing(false)
        return
      }
      if (e.key === "Enter") {
        const commit = singleLine || e.metaKey || e.ctrlKey
        if (commit) {
          e.preventDefault()
          e.stopPropagation()
          stopEditing(true)
        }
      }
    }

    const insertPlainText = (text: string) => {
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0) return
      const range = sel.getRangeAt(0)
      range.deleteContents()
      const node = document.createTextNode(text)
      range.insertNode(node)
      range.setStartAfter(node)
      range.setEndAfter(node)
      sel.removeAllRanges()
      sel.addRange(range)
    }

    const sanitize = (text: string) =>
      singleLine
        ? text.replace(/[\r\n\t]+/g, " ")
        : text.replace(/\r\n?/g, "\n")

    const handlePaste = (e: React.ClipboardEvent<HTMLElement>) => {
      e.preventDefault()
      insertPlainText(sanitize(e.clipboardData.getData("text/plain")))
    }

    const handleDrop = (e: React.DragEvent<HTMLElement>) => {
      e.preventDefault()
      const text = e.dataTransfer.getData("text/plain")
      if (text) insertPlainText(sanitize(text))
    }

    // Catch-all: if anything sneaks past paste/drop (formatted insertions,
    // line breaks from IME, etc.) bail it out before it lands in the DOM.
    const handleBeforeInput = (e: React.FormEvent<HTMLElement>) => {
      const ev = e.nativeEvent as InputEvent
      if (singleLine && ev.inputType === "insertParagraph") {
        e.preventDefault()
        stopEditing(true)
        return
      }
      if (singleLine && ev.inputType === "insertLineBreak") {
        e.preventDefault()
        return
      }
      if (ev.inputType === "insertFromPaste" && ev.dataTransfer) {
        e.preventDefault()
        insertPlainText(sanitize(ev.dataTransfer.getData("text/plain")))
      }
    }

    const handleBlur = () => stopEditing(true)

    const DOUBLE_CLICK_MS = 350

    // Single entry point for view-mode pointerdown: forwards to the consumer's
    // handler (e.g. select-on-press), then decides whether to flip into edit
    // mode based on `editTrigger`. Uses timing rather than `dblclick` so it
    // survives ancestors that `preventDefault()` on pointerdown.
    const handleIdlePointerDown = (e: React.PointerEvent<HTMLElement>) => {
      onPointerDown?.(e)
      if (disabled || e.button !== 0) return
      if (editTrigger === "click") {
        e.preventDefault()
        e.stopPropagation()
        startEditing()
        return
      }
      if (editTrigger === "doubleClick") {
        const now = e.timeStamp
        const prev = lastPointerDownTimeRef.current
        lastPointerDownTimeRef.current = now
        if (prev && now - prev < DOUBLE_CLICK_MS) {
          e.preventDefault()
          e.stopPropagation()
          lastPointerDownTimeRef.current = 0
          startEditing()
        }
      }
    }

    // Show the placeholder via a pseudo-element so it works in both modes
    // and doesn't perturb layout.
    const sharedClass = cn(
      "outline-none",
      singleLine ? "whitespace-nowrap" : "break-words whitespace-pre-wrap",
      "empty:before:text-muted-foreground/60 empty:before:content-[attr(data-placeholder)]",
      className
    )

    const Tag = as as keyof React.JSX.IntrinsicElements

    if (isEditing) {
      return React.createElement(Tag, {
        ref: elRef as React.Ref<HTMLElement>,
        contentEditable: "plaintext-only",
        suppressContentEditableWarning: true,
        spellCheck: false,
        role: "textbox",
        "aria-multiline": !singleLine,
        "aria-label": placeholder,
        "data-placeholder": placeholder,
        "data-editable-text": "editing",
        className: cn(sharedClass, editClassName),
        style:
          lockWidthOnEdit && lockedWidthRef.current != null
            ? { ...style, maxWidth: lockedWidthRef.current }
            : style,
        onKeyDown: handleKeyDown,
        onPaste: handlePaste,
        onDrop: handleDrop,
        onBeforeInput: handleBeforeInput,
        onBlur: handleBlur,
        // Don't let pointerdown / click / dblclick in the editable region
        // trigger parent drag, select, or activate handlers while the user
        // is typing or positioning the caret.
        onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
          e.stopPropagation()
        },
        onClick: (e: React.MouseEvent<HTMLElement>) => {
          e.stopPropagation()
        },
        onDoubleClick: (e: React.MouseEvent<HTMLElement>) => {
          e.stopPropagation()
        },
        onCompositionStart: () => {
          isComposingRef.current = true
        },
        onCompositionEnd: () => {
          isComposingRef.current = false
        },
      })
    }

    return React.createElement(
      Tag,
      {
        ref: elRef as React.Ref<HTMLElement>,
        "data-placeholder": placeholder,
        "data-editable-text": "idle",
        style,
        tabIndex: disabled ? -1 : 0,
        onPointerDown:
          editTrigger === "manual" ? onPointerDown : handleIdlePointerDown,
        // When trigger is doubleClick, swallow the browser's `dblclick` event
        // so a parent's `onDoubleClick` (e.g. sidebar zoom-to-frame) doesn't
        // fire alongside our rename. Single click still bubbles for selection.
        onDoubleClick:
          editTrigger === "doubleClick"
            ? (e: React.MouseEvent<HTMLElement>) => {
                e.stopPropagation()
              }
            : undefined,
        className: cn(sharedClass, !disabled && "cursor-text", viewClassName),
      },
      value
    )
  }
)

export { EditableText }
