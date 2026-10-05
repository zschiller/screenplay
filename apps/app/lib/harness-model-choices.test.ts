// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import {
  readHarnessModelChoices,
  writeHarnessModelChoices,
} from "./harness-model-choices"

afterEach(() => window.localStorage.clear())

describe("the stored choice", () => {
  it("round-trips per Harness and forgets a Harness left with none", () => {
    const pickle = {
      id: "opencode/big-pickle",
      label: "Big Pickle",
      group: "OpenCode Zen",
    }
    writeHarnessModelChoices("opencode-gateway", [pickle])
    expect(readHarnessModelChoices()).toEqual({ "opencode-gateway": [pickle] })
    // The same object until it changes, as useSyncExternalStore needs.
    expect(readHarnessModelChoices()).toBe(readHarnessModelChoices())
    writeHarnessModelChoices("opencode-gateway", [])
    expect(readHarnessModelChoices()).toEqual({})
  })

  it("reads nothing from a value it didn't write", () => {
    window.localStorage.setItem("agent-harness-models", "not json")
    expect(readHarnessModelChoices()).toEqual({})
    window.localStorage.setItem(
      "agent-harness-models",
      JSON.stringify({ a: [{ id: 1 }], b: "x" })
    )
    expect(readHarnessModelChoices()).toEqual({ a: [] })
  })
})
