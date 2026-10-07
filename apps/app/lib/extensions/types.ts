import type { z } from "zod"

import type { ClientInterfaces, ServerInterfaces } from "./interfaces"

/**
 * What an implementation gets when the server builds it from the config file.
 * Deliberately small: an extension can use Node itself for anything else.
 */
export interface ExtensionContext {
  /** A folder this implementation may keep files in. Exists before `create` runs. */
  dataFolder: string
  /** One line to the server log, prefixed with the implementation id. */
  log(line: string): void
}

/**
 * One implementation of one interface. Built-ins and extensions have the same
 * shape. The config file picks one with `{ "use": "<id>", …options }`;
 * `options` validates everything but `use` (unknown fields are refused), and
 * `create` builds the implementation once at server start.
 */
export interface Implementation<T, Options extends z.ZodObject = z.ZodObject> {
  options: Options
  create(options: z.output<Options>, ctx: ExtensionContext): T | Promise<T>
}

/** Any options schema: each implementation checks its own options. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyOptions = any

/**
 * What an extension's `server.ts` default-exports: its implementations, keyed
 * by interface and then by name. The config names one as
 * `<extension folder>/<name>`.
 */
export interface ServerExtension {
  implementations: {
    [K in keyof ServerInterfaces]?: Record<
      string,
      Implementation<ServerInterfaces[K], AnyOptions>
    >
  }
}

/**
 * What an extension's `client.tsx` default-exports ("use client"): browser
 * pieces, keyed by interface and then by name, matching the server side.
 */
export interface ClientExtension {
  components: {
    [K in keyof ClientInterfaces]?: Record<string, ClientInterfaces[K]>
  }
}

/** Typed helpers so an extension gets inference and errors where it writes. */
export function defineServerExtension(ext: ServerExtension): ServerExtension {
  return ext
}

export function defineClientExtension(ext: ClientExtension): ClientExtension {
  return ext
}

export function defineImplementation<Options extends z.ZodObject, T>(
  impl: Implementation<T, Options>
): Implementation<T, Options> {
  return impl
}
