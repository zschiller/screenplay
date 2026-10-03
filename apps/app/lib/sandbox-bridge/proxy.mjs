import http from "node:http"
import net from "node:net"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const UPSTREAM_PORT = Number(process.env.SCREENPLAY_UPSTREAM_PORT) || 3000
const LISTEN_PORT = Number(process.env.SCREENPLAY_LISTEN_PORT) || 3001
const UPSTREAM_HOST = "127.0.0.1"
// Hosted sandboxes need every interface (the platform forwards the port in);
// the desktop's local backend sets loopback so previews stay off the LAN (#997).
const LISTEN_HOST = process.env.SCREENPLAY_LISTEN_HOST || "0.0.0.0"

const __dirname = dirname(fileURLToPath(import.meta.url))
const BRIDGE_PATH = join(__dirname, "bridge.js")

const BRIDGE_TAG =
  '<script src="/__screenplay-bridge.js" data-screenplay-bridge></script>'

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
  // Drop the upstream's framing header too. The HTML path buffers the body and
  // sets its own content-length (fixed-length framing); the passthrough path
  // pipes a body of unknown length and lets Node re-chunk. Either way, keeping
  // the upstream's `transfer-encoding: chunked` would put Content-Length AND
  // Transfer-Encoding on the same response — a framing conflict that lenient
  // clients (curl, browsers) tolerate but a strict HTTP parser rejects
  // (Node/undici: HPE_INVALID_CONTENT_LENGTH). That's what darkened the iframe:
  // the server-side preview probe (`fetch` → undici) threw on every poll, so it
  // never saw the dev server as ready even though the page served fine in a
  // browser.
  delete out["transfer-encoding"]
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

// The placeholder marks itself (and why the upstream failed) in headers so the
// server-side preview probe can tell "proxy up, dev server not listening"
// (ECONNREFUSED — on the local backend the signature of a dev server that
// never bound the port portless assigned it) apart from a generic unreachable
// preview.
function servePlaceholder(res, statusCode = 503, upstreamError = "") {
  const body = `<!doctype html><html><head><title>Starting…</title></head><body><p>Dev server not yet ready.</p></body></html>`
  res.writeHead(statusCode, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
    "x-screenplay-proxy": "placeholder",
    ...(upstreamError ? { "x-screenplay-upstream-error": upstreamError } : {}),
  })
  res.end(body)
}

// ---------- going local from a shared frame (#1397) ----------
//
// A viewer's local copy of a shared frame starts from the shared browser's
// cookies and local storage. The canvas loads this page in a hidden iframe on
// the preview's origin and posts it the snapshot; it writes local storage
// itself and has the proxy set the cookies (HttpOnly ones included), then
// reports back, and the canvas opens the real iframe.

const SEED_PATH = "/__screenplay-seed"
const MAX_SEED_BODY = 1 << 20

const SEED_PAGE = `<!doctype html><meta charset="utf-8"><script>
(function () {
  if (window.parent === window) return
  addEventListener("message", async function (e) {
    var d = e.data
    if (e.source !== window.parent || !d || d.type !== "screenplay:seed") return
    var ok = true
    try {
      localStorage.clear()
      for (var i = 0; i < d.localStorage.length; i++)
        localStorage.setItem(d.localStorage[i][0], d.localStorage[i][1])
    } catch (err) {
      ok = false
    }
    try {
      var res = await fetch("${SEED_PATH}", {
        method: "POST",
        headers: { "content-type": "application/json", "x-screenplay-seed": "1" },
        body: JSON.stringify({ cookies: d.cookies, secure: isSecureContext }),
      })
      if (!res.ok) ok = false
    } catch (err) {
      ok = false
    }
    window.parent.postMessage({ type: "screenplay:seeded", ok: ok }, "*")
  })
  window.parent.postMessage({ type: "screenplay:seed-ready" }, "*")
})()
</script>`

const COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/
const COOKIE_VALUE = /^[^;,\s\x00-\x1f\x7f]*$/
const COOKIE_PATH = /^\/[^;\x00-\x1f\x7f]*$/

/**
 * Set-Cookie headers that replace the preview origin's cookies with the shared
 * browser's. The local iframe is a third party on the canvas, where only
 * `SameSite=None; Secure` cookies stick and browsers that block third-party
 * cookies keep only `Partitioned` ones; so in a secure context (HTTPS, or
 * localhost), where Secure cookies can be set, seeded cookies take those
 * attributes, and keep their own otherwise.
 */
function seedCookieHeaders(cookies, { secure, existing = [] }) {
  const thirdParty = "; Secure; SameSite=None; Partitioned"
  const out = []
  const seeded = new Set()
  for (const c of Array.isArray(cookies) ? cookies : []) {
    if (!c || typeof c !== "object") continue
    const { name, value, path = "/" } = c
    if (typeof name !== "string" || !COOKIE_NAME.test(name)) continue
    if (typeof value !== "string" || !COOKIE_VALUE.test(value)) continue
    if (typeof path !== "string" || !COOKIE_PATH.test(path)) continue
    seeded.add(name)
    let header = `${name}=${value}; Path=${path}`
    if (typeof c.expires === "number" && c.expires > 0)
      header += `; Expires=${new Date(c.expires * 1000).toUTCString()}`
    if (c.httpOnly) header += "; HttpOnly"
    if (secure) header += thirdParty
    else {
      if (c.secure) header += "; Secure"
      if (["Strict", "Lax", "None"].includes(c.sameSite))
        header += `; SameSite=${c.sameSite}`
    }
    out.push(header)
  }
  // Cookies the local copy had that the shared page doesn't: gone, in both
  // their partitioned and unpartitioned forms.
  const expired = "=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT"
  for (const name of new Set(existing)) {
    if (seeded.has(name) || !COOKIE_NAME.test(name)) continue
    out.unshift(`${name}${expired}`)
    if (secure) out.unshift(`${name}${expired}${thirdParty}`)
  }
  return out
}

function cookieNames(header) {
  if (typeof header !== "string") return []
  return header
    .split(";")
    .map((part) => part.split("=")[0].trim())
    .filter(Boolean)
}

function serveSeed(req, res) {
  if (req.method === "GET") {
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-length": Buffer.byteLength(SEED_PAGE),
    })
    res.end(SEED_PAGE)
    return
  }
  // Only the seed page itself: the custom header makes any other origin's
  // request a CORS preflight, which this never answers.
  const site = req.headers["sec-fetch-site"]
  if (
    req.method !== "POST" ||
    req.headers["x-screenplay-seed"] !== "1" ||
    (site !== undefined && site !== "same-origin")
  ) {
    res.writeHead(403).end()
    return
  }
  const chunks = []
  let size = 0
  req.on("data", (c) => {
    size += c.length
    if (size > MAX_SEED_BODY) req.destroy()
    else chunks.push(c)
  })
  req.on("end", () => {
    let body
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"))
    } catch {
      res.writeHead(400).end()
      return
    }
    res.writeHead(204, {
      "cache-control": "no-store",
      "set-cookie": seedCookieHeaders(body?.cookies, {
        secure: body?.secure === true,
        existing: cookieNames(req.headers.cookie),
      }),
    })
    res.end()
  })
}

const server = http.createServer((req, res) => {
  if (req.url === "/__screenplay-bridge.js") {
    serveBridge(res)
    return
  }
  if (req.url === SEED_PATH) {
    serveSeed(req, res)
    return
  }

  const headers = { ...req.headers }
  headers["host"] = `${UPSTREAM_HOST}:${UPSTREAM_PORT}`
  headers["accept-encoding"] = "identity"
  // Drop Origin so Next.js 15+ treats the request as same-site instead of
  // running its stricter cross-origin check against a rewritten origin.
  delete headers["origin"]

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
    }
  )

  upstreamReq.on("error", (err) => {
    log("upstream request error", err.message)
    if (!res.headersSent) servePlaceholder(res, 503, err.code || "")
    else res.destroy()
  })

  req.pipe(upstreamReq)
})

server.on("upgrade", (req, clientSocket, head) => {
  const upstream = net.connect(UPSTREAM_PORT, UPSTREAM_HOST, () => {
    const headers = { ...req.headers }
    headers["host"] = `${UPSTREAM_HOST}:${UPSTREAM_PORT}`
    delete headers["origin"]
    const headerLines = Object.entries(headers)
      .map(([k, v]) =>
        Array.isArray(v)
          ? v.map((vv) => `${k}: ${vv}`).join("\r\n")
          : `${k}: ${v}`
      )
      .join("\r\n")
    upstream.write(
      `${req.method} ${req.url} HTTP/1.1\r\n${headerLines}\r\n\r\n`
    )
    if (head && head.length) upstream.write(head)
    upstream.pipe(clientSocket)
    clientSocket.pipe(upstream)
  })
  upstream.on("error", () => clientSocket.destroy())
  clientSocket.on("error", () => upstream.destroy())
})

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  log(
    `listening on ${LISTEN_HOST}:${LISTEN_PORT} -> ${UPSTREAM_HOST}:${UPSTREAM_PORT}`
  )
  log("CSP headers are stripped; intended for dev use only")
})
