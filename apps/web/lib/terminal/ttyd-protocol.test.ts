import { describe, expect, it } from "vitest"
import {
  decodeServerMessage,
  encodeHandshake,
  encodeInput,
  encodeResize,
  terminalWebSocketUrl,
} from "@/lib/terminal/ttyd-protocol"

const decoder = new TextDecoder()
const encoder = new TextEncoder()

/** Prefix bytes the way the daemon does, for building server frames in tests. */
function serverFrame(command: string, payload: string): Uint8Array {
  return encoder.encode(`${command}${payload}`)
}

describe("encodeHandshake", () => {
  it("is the bare JSON whose first byte is the JSON_DATA marker `{`", () => {
    const frame = encodeHandshake({ authToken: "", columns: 80, rows: 24 })
    expect(frame[0]).toBe("{".charCodeAt(0))
    expect(JSON.parse(decoder.decode(frame))).toEqual({
      AuthToken: "",
      columns: 80,
      rows: 24,
    })
  })

  it("carries the minted credential through as the AuthToken", () => {
    const frame = encodeHandshake({
      authToken: "tok-123",
      columns: 120,
      rows: 40,
    })
    expect(JSON.parse(decoder.decode(frame)).AuthToken).toBe("tok-123")
  })
})

describe("encodeInput", () => {
  it("prefixes the INPUT command byte `0` to the raw keystrokes", () => {
    const frame = encodeInput("ls\r")
    expect(String.fromCharCode(frame[0]!)).toBe("0")
    expect(decoder.decode(frame.subarray(1))).toBe("ls\r")
  })

  it("round-trips multi-byte UTF-8 input", () => {
    const frame = encodeInput("é→😀")
    expect(decoder.decode(frame.subarray(1))).toBe("é→😀")
  })
})

describe("encodeResize", () => {
  it("prefixes the RESIZE command byte `1` to a {columns, rows} payload", () => {
    const frame = encodeResize(120, 40)
    expect(String.fromCharCode(frame[0]!)).toBe("1")
    expect(JSON.parse(decoder.decode(frame.subarray(1)))).toEqual({
      columns: 120,
      rows: 40,
    })
  })
})

describe("decodeServerMessage", () => {
  it("decodes OUTPUT to the raw payload bytes (left for xterm to decode)", () => {
    const msg = decodeServerMessage(serverFrame("0", "hello[0m"))
    expect(msg.type).toBe("output")
    if (msg.type !== "output") throw new Error("expected output")
    expect(decoder.decode(msg.data)).toBe("hello[0m")
  })

  it("decodes SET_WINDOW_TITLE", () => {
    const msg = decodeServerMessage(serverFrame("1", "bash -l (~)"))
    expect(msg).toEqual({ type: "title", title: "bash -l (~)" })
  })

  it("decodes SET_PREFERENCES", () => {
    const msg = decodeServerMessage(serverFrame("2", "{}"))
    expect(msg).toEqual({ type: "preferences", raw: "{}" })
  })

  it("reports an unknown command rather than throwing", () => {
    expect(decodeServerMessage(serverFrame("9", "x"))).toEqual({
      type: "unknown",
      command: "9",
    })
  })

  it("treats an empty frame as unknown", () => {
    expect(decodeServerMessage(new Uint8Array())).toEqual({
      type: "unknown",
      command: "",
    })
  })
})

describe("terminalWebSocketUrl", () => {
  it("upgrades https to wss and appends /ws", () => {
    expect(terminalWebSocketUrl("https://abc-7681.vercel.run")).toBe(
      "wss://abc-7681.vercel.run/ws"
    )
  })

  it("upgrades http to ws and appends /ws", () => {
    expect(terminalWebSocketUrl("http://localhost:7681")).toBe(
      "ws://localhost:7681/ws"
    )
  })

  it("does not double a trailing slash before /ws", () => {
    expect(terminalWebSocketUrl("https://abc-7681.vercel.run/")).toBe(
      "wss://abc-7681.vercel.run/ws"
    )
  })

  it("appends the tmux session as ttyd's ?arg= when given one command arg", () => {
    expect(
      terminalWebSocketUrl("https://abc-7681.vercel.run", ["screenplay-tab1"])
    ).toBe("wss://abc-7681.vercel.run/ws?arg=screenplay-tab1")
  })

  it("appends multiple command args as repeated ?arg=s in order", () => {
    // The session name followed by the harness launch command (#285): each
    // element becomes its own ttyd argv, so the daemon runs
    // `tmux new -A -s screenplay-tab1 sh -c 'claude; exec $SHELL'`.
    expect(
      terminalWebSocketUrl("https://abc-7681.vercel.run", [
        "screenplay-tab1",
        "sh",
        "-c",
        "claude; exec $SHELL",
      ])
    ).toBe(
      "wss://abc-7681.vercel.run/ws?arg=screenplay-tab1&arg=sh&arg=-c&arg=claude%3B+exec+%24SHELL"
    )
  })

  it("returns the bare /ws endpoint when given no command args", () => {
    expect(terminalWebSocketUrl("https://abc-7681.vercel.run", [])).toBe(
      "wss://abc-7681.vercel.run/ws"
    )
  })
})
