import { describe, expect, it } from "vitest"

import { InMemoryDetectFileSystem } from "@/lib/add-repo/detect-fs"
import { detectSettings } from "@/lib/add-repo/detect-settings"

/**
 * Seam A (PRD #673, slice #678): `detectSettings` over an in-memory FS fixture.
 * We assert the mapped `{ setupScript, devScript, devServerPort }`, never
 * build-info internals — a fake `package.json` + lockfile + framework config in,
 * the run settings out. The two real adapters (GitHub virtual FS, on-disk) are
 * thin shells under this seam.
 */

const pkg = (extra: Record<string, unknown>) =>
  JSON.stringify({ name: "fixture", ...extra })

describe("detectSettings — package manager → setup script", () => {
  it("maps an npm lockfile to `npm install`", async () => {
    const fs = new InMemoryDetectFileSystem({
      "package.json": pkg({ scripts: { dev: "node server.js" } }),
      "package-lock.json": "{}",
    })
    const { setupScript } = await detectSettings(fs)
    expect(setupScript).toBe("npm install")
  })

  it("maps a yarn lockfile to `yarn install`", async () => {
    const fs = new InMemoryDetectFileSystem({
      "package.json": pkg({ scripts: { dev: "node server.js" } }),
      "yarn.lock": "",
    })
    const { setupScript } = await detectSettings(fs)
    expect(setupScript).toBe("yarn install")
  })

  it("maps a pnpm lockfile to `pnpm install`", async () => {
    const fs = new InMemoryDetectFileSystem({
      "package.json": pkg({ scripts: { dev: "node server.js" } }),
      "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
    })
    const { setupScript } = await detectSettings(fs)
    expect(setupScript).toBe("pnpm install")
  })
})

describe("detectSettings — framework → run script + port", () => {
  it("detects Next.js (dev command + default port 3000)", async () => {
    const fs = new InMemoryDetectFileSystem({
      "package.json": pkg({
        dependencies: { next: "15.0.0", react: "19", "react-dom": "19" },
        scripts: { dev: "next dev" },
      }),
      "package-lock.json": "{}",
      "next.config.js": "module.exports = {}",
    })
    const { setupScript, devScript, devServerPort } = await detectSettings(fs)
    expect(setupScript).toBe("npm install")
    expect(devScript).toBe("npm run dev")
    expect(devServerPort).toBe(3000)
  })

  it("detects Vite (dev command + default port 5173)", async () => {
    const fs = new InMemoryDetectFileSystem({
      "package.json": pkg({
        devDependencies: { vite: "5.0.0" },
        scripts: { dev: "vite" },
      }),
      "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
      "vite.config.js": "export default {}",
    })
    const { devScript, devServerPort } = await detectSettings(fs)
    expect(devScript).toBe("pnpm run dev")
    expect(devServerPort).toBe(5173)
  })
})

describe("detectSettings — monorepo", () => {
  it("takes the single top-level app detection across workspace packages", async () => {
    // A pnpm workspace: one framework app (packages/web, Next.js) plus a
    // frameworkless library package. build-info surfaces the app as the
    // top-level/primary detection; the library contributes nothing.
    const fs = new InMemoryDetectFileSystem({
      "package.json": pkg({ private: true, workspaces: ["packages/*"] }),
      "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
      "pnpm-workspace.yaml": "packages:\n  - 'packages/*'\n",
      "packages/web/package.json": pkg({
        name: "web",
        dependencies: { next: "15.0.0", react: "19", "react-dom": "19" },
        scripts: { dev: "next dev" },
      }),
      "packages/web/next.config.js": "module.exports = {}",
      "packages/config/package.json": pkg({
        name: "config",
        main: "index.js",
      }),
    })
    const { setupScript, devScript, devServerPort } = await detectSettings(fs)
    expect(setupScript).toBe("pnpm install") // the workspace-root lockfile
    expect(devServerPort).toBe(3000) // Next.js, the one app in the workspace
    expect(devScript).toContain("dev")
  })
})

describe("detectSettings — unrecognized project", () => {
  it("falls back to plain defaults (empty scripts, port 3000)", async () => {
    const fs = new InMemoryDetectFileSystem({
      "README.md": "# just docs",
    })
    expect(await detectSettings(fs)).toEqual({
      setupScript: "",
      devScript: "",
      devServerPort: 3000,
    })
  })

  it("fills only the setup script when there's a lockfile but no framework", async () => {
    const fs = new InMemoryDetectFileSystem({
      "package.json": pkg({ scripts: { start: "node index.js" } }),
      "yarn.lock": "",
    })
    expect(await detectSettings(fs)).toEqual({
      setupScript: "yarn install",
      devScript: "",
      devServerPort: 3000,
    })
  })
})
