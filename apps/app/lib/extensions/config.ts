import "server-only"

import { mkdirSync, readFileSync } from "node:fs"
import path from "node:path"

import { z } from "zod"

import { INTERFACES } from "./built-ins"
import type { ServerInterfaces } from "./interfaces"
import { parseJsonc } from "./jsonc"
import { type InterfaceKey, implementationsOf } from "./registry"
import type {
  AnyOptions,
  ExtensionContext,
  Implementation,
  ServerExtension,
} from "./types"

/** The env var naming the config file. Unset: no file, every default. */
export const CONFIG_ENV_VAR = "SCREENPLAY_CONFIG"

/** The file name the docs use, kept in the data folder. */
export const CONFIG_FILE_NAME = "screenplay.config.jsonc"

const port = z.number().int().min(1).max(65535)

/** Everything in the file except the interfaces, which are checked after. */
const settingsSchema = z.strictObject({
  $schema: z.string().optional(),
  /** Where Screenplay keeps its data. Relative to the config file's folder. */
  dataFolder: z.string().min(1).optional(),
  listeners: z
    .strictObject({
      /** The host's own listener. Always 127.0.0.1; only the port is set. */
      host: z.strictObject({ port }).optional(),
      /** Network listeners for viewers. */
      viewers: z
        .array(
          z.strictObject({
            name: z.string().min(1),
            address: z.string().min(1),
            port,
          })
        )
        .optional(),
    })
    .optional(),
  /** The company's outbound proxy and the certificate authority it uses. */
  outboundProxy: z
    .strictObject({
      url: z.url(),
      noProxy: z.array(z.string()).optional(),
      /** A PEM file of extra certificate authorities. Relative to the config file. */
      caFile: z.string().min(1).optional(),
    })
    .optional(),
  ...(Object.fromEntries(
    Object.keys(INTERFACES).map((key) => [key, z.unknown().optional()])
  ) as Record<InterfaceKey, z.ZodOptional<z.ZodUnknown>>),
})

type Settings = Omit<z.output<typeof settingsSchema>, InterfaceKey>

/** One implementation the file picked, with its checked options. */
export interface Selection<K extends InterfaceKey> {
  use: string
  implementation: Implementation<ServerInterfaces[K], AnyOptions>
  options: unknown
}

export interface ScreenplayConfig extends Omit<Settings, "$schema"> {
  /** The file it was read from; null when there is none. */
  file: string | null
  dataFolder: string
  /** Per interface, what the file picked (or its default): one entry, or a list when the interface takes many. */
  interfaces: { [K in InterfaceKey]: Selection<K>[] }
  /** The interfaces the file names; the rest are left at their defaults. */
  named: InterfaceKey[]
}

/** A config file the server can't start with. The message names each field. */
export class ConfigError extends Error {
  constructor(
    readonly file: string,
    readonly problems: string[]
  ) {
    super(
      `${file} isn’t valid, so Screenplay won’t start:\n${problems
        .map((p) => `  ${p}`)
        .join("\n")}`
    )
    this.name = "ConfigError"
  }
}

/** `listeners.viewers[0].port`, from a zod issue path. */
function fieldName(segments: readonly PropertyKey[]): string {
  return segments
    .map((s, i) =>
      typeof s === "number" ? `[${s}]` : i === 0 ? String(s) : `.${String(s)}`
    )
    .join("")
}

function describeIssues(
  issues: readonly z.core.$ZodIssue[],
  prefix: readonly PropertyKey[] = []
): string[] {
  return issues.flatMap((issue) => {
    const at = [...prefix, ...issue.path]
    if (issue.code === "unrecognized_keys") {
      return issue.keys.map(
        (key) => `${fieldName([...at, key])}: not a setting Screenplay knows`
      )
    }
    return [`${fieldName(at) || "(file)"}: ${issue.message}`]
  })
}

function selectEntries<K extends InterfaceKey>(
  key: K,
  raw: unknown,
  extensions: Record<string, ServerExtension> | undefined,
  problems: string[]
): Selection<K>[] {
  const spec = INTERFACES[key]
  const value = raw === undefined ? spec.defaultEntry : raw
  const many = spec.many === true
  if (many !== Array.isArray(value)) {
    problems.push(
      `${key}: expected ${many ? "a list of" : "one"} { "use": "<id>", …options }`
    )
    return []
  }
  const known = implementationsOf(key, extensions)
  const entries: unknown[] = many ? (value as unknown[]) : [value]
  return entries.flatMap((entry, i) => {
    const at: PropertyKey[] = many ? [key, i] : [key]
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      problems.push(`${fieldName(at)}: expected { "use": "<id>", …options }`)
      return []
    }
    const { use, ...options } = entry as Record<string, unknown>
    if (typeof use !== "string") {
      problems.push(
        `${fieldName([...at, "use"])}: required; one of ${[...known.keys()].join(", ")}`
      )
      return []
    }
    const implementation = known.get(use)
    if (!implementation) {
      problems.push(
        `${fieldName([...at, "use"])}: "${use}" isn’t a built-in or an extension this build picked up; known: ${[...known.keys()].join(", ")}`
      )
      return []
    }
    const parsed = implementation.options.strict().safeParse(options)
    if (!parsed.success) {
      problems.push(...describeIssues(parsed.error.issues, at))
      return []
    }
    return [{ use, implementation, options: parsed.data }]
  })
}

/**
 * Check a config file's contents. `file` names it in messages and anchors its
 * relative paths. Throws a {@link ConfigError} listing every bad field.
 */
export function parseConfig(
  text: string | null,
  file: string | null,
  extensions?: Record<string, ServerExtension>
): ScreenplayConfig {
  const label = file ?? CONFIG_FILE_NAME
  let raw: unknown = {}
  if (text !== null) {
    try {
      raw = parseJsonc(text)
    } catch (err) {
      throw new ConfigError(label, [
        `not JSON with comments: ${err instanceof Error ? err.message : err}`,
      ])
    }
  }
  const settings = settingsSchema.safeParse(raw)
  const problems = settings.success ? [] : describeIssues(settings.error.issues)
  const values = (raw ?? {}) as Record<string, unknown>
  const interfaces = Object.fromEntries(
    (Object.keys(INTERFACES) as InterfaceKey[]).map((key) => [
      key,
      selectEntries(key, values[key], extensions, problems),
    ])
  ) as ScreenplayConfig["interfaces"]
  if (!settings.success || problems.length > 0) {
    throw new ConfigError(label, problems)
  }
  const base = file ? path.dirname(path.resolve(file)) : process.cwd()
  const {
    $schema: _schema,
    dataFolder,
    outboundProxy,
    listeners,
  } = settings.data
  return {
    file,
    dataFolder: path.resolve(base, dataFolder ?? (file ? "." : ".screenplay")),
    listeners,
    outboundProxy: outboundProxy && {
      ...outboundProxy,
      caFile: outboundProxy.caFile && path.resolve(base, outboundProxy.caFile),
    },
    interfaces,
    named: (Object.keys(INTERFACES) as InterfaceKey[]).filter(
      (key) => values[key] !== undefined
    ),
  }
}

/** Read and check the file `SCREENPLAY_CONFIG` names, or the defaults. */
export function loadConfig(
  env: Record<string, string | undefined> = process.env
): ScreenplayConfig {
  const file = env[CONFIG_ENV_VAR] || null
  if (!file) return parseConfig(null, null)
  let text: string
  try {
    text = readFileSync(file, "utf8")
  } catch (err) {
    throw new ConfigError(file, [
      `can’t be read: ${err instanceof Error ? err.message : err}`,
    ])
  }
  return parseConfig(text, file)
}

let cached: ScreenplayConfig | undefined

/** The config, read once per server process. */
export function getConfig(): ScreenplayConfig {
  cached ??= loadConfig()
  return cached
}

/**
 * Build the implementations the config picked for one interface: one for most
 * interfaces, several for one that takes a list.
 */
export async function createConfigured<K extends InterfaceKey>(
  key: K,
  config: ScreenplayConfig = getConfig()
): Promise<ServerInterfaces[K][]> {
  return Promise.all(
    config.interfaces[key].map(({ use, implementation, options }) => {
      const ctx: ExtensionContext = {
        dataFolder: path.join(
          config.dataFolder,
          "extensions",
          key,
          use.replace(/\//g, "__")
        ),
        log: (line) => console.log(`[${key}:${use}] ${line}`),
      }
      mkdirSync(ctx.dataFolder, { recursive: true })
      return implementation.create(options, ctx)
    })
  )
}
