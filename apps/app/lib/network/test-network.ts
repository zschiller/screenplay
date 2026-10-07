import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import http from "node:http"
import https from "node:https"
import net from "node:net"
import type stream from "node:stream"
import { tmpdir } from "node:os"
import path from "node:path"

/**
 * A stand-in for a locked-down network in tests (#1929): a company CA, an
 * HTTPS host only reachable by name through a proxy, and the proxy itself,
 * which records every tunnel it opens. The host's name doesn't resolve, so a
 * request that skips the proxy fails, and its certificate is signed by the CA
 * alone, so a request that doesn't trust the CA fails too.
 */
export type TestNetwork = {
  /** PEM file of the company CA. */
  caFile: string
  /** `http://127.0.0.1:<port>`, the proxy to configure. */
  proxyUrl: string
  /** An origin on the far side of the proxy, e.g. `https://intranet.test:1234`. */
  remoteOrigin: string
  /** `host:port` of each tunnel the proxy opened, in order. */
  tunnels: string[]
  close(): Promise<void>
}

export const REMOTE_HOST = "intranet.test"

/** Mints a CA and a host certificate it signs, with the system `openssl`. */
function mintCertificates(): { caFile: string; key: string; cert: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "screenplay-ca-"))
  const at = (name: string) => path.join(dir, name)
  const openssl = (...args: string[]) =>
    execFileSync("openssl", args, { stdio: "ignore" })
  openssl(
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-days",
    "1",
    "-subj",
    "/CN=Screenplay Test Company CA",
    "-keyout",
    at("ca.key"),
    "-out",
    at("ca.pem")
  )
  openssl(
    "req",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-subj",
    `/CN=${REMOTE_HOST}`,
    "-keyout",
    at("host.key"),
    "-out",
    at("host.csr")
  )
  writeFileSync(at("host.ext"), `subjectAltName=DNS:${REMOTE_HOST}\n`)
  openssl(
    "x509",
    "-req",
    "-days",
    "1",
    "-in",
    at("host.csr"),
    "-CA",
    at("ca.pem"),
    "-CAkey",
    at("ca.key"),
    "-CAcreateserial",
    "-extfile",
    at("host.ext"),
    "-out",
    at("host.pem")
  )
  return {
    caFile: at("ca.pem"),
    key: readFileSync(at("host.key"), "utf8"),
    cert: readFileSync(at("host.pem"), "utf8"),
  }
}

function listen(server: net.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve((server.address() as net.AddressInfo).port)
    })
  })
}

/** Starts the network. `handler` answers requests to the remote host. */
export async function startTestNetwork(
  handler: http.RequestListener
): Promise<TestNetwork> {
  const { caFile, key, cert } = mintCertificates()
  const remote = https.createServer({ key, cert }, handler)
  const remotePort = await listen(remote)

  const tunnels: string[] = []
  const sockets = new Set<stream.Duplex>()
  const proxy = http.createServer((_req, res) => {
    res.writeHead(405).end()
  })
  proxy.on("connect", (req, client, head) => {
    tunnels.push(req.url ?? "")
    const [host, port] = (req.url ?? "").split(":")
    if (host !== REMOTE_HOST || Number(port) !== remotePort) {
      client.end("HTTP/1.1 502 Bad Gateway\r\n\r\n")
      return
    }
    const upstream = net.connect(remotePort, "127.0.0.1", () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n")
      upstream.write(head)
      upstream.pipe(client)
      client.pipe(upstream)
    })
    for (const socket of [client, upstream]) {
      sockets.add(socket)
      socket.on("error", () => socket.destroy())
      socket.on("close", () => sockets.delete(socket))
    }
  })
  const proxyPort = await listen(proxy)

  return {
    caFile,
    proxyUrl: `http://127.0.0.1:${proxyPort}`,
    remoteOrigin: `https://${REMOTE_HOST}:${remotePort}`,
    tunnels,
    async close() {
      for (const socket of sockets) socket.destroy()
      remote.closeAllConnections()
      await Promise.all(
        [remote, proxy].map(
          (server) => new Promise((resolve) => server.close(resolve))
        )
      )
    },
  }
}

/**
 * The environment a child process starts with: this one's, minus any proxy
 * and CA settings it inherited (a CI runner or dev container may have its
 * own), plus `extra`.
 */
export function cleanEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env = {} as NodeJS.ProcessEnv
  for (const [name, value] of Object.entries(process.env)) {
    if (/proxy|^NODE_EXTRA_CA_CERTS$|^NODE_OPTIONS$/i.test(name)) continue
    env[name] = value
  }
  return { ...env, ...extra }
}
