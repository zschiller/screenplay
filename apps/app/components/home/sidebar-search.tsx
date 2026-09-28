"use client"

import { useEffect, useRef, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { Search, X } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Kbd } from "@workspace/ui/components/kbd"
import { Label } from "@workspace/ui/components/label"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarInput,
} from "@workspace/ui/components/sidebar"
import { useHome } from "./home-provider"

/** The key that focuses home search from anywhere on the page. */
export const SEARCH_SHORTCUT = "/"

/**
 * Home search at the top of the sidebar (#807), shadcn's sidebar search form.
 * Search spans every folder, so it lives with the navigation rather than in a
 * page's toolbar; the page on screen renders the results. `/` focuses it from
 * anywhere that isn't already taking text, and Esc clears it, then leaves it.
 */
export function SidebarSearch() {
  const { query, setQuery } = useHome()
  const inputRef = useRef<HTMLInputElement>(null)
  const [focused, setFocused] = useState(false)
  const router = useRouter()
  const pathname = usePathname()

  // A search is a visit: navigating anywhere (into a result, or a sidebar
  // link) ends it. The one navigation search makes itself — Settings has no
  // results list, so typing there moves to All files — keeps it.
  const keepOnNavigate = useRef(false)
  const lastPathname = useRef(pathname)
  useEffect(() => {
    if (pathname === lastPathname.current) return
    lastPathname.current = pathname
    if (keepOnNavigate.current) keepOnNavigate.current = false
    else setQuery("")
  }, [pathname, setQuery])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== SEARCH_SHORTCUT || e.metaKey || e.ctrlKey || e.altKey)
        return
      if (e.defaultPrevented || isTypingTarget(e.target)) return
      e.preventDefault()
      inputRef.current?.focus()
      inputRef.current?.select()
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [])

  const onChange = (value: string) => {
    setQuery(value)
    if (value.trim() && pathname.startsWith("/settings")) {
      keepOnNavigate.current = true
      router.push("/files")
    }
  }

  return (
    <SidebarGroup className="pb-0">
      <SidebarGroupContent className="relative">
        <Label htmlFor="home-search" className="sr-only">
          Search
        </Label>
        <SidebarInput
          ref={inputRef}
          id="home-search"
          type="search"
          value={query}
          placeholder="Search"
          aria-label="Search canvases and folders"
          aria-keyshortcuts={SEARCH_SHORTCUT}
          // The native clear glyph would double up with ours.
          className="pr-8 pl-8 [&::-webkit-search-cancel-button]:appearance-none"
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key !== "Escape") return
            e.preventDefault()
            if (query) setQuery("")
            else e.currentTarget.blur()
          }}
        />
        <Search className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 opacity-50 select-none" />
        {query ? (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Clear search"
            className="absolute top-1/2 right-1 -translate-y-1/2"
            onClick={() => {
              setQuery("")
              inputRef.current?.focus()
            }}
          >
            <X />
          </Button>
        ) : (
          !focused && (
            <Kbd className="absolute top-1/2 right-1.5 -translate-y-1/2">
              {SEARCH_SHORTCUT}
            </Kbd>
          )
        )}
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable
  )
}
