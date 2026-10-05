"use client"

import { useLayoutEffect, useRef, useState } from "react"

import { cn } from "@workspace/ui/lib/utils"

/**
 * Draws its children at a fixed design size (`width` × `height` CSS px) and
 * scales them down to the box's width, like an image, so an excerpt of the
 * app keeps the app's real proportions in a narrow column. It never scales
 * up: in a wider box the design sits centred at the app's own size, so the
 * excerpt's type never outgrows the page's. The box's own size comes from
 * its aspect ratio (capped at `height`), so scaling never shifts the layout;
 * before hydration it assumes `initialScale`. With `fill`, a wider box widens
 * the design to the box instead of centring it, for a panel that runs edge to
 * edge (a chat, a window), whose edges would otherwise float in the gutter.
 * Its hairline is drawn over the design, not as a border: a border takes
 * 2px from the box's height but not the aspect ratio's, so it clipped the
 * design's bottom edge and its insets came out uneven.
 */
export function Fit({
  width,
  height,
  initialScale = 0.77,
  fill,
  className,
  children,
  ...props
}: {
  width: number
  height: number
  initialScale?: number
  fill?: boolean
  className?: string
  children: React.ReactNode
} & React.ComponentProps<"div">) {
  const box = useRef<HTMLDivElement>(null)
  const [{ scale, left, inner }, setFit] = useState({
    scale: initialScale,
    left: 0,
    inner: width,
  })

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => {
      const scale = Math.min(1, el.clientWidth / width)
      const inner = fill && scale === 1 ? el.clientWidth : width
      setFit({ scale, left: (el.clientWidth - inner * scale) / 2, inner })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [width, fill])

  return (
    <div
      ref={box}
      className={cn(
        "relative isolate w-full overflow-hidden",
        "after:pointer-events-none after:absolute after:inset-0 after:z-10 after:border after:border-border",
        className
      )}
      style={{ aspectRatio: `${width} / ${height}`, maxHeight: height }}
      {...props}
    >
      <div
        className="absolute top-0 origin-top-left"
        style={
          {
            left,
            width: inner,
            height,
            transform: `scale(${scale})`,
            "--fit-scale": scale,
          } as React.CSSProperties
        }
      >
        {children}
      </div>
    </div>
  )
}
