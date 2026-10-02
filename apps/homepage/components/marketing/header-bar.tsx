"use client"

import { useEffect, useState } from "react"

/**
 * The sticky header's bar. Its rule only shows once the page has scrolled,
 * so at the top the hero's backdrop runs up to the nav with nothing between.
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
      className="sticky top-0 z-50 border-b border-transparent bg-background transition-colors data-scrolled:border-border"
    >
      {children}
    </header>
  )
}
