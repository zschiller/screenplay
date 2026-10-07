// The server registry before lib/extensions/codegen.mjs has run (a fresh
// clone). tsconfig `paths` prefer the generated `server.generated.ts`.
import "server-only"

import type { ServerExtension } from "@/lib/extensions/types"

export const serverExtensions: Record<string, ServerExtension> = {}
