import type { ExposedPort, PreviewExposure } from "@/lib/preview-exposure/types"

/** The Mac app: previews on 127.0.0.1, loaded at `http://localhost:<port>`. */
export function loopbackExposure(): PreviewExposure {
  return {
    async expose(port): Promise<ExposedPort> {
      return { browserOrigin: `http://localhost:${port}` }
    },
    async release() {},
  }
}
