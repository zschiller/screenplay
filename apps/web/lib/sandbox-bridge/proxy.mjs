import http from "node:http"
import net from "node:net"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const UPSTREAM_PORT = Number(process.env.SCREENPLAY_UPSTREAM_PORT) || 3000
const LISTEN_PORT = Number(process.env.SCREENPLAY_LISTEN_PORT) || 3001
const UPSTREAM_HOST = "127.0.0.1"

const __dirname = dirname(fileURLToPath(import.meta.url))
const BRIDGE_PATH = join(__dirname, "bridge.js")

const BRIDGE_TAG = '<script src="/__screenplay-bridge.js" data-screenplay-bridge></script>'

function log(...args) {
  console.log("[screenplay-proxy]", ...args)
}

function stripResponseHeaders(h) {
  const out = { ...h }
  delete out["content-security-policy"]
  delete out["content-security-policy-report-only"]
  delete out["x-frame-options"]
  delete out["content-encoding"]
  delete out["content-length"]
  return out
}

function injectBridge(html) {
  const headClose = html.search(/<\/head\s*>/i)
  if (headClose !== -1) {
    return html.slice(0, headClose) + BRIDGE_TAG + html.slice(headClose)
  }
  const bodyOpen = html.search(/<body\b[^>]*>/i)
  if (bodyOpen !== -1) {
    const tagEnd = html.indexOf(">", bodyOpen) + 1
    return html.slice(0, tagEnd) + BRIDGE_TAG + html.slice(tagEnd)
  }
  return BRIDGE_TAG + html
}

function serveBridge(res) {
  // Re-read from disk each request so bridge updates written by installBridge
  // take effect without restarting the proxy.
  const bridge = readFileSync(BRIDGE_PATH)
  res.writeHead(200, {
    "content-type": "application/javascript; charset=utf-8",
    "cache-control": "no-store",
    "content-length": bridge.length,
  })
  res.end(bridge)
}

function servePlaceholder(res, statusCode = 503) {
  const body = `<!doctype html><html><head><title>Starting…</title></head><body><p>Dev server not yet ready.</p></body></html>`
  res.writeHead(statusCode, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
  })
  res.end(body)
}

const server = http.createServer((req, res) => {
  if (req.url === "/__screenplay-bridge.js") {
    serveBridge(res)
    return
  }

  const headers = { ...req.headers }
  headers["host"] = `${UPSTREAM_HOST}:${UPSTREAM_PORT}`
  headers["accept-encoding"] = "identity"
  if (headers["origin"]) headers["origin"] = `http://${UPSTREAM_HOST}:${UPSTREAM_PORT}`

  const upstreamReq = http.request(
    {
      host: UPSTREAM_HOST,
      port: UPSTREAM_PORT,
      method: req.method,
      path: req.url,
      headers,
    },
    (upstreamRes) => {
      const ct = String(upstreamRes.headers["content-type"] || "")
      const outHeaders = stripResponseHeaders(upstreamRes.headers)

      if (!ct.startsWith("text/html")) {
        res.writeHead(upstreamRes.statusCode || 200, outHeaders)
        upstreamRes.pipe(res)
        return
      }

      const chunks = []
      upstreamRes.on("data", (c) => chunks.push(c))
      upstreamRes.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8")
        const injected = injectBridge(body)
        outHeaders["content-length"] = Buffer.byteLength(injected)
        res.writeHead(upstreamRes.statusCode || 200, outHeaders)
        res.end(injected)
      })
      upstreamRes.on("error", (err) => {
        log("upstream response error", err.message)
        if (!res.headersSent) servePlaceholder(res, 502)
        else res.destroy()
      })
    },
  )

  upstreamReq.on("error", (err) => {
    log("upstream request error", err.message)
    if (!res.headersSent) servePlaceholder(res, 503)
    else res.destroy()
  })

  req.pipe(upstreamReq)
})

server.on("upgrade", (req, clientSocket, head) => {
  const upstream = net.connect(UPSTREAM_PORT, UPSTREAM_HOST, () => {
    const headers = { ...req.headers }
    headers["host"] = `${UPSTREAM_HOST}:${UPSTREAM_PORT}`
    if (headers["origin"]) headers["origin"] = `http://${UPSTREAM_HOST}:${UPSTREAM_PORT}`
    const headerLines = Object.entries(headers)
      .map(([k, v]) => Array.isArray(v) ? v.map((vv) => `${k}: ${vv}`).join("\r\n") : `${k}: ${v}`)
      .join("\r\n")
    upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${headerLines}\r\n\r\n`)
    if (head && head.length) upstream.write(head)
    upstream.pipe(clientSocket)
    clientSocket.pipe(upstream)
  })
  upstream.on("error", () => clientSocket.destroy())
  clientSocket.on("error", () => upstream.destroy())
})

server.listen(LISTEN_PORT, "0.0.0.0", () => {
  log(`listening on 0.0.0.0:${LISTEN_PORT} -> ${UPSTREAM_HOST}:${UPSTREAM_PORT}`)
  log("CSP headers are stripped; intended for dev use only")
})
