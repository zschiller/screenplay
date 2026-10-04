"use client"

import { useEffect, useState } from "react"

/**
 * The sticky header's bar, filled and ruled off from the page. On phones it
 * stays clear until the page scrolls, so the hero's floor runs on behind the
 * nav where there's little room. It marks when the page has scrolled, which
 * the hero's peek checks.
 */
export function HeaderBar({ children }: { children: React.ReactNode }) {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 0)
    update()
    window.addEventListener("scroll", update, { passive: true })
    return () => window.removeEventListener("scroll", update)
  }, [])

  return (
    <header
      data-scrolled={scrolled || undefined}
      className="sticky top-0 z-50 border-b border-border bg-background max-sm:border-transparent max-sm:bg-transparent max-sm:transition-colors max-sm:data-scrolled:border-border max-sm:data-scrolled:bg-background"
    >
      {children}
    </header>
  )
}
