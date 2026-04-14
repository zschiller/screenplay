"use client"

import { useOthers, useSelf } from "@liveblocks/react/suspense"
import {
  Avatar,
  AvatarImage,
  AvatarFallback,
} from "@/components/ui/avatar"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

interface FollowingToolbarProps {
  followingId: number | null
  onFollow: (connectionId: number | null) => void
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
  const others = useOthers()
  const self = useSelf()

  if (others.length === 0) return null

  return (
    <TooltipProvider>
      <div className="absolute right-4 top-4 z-[9998] flex flex-row-reverse items-center [&>*:not(:last-child)]:-ml-2">
        {/* Current user */}
        {self && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="relative rounded-full ring-2 ring-background transition-shadow hover:ring-foreground/20"
                onClick={() => onFollow(null)}
              >
                <Avatar size="sm">
                  {self.info?.avatar ? (
                    <AvatarImage src={self.info.avatar} alt={self.info?.name ?? "You"} />
                  ) : null}
                  <AvatarFallback
                    style={{ backgroundColor: self.presence.color }}
                    className="text-white text-[10px] font-medium"
                  >
                    {getInitials(self.info?.name || self.presence.name || "?")}
                  </AvatarFallback>
                </Avatar>
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {self.info?.name || self.presence.name || "You"} (you)
            </TooltipContent>
          </Tooltip>
        )}

        {/* Other users */}
        {others.map(({ connectionId, presence, info }) => {
          const isFollowing = followingId === connectionId
          const name = info?.name || presence.name || "Anonymous"

          return (
            <Tooltip key={connectionId}>
              <TooltipTrigger asChild>
                <button
                  className="relative rounded-full ring-2 ring-background transition-all"
                  style={{
                    boxShadow: isFollowing
                      ? `0 0 0 2px ${presence.color}`
                      : undefined,
                  }}
                  onClick={() =>
                    onFollow(isFollowing ? null : connectionId)
                  }
                >
                  <Avatar size="sm">
                    {info?.avatar ? (
                      <AvatarImage src={info.avatar} alt={name} />
                    ) : null}
                    <AvatarFallback
                      style={{ backgroundColor: presence.color }}
                      className="text-white text-[10px] font-medium"
                    >
                      {getInitials(name)}
                    </AvatarFallback>
                  </Avatar>
                  {/* Following badge */}
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
