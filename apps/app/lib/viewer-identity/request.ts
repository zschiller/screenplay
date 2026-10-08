import "server-only"

import { headers } from "next/headers"

import {
  decodeHeaderValue,
  REFUSAL_HEADER,
  VIEWER_HEADER,
} from "@/server/viewer.mjs"
import { viewers } from "@/lib/capabilities"
import type { ViewerPerson } from "@/lib/viewer-identity/types"

/**
 * Who this request is from, as the front server worked it out (#1931): the
 * host, a viewer the Viewer identity named, or a viewer it
 * refused. The role comes from the listener the request arrived on; the front
 * server strips any client-sent copy of the header this reads, so it can be
 * trusted. Without the viewers capability (anywhere but the Mac app) there is
 * no viewer listener and everyone is the host.
 */
export type RequestRole =
  | { role: "host" }
  | { role: "viewer"; person: ViewerPerson }
  | { role: "refused"; message: string }

export async function requestRole(): Promise<RequestRole> {
  if (!viewers) return { role: "host" }
  return roleFromHeaders(await headers())
}

/** {@link requestRole} from a request's headers. */
export function roleFromHeaders(h: Pick<Headers, "get">): RequestRole {
  const person = asPerson(decodeHeaderValue(h.get(VIEWER_HEADER)))
  if (person) return { role: "viewer", person }
  const refusal = decodeHeaderValue(h.get(REFUSAL_HEADER)) as {
    message?: unknown
  } | null
  if (refusal && typeof refusal.message === "string") {
    return { role: "refused", message: refusal.message }
  }
  return { role: "host" }
}

function asPerson(value: unknown): ViewerPerson | null {
  const v = value as Partial<ViewerPerson> | null
  if (!v || typeof v.id !== "string" || typeof v.name !== "string") return null
  return {
    id: v.id,
    name: v.name,
    ...(typeof v.email === "string" && { email: v.email }),
    ...(typeof v.avatarUrl === "string" && { avatarUrl: v.avatarUrl }),
  }
}
