import type { IframeLayerLayoutMap } from "@/lib/canvas/layout"
import type { DomRect } from "@/lib/postmessage-protocol"
import type {
  HighlightTarget,
  PickedElement,
  PickRequest,
} from "@/lib/targeting-store"

/**
 * Element Targeting core (PRD #616, #705) — the React-free half of a Composer's
 * one-shot crosshair pick of an element on the canvas. The `useElementTargeting`
 * controller is the thin React binding; everything that decides lives here so it
 * is asserted against fake layouts and a fake element-at-point resolver rather
 * than through the Canvas root:
 *
 * - **one eligibility rule** (`isTargetableFrame`): a frame is targetable for a
 *   pick iff its `branchId` equals the pick's Branch id. The eligible set, the
 *   dimmed set, and the per-Branch "has anything to hit" publish all derive from
 *   it, so they can never disagree;
 * - **hit-testing** a world-space point against the eligible frames' layouts;
 * - the **pick state machine** (`ElementTargeting`): idle → armed → resolving →
 *   idle, where a new request supersedes the prior pick (resolving it `null`),
 *   cancel / miss / a closed frame resolve `null`, and a late element-at-point
 *   answer for a pick that was already settled is dropped;
 * - **highlight sequencing**: a hovered token's selector resolves to a rect
 *   asynchronously, and a newer hover (or a reset) supersedes an in-flight one.
 *
 * The layers a pick can hit are frames and Mockups (#1309), as
 * {@link TargetLayer}s: a Mockup counts as the Workspace's of the chat that
 * last changed it.
 *
 * The pick key is the requesting Composer's **Branch id**. Agent chats pass it as
 * their `sandboxId` prop (a sandbox-backed agent's id *is* its Branch id), and
 * eligibility matches it against each Iframe Layer's `branchId`.
 */

/**
 * A layer a pick can hit: a frame, or a Mockup, whose `branchId` is the
 * Workspace of the chat that last changed it (a Mockup has no route of its own). An
 * `IframeLayerData` is one as it stands.
 */
export interface TargetLayer {
  id: string
  branchId?: string
  route?: string
  label: string
  kind?: "mockup"
}

/**
 * The pick key of the Coordinator's Composer: it sees the whole canvas, so it
 * picks in every Workspace's frames and in every Mockup, and passes the element
 * on to the chat that owns it. Never a Branch id (those are nanoids).
 */
export const ANY_BRANCH = "*"

/**
 * The single eligibility rule: an Iframe Layer is targetable for a pick keyed by
 * `branchId` iff it belongs to that Branch, or for an {@link ANY_BRANCH} pick
 * iff it is a Mockup or a frame with a Branch. An absent Branch id (a composer
 * with no bound Branch) targets nothing, and a frame with no `branchId` (an
 * empty frame) is never targetable — matching happens on a concrete id, never
 * on `undefined === undefined`.
 */
export function isTargetableFrame(
  layer: TargetLayer,
  branchId: string | null | undefined
): boolean {
  if (branchId === ANY_BRANCH)
    return !!layer.branchId || layer.kind === "mockup"
  return !!branchId && layer.branchId === branchId
}

// Stable empty set for the "no pick armed → nothing dimmed" case, so a memoized
// consumer isn't handed a fresh Set identity every render.
const EMPTY_IDS: ReadonlySet<string> = new Set()

/**
 * Split the room's frames for a pick keyed by `branchId` into the eligible ones
 * (the only frames the hit-test resolves against) and the ids of the rest (drawn
 * dimmed so it's clear what can be targeted). With no pick (`null`), nothing is
 * eligible and nothing is dimmed.
 */
export function partitionTargetFrames(
  branchId: string | null,
  iframeLayers: readonly TargetLayer[]
): { eligible: TargetLayer[]; dimmedIds: ReadonlySet<string> } {
  if (branchId === null) return { eligible: [], dimmedIds: EMPTY_IDS }
  const eligible: TargetLayer[] = []
  const dimmedIds = new Set<string>()
  for (const layer of iframeLayers) {
    if (isTargetableFrame(layer, branchId)) eligible.push(layer)
    else dimmedIds.add(layer.id)
  }
  return { eligible, dimmedIds }
}

/**
 * The Branch ids a pick would have something to hit for — those with at least
 * one targetable frame on the canvas, plus {@link ANY_BRANCH} when anything is
 * targetable. Published to the Composers so each can disable its target
 * affordance when its own Branch has no frame (#619).
 */
export function targetableBranchIds(
  iframeLayers: readonly TargetLayer[]
): Set<string> {
  const ids = new Set<string>()
  for (const layer of iframeLayers) {
    if (layer.branchId && isTargetableFrame(layer, layer.branchId)) {
      ids.add(layer.branchId)
    }
    if (isTargetableFrame(layer, ANY_BRANCH)) ids.add(ANY_BRANCH)
  }
  return ids
}

/**
 * Hit-test a world-space point against the eligible frames' layouts. Returns the
 * first eligible frame (in layout order) containing the point, with the point in
 * that frame's local (iframe-viewport) coordinates — or `null` for a miss.
 */
export function hitTestTargetFrame(
  point: { x: number; y: number },
  eligible: readonly TargetLayer[],
  layouts: IframeLayerLayoutMap
): { layer: TargetLayer; localX: number; localY: number } | null {
  const byId = new Map(eligible.map((layer) => [layer.id, layer]))
  for (const layout of layouts.values()) {
    const layer = byId.get(layout.id)
    if (!layer) continue
    if (
      point.x >= layout.x &&
      point.x <= layout.x + layout.width &&
      point.y >= layout.y &&
      point.y <= layout.y + layout.height
    ) {
      return { layer, localX: point.x - layout.x, localY: point.y - layout.y }
    }
  }
  return null
}

/** The element the in-iframe bridge reports at a point (structural subset of
 *  its `PickResult`). */
export interface ElementAtPointResult {
  tagName?: string
  id?: string
  selector: string
}

/** The per-frame DOM bridge surface targeting needs. Absent for a closed frame
 *  (one whose iframe isn't mounted). */
export interface TargetingFrameDom {
  elementAtPoint(x: number, y: number): Promise<ElementAtPointResult | null>
  getRectsForSelectors(selectors: string[]): Promise<(DomRect | null)[]>
}

export type GetTargetingFrameDom = (
  iframeLayerId: string
) => TargetingFrameDom | undefined

/** A resolved token highlight, in its frame's local coordinates. */
export interface TargetHighlight {
  iframeLayerId: string
  rect: DomRect
}

/**
 * Project a frame-local highlight into world space through the frame's layout,
 * or `null` when there's no highlight or its frame has no layout.
 */
export function projectHighlight(
  highlight: TargetHighlight | null,
  layouts: IframeLayerLayoutMap
): DomRect | null {
  if (!highlight) return null
  const layout = layouts.get(highlight.iframeLayerId)
  if (!layout) return null
  return {
    x: layout.x + highlight.rect.x,
    y: layout.y + highlight.rect.y,
    width: highlight.rect.width,
    height: highlight.rect.height,
  }
}

/** Where the pick is in its lifecycle. Only `armed` shows pick mode (crosshair,
 *  dimming, click routing); `resolving` is the async element-at-point
 *  round-trip after a hit, during which the canvas is already back to normal. */
export type TargetingPhase = "idle" | "armed" | "resolving"

export interface TargetingSnapshot {
  phase: TargetingPhase
  /** The Branch id of the armed pick, or `null` unless `phase === "armed"`. */
  armedBranchId: string | null
  /** The resolved token highlight, frame-local, or `null`. */
  highlight: TargetHighlight | null
}

/** What a click hands the core: the world-space point plus the room snapshot. */
export interface TargetingClickInputs {
  point: { x: number; y: number }
  iframeLayers: readonly TargetLayer[]
  layouts: IframeLayerLayoutMap
  getDom: GetTargetingFrameDom
}

const IDLE: TargetingSnapshot = {
  phase: "idle",
  armedBranchId: null,
  highlight: null,
}

/**
 * The pick state machine plus highlight sequencing. Every pick request settles
 * **exactly once**: with the picked element, or `null` on supersede, cancel,
 * miss, closed frame, bridge failure, or reset (unmount). A late element-at-point
 * answer for a pick that already settled is dropped.
 *
 * Observable via `subscribe` / `getSnapshot` (a `useSyncExternalStore` pair);
 * the snapshot is replaced, never mutated, on every change.
 */
export class ElementTargeting {
  private snapshot: TargetingSnapshot = IDLE
  private listeners = new Set<() => void>()
  // The pending (armed or resolving) request, or null when idle.
  private pending: PickRequest | null = null
  private highlightSeq = 0

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): TargetingSnapshot => this.snapshot

  /** Whether a pick is armed (pick mode is showing). */
  isArmed(): boolean {
    return this.snapshot.phase === "armed"
  }

  /** Arm a pick, superseding any pending one (which resolves `null`). */
  request(request: PickRequest): void {
    this.settle(null)
    this.pending = request
    this.update({ phase: "armed", armedBranchId: request.branchId })
  }

  /** Cancel the pending pick (armed or resolving) — it resolves `null`. */
  cancel(): void {
    this.settle(null)
    this.update({ phase: "idle", armedBranchId: null })
  }

  /**
   * Resolve an armed pick from a canvas click. A miss (outside every eligible
   * frame) or a closed frame cancels; a hit on an open frame leaves pick mode
   * immediately and resolves once the frame's bridge answers.
   */
  click({ point, iframeLayers, layouts, getDom }: TargetingClickInputs): void {
    const request = this.pending
    if (!request || this.snapshot.phase !== "armed") return
    const { eligible } = partitionTargetFrames(request.branchId, iframeLayers)
    const hit = hitTestTargetFrame(point, eligible, layouts)
    const dom = hit ? getDom(hit.layer.id) : undefined
    if (!hit || !dom) {
      this.cancel()
      return
    }
    const { layer, localX, localY } = hit
    this.update({ phase: "resolving", armedBranchId: null })
    const finish = (picked: PickedElement | null) => {
      // Dropped if the pick already settled (superseded, cancelled, reset).
      if (this.pending !== request) return
      this.settle(picked)
      this.update({ phase: "idle", armedBranchId: null })
    }
    dom
      .elementAtPoint(localX, localY)
      .then((result) => {
        if (!result || !result.tagName) {
          finish(null)
          return
        }
        finish({
          tagName: result.tagName,
          id: result.id,
          selector: result.selector,
          // A Mockup's page has no route; the agent finds it by id instead.
          route:
            layer.kind === "mockup"
              ? `mockup ${layer.id}`
              : (layer.route ?? "/"),
          iframeLayerId: layer.id,
          frameLabel: layer.label,
          ...(layer.kind === "mockup" ? { layerKind: "mockup" as const } : {}),
        })
      })
      .catch(() => finish(null))
  }

  /**
   * Show (or clear, with `null`) the outline for a hovered token. The selector
   * resolves through the frame's bridge; a closed frame or stale selector clears
   * it, and a newer call supersedes any in-flight resolve.
   */
  highlight(
    target: HighlightTarget | null,
    getDom: GetTargetingFrameDom
  ): void {
    const seq = ++this.highlightSeq
    const dom = target ? getDom(target.iframeLayerId) : undefined
    if (!target || !dom) {
      this.update({ highlight: null })
      return
    }
    dom
      .getRectsForSelectors([target.selector])
      .then(([rect]) => {
        if (seq !== this.highlightSeq) return
        this.update({
          highlight: rect
            ? { iframeLayerId: target.iframeLayerId, rect }
            : null,
        })
      })
      .catch(() => {
        if (seq === this.highlightSeq) this.update({ highlight: null })
      })
  }

  /**
   * Tear down on unmount: the pending pick resolves `null` so its promise never
   * dangles, any in-flight highlight is dropped, and the state returns to idle.
   * The instance stays usable (a remount re-arms it).
   */
  reset(): void {
    this.settle(null)
    this.highlightSeq++
    this.update(IDLE)
  }

  private settle(picked: PickedElement | null): void {
    const request = this.pending
    if (!request) return
    this.pending = null
    request.resolve(picked)
  }

  private update(patch: Partial<TargetingSnapshot>): void {
    const next = { ...this.snapshot, ...patch }
    if (
      next.phase === this.snapshot.phase &&
      next.armedBranchId === this.snapshot.armedBranchId &&
      next.highlight === this.snapshot.highlight
    ) {
      return
    }
    this.snapshot = next
    for (const listener of this.listeners) listener()
  }
}
