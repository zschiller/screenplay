// The client registry before lib/extensions/codegen.mjs has run (a fresh
// clone). tsconfig `paths` prefer the generated `client.generated.ts`.
import type { ClientExtension } from "@/lib/extensions/types"

export const clientExtensions: Record<string, ClientExtension> = {}
