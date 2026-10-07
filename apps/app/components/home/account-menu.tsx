"use client"

import { useRouter } from "next/navigation"
import { CaretUpDownIcon, SignOutIcon } from "@workspace/ui/components/icons"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@workspace/ui/components/sidebar"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { signOut, useAppSession } from "@/lib/auth-client"

/**
 * The signed-in account at the foot of the home sidebar: photo, name and
 * email in one row that opens the account menu, as Claude does (shadcn's
 * NavUser block). Hosted-only: the desktop build has no login (PRD #404), so
 * the sidebar omits it and per-account settings live on the Settings page.
 */
export function AccountMenu() {
  const { data: session, isPending } = useAppSession()
  const router = useRouter()

  // The row's own height, so nothing below the nav moves when the session lands.
  if (isPending) return <Skeleton className="h-12 w-full" />

  const user = session?.user
  const name = user?.name ?? "Account"
  const email = user?.email ?? null
  const initials = (name[0] ?? "?").toUpperCase()

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              aria-label="Account"
              className="data-[state=open]:bg-sidebar-accent"
            >
              <AccountIdentity
                name={name}
                email={email}
                image={user?.image}
                initials={initials}
              />
              <CaretUpDownIcon className="ml-auto text-muted-foreground" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="top"
            align="start"
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56"
          >
            {/* The same identity as the row, not a section heading, so not a
                DropdownMenuLabel (that's a group's mono heading). */}
            <div className="flex items-center gap-2 px-1.5 py-1.5 text-left">
              <AccountIdentity
                name={name}
                email={email}
                image={user?.image}
                initials={initials}
              />
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={async () => {
                await signOut()
                router.push("/sign-in")
              }}
            >
              <SignOutIcon />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

/** Photo (initials until it loads), then name over email. */
function AccountIdentity({
  name,
  email,
  image,
  initials,
}: {
  name: string
  email: string | null
  image: string | null | undefined
  initials: string
}) {
  return (
    <>
      <Avatar>
        <AvatarImage src={image ?? undefined} alt={name} />
        <AvatarFallback className="text-xs">{initials}</AvatarFallback>
      </Avatar>
      <div className="grid min-w-0 flex-1 text-left leading-tight">
        <span className="truncate text-sm font-medium text-foreground">
          {name}
        </span>
        {email && (
          <span className="truncate text-xs text-muted-foreground">
            {email}
          </span>
        )}
      </div>
    </>
  )
}
