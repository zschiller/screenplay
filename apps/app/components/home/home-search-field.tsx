"use client"

import { useEffect, useRef, useState } from "react"
import { Search, X } from "lucide-react"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@workspace/ui/components/input-group"
import { Kbd } from "@workspace/ui/components/kbd"
import { cn } from "@workspace/ui/lib/utils"

/** The key that focuses home search from anywhere on the page. */
export const SEARCH_SHORTCUT = "/"

/**
 * The home header's search field (#807). `/` focuses it from anywhere on the
 * page that isn't already taking text; Esc clears it, then leaves it. The
 * shortcut hint shows only while the field is idle, so it never sits beside
 * a query.
 *
 * Below the header's compact width there's no room for an idle field, so it
 * folds to a search-icon button; focused or holding a query, it opens across
 * the header in the title's place (see `HomePageHeader`).
 */
export function HomeSearchField({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [focused, setFocused] = useState(false)
  const open = focused || value !== ""

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

  return (
    <InputGroup
      data-search-open={open}
      className={cn(
        "@3xl/header:w-60",
        open ? "@max-3xl/header:flex-1" : "@max-3xl/header:w-8"
      )}
    >
      <InputGroupAddon className={cn(!open && "@max-3xl/header:pl-[7px]")}>
        <Search />
      </InputGroupAddon>
      <InputGroupInput
        ref={inputRef}
        type="search"
        value={value}
        placeholder="Search"
        aria-label="Search canvases and folders"
        aria-keyshortcuts={SEARCH_SHORTCUT}
        // The native clear glyph would double up with ours.
        className={cn(
          "[&::-webkit-search-cancel-button]:appearance-none",
          !open && "@max-3xl/header:w-0 @max-3xl/header:px-0"
        )}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return
          e.preventDefault()
          if (value) onChange("")
          else e.currentTarget.blur()
        }}
      />
      {value ? (
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            size="icon-xs"
            aria-label="Clear search"
            onClick={() => {
              onChange("")
              inputRef.current?.focus()
            }}
          >
            <X />
          </InputGroupButton>
        </InputGroupAddon>
      ) : (
        !focused && (
          <InputGroupAddon
            align="inline-end"
            className="hidden @3xl/header:flex"
          >
            <Kbd>{SEARCH_SHORTCUT}</Kbd>
          </InputGroupAddon>
        )
      )}
    </InputGroup>
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
