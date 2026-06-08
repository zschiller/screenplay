"use client"

import { createAuthClient } from "better-auth/react"
import { AUTH_BASE_PATH } from "@/lib/base-path"

// Mirror the server's `basePath`: in the browser the client resolves its fetch
// target as `window.location.origin` + this path, so it must include the `/app`
// prefix to reach the handler at `/app/api/auth/*` instead of the apex root.
export const authClient = createAuthClient({ basePath: AUTH_BASE_PATH })

export const { signIn, signOut, useSession } = authClient
