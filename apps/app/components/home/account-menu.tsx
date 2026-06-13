"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { LayoutGrid, LogOut } from "lucide-react"
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
import { isLocalBuild } from "@/lib/local-mode"
import { RepoConfigsDialog } from "./repo-configs-dialog"

/**
 * The account (avatar) menu in the homescreen header — Repo Configs always,
 * Sign out only on the hosted build.
 */
export function AccountMenu() {
  const { data: session, isPending } = useAppSession()
  const router = useRouter()
  const [configsOpen, setConfigsOpen] = useState(false)

  if (isPending) {
    return <Skeleton className="size-8 rounded-full" />
  }

  const user = session?.user
  const name = user?.name ?? "Account"
  const email = user?.email ?? null
  const initials = (name[0] ?? "?").toUpperCase()

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
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
          <DropdownMenuLabel className="text-muted-foreground">
            {isLocalBuild ? name : `Signed in as ${email ?? name}`}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setConfigsOpen(true)}>
            <LayoutGrid />
            Configured repositories
          </DropdownMenuItem>
          {/* No sign-out in the local build — there is no login (PRD #404). */}
          {!isLocalBuild && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={async () => {
                  await signOut()
                  router.push("/sign-in")
                }}
              >
                <LogOut />
                Sign out
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <RepoConfigsDialog open={configsOpen} onOpenChange={setConfigsOpen} />
    </>
  )
}
