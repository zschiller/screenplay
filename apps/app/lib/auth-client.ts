"use client"

import { createAuthClient } from "better-auth/react"
import { AUTH_BASE_PATH } from "@/lib/base-path"
import { isLocalBuild } from "@/lib/local-mode"
import { LOCAL_USER } from "@/lib/local-user"

// Mirror the server's `basePath`: in the browser the client resolves its fetch
// target as `window.location.origin` + this path, so it must include the `/app`
// prefix to reach the handler at `/app/api/auth/*` instead of the apex root.
export const authClient = createAuthClient({ basePath: AUTH_BASE_PATH })

export const { signIn, signOut, useSession } = authClient

// The local desktop build (PRD #404, issue #417) has no login — there is one
// seeded local user and no `/api/auth/get-session` to call. This synthetic
// result lets the few client components that need an identity (the canvas's
// presence seed, the chat panel, the sidebar header) read `data.user` without a
// network round-trip.
const LOCAL_SESSION_RESULT = {
  data: {
    user: {
      id: LOCAL_USER.id,
      name: LOCAL_USER.name,
      email: LOCAL_USER.email,
      image: null,
    },
    session: { id: "local", userId: LOCAL_USER.id },
  },
  isPending: false,
  error: null,
  refetch: () => {},
} as unknown as ReturnType<typeof useSession>

/**
 * Session for components, build-aware. In the hosted build this is Better
 * Auth's `useSession`; in the local build it short-circuits to the single
 * seeded local user. `isLocalBuild` is a compile-time constant, so exactly one
 * branch survives bundling and the hook call below is unconditional within any
 * given build (despite the rules-of-hooks lint).
 */
export function useAppSession(): ReturnType<typeof useSession> {
  if (isLocalBuild) return LOCAL_SESSION_RESULT
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useSession()
}
