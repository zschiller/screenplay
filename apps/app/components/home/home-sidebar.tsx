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

/**
 * The root of the folder tree (PRD #475), below the divider: top-level folders
 * above the files. Not the Canvas icon: this is every file, folders included,
 * and a Canvas wears `CanvasIcon` alone.
 */
const ALL_FILES: NavLink = {
  href: "/files",
  label: "All files",
  icon: FilesIcon,
}

/** At the foot of the nav, under Docs and above the account row. */
const SETTINGS: NavLink = {
  href: "/settings",
  label: "Settings",
  icon: GearIcon,
}

/** Opens the product docs in the browser, anchored at the bottom of the nav. */
const DOCS: NavLink = { href: docsUrl, label: "Docs", icon: BookOpenIcon }

export function HomeSidebar() {
  const pathname = usePathname()
  // On the desktop build the macOS traffic lights overlay the sidebar's
  // top-left; reserve a draggable strip above Search so they never collide.
  const trafficLightsPresent = useTrafficLightsPresent()

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href)

  // SidebarProvider doubles as the styled flex container here (sidebar tokens +
  // menu styling) — the surrounding ResizablePanel owns the width, so we don't
  // mount the fixed-position <Sidebar> itself.
  return (
    <SidebarProvider className="flex h-full min-h-0 w-full flex-col bg-sidebar text-sidebar-foreground">
      {trafficLightsPresent && (
        <SidebarHeader data-tauri-drag-region className="gap-0 p-0">
          <div data-tauri-drag-region className="h-9 shrink-0" />
        </SidebarHeader>
      )}

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
              {/* "All files" is the folder-tree root, so it doubles as a drop
                  zone: dragging a canvas/folder onto it files the item back at
                  the top of the tree (the sidebar twin of the "Move to → All
                  files" option). */}
              <FilesRootNavItem
                link={ALL_FILES}
                active={isActive(ALL_FILES.href)}
              />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* The user's pins, below the nav — self-hiding when there are none. */}
        <PinnedList />
      </SidebarContent>

      {/* The foot of the nav, below any pins: Docs like a help link, then
          Settings, then (web only) the signed-in account, as Claude does.
          Desktop has no login (PRD #404), so it stops at Settings. */}
      <SidebarFooter>
        <SidebarMenu>
          <DocsNavItem link={DOCS} />
          <NavItem link={SETTINGS} active={isActive(SETTINGS.href)} />
        </SidebarMenu>
        {!isLocalBuild && <AccountMenu />}
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
