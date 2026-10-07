import { spawn } from "node:child_process"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  chromiumNetworkArgs,
  isLoopbackHost,
  outboundProxyEnv,
} from "./outbound-proxy"
import { cleanEnv, startTestNetwork, type TestNetwork } from "./test-network"

describe("outboundProxyEnv", () => {
  it("sets nothing when nothing is configured", () => {
    expect(outboundProxyEnv({})).toEqual({})
  })

  it("sends Node and every child through the proxy, never loopback", () => {
    const env = outboundProxyEnv({
      url: "http://proxy.corp:3128",
      noProxy: [".corp.example", "localhost"],
    })
    for (const name of ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY"]) {
      expect(env[name]).toBe("http://proxy.corp:3128")
    }
    expect(env.NODE_USE_ENV_PROXY).toBe("1")
    expect(env.NO_PROXY).toBe(
      "localhost,127.0.0.1,::1,.localhost,.corp.example"
    )
    expect(env.no_proxy).toBe(env.NO_PROXY)
  })

  it("trusts a CA on its own, without a proxy", () => {
    expect(outboundProxyEnv({ caFile: "/etc/corp/ca.pem" })).toEqual({
      NODE_EXTRA_CA_CERTS: "/etc/corp/ca.pem",
    })
  })
})

describe("chromiumNetworkArgs", () => {
  it("is empty without a proxy", () => {
    expect(chromiumNetworkArgs({ NODE_EXTRA_CA_CERTS: "/ca.pem" })).toEqual([])
  })

  it("passes the proxy and the bypass list, in Chromium's spelling", () => {
    const env = outboundProxyEnv({
      url: "http://proxy.corp:3128",
      noProxy: [".corp.example"],
    })
    expect(chromiumNetworkArgs(env)).toEqual([
      "--proxy-server=http://proxy.corp:3128",
      "--proxy-bypass-list=localhost;127.0.0.1;::1;*.localhost;*.corp.example",
    ])
  })
})

describe("isLoopbackHost", () => {
  it.each([
    "localhost",
    "app.feat-x.localhost",
    "127.0.0.1",
    "127.8.0.3",
    "[::1]",
  ])("%s is on this machine", (host) => expect(isLoopbackHost(host)).toBe(true))

  it.each(["fonts.gstatic.com", "10.0.0.1", "localhost.example.com"])(
    "%s is off-box",
    (host) => expect(isLoopbackHost(host)).toBe(false)
  )
})

/**
 * Runs `code` in a fresh Node started with the environment the start script
 * would give it, and returns what it printed.
 */
function runNode(
  code: string,
  env: Record<string, string>
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ["--no-warnings", "--input-type=module", "-e", code],
      { env: cleanEnv(env) }
    )
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => (stdout += chunk))
    child.stderr.on("data", (chunk) => (stderr += chunk))
    child.on("close", (exitCode) => resolve({ code: exitCode, stdout, stderr }))
  })
}

describe("a server request behind a company proxy and CA", () => {
  let network: TestNetwork

  beforeAll(async () => {
    network = await startTestNetwork((req, res) => {
      res.end(`hello from ${req.url}`)
    })
  })
  afterAll(() => network.close())

  const fetchBoth = (origin: string) => `
    const viaFetch = await (await fetch("${origin}/fetch")).text()
    const https = await import("node:https")
    const viaHttps = await new Promise((resolve, reject) => {
      https.get("${origin}/https", (res) => {
        let body = ""
        res.on("data", (chunk) => (body += chunk))
        res.on("end", () => resolve(body))
      }).on("error", reject)
    })
    console.log(JSON.stringify([viaFetch, viaHttps]))
  `

  it("goes through the proxy and trusts the CA, for fetch and https", async () => {
    const before = network.tunnels.length
    const result = await runNode(
      fetchBoth(network.remoteOrigin),
      outboundProxyEnv({ url: network.proxyUrl, caFile: network.caFile })
    )
    expect(result.stderr).toBe("")
    expect(JSON.parse(result.stdout)).toEqual([
      "hello from /fetch",
      "hello from /https",
    ])
    expect(network.tunnels.slice(before)).toEqual([
      network.remoteOrigin.replace("https://", ""),
      network.remoteOrigin.replace("https://", ""),
    ])
  })

  it("fails without the CA, so the CA is what made it work", async () => {
    const result = await runNode(
      fetchBoth(network.remoteOrigin),
      outboundProxyEnv({ url: network.proxyUrl })
    )
    expect(result.code).not.toBe(0)
  })
})
