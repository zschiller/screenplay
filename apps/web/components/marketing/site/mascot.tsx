"use client"

import * as React from "react"
import {
  MARK_BLUE,
  MARK_BODY,
  MARK_LEFT_EYE,
  MARK_NAVY,
  MARK_RIGHT_EYE,
  MARK_SMILE,
  MARK_SMILE_WIDTH,
} from "@workspace/ui/lib/brand"
import { cn } from "@workspace/ui/lib/utils"

// The logo's face (the static mark's primitives, @workspace/ui/lib/brand),
// animated: two eyes that track the pointer and blink, and a smile that
// widens on hover.
const GRIN = "M13.8 13.9 Q18.4 21.6 23.1 14.4"
const FROWN = "M14.6 18.6 Q18.4 14.6 22.4 17.8"

export type MascotTone = "blue" | "coral" | "mint" | "sun" | "lilac" | "ink"

const tones: Record<MascotTone, { body: string; face: string }> = {
  blue: { body: MARK_BLUE, face: MARK_NAVY },
  coral: { body: "#FF7A59", face: "#3D1408" },
  mint: { body: "#2FCB8F", face: "#063522" },
  sun: { body: "#FFC53D", face: "#3D2A00" },
  lilac: { body: "#9B7BFF", face: "#1E0F4D" },
  ink: { body: "#1B1F2A", face: "#F5F7FF" },
}

type MascotProps = {
  size?: number
  tone?: MascotTone
  /** Track the pointer anywhere on the page, not only when hovered. */
  follow?: boolean
  /** Fixed gaze in [-1, 1] units, used when `follow` is off. */
  gaze?: { x: number; y: number }
  /** "sad" flips the smile — used where the mascot is having a bad time. */
  mood?: "happy" | "sad"
  className?: string
  title?: string
}

export function Mascot({
  size = 32,
  tone = "blue",
  follow = true,
  gaze,
  mood = "happy",
  className,
  title,
}: MascotProps) {
  const ref = React.useRef<SVGSVGElement>(null)
  const [look, setLook] = React.useState({ x: 0, y: 0 })
  const [blink, setBlink] = React.useState(false)
  const [happy, setHappy] = React.useState(false)

  React.useEffect(() => {
    if (!follow) return
    let frame = 0
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const el = ref.current
        if (!el) return
        const r = el.getBoundingClientRect()
        const dx = e.clientX - (r.left + r.width / 2)
        const dy = e.clientY - (r.top + r.height / 2)
        const dist = Math.hypot(dx, dy) || 1
        // Ease into the edge of the eye socket as the pointer gets further away.
        const reach = Math.min(1, dist / 240)
        setLook({ x: (dx / dist) * reach, y: (dy / dist) * reach })
      })
    }
    window.addEventListener("pointermove", onMove, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener("pointermove", onMove)
    }
  }, [follow])

  React.useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    let timeout: ReturnType<typeof setTimeout>
    const schedule = () => {
      timeout = setTimeout(
        () => {
          setBlink(true)
          setTimeout(() => setBlink(false), 140)
          schedule()
        },
        2400 + Math.random() * 3600
      )
    }
    schedule()
    return () => clearTimeout(timeout)
  }, [])

  const g = follow ? look : (gaze ?? { x: 0, y: 0 })
  const ox = g.x * 1.6
  const oy = g.y * 1.4
  const { body, face } = tones[tone]
  const eyeStyle: React.CSSProperties = {
    transform: `translate(${ox}px, ${oy}px) scaleY(${blink ? 0.12 : happy ? 0.8 : 1})`,
    transformBox: "fill-box",
    transformOrigin: "center",
    transition: blink
      ? "transform 60ms ease-in"
      : "transform 180ms cubic-bezier(.2,.8,.2,1)",
  }

  return (
    <svg
      ref={ref}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("mascot shrink-0 overflow-visible", className)}
      onPointerEnter={() => setHappy(true)}
      onPointerLeave={() => setHappy(false)}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
      <g className="mascot-body">
        <path d={MARK_BODY} fill={body} />
        <g
          style={{
            transform: `translate(${ox * 0.35}px, ${oy * 0.35}px)`,
            transition: "transform 220ms cubic-bezier(.2,.8,.2,1)",
          }}
        >
          <ellipse {...MARK_LEFT_EYE} fill={face} style={eyeStyle} />
          <ellipse {...MARK_RIGHT_EYE} fill={face} style={eyeStyle} />
          <path
            d={mood === "sad" ? FROWN : happy ? GRIN : MARK_SMILE}
            stroke={face}
            strokeWidth={MARK_SMILE_WIDTH}
            strokeLinecap="round"
            fill={happy && mood !== "sad" ? face : "none"}
          />
          {happy && mood !== "sad" ? (
            <>
              <ellipse
                cx="6.2"
                cy="15.6"
                rx="1.7"
                ry="1"
                fill="#FF8FB1"
                opacity=".75"
              />
              <ellipse
                cx="26.6"
                cy="13.4"
                rx="1.7"
                ry="1"
                fill="#FF8FB1"
                opacity=".75"
              />
            </>
          ) : null}
        </g>
      </g>
    </svg>
  )
}
