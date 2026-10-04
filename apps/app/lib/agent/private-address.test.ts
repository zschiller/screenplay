import { describe, expect, it } from "vitest"

import { isPrivateAddress } from "@/lib/agent/private-address"

describe("isPrivateAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "::",
    "::ffff:127.0.0.1",
    "fd00::1",
    "fe80::1",
    "not-an-ip",
  ])("%s is private", (address) => {
    expect(isPrivateAddress(address)).toBe(true)
  })

  it.each([
    "93.184.216.34",
    "172.32.0.1",
    "100.128.0.1",
    "8.8.8.8",
    "2606:4700::6810:85e5",
    "::ffff:8.8.8.8",
  ])("%s is public", (address) => {
    expect(isPrivateAddress(address)).toBe(false)
  })
})
