import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { getSandboxCliContext } from "@/lib/sandbox-cli-context"

/**
 * Build a fake Vercel OIDC token: a JWT whose middle segment is the
 * base64url-encoded JSON payload `getSandboxCliContext` decodes.
 */
function tokenWith(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url")
  return `header.${body}.signature`
}

describe("getSandboxCliContext", () => {
  const original = process.env.VERCEL_OIDC_TOKEN

  beforeEach(() => {
    delete process.env.VERCEL_OIDC_TOKEN
  })

  afterEach(() => {
    if (original === undefined) delete process.env.VERCEL_OIDC_TOKEN
    else process.env.VERCEL_OIDC_TOKEN = original
  })

  it("decodes team scope and project from the OIDC token payload", async () => {
    process.env.VERCEL_OIDC_TOKEN = tokenWith({
      owner: "acme-team",
      project: "screenplay",
    })

    expect(await getSandboxCliContext()).toEqual({
      scope: "acme-team",
      project: "screenplay",
    })
  })

  it("returns an empty context when the token is absent", async () => {
    expect(await getSandboxCliContext()).toEqual({})
  })

  it("returns an empty context when the token is malformed", async () => {
    process.env.VERCEL_OIDC_TOKEN = "not-a-jwt"

    expect(await getSandboxCliContext()).toEqual({})
  })
})
