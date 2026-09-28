"use client"

import { createContext, useContext, useEffect, useRef, useState } from "react"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"

/**
 * The horizontal gutter every home page (the Canvas list, a Folder, Settings)
 * shares between its header and its body, so the title and the first tile/row
 * always line up. Sized off the `home` container (`HomeScrollBody`), not the
 * window: the resizable sidebar can take most of a narrow window, so the width
 * that matters is the content's own.
 */
export const HOME_GUTTER = "px-4 @2xl/home:px-8 @4xl/home:px-16"

/** The column every home page's header and body share. */
export const HOME_COLUMN = cn("mx-auto w-full max-w-5xl", HOME_GUTTER)

// The header width below which toolbar buttons drop their text labels and show
// icon + tooltip instead. Matches Tailwind's `@3xl` container size (48rem), which
// `HomeToolbarLabel` hides its text at — the CSS hides the label on first paint,
// this only decides whether the tooltip is worth offering.
const COMPACT_BELOW_PX = 768

const CompactContext = createContext(false)

/**
 * Whether the home header is below its compact width — for header content that
 * has to restructure rather than just hide text (the breadcrumb folds its middle
 * crumbs away). False on the server and the first client paint.
 */
export function useHomeHeaderCompact(): boolean {
  return useContext(CompactContext)
}

/**
 * The sticky header of a home page: the page's title (or breadcrumb) on the
 * left, its toolbar on the right. The title side shrinks and truncates first;
 * the toolbar never wraps, and below `@3xl` its buttons collapse to icons with
 * tooltips (see {@link HomeToolbarLabel}), so the two can never collide down to
 * the narrowest content width the resizable sidebar allows.
 */
export function HomePageHeader({
  title,
  search,
  actions,
}: {
  /** A string renders as the page's `h1`; anything else (a breadcrumb) as is. */
  title: React.ReactNode
  /**
   * The search field, between the title and the toolbar. While compact, an
   * open field (one marked `data-search-open="true"`) takes the title's place,
   * since there's no width for both.
   */
  search?: React.ReactNode
  actions?: React.ReactNode
}) {
  const ref = useRef<HTMLElement>(null)
  const [compact, setCompact] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setCompact(el.clientWidth < COMPACT_BELOW_PX)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <header
      ref={ref}
      data-tauri-drag-region
      className="group/header @container/header flex h-14 items-center bg-background"
    >
      <CompactContext.Provider value={compact}>
        <div
          data-tauri-drag-region
          className={cn(HOME_COLUMN, "flex items-center gap-2")}
        >
          <div
            data-tauri-drag-region
            className="flex min-w-0 flex-1 @max-3xl/header:group-has-data-[search-open=true]/header:hidden"
          >
            {typeof title === "string" ? (
              <h1 className="truncate text-2xl font-normal">{title}</h1>
            ) : (
              title
            )}
          </div>
          {search}
          {actions && (
            <TooltipProvider delayDuration={300}>
              <div className="flex shrink-0 items-center gap-2">{actions}</div>
            </TooltipProvider>
          )}
        </div>
      </CompactContext.Provider>
    </header>
  )
}

/**
 * A toolbar button's text label, hidden below the header's `@3xl` width so the
 * button reads as its icon alone. The button itself must carry an `aria-label`,
 * since a hidden label names nothing.
 */
export function HomeToolbarLabel({ children }: { children: React.ReactNode }) {
  return <span className="hidden @3xl/header:inline">{children}</span>
}

/**
 * Wraps a toolbar control in a tooltip naming it, but only while the header is
 * compact — when the button's own label is showing, a tooltip repeating it is
 * noise.
 */
export function HomeToolbarTooltip({
  label,
  children,
}: {
  label: string
  children: React.ReactElement
}) {
  const compact = useHomeHeaderCompact()
  if (!compact) return children
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}
