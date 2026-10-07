// The lines the front server prints once it listens (#1930): where the host
// opens the app, the viewer ports, and the one `ssh -L` that reaches both the
// host listener and portless's proxy, which serves the host's frames.

import os from "node:os"

/**
 * @param {{
 *   hostPort: number
 *   portlessPort: number
 *   viewers?: { name: string, address: string, port: number }[]
 *   user?: string
 *   machine?: string
 * }} opts
 * @returns {string[]}
 */
export function bannerLines({
  hostPort,
  portlessPort,
  viewers = [],
  user = os.userInfo().username,
  machine = os.hostname(),
}) {
  const forwards = [hostPort, portlessPort]
    .map((port) => `-L ${port}:127.0.0.1:${port}`)
    .join(" ")
  const lines = [
    "",
    `  Screenplay is running (Headless).`,
    "",
    `  Host:    http://localhost:${hostPort}`,
    `  Frames:  http://*.localhost:${portlessPort} (portless)`,
  ]
  for (const viewer of viewers) {
    lines.push(
      `  Viewers: ${viewer.address}:${viewer.port} (${viewer.name}), not served until Sharing ships`
    )
  }
  lines.push(
    "",
    `  From your own computer, open a tunnel to both ports, then the host URL:`,
    "",
    `    ssh -N ${forwards} ${user}@${machine}`,
    ""
  )
  return lines
}
