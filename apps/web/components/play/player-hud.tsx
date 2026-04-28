"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { animate, motion, useMotionValue } from "motion/react"
import { ArrowLeft, GripVertical, MessageSquare, SlidersHorizontal } from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"
import type { JsonObject, JsonValue } from "@/lib/postmessage-protocol"
import type { BranchCommentRecord } from "@/lib/branch-comments"
import { PlayerKnobs } from "./player-knobs"
import { PlayerComments } from "./player-comments"

type Corner = "tl" | "tr" | "bl" | "br"

type Panel = "knobs" | "comments" | null

const MARGIN = 16
const HUD_WIDTH = 132 // approximate pill width; only used for first paint
const HUD_HEIGHT = 36
const PANEL_WIDTH = 320
const PANEL_HEIGHT = 360
const PANEL_GAP = 8
const STORAGE_KEY = "screenplay:player-hud-corner"

interface PlayerHudProps {
  roomId: string
  projectName: string
  agentId: string
  branch: string
  knobs: JsonValue[]
  knobValues: JsonObject
  onKnobChange: (next: JsonObject) => void
  initialComments: BranchCommentRecord[]
}

export function PlayerHud({
  roomId,
  projectName,
  agentId,
  branch,
  knobs,
  knobValues,
  onKnobChange,
  initialComments,
}: PlayerHudProps) {
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

  const cornerPos = useCallback(
    (c: Corner) => {
      // Use the actual rendered HUD size if mounted; fall back to the static
      // estimate so the first paint already lands in the right corner instead
      // of (0, 0).
      const rect = hudRef.current?.getBoundingClientRect()
      const w = rect?.width || HUD_WIDTH
      const h = rect?.height || HUD_HEIGHT
      const right = window.innerWidth - w - MARGIN
      const bottom = window.innerHeight - h - MARGIN
      switch (c) {
        case "tl": return { x: MARGIN, y: MARGIN }
        case "tr": return { x: right, y: MARGIN }
        case "bl": return { x: MARGIN, y: bottom }
        case "br": return { x: right, y: bottom }
      }
    },
    [],
  )

  // Snap to the active corner once the HUD has rendered so cornerPos can
  // measure the real pill width. useLayoutEffect avoids a one-frame flash
  // at (0, 0) before the snap.
  useLayoutEffect(() => {
    const target = cornerPos(corner)
    x.set(target.x)
    y.set(target.y)
  }, [corner, cornerPos, x, y])

  // Re-snap on viewport resize so the HUD stays anchored to its corner.
  useEffect(() => {
    function handleResize() {
      const target = cornerPos(corner)
      animate(x, target.x, { type: "spring", stiffness: 320, damping: 28 })
      animate(y, target.y, { type: "spring", stiffness: 320, damping: 28 })
    }
    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [corner, cornerPos, x, y])

  const persistCorner = useCallback((next: Corner) => {
    setCorner(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {}
  }, [])

  const handleDragEnd = useCallback(() => {
    const rect = hudRef.current?.getBoundingClientRect()
    if (!rect) return
    const cx = window.innerWidth / 2
    const cy = window.innerHeight / 2
    const midX = rect.left + rect.width / 2
    const midY = rect.top + rect.height / 2
    const next: Corner = `${midY < cy ? "t" : "b"}${midX < cx ? "l" : "r"}` as Corner
    persistCorner(next)
    const target = cornerPos(next)
    animate(x, target.x, { type: "spring", stiffness: 360, damping: 26 })
    animate(y, target.y, { type: "spring", stiffness: 360, damping: 26 })
  }, [cornerPos, persistCorner, x, y])

  // Where to dock the expanded panel relative to the pill's anchor corner.
  const panelStyle = useMemo<React.CSSProperties>(() => {
    const isTop = corner === "tl" || corner === "tr"
    const isLeft = corner === "tl" || corner === "bl"
    return {
      width: PANEL_WIDTH,
      height: PANEL_HEIGHT,
      [isTop ? "top" : "bottom"]: HUD_HEIGHT + PANEL_GAP,
      [isLeft ? "left" : "right"]: 0,
    }
  }, [corner])

  // Close the open panel when the user clicks outside the HUD region.
  useEffect(() => {
    if (!panel) return
    function onPointerDown(e: PointerEvent) {
      const node = hudRef.current
      if (!node) return
      if (node.contains(e.target as Node)) return
      setPanel(null)
    }
    window.addEventListener("pointerdown", onPointerDown)
    return () => window.removeEventListener("pointerdown", onPointerDown)
  }, [panel])

  return (
    <motion.div
      ref={hudRef}
      drag
      dragMomentum={false}
      dragElastic={0}
      onDragEnd={handleDragEnd}
      style={{ x, y, position: "fixed", top: 0, left: 0, touchAction: "none" }}
      className="z-50 select-none"
    >
      <div className="flex items-center gap-1 rounded-full border border-border/60 bg-background/95 px-1.5 py-1 shadow-lg backdrop-blur-sm">
        <span
          className="flex h-7 w-5 cursor-grab items-center justify-center text-muted-foreground active:cursor-grabbing"
          title="Drag to a corner"
          aria-label="Drag to a corner"
        >
          <GripVertical className="size-4" />
        </span>
        <HudButton
          active={panel === "knobs"}
          onClick={() => setPanel(panel === "knobs" ? null : "knobs")}
          title={knobs.length > 0 ? `${knobs.length} knob${knobs.length === 1 ? "" : "s"}` : "Knobs"}
        >
          <SlidersHorizontal className="size-4" />
          {knobs.length > 0 ? (
            <span className="ml-1 text-[10px] font-medium tabular-nums text-muted-foreground">
              {knobs.length}
            </span>
          ) : null}
        </HudButton>
        <HudButton
          active={panel === "comments"}
          onClick={() => setPanel(panel === "comments" ? null : "comments")}
          title="Branch comments"
        >
          <MessageSquare className="size-4" />
        </HudButton>
        <a
          href={`/${roomId}`}
          onPointerDown={(e) => e.stopPropagation()}
          className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
          title={`Back to ${projectName}`}
        >
          <ArrowLeft className="size-4" />
        </a>
      </div>

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
          className="absolute flex flex-col overflow-hidden rounded-xl border border-border/60 bg-background/98 shadow-2xl backdrop-blur-sm"
        >
          {panel === "knobs" ? (
            <PlayerKnobs
              knobs={knobs}
              values={knobValues}
              onChange={onKnobChange}
            />
          ) : (
            <PlayerComments
              roomId={roomId}
              branch={branch}
              agentId={agentId}
              initialComments={initialComments}
            />
          )}
        </motion.div>
      ) : null}
    </motion.div>
  )
}

interface HudButtonProps {
  active: boolean
  onClick: () => void
  title: string
  children: React.ReactNode
}

function HudButton({ active, onClick, title, children }: HudButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      // The HUD itself owns drag, so pointerdown anywhere starts a drag — even
      // on these buttons. Stop propagation so a tap fires onClick instead.
      onPointerDown={(e) => e.stopPropagation()}
      className={cn(
        "flex h-7 items-center gap-1 rounded-full px-2 text-sm transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {children}
    </button>
  )
}
