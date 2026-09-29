import { cn } from "@workspace/ui/lib/utils"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"

/**
 * The full-window frame the Canvas route's not-found and error pages share
 * (#735): the canvas backdrop with one Empty centered on it, so a Canvas that
 * can't open still reads as the Canvas route rather than a bare browser error.
 *
 * Keeps a drag strip across the top, the same height as the canvas top bar, so
 * the desktop window can still be moved while one of these is showing.
 */
export function CanvasRouteState({
  icon,
  title,
  description,
  children,
  footer,
  className,
}: {
  icon: React.ReactNode
  title: string
  description: React.ReactNode
  /** The actions. */
  children: React.ReactNode
  /** Small print under the actions, e.g. an error reference. */
  footer?: React.ReactNode
  className?: string
}) {
  return (
    <main
      className={cn(
        "fixed inset-0 flex items-center justify-center bg-canvas-plane",
        className
      )}
    >
      <div data-tauri-drag-region className="absolute inset-x-0 top-0 h-12" />
      <Empty className="flex-none animate-in duration-300 fade-in-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">{icon}</EmptyMedia>
          <EmptyTitle>{title}</EmptyTitle>
          <EmptyDescription>{description}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="flex-row justify-center">
          {children}
        </EmptyContent>
        {footer}
      </Empty>
    </main>
  )
}
