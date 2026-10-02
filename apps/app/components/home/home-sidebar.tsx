"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  type Icon,
  BookOpenIcon,
  ClockIcon,
  FilesIcon,
  GearIcon,
} from "@workspace/ui/components/icons"
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
} from "@workspace/ui/components/sidebar"
import { cn } from "@workspace/ui/lib/utils"
import { docsUrl } from "@/lib/docs-url"
import { isLocalBuild } from "@/lib/local-mode"
import { openExternal } from "@/lib/open-external"
import { useTrafficLightsPresent } from "@/lib/use-traffic-lights"
import { AccountMenu } from "./account-menu"
import { PinnedList } from "./pinned-list"
import { SidebarSearch } from "./sidebar-search"
import { useRootDroppable } from "./file-dnd"

type NavLink = { href: string; label: string; icon: Icon }

/** Top group: the recently-edited canvases list. */
const RECENTS: NavLink = { href: "/", label: "Recents", icon: ClockIcon }

/** Lower group, below the divider. */
const SECTIONS: NavLink[] = [
  // The root of the folder tree (PRD #475): top-level folders above the files.
  // Not the Canvas icon: this is every file, folders included, and a Canvas
  // wears `CanvasIcon` alone.
  { href: "/files", label: "All files", icon: FilesIcon },
  { href: "/settings", label: "Settings", icon: GearIcon },
]

/** Opens the product docs in the browser, anchored at the bottom of the nav. */
const DOCS: NavLink = { href: docsUrl, label: "Docs", icon: BookOpenIcon }

export function HomeSidebar() {
  const pathname = usePathname()
  // On the desktop build the macOS traffic lights overlay the sidebar's
  // top-left; reserve a draggable strip above the brand so they never collide.
  // On the hosted (web) build this is false and the brand row hosts the
  // account dropdown instead.
  const trafficLightsPresent = useTrafficLightsPresent()

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href)

  // SidebarProvider doubles as the styled flex container here (sidebar tokens +
  // menu styling) — the surrounding ResizablePanel owns the width, so we don't
  // mount the fixed-position <Sidebar> itself.
  return (
    <SidebarProvider className="flex h-full min-h-0 w-full flex-col bg-sidebar text-sidebar-foreground">
      <SidebarHeader data-tauri-drag-region className="gap-0 p-0">
        {trafficLightsPresent && (
          <div data-tauri-drag-region className="h-9 shrink-0" />
        )}
        {/* Web: account dropdown at the top. Desktop has no login, so the
            header is just the traffic-light spacer above. */}
        {!isLocalBuild && (
          <div data-tauri-drag-region className="flex items-center px-3 py-2">
            {/* `flex`, not block: the trigger is inline-flex, and in a block
                its line box sits on the initials' baseline until the photo
                loads, then on the image's bottom edge, growing the row 6px. */}
            <div className="ml-auto flex">
              <AccountMenu />
            </div>
          </div>
        )}
      </SidebarHeader>

      <SidebarContent>
        <SidebarSearch />

        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <NavItem link={RECENTS} active={isActive(RECENTS.href)} />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator />

        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {SECTIONS.map((link) =>
                // "All files" is the folder-tree root, so it doubles as a drop
                // zone: dragging a canvas/folder onto it files the item back at
                // the top of the tree (the sidebar twin of the "Move to → All
                // files" option).
                link.href === "/files" ? (
                  <FilesRootNavItem
                    key={link.href}
                    link={link}
                    active={isActive(link.href)}
                  />
                ) : (
                  <NavItem
                    key={link.href}
                    link={link}
                    active={isActive(link.href)}
                  />
                )
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* The user's pins, below the nav — self-hiding when there are none. */}
        <PinnedList />
      </SidebarContent>

      {/* Docs sits at the foot of the nav, below any pins, like a help link. */}
      <SidebarFooter>
        <SidebarMenu>
          <DocsNavItem link={DOCS} />
        </SidebarMenu>
      </SidebarFooter>
    </SidebarProvider>
  )
}

function NavItem({ link, active }: { link: NavLink; active: boolean }) {
  const Icon = link.icon
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active}>
        <Link href={link.href}>
          <Icon />
          <span>{link.label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

/**
 * The Docs link: leaves the app for the docs site, so it never shows as
 * active. The desktop webview can't honor `target="_blank"`, so the click goes
 * through the opener plugin (a plain new tab on the web).
 */
function DocsNavItem({ link }: { link: NavLink }) {
  const Icon = link.icon
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild>
        <a
          href={link.href}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => {
            e.preventDefault()
            openExternal(link.href)
          }}
        >
          <Icon />
          <span>{link.label}</span>
        </a>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

/**
 * The "All files" nav item, doubling as the drop target for the folder-tree root
 * (issue #487). Identical to `NavItem` but its row is a dnd-kit droppable; while
 * a valid drag hovers it the row rings to signal the drop. The button stays a
 * plain navigating Link — the droppable lives on the wrapping <li>, which only
 * reacts to the shell's DndContext during a drag and never intercepts a click.
 */
function FilesRootNavItem({
  link,
  active,
}: {
  link: NavLink
  active: boolean
}) {
  const Icon = link.icon
  const { setNodeRef, isOver } = useRootDroppable()
  return (
    <SidebarMenuItem
      ref={setNodeRef}
      className={cn("rounded-md", isOver && "ring-2 ring-primary")}
    >
      <SidebarMenuButton asChild isActive={active}>
        <Link href={link.href}>
          <Icon />
          <span>{link.label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}
