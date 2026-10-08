import {
  ChatIcon,
  FileTextIcon,
  FrameCornersIcon,
  NavigationArrowIcon,
  SidebarSimpleIcon,
} from "@workspace/ui/components/icons"

import { SidebarGroupLabel } from "@workspace/ui/components/sidebar"
import { Skeleton } from "@workspace/ui/components/skeleton"

import { buildIdentity, commenting, viewers } from "@/lib/capabilities"
import type { PanelLayout } from "@/lib/panel-layout"

/**
 * The Canvas while it loads — shown by the route's `loading.tsx` during the
 * server render and by the room provider while the Y.Doc syncs.
 *
 * It draws the chrome the Canvas is about to paint, in the same places and at
 * the same sizes: the sidebar with its header, the top-left room pill, the
 * bottom tool pill, the top-right pill, and the chat panel when the layout
 * cookie says it's open. Only the parts that depend on the room's data (the
 * room name, the sidebar's layer rows) are pulsing placeholders. The real
 * chrome fades its contents in over these, so the hand-over reads as the
 * content arriving rather than the whole window being swapped.
 *
 * The placeholders wait before they show ({@link Placeholder}): most loads
 * finish first, and bars that blink in and straight out again read as a
 * flash, not as loading.
 *
 * Mirrors `Canvas`'s markup by hand; if the chrome there moves, move it here.
 */
export function CanvasSkeleton({
  initialLayout,
  viewer = false,
}: {
  initialLayout?: PanelLayout
  /** A viewer's canvas link (Sharing), which has no Share button. */
  viewer?: boolean
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
      className="fixed inset-0 flex bg-canvas-plane"
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
              <PillIcon icon={<SidebarSimpleIcon />} />
            </div>
            <SidebarRows />
          </aside>
          <div className="w-px bg-border" />
        </>
      )}
      <div style={canvasStyle} className="relative min-w-0">
        <div data-tauri-drag-region className="absolute inset-x-0 top-0 h-12" />
        {/* Top-left: the room pill (breadcrumb, name, menu). */}
        <div className="absolute top-0 left-0 flex h-12 items-center pl-2">
          <Pill>
            {!showSidebar && <PillIcon icon={<SidebarSimpleIcon />} />}
            <Placeholder className="flex h-7 items-center gap-2 px-1.5">
              <Skeleton className="h-3 w-12" />
              <span className="text-xs text-muted-foreground/40">/</span>
              <Skeleton className="h-3 w-24" />
            </Placeholder>
            <div className="size-7" />
          </Pill>
        </div>
        {/* Top-right: the zoom menu (always), Share on web and for the Mac
            app's owner, and the chat-expand button while chat is closed. */}
        <div className="absolute top-0 right-0 flex h-12 items-center px-2">
          <Pill>
            <Placeholder className="flex h-7 w-13 items-center px-1.5">
              <Skeleton className="h-3 w-full" />
            </Placeholder>
            {(buildIdentity === "account" || (viewers && !viewer)) && (
              <Placeholder className="ml-1 flex">
                <Skeleton className="h-6 w-14" />
              </Placeholder>
            )}
            {!showChat && <PillIcon icon={<SidebarSimpleIcon mirrored />} />}
          </Pill>
        </div>
        {/* Bottom: the tool pill. */}
        <div className="absolute bottom-0 left-1/2 flex h-12 -translate-x-1/2 items-center px-2">
          <Pill>
            <PillIcon icon={<NavigationArrowIcon />} />
            <PillIcon icon={<FrameCornersIcon />} />
            <PillIcon icon={<FileTextIcon />} />
            {commenting && <PillIcon icon={<ChatIcon />} />}
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

/**
 * The sidebar while it loads: the Pages section with one row, its divider,
 * then layer rows at a layer row's height and inset, so the real ones land
 * where these sat (#1835).
 */
function SidebarRows() {
  return (
    <>
      <div className="flex flex-col p-2">
        <SidebarGroupLabel>Pages</SidebarGroupLabel>
        <Placeholder className="flex h-8 items-center px-2">
          <Skeleton className="h-3 w-16 bg-sidebar-accent" />
        </Placeholder>
      </div>
      <div className="h-px bg-sidebar-border" />
      <div className="flex flex-col p-2">
        <LayerRows />
      </div>
    </>
  )
}

function LayerRows() {
  return (
    <Placeholder className="flex flex-col">
      {[64, 48, 56, 40, 52].map((width, i) => (
        <div key={i} className="flex h-8 items-center gap-2 px-2">
          <Skeleton className="size-4 bg-sidebar-accent" />
          <Skeleton
            className="h-3 bg-sidebar-accent"
            style={{ width: `${width}%` }}
          />
        </div>
      ))}
    </Placeholder>
  )
}

/**
 * Pulsing placeholders that fade in only once the load has run for a moment.
 * The space they hold is there from the first frame, so nothing moves.
 */
function Placeholder({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      className={`animate-in delay-400 duration-200 fade-in-0 fill-mode-backwards ${className ?? ""}`}
    >
      {children}
    </div>
  )
}

/** The floating pill the canvas chrome sits in — same box as the real ones. */
function Pill({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1 rounded-lg bg-background p-1 shadow-md outline outline-1 outline-foreground/10">
      {children}
    </div>
  )
}

/** An `icon-sm` button's footprint with its icon drawn inert. */
function PillIcon({ icon }: { icon: React.ReactNode }) {
  return (
    <div className="flex size-7 items-center justify-center text-muted-foreground/40 [&_svg]:size-4">
      {icon}
    </div>
  )
}
