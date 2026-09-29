"use client"

import { useRouter } from "next/navigation"
import { SignOutIcon } from "@workspace/ui/components/icons"
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { signOut, useAppSession } from "@/lib/auth-client"

/**
 * The account (avatar) dropdown at the top of the home sidebar. Hosted-only:
 * the desktop build has no login (PRD #404), so the sidebar omits it and
 * per-account settings live on the Settings page instead.
 */
export function AccountMenu() {
  const { data: session, isPending } = useAppSession()
  const router = useRouter()

  if (isPending) {
    return <Skeleton className="size-7 rounded-full" />
  }

  const user = session?.user
  const name = user?.name ?? "Account"
  const email = user?.email ?? null
  const initials = (name[0] ?? "?").toUpperCase()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="rounded-full"
          aria-label="Account"
        >
          <Avatar className="size-7">
            <AvatarImage src={user?.image ?? undefined} alt={name} />
            <AvatarFallback className="text-xs">{initials}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="bottom">
        {/* An account line, not a section heading: keeps the UI face. */}
        <DropdownMenuLabel className="font-sans text-xs tracking-normal normal-case">
          {`Signed in as ${email ?? name}`}
        </DropdownMenuLabel>
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
  )
}
