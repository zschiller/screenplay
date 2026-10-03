"use client"

import { memo, useMemo } from "react"

import { getGroupMembers } from "@/lib/canvas/layout"
import {
  groupAssignSummary,
  groupSwitchSummary,
  groupWorkspace,
} from "@/lib/canvas/group-workspace"
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
import { hiddenLayerLabels } from "@/lib/canvas/layer-labels"
import type { FrameControl } from "./use-frame-control"
import type { SharedFrames } from "./use-shared-frames"

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
  documentWorkspaces,
  mockupLayers,
  selection,
  onIframeWheel,
  reference,
  gesturePreview,
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
  handlePlayIframeLayer,
  onAskForKnob,
  onAskForMockupKnob,
  handleCaptureReadyChange,
  handleCaptureDirty,
  layerMutations,
  groupActions,
}: {
  iframeLayerGroups: IframeLayerGroupData[]
  iframeLayers: IframeLayerData[]
  markdownLayers: MarkdownLayerData[]
  /** The Workspace of each Document's and Mockup's owning chat (#1314, #1309), by layer id. */
  documentWorkspaces: ReadonlyMap<string, string>
  mockupLayers: MockupLayerData[]
  selection: CanvasSelection
  /** Forwarded wheel from inside an interactive iframe (cursor-centered zoom).
   *  Just `camera.handleIframeWheel` — passed as the bare callback rather than
   *  the whole camera object so this memoized layer doesn't re-render every pan
   *  frame (the camera object is recreated each render). */
  onIframeWheel: CanvasCamera["handleIframeWheel"]
  reference: ElementReference
  gesturePreview: GesturePreview
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
  handlePlayIframeLayer: NonNullable<IframeLayerProps["onPlay"]>
  /** Start an "add a knob" request in a Workspace's chat composer. */
  onAskForKnob: (branchId: string) => void
  /**
   * Start an "add a knob" request in the composer of the chat that made a
   * Mockup.
   */
  onAskForMockupKnob: (mockupId: string) => void
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
  // Alias the controller state/verbs to the local names the JSX reads, so the
  // flat-member render below stays a verbatim move from `canvas.tsx`.
  const renameIframeLayerGroup = groupActions.renameIframeLayerGroup
  const selectedIframeLayerIds = selection.iframeLayerIds
  const selectedGroupIds = selection.groupIds
  const selectedDocumentLayerIds = selection.documentLayerIds
  const handleIframeLayerSelect = selection.selectIframeLayer
  const handleGroupSelect = selection.selectGroup
  const handleDocumentLayerSelect = selection.selectDocumentLayer
  const labelsHidden = useMemo(
    () => hiddenLayerLabels(effectiveIframeLayerLayouts.values(), zoom),
    [effectiveIframeLayerLayouts, zoom]
  )

  return (
    <>
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
          const shared = groupWorkspace(group, framesById, documentWorkspaces)
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
                summary: [groupSwitchSummary(frames)],
                onPick: (branchId: string) =>
                  layerMutations.assignGroupAgent(group.id, branchId),
              },
            }
          }
          const switcher = {
            branches: agents,
            summary: [
              shared.branchId
                ? groupSwitchSummary(shared.frames.length)
                : // Frames with no Workspace yet pick one here, once,
                  // instead of on each frame's label (#871).
                  groupAssignSummary(shared.frames.length),
            ],
            onPick: (branchId: string) =>
              layerMutations.assignGroupAgent(group.id, branchId),
          }
          if (!shared.branchId) return { switcher }
          const workspace = workspaceOf(shared.branchId)
          // A Group of one chat's Documents names its Workspace, with no
          // frames for a pick to move (#1314).
          if (shared.frames.length === 0) return workspace
          return workspace ? { ...workspace, switcher } : undefined
        }

        return entries.map(({ member, group }) => {
          const members = getGroupMembers(group)
          const index = members.findIndex((m) => m.id === member.id)
          const groupSelected = selectedGroupIds.has(group.id)
          const showGroupLabel = members.length > 1
          const groupLabel = showGroupLabel
            ? groupDisplayNames.get(group.id)
            : undefined
          // Every frame names its own Workspace unless the group label names
          // the one they all show (#1276).
          const groupNamesWorkspace =
            showGroupLabel &&
            !!groupWorkspace(group, framesById, documentWorkspaces)
          const groupLabelWorkspace =
            index === 0 && showGroupLabel ? groupSwitcherOf(group) : undefined
          // Tint this member's name (and, on the leftmost member,
          // the group label) to match a remote user's selection
          // rect. Skipped when we've selected it locally — our own
          // fuchsia takes precedence.
          const remoteSelectedColor = remoteSelectionColors.get(member.id)
          const remoteGroupSelectedColor =
            index === 0 ? remoteGroupSelectionColors.get(member.id) : undefined
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
          const reorderPreview = gesturePreview.reorder
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

          const zIndex = groupZIndex.get(group.id)

          if (member.kind === "markdown-layer") {
            const doc = markdownLayers.find((d) => d.id === member.id)
            if (!doc) return null
            return (
              <MarkdownLayer
                key={doc.id}
                layer={doc}
                zoom={zoom}
                labelHidden={labelsHidden.has(doc.id)}
                selected={selectedDocumentLayerIds.has(doc.id)}
                multiSelected={
                  selectedIframeLayerIds.size + selectedDocumentLayerIds.size >
                  1
                }
                editing={editingDocumentLayerId === doc.id}
                spaceHeld={spaceHeld}
                userName={selfName}
                userColor={selfColor}
                worldX={layout.x}
                worldY={layout.y}
                zIndex={zIndex}
                dragTranslateX={dragTranslateX}
                dragTranslateY={dragTranslateY}
                dragPopped={dragPopped}
                remoteSelectedColor={remoteSelectedColor}
                remoteGroupSelectedColor={remoteGroupSelectedColor}
                groupLabel={index === 0 ? groupLabel : undefined}
                groupWorkspace={groupLabelWorkspace}
                // The chat that made it, unless the group label names it
                // (#1314); a hand-made Document names none.
                ownerWorkspace={
                  groupNamesWorkspace
                    ? undefined
                    : workspaceOf(documentWorkspaces.get(doc.id))
                }
                groupSelected={groupSelected}
                onSelectGroup={
                  index === 0 && showGroupLabel
                    ? (shiftKey) => handleGroupSelect(group.id, shiftKey)
                    : undefined
                }
                onRenameGroup={
                  index === 0 && showGroupLabel
                    ? (name) => renameIframeLayerGroup(group.id, name)
                    : undefined
                }
                onSelect={handleDocumentLayerSelect}
                onMoveGroup={(_dx, _dy, totalDx, totalDy, metaKey) =>
                  gestureLayerHandlers.onMove(totalDx, totalDy, metaKey)
                }
                onMoveSelected={(_dx, _dy, totalDx, totalDy, metaKey) =>
                  gestureLayerHandlers.onMove(totalDx, totalDy, metaKey)
                }
                onGroupDragStart={() =>
                  gestureLayerHandlers.onGroupDragStart(doc.id)
                }
                onGroupDragEnd={gestureLayerHandlers.onGroupDragEnd}
                onRequestReorderDrag={gestureLayerHandlers.onRequestReorderDrag}
                onResize={layerMutations.resizeDocument}
                onTitleChange={layerMutations.setTitleCache}
                onRename={layerMutations.setTitle}
                onStartEdit={setEditingDocumentLayerId}
                onStopEdit={() => setEditingDocumentLayerId(null)}
                onEditorReady={reference.onDocumentEditorReady}
                commentMode={commentMode}
                onStartInlineComment={reference.startInlineComment}
                onSelectInlineThread={reference.setActiveThread}
                onReplyInChat={reference.replyInChat}
              />
            )
          }

          if (member.kind === "mockup-layer") {
            const mockup = mockupsById.get(member.id)
            if (!mockup) return null
            return (
              <MockupLayer
                key={mockup.id}
                layer={mockup}
                // The chat that made it, unless the group label names it
                // (#1309), as a chat-made Document does.
                ownerWorkspace={
                  groupNamesWorkspace
                    ? undefined
                    : workspaceOf(documentWorkspaces.get(mockup.id))
                }
                zoom={zoom}
                labelHidden={labelsHidden.has(mockup.id)}
                // Mockups share the Document selection Set.
                selected={selectedDocumentLayerIds.has(mockup.id)}
                multiSelected={
                  selectedIframeLayerIds.size + selectedDocumentLayerIds.size >
                  1
                }
                spaceHeld={spaceHeld}
                worldX={layout.x}
                worldY={layout.y}
                zIndex={zIndex}
                dragTranslateX={dragTranslateX}
                dragTranslateY={dragTranslateY}
                dragPopped={dragPopped}
                remoteSelectedColor={remoteSelectedColor}
                remoteGroupSelectedColor={remoteGroupSelectedColor}
                groupLabel={index === 0 ? groupLabel : undefined}
                groupWorkspace={groupLabelWorkspace}
                groupSelected={groupSelected}
                onSelectGroup={
                  index === 0 && showGroupLabel
                    ? (shiftKey) => handleGroupSelect(group.id, shiftKey)
                    : undefined
                }
                onRenameGroup={
                  index === 0 && showGroupLabel
                    ? (name) => renameIframeLayerGroup(group.id, name)
                    : undefined
                }
                onSelect={handleDocumentLayerSelect}
                onMoveGroup={(_dx, _dy, totalDx, totalDy, metaKey) =>
                  gestureLayerHandlers.onMove(totalDx, totalDy, metaKey)
                }
                onMoveSelected={(_dx, _dy, totalDx, totalDy, metaKey) =>
                  gestureLayerHandlers.onMove(totalDx, totalDy, metaKey)
                }
                onGroupDragStart={() =>
                  gestureLayerHandlers.onGroupDragStart(mockup.id)
                }
                onGroupDragEnd={gestureLayerHandlers.onGroupDragEnd}
                onRequestReorderDrag={gestureLayerHandlers.onRequestReorderDrag}
                onResize={layerMutations.resizeMockup}
                onRename={layerMutations.renameMockup}
                onSetStatus={layerMutations.setMockupStatus}
                pickActive={pickActive}
                dimmed={dimmedIframeLayerIds.has(mockup.id)}
                onHover={reference.setInspectHover}
                onDomReady={reference.onIframeLayerDomReady}
                onKnobsDeclared={layerMutations.updateMockupKnobs}
                onKnobValuesChange={layerMutations.updateMockupKnobValues}
                onSharedStateChanged={layerMutations.updateMockupSharedState}
                focused={focusedIframeLayerId === mockup.id}
                driver={frameControl.driverOf(mockup.id)}
                onFocus={(id) => {
                  if (id === null) {
                    setFocusedIframeLayerId(null)
                    return
                  }
                  // Interact goes through Frame Control, as on a frame: it
                  // takes the mockup from the agent.
                  frameControl.interact(id)
                  setCreateFlowIframeLayerId(null)
                }}
                commentMode={commentMode}
                onWheel={onIframeWheel}
                onAskForKnob={
                  documentWorkspaces.has(mockup.id)
                    ? () => onAskForMockupKnob(mockup.id)
                    : undefined
                }
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
          // This viewer's local copy of a shared frame (#1397) is a
          // per-viewer iframe on its own route, and nothing it does is
          // written to the room.
          const localCopy = sharedFrames.localCopyOf(iframeLayer)
          const stream = localCopy
            ? undefined
            : sharedFrames.streamOf(iframeLayer.branchId)
          const setLocalRoute = (id: string, route: string) =>
            sharedFrames.setLocalRoute(id, route)
          return (
            <IframeLayer
              // Switching between the shared frame and a local copy starts
              // the view afresh: a new iframe, or a new stream view.
              key={localCopy ? `${iframeLayer.id}:local` : iframeLayer.id}
              iframeLayer={{
                ...iframeLayer,
                // Until the app says whether the Workspace's frames are
                // shared, the frame waits rather than loading an iframe.
                iframeUrl: sharedFrames.checking(iframeLayer.branchId)
                  ? undefined
                  : agentInfo?.previewDomain,
                ...(localCopy ? { route: localCopy.route } : {}),
              }}
              sharedStream={
                stream
                  ? { connection: stream, roomId: sharedFrames.roomId }
                  : undefined
              }
              localCopy={!!localCopy}
              onGoLocal={
                stream
                  ? () => {
                      frameControl.letGo(iframeLayer.id)
                      sharedFrames.goLocal(iframeLayer)
                    }
                  : undefined
              }
              onRejoin={
                localCopy
                  ? () => {
                      frameControl.letGo(iframeLayer.id)
                      sharedFrames.rejoin(iframeLayer.id)
                    }
                  : undefined
              }
              zoom={zoom}
              labelHidden={labelsHidden.has(iframeLayer.id)}
              focused={focusedIframeLayerId === iframeLayer.id}
              createFlow={createFlowIframeLayerId === iframeLayer.id}
              selected={selectedIframeLayerIds.has(iframeLayer.id)}
              driver={frameControl.driverOf(iframeLayer.id)}
              askedForControl={frameControl.askedFor(iframeLayer.id)}
              controlRequests={frameControl.requestsOf(iframeLayer.id)}
              onGrantControl={frameControl.grant}
              onDeclineControl={frameControl.decline}
              onFocus={(id) => {
                if (id === null) {
                  setFocusedIframeLayerId(null)
                  return
                }
                // Interact goes through Frame Control: it takes the frame
                // from the agent, or asks the person driving it.
                frameControl.interact(id)
                setCreateFlowIframeLayerId(null)
              }}
              onToggleCreateFlow={(id) => {
                setCreateFlowIframeLayerId(id)
                if (id !== null) setFocusedIframeLayerId(null)
              }}
              onSelect={handleIframeLayerSelect}
              onMoveGroup={(_dx, _dy, totalDx, totalDy, metaKey) =>
                gestureLayerHandlers.onMove(totalDx, totalDy, metaKey)
              }
              onMoveSelected={(_dx, _dy, totalDx, totalDy, metaKey) =>
                gestureLayerHandlers.onMove(totalDx, totalDy, metaKey)
              }
              onGroupDragStart={() =>
                gestureLayerHandlers.onGroupDragStart(iframeLayer.id)
              }
              onGroupDragEnd={gestureLayerHandlers.onGroupDragEnd}
              onRequestReorderDrag={gestureLayerHandlers.onRequestReorderDrag}
              onResize={gestureLayerHandlers.onResize}
              onResizeStart={gestureLayerHandlers.onResizeStart}
              onResizeEnd={gestureLayerHandlers.onResizeEnd}
              onRemove={removeIframeLayer}
              onRename={layerMutations.rename}
              onStateChanged={
                localCopy ? ignoreLocalState : layerMutations.updateState
              }
              onRouteChange={
                localCopy ? setLocalRoute : layerMutations.updateRoute
              }
              onScrollChange={
                localCopy ? undefined : layerMutations.updateScroll
              }
              onKnobsDeclared={layerMutations.updateKnobs}
              onKnobValuesChange={layerMutations.updateKnobValues}
              onSharedStateChanged={
                localCopy ? undefined : layerMutations.updateSharedState
              }
              onPlay={iframeLayer.branchId ? handlePlayIframeLayer : undefined}
              onOpenInBrowser={openInBrowser}
              onDuplicate={() =>
                groupActions.duplicateIframeLayer(group.id, iframeLayer.id)
              }
              onAskForKnob={
                iframeLayer.branchId
                  ? () => onAskForKnob(iframeLayer.branchId!)
                  : undefined
              }
              onFitToContent={layerMutations.fitToContent}
              onSetSize={layerMutations.fitToContent}
              multiSelected={
                selectedIframeLayerIds.size + selectedDocumentLayerIds.size > 1
              }
              spaceHeld={spaceHeld}
              commentMode={commentMode}
              pickActive={pickActive}
              dimmed={dimmedIframeLayerIds.has(iframeLayer.id)}
              onHover={reference.setInspectHover}
              onWheel={onIframeWheel}
              onDomReady={reference.onIframeLayerDomReady}
              onCaptureReadyChange={handleCaptureReadyChange}
              onCaptureDirty={handleCaptureDirty}
              workspace={assignedAgent}
              onRestartWorkspace={onRestartWorkspace}
              onOpenLogs={onOpenLogs}
              onStartChat={iframeLayer.branchId ? undefined : onStartChat}
              assignableBranches={agents}
              onAssignBranch={layerMutations.assignAgent}
              discoveredRoutes={agentInfo?.discoveredRoutes}
              onSelectRoute={
                localCopy ? setLocalRoute : layerMutations.updateRoute
              }
              remoteSelectedColor={remoteSelectedColor}
              remoteGroupSelectedColor={remoteGroupSelectedColor}
              groupLabel={index === 0 ? groupLabel : undefined}
              groupWorkspace={groupLabelWorkspace}
              showWorkspace={!groupNamesWorkspace}
              groupSelected={groupSelected}
              onSelectGroup={
                index === 0 && showGroupLabel
                  ? (shiftKey) => handleGroupSelect(group.id, shiftKey)
                  : undefined
              }
              onRenameGroup={
                index === 0 && showGroupLabel
                  ? (name) => renameIframeLayerGroup(group.id, name)
                  : undefined
              }
              worldX={layout.x}
              worldY={layout.y}
              zIndex={zIndex}
              dragTranslateX={dragTranslateX}
              dragTranslateY={dragTranslateY}
              dragPopped={dragPopped}
            />
          )
        })
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

/** A local copy's page state stays in the copy (#1397). */
function ignoreLocalState() {}

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
