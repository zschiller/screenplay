"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Clock, LayoutGrid, Settings, type LucideIcon } from "lucide-react"
import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
} from "@workspace/ui/components/sidebar"
import { isLocalBuild } from "@/lib/local-mode"
import { useTrafficLightsPresent } from "@/lib/use-traffic-lights"
import { AccountMenu } from "./account-menu"

type NavLink = { href: string; label: string; icon: LucideIcon }

/** Top group: the recently-edited canvases list. */
const RECENTS: NavLink = { href: "/", label: "Recents", icon: Clock }

/** Lower group, below the divider. */
const SECTIONS: NavLink[] = [
  // A flat grid today; it becomes the folder tree later.
  { href: "/canvases", label: "All files", icon: LayoutGrid },
  { href: "/settings", label: "Settings", icon: Settings },
]

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
          <div
            data-tauri-drag-region
            className="flex items-center px-3 py-2"
          >
            <div className="ml-auto">
              <AccountMenu />
            </div>
          </div>
        )}
      </SidebarHeader>

      <SidebarContent>
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
              {SECTIONS.map((link) => (
                <NavItem
                  key={link.href}
                  link={link}
                  active={isActive(link.href)}
                />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
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
