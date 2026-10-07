import { execFileSync, spawn } from "node:child_process"
import { existsSync } from "node:fs"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { fileURLToPath } from "node:url"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { outboundProxyEnv } from "@/lib/network/outbound-proxy"
import {
  cleanEnv,
  startTestNetwork,
  type TestNetwork,
} from "@/lib/network/test-network"

function which(bin: string): string | null {
  try {
    return execFileSync("which", [bin], { encoding: "utf8" }).trim() || null
  } catch {
    return null
  }
}

const CHROME =
  process.env.CHROME ??
  which("google-chrome") ??
  which("chromium") ??
  (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : null)
if (process.env.SCREENPLAY_REQUIRE_BROWSER_STACK && !CHROME) {
  throw new Error("Chrome is required but wasn't found")
}

const APP_DIR = fileURLToPath(new URL("../../..", import.meta.url))
const CAPTURER = fileURLToPath(new URL("./puppeteer.ts", import.meta.url))
const SERVER_ONLY_STUB = new URL(
  "../../../test/stubs/server-only.ts",
  import.meta.url
).href

// Resolves `server-only` (which Next provides, and nothing installs) to the
// test stub, as vitest.config.ts does for in-process tests.
const STUB_SERVER_ONLY = `data:text/javascript,${encodeURIComponent(`
  import { register } from "node:module"
  register("data:text/javascript," + encodeURIComponent(\`
    export async function resolve(specifier, context, next) {
      if (specifier === "server-only") {
        return { url: ${JSON.stringify(SERVER_ONLY_STUB)}, shortCircuit: true }
      }
      return next(specifier, context)
    }
  \`))
`)}`

/**
 * Reads a preview with the Puppeteer capturer in a fresh server process started
 * with `env`, as the start script would start it, and returns what the page's
 * script returned.
 */
function readPreview(
  previewUrl: string,
  script: string,
  env: Record<string, string>
): Promise<string> {
  const code = `
    const { getPuppeteerCapturer } = await import(${JSON.stringify(CAPTURER)})
    const result = await getPuppeteerCapturer().evaluate(
      ${JSON.stringify(previewUrl)},
      { width: 400, height: 300 },
      ${JSON.stringify(script)}
    )
    process.stdout.write(result)
  `
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--no-warnings",
        "--import",
        STUB_SERVER_ONLY,
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        code,
      ],
      { cwd: APP_DIR, env: cleanEnv({ ...env, CHROMIUM_PATH: CHROME! }) }
    )
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => (stdout += chunk))
    child.stderr.on("data", (chunk) => (stderr += chunk))
    child.on("close", (exitCode) =>
      exitCode === 0 ? resolve(stdout) : reject(new Error(stderr))
    )
  })
}

describe.skipIf(!CHROME)("thumbnails behind a company proxy and CA", () => {
  let network: TestNetwork
  let preview: http.Server
  let previewUrl: string

  beforeAll(async () => {
    // A stylesheet on an off-box host, signed by the company CA and reachable
    // only through the proxy, as a CDN on a locked-down network is.
    network = await startTestNetwork((_req, res) => {
      res.writeHead(200, { "content-type": "text/css" })
      res.end("body { background-color: rgb(1, 2, 3); }")
    })
    // The preview itself, on loopback like every preview the server reads.
    preview = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" })
      res.end(
        `<link rel="stylesheet" href="${network.remoteOrigin}/style.css"><p>Preview</p>`
      )
    })
    await new Promise<void>((resolve) =>
      preview.listen(0, "127.0.0.1", resolve)
    )
    previewUrl = `http://127.0.0.1:${(preview.address() as AddressInfo).port}/`
  })

  afterAll(async () => {
    await new Promise((resolve) => preview?.close(resolve))
    await network?.close()
  })

  const background = "return getComputedStyle(document.body).backgroundColor"

  it("loads a preview's off-box resources through the proxy, trusting the CA", async () => {
    const before = network.tunnels.length
    const result = await readPreview(
      previewUrl,
      background,
      outboundProxyEnv({ url: network.proxyUrl, caFile: network.caFile })
    )
    expect(result).toBe("rgb(1, 2, 3)")
    expect(network.tunnels.length).toBeGreaterThan(before)
  }, 60_000)

  it("can't load them without the CA", async () => {
    const result = await readPreview(
      previewUrl,
      background,
      outboundProxyEnv({ url: network.proxyUrl })
    )
    expect(result).not.toBe("rgb(1, 2, 3)")
  }, 60_000)
})
