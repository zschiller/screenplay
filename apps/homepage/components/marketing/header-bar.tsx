"use client"

import { useEffect, useRef, useState } from "react"

/**
 * The sticky header's bar, filled and ruled off from the page. On phones it
 * starts clear, so the hero's floor runs on behind the nav where there's
 * little room, and fills in as the page scrolls, solid by the time the
 * headline reaches it. It marks when the page has scrolled, which the hero's
 * peek checks.
 */
export function HeaderBar({ children }: { children: React.ReactNode }) {
  const bar = useRef<HTMLElement>(null)
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    let frame = 0
    const update = () => {
      frame = 0
      setScrolled(window.scrollY > 0)
      const el = bar.current
      if (!el) return
      // How far the page scrolls before the headline meets the bar's bottom
      // edge; pages without one fill the bar as soon as they scroll.
      const head = document.querySelector("[data-veil]")
      const until = head
        ? head.getBoundingClientRect().top + window.scrollY - el.offsetHeight
        : 1
      const fill = Math.min(Math.max(window.scrollY / Math.max(until, 1), 0), 1)
      el.style.setProperty("--bar-fill", String(fill))
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    window.addEventListener("scroll", onScroll, { passive: true })
    window.addEventListener("resize", onScroll)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener("scroll", onScroll)
      window.removeEventListener("resize", onScroll)
    }
  }, [])

  return (
    <header
      ref={bar}
      data-scrolled={scrolled || undefined}
      className="sticky top-0 z-50 border-b border-border bg-background max-sm:border-transparent max-sm:bg-transparent max-sm:before:absolute max-sm:before:inset-x-0 max-sm:before:top-0 max-sm:before:-bottom-px max-sm:before:-z-10 max-sm:before:border-b max-sm:before:border-border max-sm:before:bg-background max-sm:before:opacity-(--bar-fill,0)"
    >
      {children}
    </header>
  )
}
