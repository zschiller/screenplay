"use client"

import { memo } from "react"

import { getGroupMembers } from "@/lib/canvas/layout"
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
  RepoData,
} from "@/lib/types"
import { openPreviewInBrowser } from "@/lib/open-preview"

import { IframeLayer } from "./iframe-layer"
import { MarkdownLayer } from "./markdown-layer"
import { useCanvasGesture } from "./use-canvas-gesture"
import type { CanvasCamera } from "./use-canvas-camera"
import type { CanvasSelection } from "./use-canvas-selection"
import type { ElementReference } from "./use-element-reference"
import type { LayerMutations } from "./use-layer-mutations"
import type { GroupActions } from "./use-group-actions"

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
 * The flat member layer (PRD #571) — every Iframe Layer and Markdown Layer
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
  remoteSelectionColors,
  remoteGroupSelectionColors,
  agentDomains,
  agents,
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
  createFlowIframeLayerId,
  setCreateFlowIframeLayerId,
  removeIframeLayer,
  handlePlayIframeLayer,
  handleCaptureReadyChange,
  handleCaptureDirty,
  layerMutations,
  groupActions,
}: {
  iframeLayerGroups: IframeLayerGroupData[]
  iframeLayers: IframeLayerData[]
  markdownLayers: MarkdownLayerData[]
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
  remoteSelectionColors: Map<string, string>
  remoteGroupSelectionColors: Map<string, string>
  agentDomains: AgentDomains
  agents: BranchData[]
  repos: RepoData[]
  zoom: number
  spaceHeld: boolean
  commentMode: boolean
  /** True while an element pick is armed; eligible (non-dimmed) frames show the
   *  element hover overlay so the user can see what they're about to target. */
  pickActive: boolean
  /**
   * Iframe Layers to dim during an armed element pick (#619): every frame *not*
   * eligible for the requesting branch, so it's visually clear which frames can
   * be targeted. Empty whenever no pick is armed.
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
  createFlowIframeLayerId: string | null
  setCreateFlowIframeLayerId: React.Dispatch<
    React.SetStateAction<string | null>
  >
  removeIframeLayer: IframeLayerProps["onRemove"]
  handlePlayIframeLayer: NonNullable<IframeLayerProps["onPlay"]>
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
  const setSelectedIframeLayerIds = selection.setIframeLayerIds
  const setSelectedGroupIds = selection.setGroupIds
  const setSelectedDocumentLayerIds = selection.setDocumentLayerIds
  const handleIframeLayerSelect = selection.selectIframeLayer
  const handleGroupSelect = selection.selectGroup
  const handleDocumentLayerSelect = selection.selectDocumentLayer

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

        return entries.map(({ member, group }) => {
          const members = getGroupMembers(group)
          const index = members.findIndex((m) => m.id === member.id)
          const groupSelected = selectedGroupIds.has(group.id)
          const showGroupLabel = members.length > 1
          const groupLabel = showGroupLabel
            ? groupDisplayNames.get(group.id)
            : undefined
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
                onStartInlineComment={reference.startInlineComment}
                onSelectInlineThread={reference.setActiveThread}
              />
            )
          }

          const iframeLayer = iframeLayers.find((a) => a.id === member.id)
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
          return (
            <IframeLayer
              key={iframeLayer.id}
              iframeLayer={{
                ...iframeLayer,
                iframeUrl: agentInfo?.previewDomain,
                branch: agentInfo?.branch ?? assignedAgent?.ref,
              }}
              zoom={zoom}
              focused={focusedIframeLayerId === iframeLayer.id}
              createFlow={createFlowIframeLayerId === iframeLayer.id}
              selected={selectedIframeLayerIds.has(iframeLayer.id)}
              onFocus={(id) => {
                setFocusedIframeLayerId(id)
                if (id !== null) setCreateFlowIframeLayerId(null)
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
              onStateChanged={layerMutations.updateState}
              onRouteChange={layerMutations.updateRoute}
              onScrollChange={layerMutations.updateScroll}
              onKnobsDeclared={layerMutations.updateKnobs}
              onKnobValuesChange={layerMutations.updateKnobValues}
              onSharedStateChanged={layerMutations.updateSharedState}
              onPlay={iframeLayer.branchId ? handlePlayIframeLayer : undefined}
              onOpenInBrowser={openInBrowser}
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
              assignableBranches={agents}
              onAssignBranch={layerMutations.assignAgent}
              discoveredRoutes={agentInfo?.discoveredRoutes}
              onSelectRoute={layerMutations.updateRoute}
              remoteSelectedColor={remoteSelectedColor}
              remoteGroupSelectedColor={remoteGroupSelectedColor}
              groupLabel={index === 0 ? groupLabel : undefined}
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
          armed tool's kind and selects it. */}
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
            if (placeholderTool === "document") {
              const newId = groupActions.addDocumentLayerToGroup(rect.groupId)
              if (newId) {
                setSelectedDocumentLayerIds(new Set([newId]))
                setSelectedIframeLayerIds(new Set())
                setSelectedGroupIds(new Set())
              }
              return
            }
            const newId = groupActions.addIframeLayerToGroup(rect.groupId)
            if (newId) {
              setSelectedIframeLayerIds(new Set([newId]))
              setSelectedGroupIds(new Set())
              setSelectedDocumentLayerIds(new Set())
            }
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
