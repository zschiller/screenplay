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
 * before hydration it assumes `initialScale`.
 */
export function Fit({
  width,
  height,
  initialScale = 0.77,
  className,
  children,
  ...props
}: {
  width: number
  height: number
  initialScale?: number
  className?: string
  children: React.ReactNode
} & React.ComponentProps<"div">) {
  const box = useRef<HTMLDivElement>(null)
  const [{ scale, left }, setFit] = useState({ scale: initialScale, left: 0 })

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => {
      const scale = Math.min(1, el.clientWidth / width)
      setFit({ scale, left: (el.clientWidth - width * scale) / 2 })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [width])

  return (
    <div
      ref={box}
      className={cn("relative w-full overflow-hidden", className)}
      style={{ aspectRatio: `${width} / ${height}`, maxHeight: height }}
      {...props}
    >
      <div
        className="absolute top-0 origin-top-left"
        style={{ left, width, height, transform: `scale(${scale})` }}
      >
        {children}
      </div>
    </div>
  )
}
