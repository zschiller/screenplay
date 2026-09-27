import {
  FileText,
  Frame,
  MessageSquare,
  MousePointer2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightOpen,
} from "lucide-react"

import { Skeleton } from "@workspace/ui/components/skeleton"

import { isLocalBuild } from "@/lib/local-mode"
import type { PanelLayout } from "@/lib/panel-layout"

/**
 * The Canvas while it loads — shown by the route's `loading.tsx` during the
 * server render and by the room provider while the Y.Doc syncs.
 *
 * It draws the chrome the Canvas is about to paint, in the same places and at
 * the same sizes: the sidebar with its header and section labels, the top-left
 * room pill, the bottom tool pill, the top-right pill, and the chat panel when
 * the layout cookie says it's open. Only the parts that depend on the room's
 * data (the room name, the sidebar rows) are pulsing placeholders. The real
 * chrome fades its contents in over these, so the hand-over reads as the
 * content arriving rather than the whole window being swapped.
 *
 * Mirrors `Canvas`'s markup by hand; if the chrome there moves, move it here.
 */
export function CanvasSkeleton({
  initialLayout,
}: {
  initialLayout?: PanelLayout
}) {
  const sidebarGrow = initialLayout?.sidebar
  const canvasGrow = initialLayout?.canvas
  const chatGrow = initialLayout?.chat
  const haveLayout =
    typeof sidebarGrow === "number" &&
    typeof canvasGrow === "number" &&
    typeof chatGrow === "number"

  const showSidebar = haveLayout ? sidebarGrow > 0 : true
  const showChat = haveLayout ? chatGrow > 0 : false

  const sidebarStyle: React.CSSProperties = haveLayout
    ? { flexGrow: sidebarGrow, flexShrink: 0, flexBasis: 0 }
    : { width: 240, flexShrink: 0 }
  const canvasStyle: React.CSSProperties = haveLayout
    ? { flexGrow: canvasGrow, flexShrink: 1, flexBasis: 0 }
    : { flexGrow: 1, flexShrink: 1, flexBasis: 0 }
  const chatStyle: React.CSSProperties | undefined = haveLayout
    ? { flexGrow: chatGrow, flexShrink: 0, flexBasis: 0 }
    : undefined

  return (
    <div
      className="fixed inset-0 flex bg-muted/30"
      aria-busy="true"
      aria-label="Loading canvas"
    >
      {showSidebar && (
        <>
          <aside
            style={sidebarStyle}
            className="flex h-full min-w-0 flex-col bg-sidebar text-sidebar-foreground"
          >
            <div
              data-tauri-drag-region
              className="flex h-12 items-center justify-end px-4 pr-3"
            >
              <PanelLeftClose className="size-4 text-sidebar-foreground/40" />
            </div>
            <SidebarSection label="Projects" rows={2} className="pt-0" />
            <SidebarSection label="Canvas" rows={3} />
          </aside>
          <div className="w-px bg-border" />
        </>
      )}
      <div style={canvasStyle} className="relative min-w-0">
        <div data-tauri-drag-region className="absolute inset-x-0 top-0 h-12" />
        {/* Top-left: the room pill (breadcrumb, name, menu). */}
        <div className="absolute top-0 left-0 flex h-12 items-center pl-2">
          <Pill>
            {!showSidebar && <PillIcon icon={<PanelLeftOpen />} />}
            <div className="flex h-6 items-center gap-2 px-1.5">
              <Skeleton className="h-3 w-12" />
              <span className="text-xs text-muted-foreground/40">/</span>
              <Skeleton className="h-3 w-24" />
            </div>
            <div className="size-6" />
          </Pill>
        </div>
        {/* Top-right: Share on web; the chat-expand button while chat is
            closed. The Canvas renders nothing here on desktop with chat open. */}
        {(!isLocalBuild || !showChat) && (
          <div className="absolute top-0 right-0 flex h-12 items-center px-2">
            <Pill>
              {!isLocalBuild && <Skeleton className="h-6 w-14" />}
              {!showChat && <PillIcon icon={<PanelRightOpen />} />}
            </Pill>
          </div>
        )}
        {/* Bottom: the tool pill. */}
        <div className="absolute bottom-0 left-1/2 flex h-12 -translate-x-1/2 items-center px-2">
          <Pill>
            <PillIcon icon={<MousePointer2 />} />
            <PillIcon icon={<Frame />} />
            <PillIcon icon={<FileText />} />
            {!isLocalBuild && <PillIcon icon={<MessageSquare />} />}
          </Pill>
        </div>
      </div>
      {showChat && (
        <>
          <div className="w-px bg-border" />
          <aside style={chatStyle} className="h-full min-w-0 bg-background" />
        </>
      )}
    </div>
  )
}

function SidebarSection({
  label,
  rows,
  className,
}: {
  label: string
  rows: number
  className?: string
}) {
  return (
    <div className={`flex flex-col p-2 ${className ?? ""}`}>
      <div className="flex h-8 items-center px-2 text-xs font-medium text-sidebar-foreground/70">
        {label}
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex h-8 items-center gap-2 px-2">
          <Skeleton className="size-4 bg-sidebar-accent" />
          <Skeleton
            className="h-3 bg-sidebar-accent"
            style={{ width: `${[64, 48, 56][i % 3]}%` }}
          />
        </div>
      ))}
    </div>
  )
}

/** The floating pill the canvas chrome sits in — same box as the real ones. */
function Pill({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1 rounded-lg bg-background p-1 shadow-md outline outline-1 outline-foreground/5">
      {children}
    </div>
  )
}

/** An `icon-xs` button's footprint with its icon drawn inert. */
function PillIcon({ icon }: { icon: React.ReactNode }) {
  return (
    <div className="flex size-6 items-center justify-center text-muted-foreground/40 [&_svg]:size-3.5">
      {icon}
    </div>
  )
}
