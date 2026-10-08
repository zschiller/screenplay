/**
 * **Viewer identity**: who is making a request on a viewer listener (Sharing,
 * #1931). One of the four interfaces a company can implement for its own setup
 * (#1921). It stays this small, so a fork's own implementation is easy.
 *
 * The front server (`server/front-server.mjs`) asks it for every request on
 * a viewer listener, before Next sees the request; the host listener never
 * does, since the host is whoever reaches 127.0.0.1. Whether to trust a
 * header, and from where, is the implementation's call: the app adds no
 * header rules of its own.
 */
export interface ViewerIdentity {
  /**
   * A cheap key for this request's answer, or null for "don't remember it".
   * Requests with the same key get the same answer for its `ttlSeconds`
   * without {@link identify} running again: the email header's value, say,
   * or the peer address for a whois lookup.
   */
  cacheKey(request: ViewerRequest): string | null

  /**
   * Who is making this request, or a refusal saying what to do. Never throws
   * for someone it doesn't know; it throws only when its own lookup is broken
   * (a name command missing), which the server logs and refuses.
   */
  identify(request: ViewerRequest): Promise<ViewerAnswer>
}

export interface ViewerRequest {
  /** The headers as received on the socket. Screenplay adds and trusts none. */
  headers: Headers
  /** The TCP peer: the company proxy, `tailscale serve`, or the viewer's own machine. Never `X-Forwarded-For`. */
  remoteAddress: string
  /** The viewer listener it arrived on, as the config names it. */
  listener: ViewerListener
}

/** A viewer listener from the config file's `listeners.viewers`. */
export interface ViewerListener {
  name: string
  address: string
  port: number
}

export type ViewerAnswer =
  | {
      person: ViewerPerson
      /** How long to remember the answer for this request's cache key. */
      ttlSeconds: number
    }
  | {
      person: null
      /** Shown on the refused page as it is: what to do to get in. */
      message: string
      /** How long to remember the refusal. 0 asks again on the next request. */
      ttlSeconds: number
    }

export interface ViewerPerson {
  /**
   * Stable within this implementation and never reused for someone else. The
   * app sees it as `<implementation id>:<id>`, so switching implementations
   * makes new people rather than merging them.
   */
  id: string
  /** Shown in presence and on comments. */
  name: string
  email?: string
  /** An http(s) URL the viewer's browser can load. */
  avatarUrl?: string
}
