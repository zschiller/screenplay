// Who a viewer is, as the front server works it out (#1931). The selected
// **Viewer identity** (`lib/viewer-identity`) answers each request on a viewer
// listener before Next sees it; the answer reaches app code in a request
// header only the front server sets. Both listeners strip a client's copy of
// that header first, so app code can trust it.
//
// Plain Node, no TS: the front server loads it outside the app's bundles, and
// the app imports it for the header names.

/** The person a viewer request is from: base64url JSON of `{ id, name, email?, avatarUrl? }`. */
export const VIEWER_HEADER = "x-screenplay-viewer"

/** Set instead on a refused request: base64url JSON of `{ message }`. */
export const REFUSAL_HEADER = "x-screenplay-viewer-refusal"

/** The page a refused request is served, whatever it asked for. */
export const REFUSED_PATH = "/viewer-refused"

/** What a refusal says when the identity's own lookup broke. */
export const BROKEN_LOOKUP_MESSAGE =
  "Screenplay couldn’t check who you are. The host’s server log says why."

const RESERVED = [VIEWER_HEADER, REFUSAL_HEADER]

/** Drop any client-sent copy of the headers only the front server sets. */
export function stripReservedHeaders(req) {
  for (const name of RESERVED) delete req.headers[name]
  const raw = []
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    if (!RESERVED.includes(req.rawHeaders[i].toLowerCase())) {
      raw.push(req.rawHeaders[i], req.rawHeaders[i + 1])
    }
  }
  req.rawHeaders.splice(0, req.rawHeaders.length, ...raw)
}

/** Set one of the headers only the front server sets. */
export function setReservedHeader(req, name, value) {
  const encoded = encodeHeaderValue(value)
  req.headers[name] = encoded
  req.rawHeaders.push(name, encoded)
}

export function encodeHeaderValue(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url")
}

export function decodeHeaderValue(value) {
  if (!value) return null
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8"))
  } catch {
    return null
  }
}

const IDENTITY = Symbol.for("screenplay.viewerIdentity")

/**
 * Hand the front server the viewer identity, once, as the server starts.
 * Person ids come back as `<identity id>:<id>`, so switching implementations makes new people.
 */
export function setViewerIdentity(id, identity) {
  globalThis[IDENTITY] = identity && {
    cacheKey: (request) => identity.cacheKey(request),
    async identify(request) {
      const answer = await identity.identify(request)
      return answer.person
        ? {
            ...answer,
            person: { ...answer.person, id: `${id}:${answer.person.id}` },
          }
        : answer
    },
  }
}

/** The viewer identity the server picked, or undefined before start or without one. */
export function getViewerIdentity() {
  return globalThis[IDENTITY]
}

/**
 * Answer viewer requests through the selected identity, remembering each
 * answer for its cache key and `ttlSeconds`. With no identity, or one whose
 * lookup throws, the request is refused; a throw is logged.
 */
export function createIdentifier({
  identity = getViewerIdentity,
  now = Date.now,
  log = (line) => console.error(line),
  maxEntries = 10_000,
} = {}) {
  const remembered = new Map()
  return async function identify(request) {
    const current = identity()
    if (!current) {
      return { person: null, message: BROKEN_LOOKUP_MESSAGE, ttlSeconds: 0 }
    }
    let key = null
    try {
      key = current.cacheKey(request)
    } catch (err) {
      log(`[viewerIdentity] cacheKey failed: ${describe(err)}`)
    }
    if (key !== null) {
      const hit = remembered.get(key)
      if (hit && hit.until > now()) return hit.answer
      remembered.delete(key)
    }
    let answer
    try {
      answer = await current.identify(request)
    } catch (err) {
      log(`[viewerIdentity] ${describe(err)}`)
      return { person: null, message: BROKEN_LOOKUP_MESSAGE, ttlSeconds: 0 }
    }
    if (key !== null && answer.ttlSeconds > 0) {
      if (remembered.size >= maxEntries) remembered.clear()
      remembered.set(key, { answer, until: now() + answer.ttlSeconds * 1000 })
    }
    return answer
  }
}

function describe(err) {
  return err instanceof Error ? err.message : String(err)
}
