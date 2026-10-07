"use client"

import { useEffect, useMemo, useState } from "react"
import type { AgentMessage } from "@/lib/agent/types"
import { multiUserSurface } from "@/lib/capabilities"
import { listCollaborators } from "@/lib/rooms-actions"

/** A Canvas member as a chat names them. */
export interface ChatSender {
  name: string
  avatar: string | null
}

interface Directory {
  members: Array<ChatSender & { userId: string }>
  /** Every id a fetch has looked for, found or not. */
  looked: ReadonlySet<string>
}

const EMPTY: Directory = { members: [], looked: new Set() }

/**
 * Who sent a chat's messages, by user id, for naming them in the hosted build:
 * the Canvas's members, fetched on open and again when a message names someone
 * no fetch has looked for yet (a member invited since). Null when nobody
 * should be named: the local build has one user, and on a Canvas only its
 * owner is in, every message is theirs.
 */
export function useChatSenders(
  roomId: string,
  messages: AgentMessage[]
): Map<string, ChatSender> | null {
  const [directory, setDirectory] = useState<Directory | null>(null)

  // The first sender no fetch has looked for; "" asks for the first fetch.
  const unknown = useMemo(() => {
    if (!multiUserSurface) return null
    if (!directory) return ""
    for (const m of messages) {
      if (m.role === "user" && m.sentBy && !directory.looked.has(m.sentBy)) {
        return m.sentBy
      }
    }
    return null
  }, [directory, messages])

  useEffect(() => {
    if (unknown == null) return
    let cancelled = false
    listCollaborators(roomId)
      .then((rows) => {
        if (cancelled) return
        const members = rows.map((r) => ({
          userId: r.userId,
          name: r.name,
          avatar: r.avatar,
        }))
        setDirectory((prev) => ({
          members,
          looked: new Set([
            ...(prev ?? EMPTY).looked,
            ...members.map((m) => m.userId),
            ...(unknown ? [unknown] : []),
          ]),
        }))
      })
      .catch((e) => {
        // Messages just go unnamed; don't ask again for this sender.
        console.error("listCollaborators failed:", e)
        if (cancelled) return
        setDirectory((prev) => ({
          members: (prev ?? EMPTY).members,
          looked: new Set([...(prev ?? EMPTY).looked, unknown]),
        }))
      })
    return () => {
      cancelled = true
    }
  }, [roomId, unknown])

  return useMemo(
    () =>
      directory && directory.members.length > 1
        ? new Map(
            directory.members.map((m) => [
              m.userId,
              { name: m.name, avatar: m.avatar },
            ])
          )
        : null,
    [directory]
  )
}
