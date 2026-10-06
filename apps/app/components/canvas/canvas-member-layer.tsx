"use client"

import {
  memo,
  useCallback,
  useMemo,
  useState,
  type ComponentProps,
} from "react"
import { toast } from "sonner"

import { getGroupMembers } from "@/lib/canvas/layout"
import { groupWorkspace } from "@/lib/canvas/group-workspace"
import type {
  IframeLayerLayoutMap,
  PlaceholderRect,
  PlaceholderTool,
} from "@/lib/canvas/layout"
import type {
  BranchData,
  GroupMember,
  IframeLayerData,
  IframeLayerGroupData,
  MarkdownLayerData,
  MockupLayerData,
  RepoData,
} from "@/lib/types"
import { openPreviewInBrowser } from "@/lib/open-preview"
import { StableProps } from "@/lib/canvas/stable-props"

import { IframeLayer } from "./iframe-layer"
import { MarkdownLayer } from "./markdown-layer"
import { MockupLayer } from "./mockup-layer"
import { useCanvasGesture } from "./use-canvas-gesture"
import type { CanvasCamera } from "./use-canvas-camera"
import type { CanvasSelection } from "./use-canvas-selection"
import type { ElementReference } from "./use-element-reference"
import type { LayerMutations } from "./use-layer-mutations"
import type { GroupActions } from "./use-group-actions"
import { frameWorkspaceOf } from "./frame-nav"
import type { WorkingChat } from "./working-chat"
import {
  hiddenGroupLabels,
  hiddenLayerLabels,
  type LabelledGroup,
  widthAcross,
} from "@/lib/canvas/layer-labels"
import type { FrameControl } from "./use-frame-control"
import type { SharedFrames } from "./use-shared-frames"
import { useGoLive } from "./use-go-live"
import { PublishLayerMenu, groupLayerMenu } from "./layer-menu"
import type { GroupLabelValue } from "./group-label"
import type { LayerPlacement } from "./layer-shell"

type IframeLayerProps = React.ComponentProps<typeof IframeLayer>
type GestureLayerHandlers = ReturnType<typeof useCanvasGesture>["layerHandlers"]
type GesturePreview = ReturnType<typeof useCanvasGesture>["preview"]

/** The per-agent preview/branch resolution the member map reads per Iframe Layer. */
type AgentDomains = Record<
  string,
  {
    previewDomain: string
    branch: string
    discoveredRoutes?: { route: string; label: string }[]
  }
>

/**
 * The flat member layer (PRD #571) — every Iframe, Markdown and Mockup Layer
 * across all Groups rendered as a stable, id-sorted, absolutely-positioned
 * sibling, plus the trailing add-member placeholder hit targets.
 *
 * THE FLAT-SIBLING + ID-SORT INVARIANT: a Member is NOT nested inside a
 * per-Group element. Flattening to `[member, group]` pairs and sorting by
 * member id means React never reparents or re-orders a Member node — either of
 * which remounts the running iframe or the live TipTap editor. So pop-out /
 * drag-in across Groups keeps a Member's React identity and live DOM (no
 * reload); Group membership only changes the Member's computed world position.
 * Preserve this ordering exactly when touching this component.
 *
 * Backed by controllers rather than a long list of loose props: the Canvas
 * Selection controller (#567), the Canvas Camera controller (#567, wheel), the
 * gesture preview + Layer drag/resize callbacks (#568), the element-reference
 * controller (#570), the derived layout maps, and the thin per-Layer mutation
 * handlers (which run through Canvas Operations at their definition sites).
 */
function CanvasMemberLayerImpl({
  iframeLayerGroups,
  iframeLayers,
  markdownLayers,
  workingChats,
  mockupLayers,
  selection,
  onIframeWheel,
  reference,
  reorderPreview,
  gestureLayerHandlers,
  effectiveIframeLayerLayouts,
  iframeLayerLayouts,
  groupZIndex,
  groupDisplayNames,
  placeholderRects,
  placeholderTool,
  onPlaceholderAdd,
  remoteSelectionColors,
  remoteGroupSelectionColors,
  agentDomains,
  agents,
  onRestartWorkspace,
  onOpenLogs,
  onStartChat,
  askingIframeLayerId,
  repos,
  zoom,
  spaceHeld,
  commentMode,
  pickActive,
  dimmedIframeLayerIds,
  selfName,
  selfColor,
  editingDocumentLayerId,
  setEditingDocumentLayerId,
  focusedIframeLayerId,
  setFocusedIframeLayerId,
  frameControl,
  sharedFrames,
  createFlowIframeLayerId,
  setCreateFlowIframeLayerId,
  removeIframeLayer,
  removeMockup,
  removeDocument,
  handlePlayIframeLayer,
  onAskForKnob,
  handleCaptureReadyChange,
  handleCaptureDirty,
  layerMutations,
  groupActions,
}: {
  iframeLayerGroups: IframeLayerGroupData[]
  iframeLayers: IframeLayerData[]
  markdownLayers: MarkdownLayerData[]
  /** The chat working on each Document and Mockup right now (#1726), by layer id. */
  workingChats: ReadonlyMap<string, WorkingChat>
  mockupLayers: MockupLayerData[]
  selection: CanvasSelection
  /** Forwarded wheel from inside an interactive iframe (cursor-centered zoom).
   *  Just `camera.handleIframeWheel` — passed as the bare callback rather than
   *  the whole camera object so this memoized layer doesn't re-render every pan
   *  frame (the camera object is recreated each render). */
  onIframeWheel: CanvasCamera["handleIframeWheel"]
  reference: ElementReference
  /** The live reorder (a frame dragged within its Group), or null. Only
   *  that part of the gesture preview: the rest changes on every move. */
  reorderPreview: GesturePreview["reorder"]
  gestureLayerHandlers: GestureLayerHandlers
  effectiveIframeLayerLayouts: IframeLayerLayoutMap
  iframeLayerLayouts: IframeLayerLayoutMap
  groupZIndex: Map<string, number>
  groupDisplayNames: Map<string, string>
  placeholderRects: PlaceholderRect[]
  /** The armed tool whose kind a placeholder click appends; null hides them. */
  placeholderTool: PlaceholderTool | null
  /**
   * A placeholder click: appends a member of the armed tool's kind, selects
   * it, and drops back to Select (`useDrawTool`'s `addAtPlaceholder`).
   */
  onPlaceholderAdd: (groupId: string) => void
  remoteSelectionColors: Map<string, string>
  remoteGroupSelectionColors: Map<string, string>
  agentDomains: AgentDomains
  agents: BranchData[]
  /** A frame's Retry / Start on its failed or stopped Workspace. */
  onRestartWorkspace: (branchId: string) => void
  /** A frame's "Open logs": show its Workspace's sandbox logs. */
  onOpenLogs: (branchId: string) => void
  /** An unanswered frame's Start a chat (#1358); unset when there's no Repo. */
  onStartChat?: (iframeLayerId: string) => void
  /** The frame the chat prompt is open on, if any. */
  askingIframeLayerId?: string | null
  repos: RepoData[]
  zoom: number
  spaceHeld: boolean
  commentMode: boolean
  /** True while an element pick is armed; eligible (non-dimmed) frames show the
   *  element hover overlay so the user can see what they're about to target. */
  pickActive: boolean
  /**
   * Iframe Layers and Mockups to dim during an armed element pick (#619):
   * every one *not* eligible for the requesting branch, so it's visually clear
   * which can be targeted. Empty whenever no pick is armed.
   */
  dimmedIframeLayerIds: ReadonlySet<string>
  /** Local user's display name + presence color, used to tint our own selection.
   *  Passed as primitives rather than the whole `self` presence object, which
   *  changes identity on every viewport rebroadcast during a pan. */
  selfName: string
  selfColor: string
  editingDocumentLayerId: string | null
  setEditingDocumentLayerId: React.Dispatch<React.SetStateAction<string | null>>
  focusedIframeLayerId: string | null
  setFocusedIframeLayerId: React.Dispatch<React.SetStateAction<string | null>>
  /** Who drives each frame (#1387); entering Interact goes through it. */
  frameControl: FrameControl
  /** Which frames are one shared browser, and their streams (#1392). */
  sharedFrames: SharedFrames
  createFlowIframeLayerId: string | null
  setCreateFlowIframeLayerId: React.Dispatch<
    React.SetStateAction<string | null>
  >
  removeIframeLayer: IframeLayerProps["onRemove"]
  /** Remove one Mockup and drop it from the selection. */
  removeMockup: (id: string) => void
  /** Remove one Document (the label menu's Delete). */
  removeDocument: (id: string) => void
  handlePlayIframeLayer: NonNullable<IframeLayerProps["onPlay"]>
  /** Start an "add a knob" request in a Workspace's chat composer. */
  onAskForKnob: (branchId: string) => void
  handleCaptureReadyChange: IframeLayerProps["onCaptureReadyChange"]
  handleCaptureDirty: IframeLayerProps["onCaptureDirty"]
  /**
   * The per-Layer Canvas Operation writers, bundled into one controller object
   * (PRD #579) — the Iframe Layer / Markdown Layer content adapters read their
   * mutators from here instead of taking ~13 loose props.
   */
  layerMutations: LayerMutations
  /**
   * The structural group/frame Canvas Operations (PRD #588) — the placeholder
   * "+ frame" hit target appends through `addIframeLayerToGroup`, and the group
   * label renames through `renameIframeLayerGroup`.
   */
  groupActions: GroupActions
}) {
  // Each member's props, kept identical across renders that don't change
  // them so its memoized Layer skips the render (a marquee or a drag
  // re-renders this list on every pointer move).
  const [stable] = useState(() => new StableProps())
  // Alias the controller state/verbs to the local names the JSX reads, so the
  // flat-member render below stays a verbatim move from `canvas.tsx`.
  const renameIframeLayerGroup = groupActions.renameIframeLayerGroup
  const selectedIframeLayerIds = selection.iframeLayerIds
  const selectedGroupIds = selection.groupIds
  const selectedDocumentLayerIds = selection.documentLayerIds
  const handleIframeLayerSelect = selection.selectIframeLayer
  const handleGroupSelect = selection.selectGroup
  const handleDocumentLayerSelect = selection.selectDocumentLayer
  // More than one thing selected, Groups included (I6): every toolbar and
  // label menu hides, so nothing acts on just one of them.
  const multiSelected =
    selectedIframeLayerIds.size +
      selectedDocumentLayerIds.size +
      selectedGroupIds.size >
    1
  // Interact on a frame or a mockup, or leave it (null). Entering goes
  // through Frame Control: it takes the page from the agent, or asks the
  // person driving it.
  const focusPage = (id: string | null) => {
    if (id === null) {
      setFocusedIframeLayerId(null)
      return
    }
    frameControl.interact(id)
    setCreateFlowIframeLayerId(null)
  }
  const labelsHidden = useMemo(
    () => hiddenLayerLabels(effectiveIframeLayerLayouts.values(), zoom),
    [effectiveIframeLayerLayouts, zoom]
  )
  const groupLabelsHidden = useMemo(() => {
    const labelled = new Map<string, LabelledGroup>()
    for (const group of iframeLayerGroups) {
      const members = getGroupMembers(group)
      if (members.length > 1)
        labelled.set(group.id, { memberIds: members.map((m) => m.id) })
    }
    return hiddenGroupLabels(
      effectiveIframeLayerLayouts.values(),
      labelled,
      zoom
    )
  }, [iframeLayerGroups, effectiveIframeLayerLayouts, zoom])
  // Going live (#1520): the toggle spins until the first picture, and a
  // failure turns the frame back off and says why.
  const liveIds = useMemo(
    () =>
      new Set(
        [...iframeLayers, ...mockupLayers]
          .filter((l) => sharedFrames.liveOf(l.id).live)
          .map((l) => l.id)
      ),
    [iframeLayers, mockupLayers, sharedFrames]
  )
  const letGo = frameControl.letGo
  const updateLive = layerMutations.updateLive
  const updateMockupLive = layerMutations.updateMockupLive
  const mockupIds = useMemo(
    () => new Set(mockupLayers.map((l) => l.id)),
    [mockupLayers]
  )
  const mockupWorkspaceOf = sharedFrames.mockupWorkspaceOf
  const goLive = useGoLive({
    liveIds,
    setLive: useCallback(
      (id: string, live: boolean) => {
        // Going live or ending it switches which Frame Control record
        // governs the frame: let go of the old one.
        letGo(id)
        // A Mockup records the Workspace it borrows to run in (#1523).
        if (mockupIds.has(id)) updateMockupLive(id, live, mockupWorkspaceOf(id))
        else updateLive(id, live)
      },
      [letGo, updateLive, updateMockupLive, mockupIds, mockupWorkspaceOf]
    ),
    onFailed: useCallback((message: string) => toast.error(message), []),
  })

  // A group label runs the width of its Group, not just its leftmost member.
  const groupLabelWidth = (
    leaderId: string,
    members: readonly { id: string }[]
  ) => {
    const leader = effectiveIframeLayerLayouts.get(leaderId)
    if (!leader) return undefined
    return widthAcross(
      leader,
      members.flatMap((m) => effectiveIframeLayerLayouts.get(m.id) ?? [])
    )
  }

  const groupMenuOf = (groupId: string) =>
    groupLayerMenu(() => groupActions.removeIframeLayerGroup(groupId))

  return (
    <>
      {/* Each Group's menu (I7), for its sidebar row while the canvas is up. */}
      {iframeLayerGroups.map((group) => (
        <PublishLayerMenu
          key={`menu-${group.id}`}
          id={group.id}
          actions={groupMenuOf(group.id)}
        />
      ))}
      {(() => {
        // Flatten to [member, group] pairs, then sort by member id so
        // React never reparents or re-orders a member node (either of
        // which remounts the iframe / TipTap editor — see the
        // `groupZIndex` note for why DOM order has to stay fixed).
        const entries: Array<{
          member: GroupMember
          group: IframeLayerGroupData
        }> = []
        for (const group of iframeLayerGroups) {
          for (const member of getGroupMembers(group)) {
            entries.push({ member, group })
          }
        }
        entries.sort((a, b) => a.member.id.localeCompare(b.member.id))

        // Each Group's Workspace (#868), as its label and its frames name it.
        const framesById = new Map(iframeLayers.map((l) => [l.id, l]))
        const mockupsById = new Map(mockupLayers.map((l) => [l.id, l]))
        const workspaceOf = (branchId: string | undefined) =>
          frameWorkspaceOf(
            branchId ? agents.find((a) => a.id === branchId) : undefined
          )

        // The group label's pill, as a switcher for the whole Group (#869).
        // Only a Group whose frames all show one Workspace names it (#1276).
        const groupSwitcherOf = (group: IframeLayerGroupData) => {
          const shared = groupWorkspace(group, framesById)
          if (!shared) {
            // Frames on different Workspaces: the label names none, and
            // offers putting them all on one while hovered (#1276).
            const frames = getGroupMembers(group).filter(
              (m) => m.kind === "iframe-layer" && framesById.has(m.id)
            ).length
            if (frames === 0) return undefined
            return {
              mixed: true as const,
              switcher: {
                branches: agents,
                onPick: (branchId: string) =>
                  layerMutations.assignGroupAgent(group.id, branchId),
              },
            }
          }
          const switcher = {
            branches: agents,
            onPick: (branchId: string) =>
              layerMutations.assignGroupAgent(group.id, branchId),
          }
          if (!shared.branchId) return { switcher }
          const workspace = workspaceOf(shared.branchId)
          return workspace ? { ...workspace, switcher } : undefined
        }

        const rendered = entries.map(({ member, group }) => {
          const members = getGroupMembers(group)
          const index = members.findIndex((m) => m.id === member.id)
          const groupSelected = selectedGroupIds.has(group.id)
          const showGroupLabel = members.length > 1
          // Every frame names its own Workspace unless the group label names
          // the one they all show (#1276).
          const groupNamesWorkspace =
            showGroupLabel && !!groupWorkspace(group, framesById)
          // The group label, worn by the Group's leftmost member. Every Layer
          // kind hands it to its Layer Shell untouched.
          const groupName =
            index === 0 && showGroupLabel && !groupLabelsHidden.has(group.id)
              ? groupDisplayNames.get(group.id)
              : undefined
          const groupLabel: GroupLabelValue | undefined = groupName
            ? {
                label: groupName,
                width: groupLabelWidth(member.id, members),
                workspace: groupSwitcherOf(group),
                // Tinted to match a remote user's Group selection rect.
                remoteSelectedColor: remoteGroupSelectionColors.get(member.id),
                onSelect: (shiftKey) => handleGroupSelect(group.id, shiftKey),
                onRename: (name) => renameIframeLayerGroup(group.id, name),
                // The Group's menu (I7), as … on its label while it alone is
                // selected.
                menu:
                  groupSelected && !multiSelected
                    ? groupMenuOf(group.id)
                    : undefined,
              }
            : undefined
          // Tint this member's name to match a remote user's selection
          // rect. Skipped when we've selected it locally — our own
          // fuchsia takes precedence.
          const remoteSelectedColor = remoteSelectionColors.get(member.id)
          const layout = effectiveIframeLayerLayouts.get(member.id)
          if (!layout) return null

          // In-flow reorder: layer a cursor-tracking translate over
          // the layout slot (siblings reflow via the layout map). A
          // popped frame already sits at `cursor - grab` in
          // effectiveIframeLayerLayouts, so it needs no transform —
          // only the `dragPopped` flag for z-elevation / pointer
          // pass-through / group-label anchoring.
          let dragTranslateX: number | undefined
          let dragTranslateY: number | undefined
          let dragPopped = false
          if (reorderPreview?.memberId === member.id) {
            const grab = reorderPreview.grabOffset ?? {
              x: layout.width / 2,
              y: layout.height / 2,
            }
            if (reorderPreview.popped) {
              dragPopped = true
            } else {
              const raw = iframeLayerLayouts.get(member.id)
              if (raw) {
                // Lock Y so the dragged frame slides only horizontally.
                dragTranslateX = reorderPreview.cursor.x - grab.x - raw.x
                dragTranslateY = 0
              }
            }
          }

          // Where the member sits, and how dragging it moves its Group or
          // the selection (#568).
          const move = (
            _dx: number,
            _dy: number,
            totalDx: number,
            totalDy: number,
            metaKey: boolean
          ) => gestureLayerHandlers.onMove(totalDx, totalDy, metaKey)
          const placement: LayerPlacement = {
            worldX: layout.x,
            worldY: layout.y,
            zIndex: groupZIndex.get(group.id),
            dragTranslateX,
            dragTranslateY,
            dragPopped,
            onMoveGroup: move,
            onMoveSelected: move,
            onGroupDragStart: () =>
              gestureLayerHandlers.onGroupDragStart(member.id),
            onGroupDragEnd: gestureLayerHandlers.onGroupDragEnd,
            onRequestReorderDrag: gestureLayerHandlers.onRequestReorderDrag,
          }

          if (member.kind === "markdown-layer") {
            const doc = markdownLayers.find((d) => d.id === member.id)
            if (!doc) return null
            return (
              <MarkdownLayer
                key={doc.id}
                {...stable.value(`doc:${doc.id}`, {
                  layer: doc,
                  zoom,
                  labelHidden: labelsHidden.has(doc.id),
                  selected: selectedDocumentLayerIds.has(doc.id),
                  multiSelected,
                  editing: editingDocumentLayerId === doc.id,
                  spaceHeld,
                  userName: selfName,
                  userColor: selfColor,
                  placement,
                  remoteSelectedColor,
                  groupLabel,
                  // Named even when the group label names its Workspace, so
                  // the Group shows which layer the chat is on (#1726).
                  workingChat: workingChats.get(doc.id),
                  groupSelected,
                  onSelect: handleDocumentLayerSelect,
                  onResize: layerMutations.resizeDocument,
                  onTitleChange: layerMutations.setTitleCache,
                  onRename: layerMutations.setTitle,
                  onRemove: removeDocument,
                  onStartEdit: setEditingDocumentLayerId,
                  onStopEdit: () => setEditingDocumentLayerId(null),
                  onEditorReady: reference.onDocumentEditorReady,
                  commentMode,
                  onStartInlineComment: reference.startInlineComment,
                  onSelectInlineThread: reference.setActiveThread,
                  onReplyInChat: reference.replyInChat,
                } satisfies ComponentProps<typeof MarkdownLayer>)}
              />
            )
          }

          if (member.kind === "mockup-layer") {
            const mockup = mockupsById.get(member.id)
            if (!mockup) return null
            // A Mockup goes live as a frame does (#1523), in a Workspace it
            // borrows to run its page.
            const mockupLive = sharedFrames.liveOf(mockup.id)
            const liveWorkspace = sharedFrames.mockupWorkspaceOf(mockup.id)
            const mockupStream = sharedFrames.sharedIds.has(mockup.id)
              ? sharedFrames.streamOf(liveWorkspace)
              : undefined
            return (
              <MockupLayer
                // Going live or ending it starts the view afresh, as on a
                // frame.
                key={mockupStream ? `${mockup.id}:live` : mockup.id}
                {...stable.value(`mockup:${mockup.id}`, {
                  layer: mockup,
                  // Named even when the group label names its Workspace (#1726).
                  workingChat: workingChats.get(mockup.id),
                  zoom,
                  labelHidden: labelsHidden.has(mockup.id),
                  // Mockups share the Document selection Set.
                  selected: selectedDocumentLayerIds.has(mockup.id),
                  multiSelected,
                  spaceHeld,
                  placement,
                  remoteSelectedColor,
                  groupLabel,
                  groupSelected,
                  onSelect: handleDocumentLayerSelect,
                  onResize: gestureLayerHandlers.onResize,
                  onResizeStart: gestureLayerHandlers.onResizeStart,
                  onResizeEnd: gestureLayerHandlers.onResizeEnd,
                  onSetSize: layerMutations.setMockupSize,
                  onSetFitToContent: layerMutations.setFitToContent,
                  onFollowContentHeight: layerMutations.followContentHeight,
                  onRename: layerMutations.renameMockup,
                  onDuplicate: groupActions.duplicateMockup,
                  onRemove: removeMockup,
                  pickActive,
                  dimmed: dimmedIframeLayerIds.has(mockup.id),
                  onHover: reference.setInspectHover,
                  onDomReady: reference.onIframeLayerDomReady,
                  onCaptureReadyChange: handleCaptureReadyChange,
                  onCaptureDirty: handleCaptureDirty,
                  writes: layerMutations.mockupPage,
                  focused: focusedIframeLayerId === mockup.id,
                  driver: frameControl.driverOf(mockup.id),
                  askedForControl: frameControl.askedFor(mockup.id),
                  controlRequests: frameControl.requestsOf(mockup.id),
                  onGrantControl: frameControl.grant,
                  onDeclineControl: frameControl.decline,
                  onControlActivity: frameControl.active,
                  sharedStream: mockupStream,
                  live: mockupLive.live,
                  liveDriver: frameControl.liveDriverOf(mockup.id),
                  liveUnavailable: !liveWorkspace,
                  liveStarting: goLive.pendingIds.has(mockup.id),
                  onToggleLive: sharedFrames.mockupsGoLive
                    ? () => {
                        const stream = sharedFrames.streamOf(liveWorkspace)
                        if (!stream) return
                        goLive.toggle({
                          id: mockup.id,
                          live: mockupLive.live,
                          stream,
                          workspace: agents.find((a) => a.id === liveWorkspace),
                        })
                      }
                    : undefined,
                  onScrollChange: layerMutations.updateMockupScroll,
                  onColorSchemeChange: layerMutations.updateMockupColorScheme,
                  onFocus: focusPage,
                  commentMode,
                  onWheel: onIframeWheel,
                } satisfies ComponentProps<typeof MockupLayer>)}
              />
            )
          }

          const iframeLayer = framesById.get(member.id)
          if (!iframeLayer) return null
          const agentInfo = iframeLayer.branchId
            ? agentDomains[iframeLayer.branchId]
            : undefined
          // Resolve the assigned branch's ref independently of
          // preview readiness: the dropdown must reflect the
          // selection (and the frame show a "waiting" state) as
          // soon as a branch is picked, before its dev server —
          // and thus its previewDomain in `agentDomains` — is up.
          const assignedAgent = iframeLayer.branchId
            ? agents.find((a) => a.id === iframeLayer.branchId)
            : undefined
          const assignedRepo = assignedAgent
            ? repos.find((r) => r.id === assignedAgent.repoId)
            : undefined
          const previewDomain = agentInfo?.previewDomain
          // "Open in browser" resolves the portless named URL from the Branch's
          // sandbox + Repo, falling back to the port-based preview. Bound only
          // when the frame actually has a live preview to open.
          const openInBrowser =
            assignedAgent && assignedRepo && previewDomain
              ? () =>
                  openPreviewInBrowser({
                    sandboxName: assignedAgent.sandboxName,
                    repo: assignedRepo,
                    fallbackBase: previewDomain,
                    route: iframeLayer.route ?? "",
                  })
              : undefined
          // Frames are each viewer's own copy, an iframe that follows the
          // room, until someone turns one live (#1516): then everyone sees
          // the shared browser's stream.
          const live = sharedFrames.liveOf(iframeLayer.id)
          const stream = sharedFrames.sharedIds.has(iframeLayer.id)
            ? sharedFrames.streamOf(iframeLayer.branchId)
            : undefined
          const liveStream = sharedFrames.streamOf(iframeLayer.branchId)
          return (
            <IframeLayer
              // Going live or ending it starts the view afresh: a new stream
              // view, or a new iframe.
              key={stream ? `${iframeLayer.id}:live` : iframeLayer.id}
              {...stable.value(`frame:${iframeLayer.id}`, {
                iframeLayer: {
                  ...iframeLayer,
                  iframeUrl: agentInfo?.previewDomain,
                },
                sharedStream: stream,
                live: live.live,
                liveDriver: frameControl.liveDriverOf(iframeLayer.id),
                onToggleLive: liveStream
                  ? () =>
                      goLive.toggle({
                        id: iframeLayer.id,
                        live: live.live,
                        stream: liveStream,
                        workspace: assignedAgent,
                      })
                  : undefined,
                liveStarting: goLive.pendingIds.has(iframeLayer.id),
                zoom,
                labelHidden: labelsHidden.has(iframeLayer.id),
                focused: focusedIframeLayerId === iframeLayer.id,
                createFlow: createFlowIframeLayerId === iframeLayer.id,
                selected: selectedIframeLayerIds.has(iframeLayer.id),
                driver: frameControl.driverOf(iframeLayer.id),
                askedForControl: frameControl.askedFor(iframeLayer.id),
                controlRequests: frameControl.requestsOf(iframeLayer.id),
                onGrantControl: frameControl.grant,
                onDeclineControl: frameControl.decline,
                onControlActivity: frameControl.active,
                onFocus: focusPage,
                onToggleCreateFlow: (id) => {
                  setCreateFlowIframeLayerId(id)
                  if (id !== null) setFocusedIframeLayerId(null)
                },
                onSelect: handleIframeLayerSelect,
                onResize: gestureLayerHandlers.onResize,
                onResizeStart: gestureLayerHandlers.onResizeStart,
                onResizeEnd: gestureLayerHandlers.onResizeEnd,
                onRemove: removeIframeLayer,
                onRename: layerMutations.rename,
                onStateChanged: layerMutations.updateState,
                onRouteChange: layerMutations.updateRoute,
                onScrollChange: layerMutations.updateScroll,
                writes: layerMutations.framePage,
                onColorSchemeChange: layerMutations.updateColorScheme,
                onPlay: iframeLayer.branchId
                  ? handlePlayIframeLayer
                  : undefined,
                onOpenInBrowser: openInBrowser,
                onDuplicate: () =>
                  groupActions.duplicateIframeLayer(iframeLayer.id),
                onAskForKnob: iframeLayer.branchId
                  ? () => onAskForKnob(iframeLayer.branchId!)
                  : undefined,
                onSetFitToContent: layerMutations.setFitToContent,
                onFollowContentHeight: layerMutations.followContentHeight,
                onSetSize: layerMutations.setFrameSize,
                multiSelected,
                spaceHeld,
                commentMode,
                pickActive,
                dimmed: dimmedIframeLayerIds.has(iframeLayer.id),
                onHover: reference.setInspectHover,
                onWheel: onIframeWheel,
                onDomReady: reference.onIframeLayerDomReady,
                onCaptureReadyChange: handleCaptureReadyChange,
                onCaptureDirty: handleCaptureDirty,
                workspace: assignedAgent,
                onRestartWorkspace,
                onOpenLogs,
                onStartChat: iframeLayer.branchId ? undefined : onStartChat,
                asking: askingIframeLayerId === iframeLayer.id,
                assignableBranches: agents,
                onAssignBranch: layerMutations.assignAgent,
                discoveredRoutes: agentInfo?.discoveredRoutes,
                onSelectRoute: layerMutations.updateRoute,
                remoteSelectedColor,
                groupLabel,
                showWorkspace: !groupNamesWorkspace,
                groupSelected,
                placement,
              } satisfies ComponentProps<typeof IframeLayer>)}
            />
          )
        })
        stable.sweep()
        return rendered
      })()}

      {/* Trailing add-member placeholder click targets — one per group while
          the Frame or Document tool is armed. The visible outline is painted by
          PlaceholderRectsUnderlay; this is just the transparent hit target,
          positioned absolutely in world space. A click appends a member of the
          armed tool's kind, selects it, and drops back to Select. */}
      {placeholderRects.map((rect) => (
        <button
          key={`placeholder-${rect.groupId}`}
          type="button"
          data-iframe-layer-placeholder
          className="absolute cursor-pointer bg-transparent"
          style={{
            left: rect.x,
            top: rect.y,
            width: rect.width,
            height: rect.height,
            zIndex: groupZIndex.get(rect.groupId),
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            onPlaceholderAdd(rect.groupId)
          }}
          aria-label={
            placeholderTool === "document"
              ? "Add document to group"
              : "Add frame to group"
          }
        />
      ))}
    </>
  )
}

/**
 * Memoized so a canvas pan/zoom — which re-renders the parent every frame to
 * move the screen-space overlays — does NOT re-render the (heavy) iframe/markdown
 * layer tree. The layers are world-positioned and slide for free via the parent
 * transform; nothing here depends on the live viewport, and `zoom` (the one
 * camera value the title bars read) is constant during a pan. All props are kept
 * reference-stable upstream so this memo actually bails. See the prop comments
 * on `onIframeWheel` / `selfName` for the two that used to churn per frame.
 */
export const CanvasMemberLayer = memo(CanvasMemberLayerImpl)
