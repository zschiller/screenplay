"use client"

import { useLayoutEffect, useRef, useState } from "react"

import { cn } from "@workspace/ui/lib/utils"

/**
 * Draws its children at a fixed design size (`width` × `height` CSS px) and
 * scales them to the box's width, like an image, so an excerpt of the app
 * keeps the app's real proportions in a narrow column. The box's own size
 * comes from its aspect ratio, so scaling never shifts the layout; before
 * hydration it assumes `initialScale`.
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
  const [scale, setScale] = useState(initialScale)

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => setScale(el.clientWidth / width)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [width])

  return (
    <div
      ref={box}
      className={cn("relative w-full overflow-hidden", className)}
      style={{ aspectRatio: `${width} / ${height}` }}
      {...props}
    >
      <div
        className="absolute top-0 left-0 origin-top-left"
        style={{ width, height, transform: `scale(${scale})` }}
      >
        {children}
      </div>
    </div>
  )
}
