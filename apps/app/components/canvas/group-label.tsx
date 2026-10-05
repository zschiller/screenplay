"use client"

import { useRef, useState, type RefObject } from "react"
import { CaretUpDownIcon } from "@workspace/ui/components/icons"
import { cn } from "@workspace/ui/lib/utils"
import {
  EditableText,
  editableTextFieldClass,
  type EditableTextHandle,
} from "@workspace/ui/components/editable-text"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import { WorkspaceHoverCard } from "@/components/workspace-hover-card"
import type { LayerDragHandlers } from "@/hooks/use-layer-drag"
import type { BranchData } from "@/lib/types"
import { workspaceLabel } from "@/lib/workspace-label"
import { useWorkspaceHoverProps } from "@/lib/workspace-hover-store"
import type { FrameWorkspace } from "./frame-nav"
import { LayerMenu, type LayerMenuActions } from "./layer-menu"
import { CompactWorkspaceMention, WorkspaceCommandList } from "./workspace-list"

/** Switching a whole Group's Workspace from its label (#869), or one frame's
 *  from its own label. */
export interface GroupWorkspaceSwitch {
  /** Workspaces to offer, filtered like every Workspace list. */
  branches: BranchData[]
  /** Show the whole Group from `branchId`. */
  onPick: (branchId: string) => void
}

/** The Group's Workspace as its label names it, and switches it (#869). */
interface AssignedGroupWorkspace extends FrameWorkspace {
  switcher?: GroupWorkspaceSwitch
}

/** A Group whose frames have no Workspace yet: its label offers the list
 *  that each frame's label used to (#871). */
interface UnassignedGroupWorkspace {
  branchId?: undefined
  switcher: GroupWorkspaceSwitch
}

/** A Group whose frames show different Workspaces (#1276): its label names
 *  none, and offers "Set workspace" only while hovered, to put every frame on
 *  one. */
interface MixedGroupWorkspace {
  branchId?: undefined
  mixed: true
  switcher: GroupWorkspaceSwitch
}

export type GroupWorkspace =
  AssignedGroupWorkspace | UnassignedGroupWorkspace | MixedGroupWorkspace

interface GroupLabelProps {
  label: string
  /** The Workspace every frame in the Group shows, named once after its
   *  name (#1276). Unset when the frames differ: each names its own. */
  workspace?: GroupWorkspace
  /** True when the parent group is selected — colors the label fuchsia. */
  groupSelected?: boolean
  /** Color of a *remote* user's group selection. When set (and not locally
   *  `groupSelected`), the label is tinted to this color to match that user's
   *  selection rect. Local selection (fuchsia) takes precedence. */
  color?: string
  /** When provided, the label becomes an interactive button. Pointer-down
   *  fires immediately to mirror the frame body's instant-select. */
  onSelectGroup?: (shiftKey: boolean) => void
  /**
   * Group-move drag handlers. Spread onto the button so dragging the group
   * label translates the whole group (same as dragging the frame body).
   * Pointer events on the button stop propagation so the parent frame label
   * — which now runs reorder logic in multi-member groups — doesn't fire.
   */
  dragHandlers?: LayerDragHandlers
  /** Optional inline rename. When provided, double-click flips the label
   *  into a contenteditable with the same affordance the frame name uses. */
  onRename?: (next: string) => void
  /** The Group's menu (I7), as … after the label while it alone is selected. */
  menu?: LayerMenuActions
}

/**
 * The small "Group N" header that sits above a member when it's the
 * leftmost item in a multi-member group. Shared between `IframeLayer` and
 * `MarkdownLayer` so both kinds of group members render the same label.
 */
export function GroupLabel({ workspace, menu, ...props }: GroupLabelProps) {
  // Hovering the Workspace lights up its Workspace in the sidebar (#872).
  const hoverProps = useWorkspaceHoverProps(workspace?.branchId, "group")
  const editableRef = useRef<EditableTextHandle>(null)
  const menuButton = menu && (
    <LayerMenu
      placement="label"
      actions={menu}
      onRename={
        props.onRename ? () => editableRef.current?.startEditing() : undefined
      }
    />
  )
  if (!workspace) {
    if (!menuButton)
      return (
        <GroupName {...props} editableRef={editableRef} className="mb-0.5" />
      )
    return (
      <div className="mb-0.5 flex max-w-full min-w-0 items-center gap-2">
        <GroupName {...props} editableRef={editableRef} />
        {menuButton}
      </div>
    )
  }
  return (
    <div className="group/group-label mb-0.5 flex max-w-full min-w-0 items-center gap-2">
      <GroupName {...props} editableRef={editableRef} />
      {"mixed" in workspace ? (
        <WorkspaceChooser
          switcher={workspace.switcher}
          title="Set workspace"
          placeholder={`Show ${props.label} from…`}
          // Only on hover, so a Group of explorations stays quiet. Hidden but
          // holding its place, so hovering the spot where it appears shows it.
          className="invisible min-w-0 group-hover/group-label:visible group-hover/group-label:min-w-10 data-[state=open]:visible data-[state=open]:min-w-10"
        />
      ) : workspace.branchId === undefined ? (
        <WorkspaceChooser switcher={workspace.switcher} />
      ) : workspace.switcher ? (
        <GroupWorkspaceSwitcher
          label={props.label}
          workspace={workspace}
          switcher={workspace.switcher}
          hoverProps={hoverProps}
        />
      ) : (
        // Names win: the Workspace gives up its width first. Pressing it
        // selects the Group, like its name, rather than reordering the member.
        <WorkspaceHoverCard branchId={workspace.branchId} side="bottom">
          <span
            data-slot="group-workspace"
            className="flex min-w-10 shrink-[100] text-xs text-muted-foreground"
            {...hoverProps}
            onPointerDown={(e) => {
              if (e.button !== 0) return
              e.stopPropagation()
              props.onSelectGroup?.(e.shiftKey)
            }}
          >
            <CompactWorkspaceMention workspace={workspace} />
          </span>
        </WorkspaceHoverCard>
      )}
      {menuButton}
    </div>
  )
}

/**
 * The Group's Workspace as a switcher (#869): the shared mention, muted, with the
 * up-down chevron on hover, and pressing it opens the Workspace list. Picking one
 * shows the whole Group from it.
 */
function GroupWorkspaceSwitcher({
  label,
  workspace,
  switcher,
  hoverProps,
}: {
  label: string
  workspace: FrameWorkspace
  switcher: GroupWorkspaceSwitch
  hoverProps: ReturnType<typeof useWorkspaceHoverProps>
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <WorkspaceHoverCard
        branchId={workspace.branchId}
        side="bottom"
        suppressed={open}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            data-slot="group-workspace"
            {...hoverProps}
            aria-label={`Show ${label} from another workspace (now ${workspaceLabel(workspace)})`}
            // Names win: the Workspace gives up its width first.
            className="group flex min-w-10 shrink-[100] items-center text-xs text-muted-foreground outline-none focus-visible:outline-none"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <CompactWorkspaceMention workspace={workspace} />
            <CaretUpDownIcon
              aria-hidden
              className="ml-0 h-3 w-0 shrink-0 text-muted-foreground opacity-0 transition-all duration-150 group-hover:ml-1 group-hover:w-3 group-hover:opacity-100 group-data-[state=open]:ml-1 group-data-[state=open]:w-3 group-data-[state=open]:opacity-100"
            />
          </button>
        </PopoverTrigger>
      </WorkspaceHoverCard>
      <PopoverContent
        className="w-72 p-0"
        side="bottom"
        align="start"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <WorkspaceCommandList
          branches={switcher.branches}
          currentBranchId={workspace.branchId}
          placeholder={`Show ${label} from…`}
          onPick={(id) => {
            if (id !== workspace.branchId) switcher.onPick(id)
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

/**
 * "Choose a workspace" on the label of a Group whose frames have none yet
 * (#871), styled like the unassigned frame label it replaces, and "Set
 * workspace" on a hovered Group whose frames differ, or on a hovered frame
 * whose Group names its Workspace. Picking one sets everything the switcher
 * covers.
 */
export function WorkspaceChooser({
  switcher,
  currentBranchId,
  title = "Choose a workspace",
  placeholder,
  className,
}: {
  switcher: GroupWorkspaceSwitch
  /** Checked in the list: what the frame shows now, when it shows one. */
  currentBranchId?: string
  title?: string
  placeholder?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={title}
          // Names win: the chooser gives up its width first.
          className={cn(
            "flex min-w-10 shrink-[100] items-center outline-none focus-visible:outline-none",
            className
          )}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <span className="truncate text-xs text-muted-foreground">
            {title}
          </span>
          <CaretUpDownIcon
            aria-hidden
            className="ml-1 size-3 shrink-0 text-muted-foreground"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-72 p-0"
        side="bottom"
        align="start"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <WorkspaceCommandList
          branches={switcher.branches}
          currentBranchId={currentBranchId}
          placeholder={placeholder}
          onPick={(id) => {
            if (id !== currentBranchId) switcher.onPick(id)
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

function GroupName({
  label,
  groupSelected,
  color,
  onSelectGroup,
  dragHandlers,
  onRename,
  className,
  editableRef,
}: Omit<GroupLabelProps, "workspace" | "menu"> & {
  className?: string
  editableRef?: RefObject<EditableTextHandle | null>
}) {
  // Local selection (fuchsia) wins; a remote selector's color applies only
  // when the group isn't locally selected.
  const remoteColor = !groupSelected && color ? color : undefined
  const colorStyle = remoteColor ? { color: remoteColor } : undefined
  if (onSelectGroup) {
    const dragPointerDown = dragHandlers?.onPointerDown as
      ((e: React.PointerEvent) => void) | undefined
    const handleSelectPointerDown = (e: React.PointerEvent) => {
      if (e.button !== 0) return
      // Stop the frame's label drag handlers (which run reorder/select for
      // a single frame) from firing — clicking or dragging the group label
      // should operate on the whole group, not the leftmost frame.
      e.stopPropagation()
      onSelectGroup(e.shiftKey)
      dragPointerDown?.(e)
    }
    const colorClass = groupSelected
      ? "text-canvas-selection"
      : remoteColor
        ? undefined
        : "text-muted-foreground"

    if (onRename) {
      // Match the frame-label structure exactly: EditableText as a direct
      // child of a `flex items-center` row. `items-center` masks the vertical
      // shift from `py-0.5 -my-0.5`, and `flex-1` gives the editable a stable
      // slot to scroll inside.
      return (
        <div
          className={cn("flex max-w-full min-w-0 items-center", className)}
          {...dragHandlers}
          onPointerDown={handleSelectPointerDown}
          onClick={(e) => {
            e.stopPropagation()
          }}
        >
          <EditableText
            ref={editableRef}
            as="span"
            value={label}
            onCommit={onRename}
            placeholder="Group"
            style={colorStyle}
            className={cn("min-w-[0.75em] text-xs", colorClass)}
            viewClassName="truncate cursor-grab active:cursor-grabbing"
            editClassName={cn(
              editableTextFieldClass,
              "-mx-0.5 -my-0.5 min-w-0 flex-1 px-0.5 py-0.5"
            )}
          />
        </div>
      )
    }

    return (
      <button
        type="button"
        className={cn(
          "min-w-0 cursor-grab truncate text-xs outline-none active:cursor-grabbing",
          colorClass,
          className
        )}
        style={colorStyle}
        {...dragHandlers}
        onPointerDown={handleSelectPointerDown}
        onClick={(e) => {
          e.stopPropagation()
        }}
      >
        {label}
      </button>
    )
  }
  return (
    <div
      className={cn(
        "min-w-0 truncate text-xs",
        groupSelected
          ? "text-canvas-selection"
          : remoteColor
            ? undefined
            : "text-muted-foreground",
        className
      )}
      style={colorStyle}
    >
      {label}
    </div>
  )
}
