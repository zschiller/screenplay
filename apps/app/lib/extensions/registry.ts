import "server-only"

import { serverExtensions } from "@extensions/server"

import { INTERFACES, type ServerInterfaces } from "./interfaces"
import type { AnyOptions, Implementation, ServerExtension } from "./types"

export type InterfaceKey = keyof ServerInterfaces

/**
 * Every implementation of one interface the config file can name: built-ins by
 * bare id, then each extension's as `<extension>/<name>`.
 */
export function implementationsOf<K extends InterfaceKey>(
  key: K,
  extensions: Record<string, ServerExtension> = serverExtensions
): Map<string, Implementation<ServerInterfaces[K], AnyOptions>> {
  type Impl = Implementation<ServerInterfaces[K], AnyOptions>
  const found = new Map<string, Impl>(Object.entries(INTERFACES[key].builtIns))
  for (const [extensionId, extension] of Object.entries(extensions)) {
    const own: Record<string, Impl> = extension.implementations[key] ?? {}
    for (const [name, implementation] of Object.entries(own)) {
      found.set(`${extensionId}/${name}`, implementation)
    }
  }
  return found
}

/** The ids of the extensions this build picked up from the folder. */
export function extensionIds(
  extensions: Record<string, ServerExtension> = serverExtensions
): string[] {
  return Object.keys(extensions)
}
