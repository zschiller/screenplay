import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { z } from "zod"

import { defineImplementation } from "@/lib/extensions/types"
import type {
  ExposedPort,
  PortRange,
  PreviewExposure,
} from "@/lib/preview-exposure/types"

const run = promisify(execFile)

/** How long an expose or release command may take before it counts as failed. */
const COMMAND_TIMEOUT_MS = 30_000

const portNumber = z.number().int().min(1).max(65535)

const portRange = z
  .object({ from: portNumber, to: portNumber })
  .strict()
  .refine((r) => r.from <= r.to, {
    message: "`from` must not be above `to`",
  })

/** A URL with `{port}` in it, e.g. "https://{port}-box.corp.example". */
const portTemplate = z
  .string()
  .refine((t) => t.includes("{port}"), {
    message: "must contain {port}",
  })
  .refine((t) => isHttpUrl(fill(t, 1)), {
    message: "must be an http(s) URL once {port} is filled in",
  })

/** An argv with `{port}` filled in per call, e.g. ["corp-expose", "{port}"]. */
const command = z.array(z.string().min(1)).min(1)

/**
 * The options each built-in takes, as config writes them next to `use`. A
 * config file is validated against these before the server starts.
 */
export const previewExposureOptions = {
  /** The Mac app: previews on 127.0.0.1, loaded at `http://localhost:{port}`. */
  loopback: z
    .object({
      /** The browser origin, default `http://localhost:{port}`. */
      origin: portTemplate.optional(),
      ports: portRange.optional(),
    })
    .strict(),
  /** A proxy that gives every port its own URL, from a pattern. */
  "url-template": z
    .object({
      origin: portTemplate,
      signInUrl: portTemplate.optional(),
      /** Default "0.0.0.0", so an outside proxy can reach the listeners. */
      bindHost: z.string().min(1).optional(),
      ports: portRange.optional(),
    })
    .strict(),
  /** Commands that expose and release a port (`tailscale serve`, a company tool). */
  command: z
    .object({
      exposeCommand: command,
      releaseCommand: command.optional(),
      origin: portTemplate,
      signInUrl: portTemplate.optional(),
      /** Default "127.0.0.1": the command forwards to the listener locally. */
      bindHost: z.string().min(1).optional(),
      ports: portRange.optional(),
    })
    .strict(),
} as const

export type PreviewExposureId = keyof typeof previewExposureOptions

/** Every built-in's options, keyed by its id. */
export type PreviewExposureOptions = {
  [Id in PreviewExposureId]: z.infer<(typeof previewExposureOptions)[Id]>
}

/** A config entry: which implementation to use and its options. */
export type PreviewExposureConfig = {
  [Id in PreviewExposureId]: { use: Id } & PreviewExposureOptions[Id]
}[PreviewExposureId]

export function loopbackExposure(
  options: PreviewExposureOptions["loopback"] = {}
): PreviewExposure {
  const origin = options.origin ?? "http://localhost:{port}"
  return templateExposure({
    bind: { host: "127.0.0.1", ports: options.ports },
    origin,
  })
}

export function urlTemplateExposure(
  options: PreviewExposureOptions["url-template"]
): PreviewExposure {
  return templateExposure({
    bind: { host: options.bindHost ?? "0.0.0.0", ports: options.ports },
    origin: options.origin,
    signInUrl: options.signInUrl,
  })
}

export function commandExposure(
  options: PreviewExposureOptions["command"]
): PreviewExposure {
  const urls = templateExposure({
    bind: { host: options.bindHost ?? "127.0.0.1", ports: options.ports },
    origin: options.origin,
    signInUrl: options.signInUrl,
  })
  return {
    bind: urls.bind,
    async expose(port) {
      try {
        await runCommand(options.exposeCommand, port)
      } catch (err) {
        throw new Error(
          `The preview couldn’t be exposed on port ${port}: ${commandError(err)}`
        )
      }
      return urls.expose(port)
    },
    async release(port) {
      if (!options.releaseCommand) return
      try {
        await runCommand(options.releaseCommand, port)
      } catch (err) {
        console.warn(
          `[preview-exposure] releasing port ${port} failed: ${commandError(err)}`
        )
      }
    },
  }
}

/**
 * Build a built-in from a config entry, validating its options. Throws with a
 * message naming the bad option, so the server can refuse to start with it.
 */
export function createPreviewExposure(config: {
  use: string
  [option: string]: unknown
}): PreviewExposure {
  const { use, ...rest } = config
  if (!isBuiltin(use)) {
    const known = Object.keys(previewExposureOptions).join(", ")
    throw new Error(`Unknown preview exposure "${use}". Built-ins: ${known}.`)
  }
  const parsed = previewExposureOptions[use].safeParse(rest)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const at = issue?.path.length ? ` ${issue.path.join(".")}` : ""
    throw new Error(
      `Preview exposure "${use}":${at} ${issue?.message ?? "invalid options"}`
    )
  }
  switch (use) {
    case "loopback":
      return loopbackExposure(parsed.data as PreviewExposureOptions["loopback"])
    case "url-template":
      return urlTemplateExposure(
        parsed.data as PreviewExposureOptions["url-template"]
      )
    case "command":
      return commandExposure(parsed.data as PreviewExposureOptions["command"])
  }
}

function isBuiltin(id: string): id is PreviewExposureId {
  return Object.hasOwn(previewExposureOptions, id)
}

/** The URL part every template built-in shares: origins from a `{port}` pattern. */
function templateExposure(opts: {
  bind: { host: string; ports?: PortRange }
  origin: string
  signInUrl?: string
}): PreviewExposure {
  const bind = opts.bind.ports
    ? { host: opts.bind.host, ports: opts.bind.ports }
    : { host: opts.bind.host }
  return {
    bind,
    async expose(port): Promise<ExposedPort> {
      const browserOrigin = new URL(fill(opts.origin, port)).origin
      return opts.signInUrl
        ? { browserOrigin, signInUrl: fill(opts.signInUrl, port) }
        : { browserOrigin }
    },
    async release() {},
  }
}

function fill(template: string, port: number): string {
  return template.replaceAll("{port}", String(port))
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

async function runCommand(argv: string[], port: number): Promise<void> {
  const [file, ...args] = argv.map((a) => fill(a, port))
  await run(file!, args, { timeout: COMMAND_TIMEOUT_MS })
}

function commandError(err: unknown): string {
  const stderr = (err as { stderr?: unknown })?.stderr
  if (typeof stderr === "string" && stderr.trim()) return stderr.trim()
  return err instanceof Error ? err.message : String(err)
}

/**
 * The built-ins as the config file's `previewExposure` field names them
 * (`lib/extensions/interfaces.ts`), each checked against its options above.
 */
export const previewExposureBuiltIns = {
  loopback: defineImplementation({
    options: previewExposureOptions.loopback,
    create: (options) => loopbackExposure(options),
  }),
  "url-template": defineImplementation({
    options: previewExposureOptions["url-template"],
    create: (options) => urlTemplateExposure(options),
  }),
  command: defineImplementation({
    options: previewExposureOptions.command,
    create: (options) => commandExposure(options),
  }),
}
