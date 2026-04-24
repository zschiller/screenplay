"use client"

import {
  Avatar,
  AvatarImage,
  AvatarFallback,
} from "@workspace/ui/components/avatar"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { useOtherPresences, useSelfPresence } from "@/lib/yjs/react"

interface FollowingToolbarProps {
  followingId: number | null
  onFollow: (clientId: number | null) => void
}

function getInitials(name: string) {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()
}

export function FollowingToolbar({
  followingId,
  onFollow,
}: FollowingToolbarProps) {
  const others = useOtherPresences()
  const self = useSelfPresence()

  return (
    <TooltipProvider>
      <div className="flex flex-row-reverse items-center [&>*:not(:last-child)]:-ml-2">
        {self && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="relative rounded-full ring-2 ring-background transition-shadow hover:ring-foreground/20"
                onClick={() => onFollow(null)}
              >
                <Avatar size="sm">
                  {self.identity.avatar ? (
                    <AvatarImage src={self.identity.avatar} alt={self.identity.name} />
                  ) : null}
                  <AvatarFallback
                    style={{ backgroundColor: self.color }}
                    className="text-white text-[10px] font-medium"
                  >
                    {getInitials(self.identity.name || "?")}
                  </AvatarFallback>
                </Avatar>
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {self.identity.name || "You"} (you)
            </TooltipContent>
          </Tooltip>
        )}

        {others.map(({ clientId, presence }) => {
          const isFollowing = followingId === clientId
          const name = presence.identity.name || "Anonymous"

          return (
            <Tooltip key={clientId}>
              <TooltipTrigger asChild>
                <button
                  className="relative rounded-full ring-2 ring-background transition-all"
                  style={{
                    boxShadow: isFollowing
                      ? `0 0 0 2px ${presence.color}`
                      : undefined,
                  }}
                  onClick={() => onFollow(isFollowing ? null : clientId)}
                >
                  <Avatar size="sm">
                    {presence.identity.avatar ? (
                      <AvatarImage src={presence.identity.avatar} alt={name} />
                    ) : null}
                    <AvatarFallback
                      style={{ backgroundColor: presence.color }}
                      className="text-white text-[10px] font-medium"
                    >
                      {getInitials(name)}
                    </AvatarFallback>
                  </Avatar>
                  {isFollowing && (
                    <span
                      className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full text-[8px] text-white"
                      style={{ backgroundColor: presence.color }}
                    >
                      ◉
                    </span>
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {isFollowing ? `Following ${name} — click to stop` : `Follow ${name}`}
              </TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    </TooltipProvider>
  )
}
