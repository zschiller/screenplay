import { execFile } from "node:child_process"
import { promisify } from "node:util"

import type { ExposedPort, PreviewExposure } from "@/lib/preview-exposure/types"

const run = promisify(execFile)

/** How long a `tailscale` command may take before it counts as failed. */
const COMMAND_TIMEOUT_MS = 30_000

/**
 * Where the Mac app keeps its CLI. The App Store and standalone apps only put
 * `tailscale` on PATH when you pick "Install CLI" in their settings, so the
 * bundle's own binary is the fallback.
 */
const MAC_APP_CLI = "/Applications/Tailscale.app/Contents/MacOS/Tailscale"

export interface TailscaleExposureOptions {
  /**
   * The `tailscale` command(s) to try, in order, until one exists. Default:
   * `tailscale` on PATH, then the Mac app's own binary.
   */
  cli?: readonly string[]
}

/**
 * Sharing's preview exposure (#1952, spec #1921): each port is served over
 * the Mac's tailnet name with `tailscale serve`, so anyone on the tailnet
 * loads `https://<mac>.<tailnet>.ts.net:<port>`. Listeners stay on 127.0.0.1;
 * `tailscale serve` terminates HTTPS on the same port number of the tailnet
 * address and proxies to them. The viewer listener is exposed the same way.
 *
 * `--bg` keeps the serve config after Screenplay or the Mac restarts, until
 * {@link PreviewExposure.release} turns it off.
 */
export function tailscaleExposure(
  options: TailscaleExposureOptions = {}
): PreviewExposure {
  const candidates = options.cli ?? ["tailscale", MAC_APP_CLI]
  let found: string | undefined

  async function tailscale(args: string[]): Promise<string> {
    for (const cli of found ? [found] : candidates) {
      try {
        const { stdout } = await run(cli, args, { timeout: COMMAND_TIMEOUT_MS })
        found = cli
        return stdout
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") continue
        found = cli
        throw err
      }
    }
    throw new Error(
      "Tailscale isn’t installed. Install it from tailscale.com, sign in, then try again."
    )
  }

  /** This Mac's tailnet name, once Tailscale is signed in and can serve HTTPS. */
  async function tailnetName(): Promise<string> {
    let status: TailscaleStatus
    try {
      status = JSON.parse(await tailscale(["status", "--json"]))
    } catch (err) {
      if (err instanceof SyntaxError) {
        throw new Error("Tailscale’s status couldn’t be read.")
      }
      throw new Error(`Tailscale isn’t running: ${commandError(err)}`)
    }
    if (status.BackendState !== "Running") {
      throw new Error(
        status.BackendState === "Stopped"
          ? "Tailscale is turned off. Turn it on, then try again."
          : "Tailscale isn’t signed in. Open Tailscale and sign in, then try again."
      )
    }
    const name = status.Self?.DNSName?.replace(/\.$/, "")
    if (!name) throw new Error("Tailscale hasn’t given this Mac a name yet.")
    // Without HTTPS certificates `tailscale serve --https` prints a link to
    // turn them on and does nothing, or waits for someone to.
    if (!status.CertDomains?.length) {
      throw new Error(
        "Your tailnet doesn’t have HTTPS certificates turned on. Turn on MagicDNS and HTTPS Certificates on the DNS page of the Tailscale admin console, then try again."
      )
    }
    return name
  }

  return {
    bind: { host: "127.0.0.1" },
    async expose(port): Promise<ExposedPort> {
      const name = await tailnetName()
      try {
        await tailscale([
          "serve",
          "--bg",
          "--yes",
          `--https=${port}`,
          `http://127.0.0.1:${port}`,
        ])
      } catch (err) {
        throw new Error(
          `The preview couldn’t be shared on port ${port}: ${commandError(err)}`
        )
      }
      return { browserOrigin: new URL(`https://${name}:${port}`).origin }
    },
    async release(port) {
      try {
        await tailscale(["serve", "--yes", `--https=${port}`, "off"])
      } catch (err) {
        const message = commandError(err)
        // Already off: nothing to undo.
        if (message.includes("handler does not exist")) return
        console.warn(
          `[preview-exposure] releasing port ${port} from tailscale serve failed: ${message}`
        )
      }
    },
  }
}

/** The fields of `tailscale status --json` this reads (ipnstate.Status). */
interface TailscaleStatus {
  /** "Running" once signed in and connected; else "NeedsLogin", "Stopped", … */
  BackendState?: string
  /** `DNSName` is this machine's FQDN with a trailing dot. */
  Self?: { DNSName?: string }
  /** Names the tailnet can get HTTPS certificates for; empty when HTTPS is off. */
  CertDomains?: string[] | null
}

function commandError(err: unknown): string {
  const stderr = (err as { stderr?: unknown })?.stderr
  if (typeof stderr === "string" && stderr.trim()) return stderr.trim()
  return err instanceof Error ? err.message : String(err)
}
