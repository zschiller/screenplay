import { isIP } from "node:net"

/**
 * Whether an IP address is one a server must not fetch for someone else:
 * loopback, private, link-local (cloud metadata lives there), carrier-grade
 * NAT, unspecified, or an IPv4 address wrapped in IPv6. Anything that isn't an
 * IP address counts as private, so a malformed answer never passes.
 */
export function isPrivateAddress(address: string): boolean {
  const kind = isIP(address)
  if (kind === 4) return isPrivateIPv4(address)
  if (kind !== 6) return true
  const lower = address.toLowerCase()
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower)
  if (mapped) return isPrivateIPv4(mapped[1]!)
  if (lower === "::" || lower === "::1") return true
  const first = parseInt(lower.split(":")[0] || "0", 16)
  // fc00::/7 unique local, fe80::/10 link-local, ::/8 and ::ffff:0:0/96 forms.
  return (
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xffc0) === 0xfe80 ||
    lower.startsWith("::")
  )
}

function isPrivateIPv4(address: string): boolean {
  const [a, b] = address.split(".").map(Number) as [number, number]
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  )
}
