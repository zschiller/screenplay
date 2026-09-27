import { describe, expect, it, vi } from "vitest"

import {
  detectInstalledHarnessKeys,
  distinctByHostBinary,
  probeHostFacts,
} from "@/lib/agent/harnesses/host-binary"
import type { Harness } from "@/lib/agent/harnesses"

/**
 * The host-binary detector folds a catalog + an injected prober → the set of
 * harness keys whose `hostBinary` is present (#476). These tests fabricate a tiny
 * catalog so they assert the fold's behavior — present / absent / multiple, and
 * the shared-binary dedupe — without touching the real host or coupling to which
 * descriptors ship today.
 */

/** A minimal descriptor: only `key` and `hostBinary` matter to the detector. */
function harness(key: string, hostBinary: string): Harness {
  return {
    key,
    label: key,
    installPackage: `${key}-cli`,
    launchCommand: hostBinary,
    brokerProviderKey: "p",
    gateEnvVar: "K",
    launchArgv: [hostBinary],
    hostBinary,
    acpAdapter: null,
    seed: async () => {},
  }
}

const a = harness("a", "abin")
const b = harness("b", "bbin")
// Two harnesses sharing one host binary (the opencode-slot shape).
const c1 = harness("c1", "cbin")
const c2 = harness("c2", "cbin")

/** A prober reporting the named binaries present, counting probes per binary. */
function fakeProbe(present: string[]) {
  const set = new Set(present)
  return vi.fn(async (binary: string) => set.has(binary))
}

describe("detectInstalledHarnessKeys", () => {
  it("resolves to the keys whose hostBinary is present", async () => {
    const keys = await detectInstalledHarnessKeys([a, b], fakeProbe(["abin"]))
    expect([...keys]).toEqual(["a"])
  })

  it("returns an empty set when nothing is present", async () => {
    const keys = await detectInstalledHarnessKeys([a, b], fakeProbe([]))
    expect(keys.size).toBe(0)
  })

  it("resolves multiple present binaries to all their keys", async () => {
    const keys = await detectInstalledHarnessKeys(
      [a, b],
      fakeProbe(["abin", "bbin"])
    )
    expect([...keys].sort()).toEqual(["a", "b"])
  })

  it("lists every harness keyed on a shared present binary, probing it once", async () => {
    const probe = fakeProbe(["cbin"])
    const keys = await detectInstalledHarnessKeys([c1, c2], probe)

    expect([...keys].sort()).toEqual(["c1", "c2"])
    // The shared binary is probed once, not once per harness.
    expect(probe).toHaveBeenCalledTimes(1)
    expect(probe).toHaveBeenCalledWith("cbin")
  })

  it("probes each distinct binary exactly once across a mixed catalog", async () => {
    const probe = fakeProbe(["abin", "cbin"])
    const keys = await detectInstalledHarnessKeys([a, b, c1, c2], probe)

    expect([...keys].sort()).toEqual(["a", "c1", "c2"])
    // abin, bbin, cbin — three distinct binaries despite four harnesses.
    expect(probe).toHaveBeenCalledTimes(3)
  })
})

describe("distinctByHostBinary (the one dedupe rule)", () => {
  it("keeps one entry per distinct hostBinary, in catalog order", () => {
    expect(distinctByHostBinary([a, c1, b, c2]).map((h) => h.key)).toEqual([
      "a",
      "c1",
      "b",
    ])
  })

  it("represents a shared binary by the first descriptor that names it", () => {
    // The opencode-slot shape: the row/probe speaks for the whole binary through
    // its first catalog entry.
    expect(distinctByHostBinary([c2, c1])[0]!.key).toBe("c2")
  })

  it("is empty for an empty catalog", () => {
    expect(distinctByHostBinary([])).toEqual([])
  })
})

describe("probeHostFacts (the one host-facts probe)", () => {
  it("reads npm / brew presence through the injected prober, with the live arch", async () => {
    const probe = fakeProbe(["npm"])
    expect(await probeHostFacts(probe)).toEqual({
      npmPresent: true,
      brewPresent: false,
      arch: process.arch,
    })
    expect(probe.mock.calls.flat().sort()).toEqual(["brew", "npm"])
  })

  it("reports an absent binary as false rather than throwing", async () => {
    expect(await probeHostFacts(fakeProbe([]))).toMatchObject({
      npmPresent: false,
      brewPresent: false,
    })
  })
})
