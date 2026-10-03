"use client"

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import Link from "next/link"
import { animate, motion, useMotionValue, useReducedMotion } from "motion/react"
import {
  ArrowLeftIcon,
  ChatIcon,
  ChatTextIcon,
  ChatsIcon,
  DotsSixVerticalIcon,
  SlidersHorizontalIcon,
} from "@workspace/ui/components/icons"
import { Button } from "@workspace/ui/components/button"
import { IconButton } from "@workspace/ui/components/icon-button"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectPrimitive,
  SelectSeparator,
} from "@workspace/ui/components/select"
import { TooltipProvider } from "@workspace/ui/components/tooltip"
import type { JsonObject, JsonValue } from "@/lib/postmessage-protocol"
import {
  IFRAME_LAYER_SIZE_CATEGORY_ICONS,
  GROUPED_IFRAME_LAYER_SIZE_PRESETS,
  formatIframeLayerSize,
  getIframeLayerSizePreset,
} from "@/lib/iframe-layer-sizes"
import { CommentsPanel } from "@/components/canvas/comments-panel"
import { PlayerKnobs } from "./player-knobs"
import type { PlayerComments } from "./player-comments"
import { isLocalBuild } from "@/lib/local-mode"

type Corner = "tl" | "tr" | "bl" | "br"

type Panel = "knobs" | "comments" | null

const MARGIN = 16
// Approximate first-paint size — replaced by the real measured size as soon
// as the HUD has rendered, used only so the very first frame already lands
// near the right corner.
const HUD_WIDTH = 132
const HUD_HEIGHT = 36
const PANEL_WIDTH = 320
// The comments panel's filters and grouped rows need a fixed, taller box.
const COMMENTS_PANEL_HEIGHT = 480
const PANEL_GAP = 8
const STORAGE_KEY = "screenplay:player-hud-corner"

interface PlayerHudProps {
  roomId: string
  roomName: string
  knobs: JsonValue[]
  knobValues: JsonObject
  onKnobChange: (next: JsonObject) => void
  /**
   * Fires when the HUD's drag state flips. The parent uses this to disable
   * pointer events on the underlying iframe so a fast drag can't escape into
   * its document — pointer capture doesn't cross cross-origin iframe
   * boundaries, so without this the drag drops the moment the cursor leaves
   * the pill.
   */
  onDraggingChange?: (dragging: boolean) => void
  /** Toggle the agent chat side panel. */
  onToggleChat?: () => void
  /** Reflects the chat panel's expanded state so the HUD button can flip variants. */
  chatOpen?: boolean
  /** The Workspace's comments: the comment tool and the thread list. */
  comments: PlayerComments
  /** Active device preview preset id (from `lib/iframeLayer-sizes`). */
  deviceSizeId: string
  onDeviceSizeChange: (id: string) => void
}

export function PlayerHud({
  roomId,
  roomName,
  knobs,
  knobValues,
  onKnobChange,
  onDraggingChange,
  onToggleChat,
  chatOpen,
  comments,
  deviceSizeId,
  onDeviceSizeChange,
}: PlayerHudProps) {
  const devicePreset = getIframeLayerSizePreset(deviceSizeId)
  const DeviceIcon = IFRAME_LAYER_SIZE_CATEGORY_ICONS[devicePreset.category]
  // Read the saved corner lazily so the very first render already places the
  // HUD in the right spot. Guarded for SSR where `window` is undefined.
  const [corner, setCorner] = useState<Corner>(() => {
    if (typeof window === "undefined") return "br"
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (saved === "tl" || saved === "tr" || saved === "bl" || saved === "br") {
      return saved
    }
    return "br"
  })
  const [panel, setPanel] = useState<Panel>(null)
  const hudRef = useRef<HTMLDivElement>(null)
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  // `MotionConfig reducedMotion="user"` covers declarative animations, but not
  // the imperative `animate()` calls below — those snap instead of springing.
  const reduceMotion = useReducedMotion()
  const snapTo = useCallback(
    (target: { x: number; y: number }, stiffness: number, damping: number) => {
      if (reduceMotion) {
        x.stop()
        y.stop()
        x.set(target.x)
        y.set(target.y)
        return
      }
      animate(x, target.x, { type: "spring", stiffness, damping })
      animate(y, target.y, { type: "spring", stiffness, damping })
    },
    [reduceMotion, x, y]
  )

  const cornerPos = useCallback((c: Corner) => {
    const rect = hudRef.current?.getBoundingClientRect()
    const w = rect?.width || HUD_WIDTH
    const h = rect?.height || HUD_HEIGHT
    // Corners of the preview area, not the window: with the agent open, the
    // window's bottom-right corner is the composer's send button.
    const area = hudRef.current?.parentElement
    const right = (area?.clientWidth ?? window.innerWidth) - w - MARGIN
    const bottom = (area?.clientHeight ?? window.innerHeight) - h - MARGIN
    switch (c) {
      case "tl":
        return { x: MARGIN, y: MARGIN }
      case "tr":
        return { x: right, y: MARGIN }
      case "bl":
        return { x: MARGIN, y: bottom }
      case "br":
        return { x: right, y: bottom }
    }
  }, [])

  // Snap to the active corner once the HUD has rendered so cornerPos can
  // measure the real pill width. useLayoutEffect avoids a one-frame flash
  // at (0, 0) before the snap.
  useLayoutEffect(() => {
    const target = cornerPos(corner)
    x.set(target.x)
    y.set(target.y)
  }, [corner, cornerPos, x, y])

  // Re-snap whenever the preview area resizes (the window, or the agent panel
  // opening beside it) so the HUD stays anchored to its corner.
  useEffect(() => {
    const area = hudRef.current?.parentElement
    if (!area) return
    const ro = new ResizeObserver(() => snapTo(cornerPos(corner), 320, 28))
    ro.observe(area)
    return () => ro.disconnect()
  }, [corner, cornerPos, snapTo])

  const persistCorner = useCallback((next: Corner) => {
    setCorner(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {}
  }, [])

  const handleDragStart = useCallback(() => {
    onDraggingChange?.(true)
  }, [onDraggingChange])

  const handleDragEnd = useCallback(() => {
    onDraggingChange?.(false)
    const rect = hudRef.current?.getBoundingClientRect()
    const area = hudRef.current?.parentElement?.getBoundingClientRect()
    if (!rect || !area) return
    const cx = area.left + area.width / 2
    const cy = area.top + area.height / 2
    const midX = rect.left + rect.width / 2
    const midY = rect.top + rect.height / 2
    const next: Corner =
      `${midY < cy ? "t" : "b"}${midX < cx ? "l" : "r"}` as Corner
    persistCorner(next)
    snapTo(cornerPos(next), 360, 26)
  }, [cornerPos, persistCorner, onDraggingChange, snapTo])

  // Where to dock the expanded panel relative to the pill's anchor corner.
  // The pill height is a stable shadcn `icon-sm` row so we use the static
  // constant rather than reaching for the live ref during render.
  const panelStyle = useMemo<React.CSSProperties>(() => {
    const isTop = corner === "tl" || corner === "tr"
    const isLeft = corner === "tl" || corner === "bl"
    return {
      width: PANEL_WIDTH,
      // The comments panel fills a fixed box; the knobs panel hugs its
      // controls and scrolls past its own max height.
      height: panel === "comments" ? COMMENTS_PANEL_HEIGHT : undefined,
      [isTop ? "top" : "bottom"]: HUD_HEIGHT + PANEL_GAP,
      [isLeft ? "left" : "right"]: 0,
    }
  }, [corner, panel])

  // Close the open panel when the user clicks outside the HUD region. The
  // comments panel stays open, as on the canvas, while its pins are clicked.
  useEffect(() => {
    if (!panel || panel === "comments") return
    function onPointerDown(e: PointerEvent) {
      const node = hudRef.current
      if (!node) return
      if (node.contains(e.target as Node)) return
      setPanel(null)
    }
    window.addEventListener("pointerdown", onPointerDown)
    return () => window.removeEventListener("pointerdown", onPointerDown)
  }, [panel])

  // Escape closes the open panel and hands focus back to the button that
  // opened it. Only while focus is in the HUD (or nowhere): Escape inside the
  // chat panel or the prototype belongs to them, and one inside a Select or
  // menu the panel opened lands in a portal outside the HUD, which closes that
  // first.
  const panelButtons = useRef<
    Partial<Record<"knobs" | "comments", HTMLButtonElement | null>>
  >({})
  useEffect(() => {
    if (!panel) return
    const open = panel
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented) return
      const active = document.activeElement
      const inHud = !!active && !!hudRef.current?.contains(active)
      if (!inHud && active !== document.body && active !== null) return
      e.preventDefault()
      setPanel(null)
      if (inHud) panelButtons.current[open]?.focus()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [panel])

  // Tooltips dock above when the HUD is anchored at the bottom of the
  // viewport so they don't appear off-screen.
  const tooltipSide = corner === "bl" || corner === "br" ? "top" : "bottom"

  return (
    <motion.div
      ref={hudRef}
      drag
      dragMomentum={false}
      dragElastic={0}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      style={{
        x,
        y,
        position: "absolute",
        top: 0,
        left: 0,
        touchAction: "none",
      }}
      className="z-[9998] select-none"
    >
      <TooltipProvider>
        <div className="pointer-events-auto flex items-center gap-0.5 rounded-lg bg-background p-1 shadow-md outline outline-1 outline-foreground/10">
          <span
            className="flex h-7 w-4 cursor-grab items-center justify-center text-border active:cursor-grabbing"
            aria-label="Drag to a corner"
          >
            <DotsSixVerticalIcon className="size-3.5" />
          </span>
          {/* The desktop (local) build has no room route to go back to. */}
          {!isLocalBuild && (
            <IconButton
              label={`Back to ${roomName}`}
              tooltipSide={tooltipSide}
              asChild
            >
              <Button
                asChild
                variant="ghost"
                size="icon-sm"
                onPointerDown={(e) => e.stopPropagation()}
              >
                <Link href={`/${roomId}`}>
                  <ArrowLeftIcon />
                </Link>
              </Button>
            </IconButton>
          )}
          <Select value={deviceSizeId} onValueChange={onDeviceSizeChange}>
            <SelectPrimitive.Trigger asChild>
              <IconButton
                label={`Device: ${devicePreset.label} ${formatIframeLayerSize(devicePreset)}`}
                tooltipSide={tooltipSide}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <DeviceIcon />
              </IconButton>
            </SelectPrimitive.Trigger>
            <SelectContent
              side={tooltipSide}
              align="start"
              onPointerDown={(e) => e.stopPropagation()}
              className="max-h-80"
            >
              {GROUPED_IFRAME_LAYER_SIZE_PRESETS.map((group, index) => {
                const Icon = IFRAME_LAYER_SIZE_CATEGORY_ICONS[group.category]
                return (
                  <SelectGroup key={group.category}>
                    {index > 0 ? <SelectSeparator /> : null}
                    <SelectLabel>{group.category}</SelectLabel>
                    {group.presets.map((preset) => (
                      <SelectItem
                        key={preset.id}
                        value={preset.id}
                        // Stretch the item text so the size column lines up.
                        className="text-xs [&>span:last-child]:flex-1"
                      >
                        <span className="flex w-full items-center gap-2">
                          <Icon className="text-muted-foreground" />
                          <span className="truncate">{preset.label}</span>
                          <span className="ml-auto pl-4 text-xs text-muted-foreground tabular-nums">
                            {formatIframeLayerSize(preset)}
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )
              })}
            </SelectContent>
          </Select>
          <IconButton
            label={
              knobs.length > 0
                ? `${knobs.length} knob${knobs.length === 1 ? "" : "s"}`
                : "Knobs"
            }
            tooltipSide={tooltipSide}
            ref={(el) => {
              panelButtons.current.knobs = el
            }}
            variant={panel === "knobs" ? "default" : "ghost"}
            aria-expanded={panel === "knobs"}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setPanel(panel === "knobs" ? null : "knobs")}
          >
            <SlidersHorizontalIcon />
          </IconButton>
          {/* Comments are excluded from the local build (PRD #404, #417). */}
          {!isLocalBuild && (
            <>
              <IconButton
                label="Comment"
                shortcut="C"
                tooltipSide={tooltipSide}
                pressed={comments.commentMode}
                variant={comments.commentMode ? "default" : "ghost"}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={comments.toggleCommentMode}
              >
                <ChatTextIcon />
              </IconButton>
              <IconButton
                label="Comments"
                tooltipSide={tooltipSide}
                ref={(el) => {
                  panelButtons.current.comments = el
                }}
                variant={panel === "comments" ? "default" : "ghost"}
                aria-expanded={panel === "comments"}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() =>
                  setPanel(panel === "comments" ? null : "comments")
                }
              >
                <ChatIcon />
              </IconButton>
            </>
          )}
          {onToggleChat ? (
            <IconButton
              label={chatOpen ? "Hide chat" : "Show chat"}
              shortcut="⌘I"
              tooltipSide={tooltipSide}
              variant={chatOpen ? "default" : "ghost"}
              aria-expanded={!!chatOpen}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={onToggleChat}
            >
              <ChatsIcon />
            </IconButton>
          ) : null}
        </div>
      </TooltipProvider>

      {panel ? (
        <motion.div
          key={panel}
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: "spring", stiffness: 400, damping: 28 }}
          style={panelStyle}
          // Block drag from starting on the panel — clicks/inputs inside
          // shouldn't move the HUD.
          onPointerDown={(e) => e.stopPropagation()}
          className="pointer-events-auto absolute flex flex-col overflow-hidden rounded-lg bg-background shadow-md outline outline-1 outline-foreground/10"
        >
          {panel === "comments" ? (
            <CommentsPanel
              roomId={roomId}
              commentThreads={comments.commentThreads}
              numbers={comments.numbers}
              placements={comments.placements}
              activeThreadId={comments.activeThreadId}
              onSelectThread={comments.selectThread}
              pinsHidden={comments.pinsHidden}
              onPinsHiddenChange={comments.setPinsHidden}
              onClose={() => {
                setPanel(null)
                panelButtons.current.comments?.focus()
              }}
              describeLayer={comments.describeWorkspace}
              groupOptions={comments.groupOptions}
              // The HUD's panel is the surface, the same as the pill's; the list fills it.
              className="static size-full animate-none rounded-none bg-transparent shadow-none ring-0"
            />
          ) : (
            <PlayerKnobs
              knobs={knobs}
              values={knobValues}
              onChange={onKnobChange}
            />
          )}
        </motion.div>
      ) : null}
    </motion.div>
  )
}
