import { describe, expect, it } from "vitest"
import {
  createStreamRedactor,
  redactDeep,
  redactSensitiveInfo,
  secretPatterns,
} from "./redact"

const SECRET = "postgres://u:p4ss@db/app"

describe("redacting a Workspace's env var values (#1416)", () => {
  const secrets = secretPatterns([SECRET, "true", "3000"])

  it("strips a value and its base64 and URL-encoded forms", () => {
    const b64 = Buffer.from(SECRET).toString("base64")
    const url = encodeURIComponent(SECRET)
    const out = redactSensitiveInfo(`${SECRET} ${b64} ${url}`, secrets)
    expect(out).toBe("[REDACTED] [REDACTED] [REDACTED]")
  })

  it("leaves values under 8 characters alone", () => {
    expect(redactSensitiveInfo("DEBUG=true PORT=3000", secrets)).toBe(
      "DEBUG=true PORT=3000"
    )
  })

  it("still strips GitHub tokens", () => {
    expect(redactSensitiveInfo("ghp_abcdefghijklmnopqrstuvwxyz", secrets)).toBe(
      "[REDACTED]"
    )
  })

  it("reaches every string in structured output", () => {
    expect(
      redactDeep({ out: [`x=${SECRET}`], code: 0, ok: true }, secrets)
    ).toEqual({ out: ["x=[REDACTED]"], code: 0, ok: true })
  })
})

describe("createStreamRedactor", () => {
  const secrets = secretPatterns(["abcdefghij"])

  it("holds back a value split across chunks until it's whole", () => {
    const r = createStreamRedactor(secrets)
    const out = [r.push("key: abcde"), r.push("fghij and more"), r.flush()]
    expect(out.join("")).toBe("key: [REDACTED] and more")
    expect(out.join("")).not.toContain("abcde")
  })

  it("never splits a whole match at the cut", () => {
    const r = createStreamRedactor(secrets)
    const out = [r.push("xxabcdefghij"), r.push("y"), r.flush()]
    expect(out.join("")).toBe("xx[REDACTED]y")
  })

  it("passes chunks straight through with no secrets", () => {
    const r = createStreamRedactor([])
    expect(r.push("abc")).toBe("abc")
    expect(r.flush()).toBe("")
  })
})
