"use client"

import { useLayoutEffect, useRef, useState, type RefObject } from "react"

// The reveal's timing: it grows on a decelerating curve and folds away a
// little faster, the controls fading in once there's room for them.
const GROW_MS = 220
const FOLD_MS = 160
const FADE_IN_MS = 160
const FADE_IN_DELAY_MS = 60
const FADE_OUT_MS = 100
const EASE = "cubic-bezier(0.2, 0, 0, 1)"
// The FloatingToolbar's gap (gap-1): a folded group pulls it back so its two
// neighbours sit one gap apart, as if it weren't there.
const TOOLBAR_GAP_PX = 4

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  )
}

/**
 * A group of buttons that slides open inside a centred floating toolbar: the
 * Document's block controls between Edit and ⋯ while it's being edited. The
 * group's width grows from nothing, so the toolbar widens evenly about its
 * centre with its end buttons riding its edges, and the controls fade in once
 * there's room. Closing plays it back, so the group stays mounted (the return
 * value) until it has folded away. With reduced motion it opens and closes at once.
 *
 * Web Animations on width and opacity rather than a CSS transition to `auto`
 * (`interpolate-size`), which the Mac app's WebKit doesn't have.
 */
export function useToolbarReveal(
  open: boolean,
  groupRef: RefObject<HTMLElement | null>
): boolean {
  const [closing, setClosing] = useState(false)
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    setClosing(!open && !prefersReducedMotion())
  }

  const mountedOnce = useRef(false)
  useLayoutEffect(() => {
    // The group a toolbar opens with is already there: nothing to reveal.
    if (!mountedOnce.current) {
      mountedOnce.current = true
      return
    }
    const group = groupRef.current
    if (!group || prefersReducedMotion()) return
    const controls = Array.from(group.children) as HTMLElement[]
    // Pick up from wherever an interrupted reveal had got to.
    const running = group.getAnimations().length > 0
    const from = running
      ? {
          width: `${group.getBoundingClientRect().width}px`,
          marginLeft: getComputedStyle(group).marginLeft,
        }
      : null
    for (const el of [group, ...controls]) {
      for (const animation of el.getAnimations()) animation.cancel()
    }
    const full = group.scrollWidth
    const shut = { width: "0px", marginLeft: `-${TOOLBAR_GAP_PX}px` }
    const wide = { width: `${full}px`, marginLeft: "0px" }
    const start = from ?? (open ? shut : wide)
    const grow = group.animate([start, open ? wide : shut], {
      duration: open ? GROW_MS : FOLD_MS,
      easing: EASE,
      // Folded, it holds shut until the group unmounts.
      fill: open ? "none" : "forwards",
    })
    for (const control of controls) {
      control.animate(
        open
          ? [{ opacity: 0 }, { opacity: 1 }]
          : [{ opacity: 1 }, { opacity: 0 }],
        open
          ? { duration: FADE_IN_MS, delay: FADE_IN_DELAY_MS, fill: "backwards" }
          : { duration: FADE_OUT_MS, fill: "forwards" }
      )
    }
    grow.onfinish = () => {
      if (open) return
      for (const control of controls) {
        for (const animation of control.getAnimations()) animation.cancel()
      }
      setClosing(false)
    }
  }, [open, groupRef])

  return open || closing
}
