/**
 * What a viewer's Yjs socket may send (Sharing, #1932): it asks for the doc
 * and says where it is, and nothing else. The viewer listener's socket runs
 * every message through {@link viewerMessageFilter} before y-websocket sees
 * it:
 *
 * - **Sync step 1** (the viewer asking for the doc) passes, so the server
 *   answers with the canvas.
 * - **Sync step 2 and updates** (the viewer's own changes) are dropped: a
 *   viewer never writes the doc.
 * - **Awareness** passes for one client id only, the first the socket
 *   announces, and never one another socket already holds, so a viewer can't
 *   move someone else's cursor. Each state is stamped with the person the
 *   viewer identity named and `viewer: true`, so the host's badge (and every
 *   name) can be trusted whatever the viewer's page sent.
 * - Anything else is dropped.
 *
 * The wire format is y-websocket's: a varUint message type (0 sync, 1
 * awareness), then for sync a varUint step (0, 1 or 2), and for awareness a
 * length-prefixed update of `[count, (clientId, clock, state JSON)*]`.
 */

const MESSAGE_SYNC = 0
const MESSAGE_AWARENESS = 1
const SYNC_STEP_1 = 0

export interface ViewerPresencePerson {
  id: string
  name: string
  avatarUrl?: string
}

export interface ViewerMessageFilterOptions {
  person: ViewerPresencePerson
  /** Whether another socket on this doc already holds `clientId`. */
  heldElsewhere: (clientId: number) => boolean
}

/**
 * A filter for one viewer socket: returns the message to hand y-websocket,
 * rewritten when it is awareness, or null to drop it.
 */
export function viewerMessageFilter({
  person,
  heldElsewhere,
}: ViewerMessageFilterOptions): (message: Uint8Array) => Uint8Array | null {
  let own: number | null = null
  return (message) => {
    try {
      const reader = new Reader(message)
      const type = reader.varUint()
      if (type === MESSAGE_SYNC) {
        return reader.varUint() === SYNC_STEP_1 ? message : null
      }
      if (type !== MESSAGE_AWARENESS) return null
      const update = new Reader(reader.bytes())
      const count = update.varUint()
      const kept: Array<{ clientId: number; clock: number; state: string }> = []
      for (let i = 0; i < count; i++) {
        const clientId = update.varUint()
        const clock = update.varUint()
        const state = update.string()
        if (own === null) {
          if (heldElsewhere(clientId)) continue
          own = clientId
        }
        if (clientId !== own) continue
        kept.push({ clientId, clock, state: stamp(state, person) })
      }
      if (kept.length === 0) return null
      const out = new Writer()
      out.varUint(kept.length)
      for (const entry of kept) {
        out.varUint(entry.clientId)
        out.varUint(entry.clock)
        out.string(entry.state)
      }
      const framed = new Writer()
      framed.varUint(MESSAGE_AWARENESS)
      framed.bytes(out.toBytes())
      return framed.toBytes()
    } catch {
      return null
    }
  }
}

/**
 * A presence state as the server passes it on: whatever identity the page
 * claimed becomes the viewer identity's, and the state says it's a viewer's.
 * A state with no identity yet (its page hasn't published one) gets none.
 */
function stamp(state: string, person: ViewerPresencePerson): string {
  const parsed: unknown = JSON.parse(state)
  // A null state is the viewer leaving: pass it as is.
  if (parsed === null) return state
  if (typeof parsed !== "object" || Array.isArray(parsed)) return "null"
  return JSON.stringify({
    ...parsed,
    ...("identity" in parsed && {
      identity: {
        id: person.id,
        name: person.name,
        ...(person.avatarUrl && { avatar: person.avatarUrl }),
      },
    }),
    viewer: true,
  })
}

class Reader {
  private pos = 0
  constructor(private readonly buf: Uint8Array) {}

  varUint(): number {
    let num = 0
    let mult = 1
    for (;;) {
      if (this.pos >= this.buf.length) throw new Error("short message")
      const byte = this.buf[this.pos++]!
      num += (byte & 0x7f) * mult
      if (byte < 0x80) return num
      mult *= 128
      if (mult > 2 ** 53) throw new Error("varUint too long")
    }
  }

  bytes(): Uint8Array {
    const length = this.varUint()
    if (this.pos + length > this.buf.length) throw new Error("short message")
    const out = this.buf.subarray(this.pos, this.pos + length)
    this.pos += length
    return out
  }

  string(): string {
    return new TextDecoder("utf-8", { fatal: true }).decode(this.bytes())
  }
}

class Writer {
  private readonly parts: number[] = []

  varUint(n: number): void {
    while (n > 0x7f) {
      this.parts.push(0x80 | (n % 128))
      n = Math.floor(n / 128)
    }
    this.parts.push(n)
  }

  bytes(b: Uint8Array): void {
    this.varUint(b.length)
    for (const byte of b) this.parts.push(byte)
  }

  string(s: string): void {
    this.bytes(new TextEncoder().encode(s))
  }

  toBytes(): Uint8Array {
    return Uint8Array.from(this.parts)
  }
}
