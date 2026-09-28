import { forwardRef, useState, type Ref } from "react"
import {
  EditableText,
  type EditableTextHandle,
} from "@workspace/ui/components/editable-text"
import { getBranchColor } from "@/lib/branch-colors"
import { cn } from "@workspace/ui/lib/utils"

const EDIT_CLASS =
  "relative z-10 box-content min-w-0 max-w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden rounded-xs bg-background text-foreground shadow-sm ring-[0.5px] ring-foreground/15 px-0.5 py-0.5 -mx-0.5 -my-0.5"

interface BranchSwatchProps {
  /** String used to pick the color (the Branch id). */
  colorKey: string
  /** Manual override into the palette — wins over `colorKey` when valid. */
  colorIndex?: number
  /** Workspace title, exposed as a tooltip and accessible name when the
   *  swatch stands alone (frame rows); omit it when a title sits beside it. */
  label?: string
  className?: string
}

/**
 * A Workspace's identity: an 8px square in a hue from the identity palette,
 * which never uses the red/amber/green status colors.
 */
export function BranchSwatch({
  colorKey,
  colorIndex,
  label,
  className,
}: BranchSwatchProps) {
  const color = getBranchColor(colorKey, colorIndex)
  return (
    <span
      {...(label
        ? { role: "img", "aria-label": label, title: label }
        : { "aria-hidden": true })}
      data-branch-swatch={color.name}
      className={cn("size-2 shrink-0 rounded-[2px]", color.swatch, className)}
    />
  )
}

interface BranchIdentityProps {
  /** The Workspace title (see `branchTitle`). */
  title: string
  /** The git ref, shown after the title as muted monospace text. */
  branch?: string
  /** String used to pick the swatch color (the Branch id). */
  colorKey: string
  colorIndex?: number
  className?: string
  titleClassName?: string
  /** When provided, double-clicking the title enters inline-rename mode. */
  onRename?: (next: string) => void
  /** `"inline"` (default) shows the ref after the title. `"editing"` keeps it
   *  out of narrow rows (the sidebar) and shows it only while it's being
   *  renamed; the ref is then the title's tooltip. */
  branchDisplay?: "inline" | "editing"
  /** Handle for the ref's inline editor. The ref has no pointer trigger of
   *  its own; a caller (the "Rename branch" menu item) starts it. */
  branchRef?: Ref<EditableTextHandle>
  onRenameBranch?: (next: string) => void
}

/**
 * How a Workspace (Branch) appears everywhere it is named — sidebar rows,
 * pickers, the chat header: swatch, plain-text title, then the branch as
 * secondary monospace text. The title keeps its width; the ref takes what's
 * left and truncates first.
 */
export const BranchIdentity = forwardRef<
  EditableTextHandle,
  BranchIdentityProps
>(function BranchIdentity(
  {
    title,
    branch,
    colorKey,
    colorIndex,
    className,
    titleClassName,
    onRename,
    branchDisplay = "inline",
    branchRef,
    onRenameBranch,
  },
  ref
) {
  // In narrow rows the ref's editor takes the title's place while it's open.
  const [editingRef, setEditingRef] = useState(false)
  const hideTitle = branchDisplay === "editing" && editingRef
  const refClass = cn(
    "min-w-0 flex-1 font-mono text-[11px] text-muted-foreground",
    branchDisplay === "editing" &&
      "[&:not([data-editable-text=editing])]:hidden"
  )
  const tooltip = branchDisplay === "editing" ? branch : undefined
  return (
    <span
      title={tooltip}
      // Keys typed into an inline editor belong to it: keep Space (the
      // sortable row's pick-up key) and friends from reaching dnd-kit.
      onKeyDown={(e) => {
        if ((e.target as HTMLElement).isContentEditable) e.stopPropagation()
      }}
      className={cn(
        "flex min-w-0 items-center gap-2",
        // Let an inline editor's ring render past ancestor truncation.
        (onRename || onRenameBranch) &&
          "has-[[data-editable-text=editing]]:!overflow-visible",
        className
      )}
    >
      <BranchSwatch colorKey={colorKey} colorIndex={colorIndex} />
      {onRename ? (
        <EditableText
          ref={ref}
          as="span"
          value={title}
          onCommit={onRename}
          lockWidthOnEdit
          className={cn(
            "max-w-[calc(100%-1rem)] shrink-0",
            hideTitle && "hidden",
            titleClassName
          )}
          viewClassName="truncate"
          editClassName={EDIT_CLASS}
        />
      ) : (
        <span
          className={cn(
            "max-w-[calc(100%-1rem)] shrink-0 truncate",
            titleClassName
          )}
        >
          {title}
        </span>
      )}
      {branch &&
        (onRenameBranch ? (
          <EditableText
            ref={branchRef}
            as="span"
            value={branch}
            onCommit={onRenameBranch}
            editTrigger="manual"
            onEditStart={() => setEditingRef(true)}
            onEditEnd={() => setEditingRef(false)}
            lockWidthOnEdit
            className={refClass}
            viewClassName="truncate"
            editClassName={EDIT_CLASS}
          />
        ) : (
          <span className={cn(refClass, "truncate")}>{branch}</span>
        ))}
    </span>
  )
})
