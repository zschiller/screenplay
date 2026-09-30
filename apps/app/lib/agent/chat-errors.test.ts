import { describe, expect, it } from "vitest"
import { describeSendError, describeTurnError } from "./chat-errors"

describe("describeTurnError", () => {
  it("says how long the agent went quiet", () => {
    expect(
      describeTurnError(
        "request to https://api.example.com/v1/sessions/4f9c/prompt timed out after 120000ms"
      )
    ).toBe("The agent stopped responding after 2 minutes.")
    expect(describeTurnError("timed out after 60000ms")).toBe(
      "The agent stopped responding after a minute."
    )
    expect(describeTurnError("timed out after 30000 ms")).toBe(
      "The agent stopped responding after 30 seconds."
    )
    expect(describeTurnError("ETIMEDOUT")).toBe("The agent stopped responding.")
  })

  it("names a busy model", () => {
    expect(describeTurnError("429 Too Many Requests")).toBe(
      "The model is busy right now."
    )
    expect(describeTurnError('{"type":"overloaded_error"}')).toBe(
      "The model is busy right now."
    )
  })

  it("names an agent that couldn't be reached", () => {
    for (const raw of ["HTTP 502", "fetch failed", "connect ECONNREFUSED"]) {
      expect(describeTurnError(raw)).toBe("The agent couldn't be reached.")
    }
  })

  it("falls back to one plain line", () => {
    expect(describeTurnError("TypeError: x is undefined")).toBe(
      "The agent stopped because of an error."
    )
  })
})

describe("describeSendError", () => {
  it("keeps the server's own sentence", () => {
    const ended =
      "This chat's session has ended and can't be resumed. Please start a new chat to continue."
    expect(describeSendError(ended)).toBe(ended)
    expect(describeSendError("The agent couldn't be reached")).toBe(
      "The agent couldn't be reached."
    )
  })

  it("rewords transport errors", () => {
    expect(describeSendError("HTTP 500")).toBe("Something went wrong.")
    expect(describeSendError("HTTP 503")).toBe("The agent couldn't be reached.")
    expect(describeSendError("Failed to fetch")).toBe(
      "The agent couldn't be reached."
    )
  })
})
