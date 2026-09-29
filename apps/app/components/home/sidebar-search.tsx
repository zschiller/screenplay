"use client"

import { useEffect, useRef, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import {
  FolderIcon,
  MagnifyingGlassIcon,
  XIcon,
} from "@workspace/ui/components/icons"
import { Button } from "@workspace/ui/components/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@workspace/ui/components/command"
import { Kbd } from "@workspace/ui/components/kbd"
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@workspace/ui/components/popover"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarInput,
} from "@workspace/ui/components/sidebar"
import { CanvasIcon } from "@/components/canvas-icon"
import { prewarmRoom } from "@/lib/yjs-host/client"
import { useHome } from "./home-provider"

/** The key that focuses home search from anywhere on the page. */
export const SEARCH_SHORTCUT = "/"

const RESULTS_ID = "home-search-results"

/**
 * Home search at the top of the sidebar (#807), shadcn's sidebar search form.
 * Search spans every folder, so it lives with the navigation; its results open
 * in a popover under the field rather than replacing the page. ↑/↓ move
 * through them and Enter opens one. `/` focuses the field from anywhere that
 * isn't already taking text, and Esc clears it, then leaves it.
 */
export function SidebarSearch() {
  const { query, setQuery, search, folderPath, folderOfRoom } = useHome()
  const inputRef = useRef<HTMLInputElement>(null)
  const anchorRef = useRef<HTMLDivElement>(null)
  const [focused, setFocused] = useState(false)
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState("")
  const router = useRouter()
  const pathname = usePathname()

  // A search is a visit: navigating anywhere (into a result, or a sidebar
  // link) ends it.
  const lastPathname = useRef(pathname)
  useEffect(() => {
    if (pathname === lastPathname.current) return
    lastPathname.current = pathname
    setQuery("")
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

  const searching = query.trim() !== ""
  const results = searching ? search(query, "all") : null
  const location = (folderId: string | null) => {
    const trail = folderPath(folderId)
    return trail.length === 0
      ? "All files"
      : trail.map((folder) => folder.name).join(" / ")
  }

  const onChange = (value: string) => {
    setQuery(value)
    setOpen(value.trim() !== "")
    // Each new query starts from its top result.
    const next = value.trim() ? search(value, "all") : null
    const first = next?.folders[0]
      ? `folder:${next.folders[0].id}`
      : next?.rooms[0]
        ? `room:${next.rooms[0].id}`
        : ""
    setSelected(first)
  }

  const go = (href: string) => {
    onChange("")
    inputRef.current?.blur()
    router.push(href)
  }

  return (
    <SidebarGroup className="pb-0">
      {/* The field sits inside the Command root so ↑/↓/Enter typed in it
          drive the result list in the popover. */}
      <Command
        shouldFilter={false}
        loop
        label="Search results"
        value={selected}
        onValueChange={setSelected}
        className="size-auto overflow-visible rounded-none! bg-transparent p-0"
      >
        <Popover open={open && searching} onOpenChange={setOpen}>
          <PopoverAnchor asChild>
            <SidebarGroupContent ref={anchorRef} className="relative">
              <SidebarInput
                ref={inputRef}
                type="search"
                role="combobox"
                aria-expanded={open && searching}
                aria-controls={RESULTS_ID}
                aria-autocomplete="list"
                value={query}
                placeholder="Search"
                aria-label="Search canvases and folders"
                aria-keyshortcuts={SEARCH_SHORTCUT}
                // The native clear glyph would double up with ours.
                className="pr-8 pl-8 [&::-webkit-search-cancel-button]:appearance-none"
                onChange={(e) => onChange(e.target.value)}
                onFocus={() => {
                  setFocused(true)
                  if (searching) setOpen(true)
                }}
                onBlur={() => setFocused(false)}
                onKeyDown={(e) => {
                  // Home/End move the caret, not the result selection.
                  if (e.key === "Home" || e.key === "End") e.stopPropagation()
                  if (e.key !== "Escape") return
                  e.preventDefault()
                  if (query) onChange("")
                  else e.currentTarget.blur()
                }}
              />
              <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 opacity-50 select-none" />
              {query ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Clear search"
                  className="absolute top-1/2 right-0.5 -translate-y-1/2"
                  onClick={() => {
                    onChange("")
                    inputRef.current?.focus()
                  }}
                >
                  <XIcon />
                </Button>
              ) : (
                !focused && (
                  <Kbd className="absolute top-1/2 right-1.5 -translate-y-1/2">
                    {SEARCH_SHORTCUT}
                  </Kbd>
                )
              )}
            </SidebarGroupContent>
          </PopoverAnchor>
          <PopoverContent
            align="start"
            className="w-72 min-w-(--radix-popover-trigger-width) p-0"
            // Typing stays in the field: the popover never takes focus, and a
            // click on a result doesn't blur the field before it lands.
            onOpenAutoFocus={(e) => e.preventDefault()}
            onCloseAutoFocus={(e) => e.preventDefault()}
            onMouseDown={(e) => e.preventDefault()}
            onInteractOutside={(e) => {
              if (anchorRef.current?.contains(e.target as Node))
                e.preventDefault()
            }}
          >
            <CommandList id={RESULTS_ID}>
              <CommandEmpty>No matches</CommandEmpty>
              {results && results.folders.length > 0 && (
                <CommandGroup heading="Folders">
                  {results.folders.map((folder) => (
                    <ResultItem
                      key={folder.id}
                      value={`folder:${folder.id}`}
                      icon={<FolderIcon />}
                      name={folder.name}
                      location={location(folder.parentFolderId)}
                      onSelect={() => go(`/files/${folder.id}`)}
                    />
                  ))}
                </CommandGroup>
              )}
              {results && results.rooms.length > 0 && (
                <CommandGroup heading="Canvases">
                  {results.rooms.map((room) => (
                    <ResultItem
                      key={room.id}
                      value={`room:${room.id}`}
                      icon={<CanvasIcon />}
                      name={room.name}
                      location={location(folderOfRoom(room.id))}
                      onSelect={() => go(`/${room.id}`)}
                      onPointerEnter={() => prewarmRoom(room.id)}
                    />
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </PopoverContent>
        </Popover>
      </Command>
    </SidebarGroup>
  )
}

/** One result row: the item's icon and name, then where it lives, muted. */
function ResultItem({
  value,
  icon,
  name,
  location,
  onSelect,
  onPointerEnter,
}: {
  value: string
  icon: React.ReactNode
  name: string
  location: string
  onSelect: () => void
  onPointerEnter?: () => void
}) {
  return (
    <CommandItem
      value={value}
      onSelect={onSelect}
      onPointerEnter={onPointerEnter}
    >
      {icon}
      <span className="truncate">{name}</span>
      <span
        title={location}
        className="ml-auto min-w-0 shrink truncate text-xs text-muted-foreground"
      >
        {location}
      </span>
    </CommandItem>
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
