"use client"

import { useMemo, useState, type RefObject } from "react"
import type { EditableTextHandle } from "@workspace/ui/components/editable-text"
import {
  BracketsCurlyIcon,
  CaretUpDownIcon,
} from "@workspace/ui/components/icons"
import { MaybeWorkspaceHoverCard } from "@/components/workspace-hover-card"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import type { BranchData } from "@/lib/types"
import type { JsonObject } from "@/lib/postmessage-protocol"
import { workspaceLabel } from "@/lib/workspace-label"
import { frameWorkspaceOf, type FrameWorkspace } from "./frame-nav"
import { WorkspaceChooser } from "./group-label"
import { LayerMenu, type LayerMenuActions } from "./layer-menu"
import { LayerLabelRow } from "./layer-title-bar"
import { CompactWorkspaceMention, WorkspaceCommandList } from "./workspace-list"

interface IframeLayerLabelProps {
  label: string
  branchId?: string
  /** Name the frame's Workspace after its name: its Group's frames show
   *  different Workspaces, or it is a Group of one with no group label
   *  (#1276). Otherwise the group label names the one they all show. */
  showWorkspace?: boolean
  /** Agents the user can pick from (typically all running agents in the room). */
  assignableBranches?: BranchData[]
  onAssignBranch?: (branchId: string) => void
  /** True when this frame is selected (directly or because its group is). */
  selected?: boolean
  /** Remote selector's color for the name. Ignored while locally selected. */
  remoteSelectedColor?: string
  /** Pointer-down select for the frame name — mirrors the frame body's instant-select behavior. */
  onSelectFrame?: (shiftKey: boolean) => void
  /** Inline rename for the frame name. When provided, double-clicking the
   *  name swaps it into a contenteditable. */
  onRename?: (next: string) => void
  /** The rename field's handle, so the frame menu's Rename can start it. */
  editableRef?: RefObject<EditableTextHandle | null>
  /** The frame's menu as … at the row's end, for a selected frame with no
   *  toolbar to hold it (one without a Workspace). */
  menu?: LayerMenuActions
}

/**
 * The Iframe Layer's title row: the frame name, then its Workspace when the
 * frame names one (#868). The route lives in the selected frame's address bar
 * and in the frame itself. Rendered inside the shared `LayerTitleBar` (owned
 * by the Layer Shell), which supplies the drag-handle routing and group label;
 * this component is purely the content-specific row.
 */
export function IframeLayerLabel({
  label,
  branchId,
  showWorkspace,
  assignableBranches,
  onAssignBranch,
  selected,
  remoteSelectedColor,
  onSelectFrame,
  onRename,
  editableRef,
  menu,
}: IframeLayerLabelProps) {
  // The frame's Workspace as the list knows it, for its state and PR (#975).
  const workspace = frameWorkspaceOf(
    branchId ? assignableBranches?.find((a) => a.id === branchId) : undefined
  )
  let trailing: React.ReactNode = null
  if (!showWorkspace) {
    // The Group's label names the Workspace (or offers one for every frame);
    // hovering this frame's name offers "Set workspace" for just this frame,
    // like a mixed Group's label does for all of them (#1276).
    if (onAssignBranch) {
      trailing = (
        <WorkspaceChooser
          switcher={{
            branches: assignableBranches ?? [],
            onPick: onAssignBranch,
          }}
          currentBranchId={workspace?.branchId}
          title="Set workspace"
          placeholder={`Show ${label || "Untitled"} from…`}
          // Hidden but holding its place, so hovering the spot where it
          // appears shows it too. Out of sight it gives the name its width.
          className="invisible min-w-0 group-hover/layer-label:visible group-hover/layer-label:min-w-10 data-[state=open]:visible data-[state=open]:min-w-10"
        />
      )
    }
  } else if (!workspace) {
    // An unassigned frame offers the list, as its body does.
    if (onAssignBranch) {
      trailing = (
        <BranchPicker
          assignableBranches={assignableBranches ?? []}
          onAssignBranch={onAssignBranch}
        />
      )
    }
  } else {
    trailing = onAssignBranch ? (
      <BranchPicker
        workspace={workspace}
        assignableBranches={assignableBranches ?? []}
        onAssignBranch={onAssignBranch}
      />
    ) : (
      <MaybeWorkspaceHoverCard branchId={workspace.branchId} side="bottom">
        {/* The mention doesn't take the trigger's props; this span does. */}
        <span className="flex min-w-10 shrink-[100] text-xs text-muted-foreground">
          <CompactWorkspaceMention workspace={workspace} />
        </span>
      </MaybeWorkspaceHoverCard>
    )
  }
  return (
    <LayerLabelRow
      title={label}
      selected={selected}
      color={remoteSelectedColor}
      onSelectLayer={(shiftKey) => onSelectFrame?.(shiftKey)}
      onRename={onRename}
      editableRef={editableRef}
      placeholder="Untitled"
      trailing={
        menu ? (
          <>
            {trailing}
            <LayerMenu
              placement="label"
              actions={menu}
              onRename={
                onRename
                  ? () => editableRef?.current?.startEditing()
                  : undefined
              }
            />
          </>
        ) : (
          trailing
        )
      }
    />
  )
}

interface BranchPickerProps {
  /** Unset on an unassigned frame, which offers "Choose a workspace". */
  workspace?: FrameWorkspace
  assignableBranches: BranchData[]
  onAssignBranch: (branchId: string) => void
}

interface SharedStateIndicatorProps {
  sharedState?: JsonObject
}

/**
 * Tiny curly-brace glyph rendered inside the route pill when the prototype
 * has published any shared state via `@screenplay.space/state`. Hover to see
 * the full JSON snapshot. Collapses to nothing when the state is empty so
 * unaffected iframeLayers don't grow an extra slot.
 */
export function SharedStateIndicator({
  sharedState,
}: SharedStateIndicatorProps) {
  const json = useMemo(() => {
    if (!sharedState) return null
    const keys = Object.keys(sharedState)
    if (keys.length === 0) return null
    try {
      return JSON.stringify(sharedState, null, 2)
    } catch {
      return null
    }
  }, [sharedState])
  if (!json) return null
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className="ml-1 inline-flex size-3 shrink-0 items-center justify-center text-foreground/60"
            // Stop pointer events from bubbling into the route picker so a
            // hover-to-read doesn't accidentally open the route popover.
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            aria-label="Synced UI state"
          >
            <BracketsCurlyIcon className="size-2.5" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-[360px] p-0">
          <pre className="max-h-[300px] overflow-auto p-2 font-mono text-xs leading-snug break-words whitespace-pre-wrap">
            {json}
          </pre>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/**
 * The Workspace a frame names on its label, as a switcher: the shared mention
 * (the one the Workspace list uses), with the up-down chevron on hover. An
 * unassigned frame shows "Choose a workspace" instead.
 */
function BranchPicker({
  workspace,
  assignableBranches,
  onAssignBranch,
}: BranchPickerProps) {
  const [open, setOpen] = useState(false)
  const currentBranchId = workspace?.branchId

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <MaybeWorkspaceHoverCard
        branchId={currentBranchId}
        side="bottom"
        suppressed={open}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={
              workspace
                ? `Workspace: ${workspaceLabel(workspace)}`
                : "Choose a workspace"
            }
            // Names win: the Workspace gives up its width first.
            className="group flex min-w-10 shrink-[100] items-center text-xs text-muted-foreground outline-none focus-visible:outline-none"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            {workspace ? (
              <CompactWorkspaceMention workspace={workspace} />
            ) : (
              <span className="truncate">Choose a workspace</span>
            )}
            <CaretUpDownIcon
              aria-hidden
              className={
                workspace
                  ? "ml-0 h-3 w-0 shrink-0 text-muted-foreground opacity-0 transition-all duration-150 group-hover:ml-1 group-hover:w-3 group-hover:opacity-100 group-data-[state=open]:ml-1 group-data-[state=open]:w-3 group-data-[state=open]:opacity-100"
                  : "ml-1 size-3 shrink-0 text-muted-foreground"
              }
            />
          </button>
        </PopoverTrigger>
      </MaybeWorkspaceHoverCard>
      <PopoverContent
        className="w-72 p-0"
        side="bottom"
        align="start"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <WorkspaceCommandList
          branches={assignableBranches}
          currentBranchId={currentBranchId}
          onPick={(id) => {
            if (id !== currentBranchId) onAssignBranch(id)
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
