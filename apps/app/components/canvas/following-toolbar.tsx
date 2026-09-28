"use client"

import { Eye } from "lucide-react"

import {
  Avatar,
  AvatarImage,
  AvatarFallback,
} from "@workspace/ui/components/avatar"
import { IconButton } from "@workspace/ui/components/icon-button"
import { useOtherPresences, useSelfPresence } from "@/lib/yjs/react"
import { presenceInkClass } from "@/lib/canvas/presence-ink"

interface FollowingToolbarProps {
  followingId: number | null
  onFollow: (clientId: number | null) => void
}

// Strip the icon-button's square ghost chrome: an avatar is already its own
// round, filled target. The ring separates overlapping avatars in the stack.
const AVATAR_BUTTON_CLASS =
  "relative size-auto rounded-full border-0 p-0 ring-2 ring-background transition-shadow hover:bg-transparent hover:ring-foreground/20 dark:hover:bg-transparent"

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
    <div className="ml-0.5 flex flex-row-reverse items-center [&>*:not(:last-child)]:-ml-2">
      {self && (
        <IconButton
          label={`${self.identity.name || "You"} (you)`}
          tooltipSide="bottom"
          className={AVATAR_BUTTON_CLASS}
          onClick={() => onFollow(null)}
        >
          <Avatar size="sm">
            {self.identity.avatar ? (
              <AvatarImage src={self.identity.avatar} alt="" />
            ) : null}
            <AvatarFallback
              aria-hidden
              style={{ backgroundColor: self.color }}
              className="text-3xs font-medium text-white"
            >
              {getInitials(self.identity.name || "?")}
            </AvatarFallback>
          </Avatar>
        </IconButton>
      )}

      {others.map(({ clientId, presence }) => {
        const isFollowing = followingId === clientId
        const name = presence.identity.name || "Anonymous"

        return (
          <IconButton
            key={clientId}
            label={
              isFollowing
                ? `Following ${name} — click to stop`
                : `Follow ${name}`
            }
            tooltipSide="bottom"
            pressed={isFollowing}
            className={AVATAR_BUTTON_CLASS}
            style={{
              boxShadow: isFollowing
                ? `0 0 0 2px ${presence.color}`
                : undefined,
            }}
            onClick={() => onFollow(isFollowing ? null : clientId)}
          >
            <Avatar size="sm">
              {presence.identity.avatar ? (
                <AvatarImage src={presence.identity.avatar} alt="" />
              ) : null}
              <AvatarFallback
                aria-hidden
                style={{ backgroundColor: presence.color }}
                className={`text-3xs font-medium ${presenceInkClass(presence.color)}`}
              >
                {getInitials(name)}
              </AvatarFallback>
            </Avatar>
            {isFollowing && (
              <span
                aria-hidden
                className={`absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full ${presenceInkClass(presence.color)}`}
                style={{ backgroundColor: presence.color }}
              >
                <Eye className="size-2.5" strokeWidth={2.5} />
              </span>
            )}
          </IconButton>
        )
      })}
    </div>
  )
}
