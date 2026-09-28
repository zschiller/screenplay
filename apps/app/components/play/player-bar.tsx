"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { motion } from "motion/react"
import { ArrowLeft } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import {
  FloatingToolbar,
  FloatingToolbarButton,
  FloatingToolbarSeparator,
} from "@workspace/ui/components/floating-toolbar"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@workspace/ui/components/toggle-group"
import { TooltipProvider } from "@workspace/ui/components/tooltip"
import type { JsonObject, JsonValue } from "@/lib/postmessage-protocol"
import type { ThreadWithComments } from "@/lib/comments"
import {
  DEFAULT_IFRAME_LAYER_SIZE_ID,
  getIframeLayerSizePreset,
  type IframeLayerSizeCategory,
} from "@/lib/iframe-layer-sizes"
import { BranchBadge } from "@/components/branch-badge"
import { PlayerKnobs } from "./player-knobs"
import { PlayerComments } from "./player-comments"
import { isLocalBuild } from "@/lib/local-mode"

type Panel = "knobs" | "comments" | null

const PANEL_WIDTH = 320
const PANEL_HEIGHT = 360

const DEVICE_SEGMENTS: Array<{
  category: IframeLayerSizeCategory
  label: string
}> = [
  { category: "Desktop", label: "Desktop" },
  { category: "Tablet", label: "Tablet" },
  { category: "Mobile", label: "Phone" },
]

// The device a segment switches to until one of its sizes has been picked.
const SEGMENT_DEFAULT_SIZE: Record<IframeLayerSizeCategory, string> = {
  Desktop: DEFAULT_IFRAME_LAYER_SIZE_ID,
  Tablet: "ipad-pro-11",
  Mobile: "iphone-17-pro",
}

const segmentStorageKey = (category: IframeLayerSizeCategory) =>
  `screenplay:player-device-size:${category}`

interface PlayerBarProps {
  roomId: string
  roomName: string
  agentId: string
  branch: string
  /** The Workspace's palette override, so its pill matches the canvas. */
  colorIndex?: number
  /** The prototype's current path, as the bridge last reported it. */
  route: string
  knobs: JsonValue[]
  knobValues: JsonObject
  onKnobChange: (next: JsonObject) => void
  /** Toggle the agent chat side panel. */
  onToggleChat?: () => void
  /** Reflects the chat panel's expanded state so the Agent button can show it. */
  chatOpen?: boolean
  initialThreads: ThreadWithComments[]
  /** Active device preview preset id (from `lib/iframeLayer-sizes`). */
  deviceSizeId: string
  onDeviceSizeChange: (id: string) => void
}

/**
 * The player's one piece of chrome: a bar pinned top-centre over the stage.
 * Back to the Canvas, the Workspace and the route it's showing, the device,
 * then Knobs, Comments and Agent. Knobs and Comments open their panel under
 * the bar, so nothing covers the bar or the agent's composer.
 */
export function PlayerBar({
  roomId,
  roomName,
  agentId,
  branch,
  colorIndex,
  route,
  knobs,
  knobValues,
  onKnobChange,
  onToggleChat,
  chatOpen,
  initialThreads,
  deviceSizeId,
  onDeviceSizeChange,
}: PlayerBarProps) {
  const devicePreset = getIframeLayerSizePreset(deviceSizeId)
  const [panel, setPanel] = useState<Panel>(null)
  const [openThreadCount, setOpenThreadCount] = useState(
    () => initialThreads.filter((t) => !t.resolved).length
  )
  const barRef = useRef<HTMLDivElement>(null)

  // Each segment comes back to the size last picked in it, so Phone keeps
  // the repo's default phone rather than resetting to a generic one.
  useEffect(() => {
    try {
      window.localStorage.setItem(
        segmentStorageKey(devicePreset.category),
        devicePreset.id
      )
    } catch {}
  }, [devicePreset])

  function selectSegment(category: string) {
    const segment = DEVICE_SEGMENTS.find((s) => s.category === category)
    if (!segment || segment.category === devicePreset.category) return
    let id = SEGMENT_DEFAULT_SIZE[segment.category]
    try {
      const saved = window.localStorage.getItem(
        segmentStorageKey(segment.category)
      )
      if (saved && getIframeLayerSizePreset(saved).category === category) {
        id = saved
      }
    } catch {}
    onDeviceSizeChange(id)
  }

  // Close the open panel when the user clicks outside the bar and its panel.
  useEffect(() => {
    if (!panel) return
    function onPointerDown(e: PointerEvent) {
      const node = barRef.current
      if (!node) return
      if (node.contains(e.target as Node)) return
      setPanel(null)
    }
    window.addEventListener("pointerdown", onPointerDown)
    return () => window.removeEventListener("pointerdown", onPointerDown)
  }, [panel])

  // Escape closes the open panel and hands focus back to the button that
  // opened it. Only while focus is in the bar (or nowhere): Escape inside the
  // chat panel or the prototype belongs to them, and one inside a Select or
  // menu the panel opened lands in a portal outside the bar, which closes that
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
      const inBar = !!active && !!barRef.current?.contains(active)
      if (!inBar && active !== document.body && active !== null) return
      e.preventDefault()
      setPanel(null)
      if (inBar) panelButtons.current[open]?.focus()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [panel])

  const togglePanel = (next: Exclude<Panel, null>) =>
    setPanel(panel === next ? null : next)

  return (
    <div
      ref={barRef}
      className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col items-center gap-4 px-2 pt-2"
    >
      <TooltipProvider>
        <FloatingToolbar aria-label="Player" className="max-w-full">
          <FloatingToolbarButton
            label={`Back to ${roomName || "the canvas"}`}
            tooltipSide="bottom"
            asChild
          >
            <Button asChild variant="ghost" size="icon-xs">
              <Link href={`/${roomId}`}>
                <ArrowLeft />
              </Link>
            </Button>
          </FloatingToolbarButton>
          <BranchBadge
            branch={branch}
            colorKey={agentId}
            colorIndex={colorIndex}
            className="min-w-0 shrink"
          />
          <FloatingToolbarSeparator />
          <span
            title={route}
            className="min-w-0 shrink truncate rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground"
          >
            {route}
          </span>
          <ToggleGroup
            type="single"
            aria-label="Device"
            value={devicePreset.category}
            onValueChange={selectSegment}
            // The look of a shadcn TabsList: the chosen device sits raised
            // on a muted track, as a segmented control.
            className="h-6 shrink-0 border-transparent bg-muted p-0.5"
          >
            {DEVICE_SEGMENTS.map((segment) => (
              <ToggleGroupItem
                key={segment.category}
                value={segment.category}
                className="h-5 px-2 text-xs text-foreground/60 data-[state=on]:bg-background data-[state=on]:shadow-sm dark:data-[state=on]:bg-input/30"
              >
                {segment.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <FloatingToolbarSeparator />
          <Button
            ref={(el) => {
              panelButtons.current.knobs = el
            }}
            variant={panel === "knobs" ? "default" : "ghost"}
            size="xs"
            aria-expanded={panel === "knobs"}
            onClick={() => togglePanel("knobs")}
          >
            Knobs
          </Button>
          {/* Comments are excluded from the local build (PRD #404, #417). */}
          {!isLocalBuild && (
            <Button
              ref={(el) => {
                panelButtons.current.comments = el
              }}
              variant={panel === "comments" ? "default" : "ghost"}
              size="xs"
              aria-expanded={panel === "comments"}
              onClick={() => togglePanel("comments")}
            >
              Comments
              <span className="tabular-nums opacity-60">{openThreadCount}</span>
            </Button>
          )}
          {onToggleChat ? (
            <Button
              variant={chatOpen ? "default" : "outline"}
              size="xs"
              aria-pressed={!!chatOpen}
              onClick={onToggleChat}
            >
              Agent
            </Button>
          ) : null}
        </FloatingToolbar>
      </TooltipProvider>

      {panel ? (
        <motion.div
          key={panel}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 400, damping: 28 }}
          style={{ width: PANEL_WIDTH, height: PANEL_HEIGHT }}
          className="pointer-events-auto flex max-w-full flex-col overflow-hidden rounded-lg bg-background shadow-md outline outline-1 outline-foreground/5"
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
              initialThreads={initialThreads}
              onThreadsChange={(threads) =>
                setOpenThreadCount(threads.filter((t) => !t.resolved).length)
              }
            />
          )}
        </motion.div>
      ) : null}
    </div>
  )
}
