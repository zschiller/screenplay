export const EXTENSIONS_DIR: string

export interface FoundExtension {
  id: string
  path: string
  files: { server?: string; client?: string }
}

export function listExtensions(dir?: string): FoundExtension[]

export function registrySource(
  registry: "server" | "client",
  extensions: FoundExtension[],
  outDir: string
): string

export function generateExtensionRegistry(opts?: {
  dir?: string
  outDir?: string
  log?: boolean
}): { extensions: string[] }

export function watchExtensions(): void
