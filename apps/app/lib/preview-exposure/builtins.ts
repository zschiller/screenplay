import { z } from "zod"

import type { ExposedPort, PreviewExposure } from "@/lib/preview-exposure/types"

const portNumber = z.number().int().min(1).max(65535)

const portRange = z
  .object({ from: portNumber, to: portNumber })
  .strict()
  .refine((r) => r.from <= r.to, {
    message: "`from` must not be above `to`",
  })

/** A URL with `{port}` in it, e.g. "http://localhost:{port}". */
const portTemplate = z
  .string()
  .refine((t) => t.includes("{port}"), {
    message: "must contain {port}",
  })
  .refine((t) => isHttpUrl(fill(t, 1)), {
    message: "must be an http(s) URL once {port} is filled in",
  })

/**
 * The options each built-in takes. Each built-in checks its own against these,
 * so a fork that passes a bad one fails with a message naming it.
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
} as const

export type PreviewExposureId = keyof typeof previewExposureOptions

/** Every built-in's options, keyed by its id. */
export type PreviewExposureOptions = {
  [Id in PreviewExposureId]: z.infer<(typeof previewExposureOptions)[Id]>
}

/** Check a built-in's options, naming the bad one. */
function checked<Id extends PreviewExposureId>(
  id: Id,
  options: unknown
): PreviewExposureOptions[Id] {
  const parsed = previewExposureOptions[id].safeParse(options)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const at = issue?.path.length ? ` ${issue.path.join(".")}` : ""
    throw new Error(
      `Preview exposure "${id}":${at} ${issue?.message ?? "invalid options"}`
    )
  }
  return parsed.data as PreviewExposureOptions[Id]
}

export function loopbackExposure(
  input: PreviewExposureOptions["loopback"] = {}
): PreviewExposure {
  const options = checked("loopback", input)
  const origin = options.origin ?? "http://localhost:{port}"
  return {
    bind: options.ports
      ? { host: "127.0.0.1", ports: options.ports }
      : { host: "127.0.0.1" },
    async expose(port): Promise<ExposedPort> {
      return { browserOrigin: new URL(fill(origin, port)).origin }
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
