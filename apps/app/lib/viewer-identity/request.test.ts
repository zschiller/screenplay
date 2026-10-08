import { describe, expect, it } from "vitest"

import {
  encodeHeaderValue,
  REFUSAL_HEADER,
  VIEWER_HEADER,
} from "@/server/viewer.mjs"

import { roleFromHeaders } from "./request"

describe("roleFromHeaders", () => {
  it("is the host when the front server set nothing", () => {
    expect(roleFromHeaders(new Headers())).toEqual({ role: "host" })
  })

  it("reads the viewer the front server named", () => {
    const person = { id: "tailscale:ana", name: "Ána", email: "a@x" }
    expect(
      roleFromHeaders(
        new Headers({ [VIEWER_HEADER]: encodeHeaderValue(person) })
      )
    ).toEqual({ role: "viewer", person })
  })

  it("reads a refusal", () => {
    expect(
      roleFromHeaders(
        new Headers({
          [REFUSAL_HEADER]: encodeHeaderValue({ message: "Sign in first." }),
        })
      )
    ).toEqual({
      role: "refused",
      message: "Sign in first.",
    })
  })

  it("ignores a header that isn't the front server's shape", () => {
    expect(
      roleFromHeaders(new Headers({ [VIEWER_HEADER]: "not base64 json" }))
    ).toEqual({ role: "host" })
  })
})
