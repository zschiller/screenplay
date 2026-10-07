import "server-only"

import { hostHarnessOf } from "@/lib/agent/harnesses/coding-cli"
import { setHostHarnesses } from "@/lib/agent/harnesses"
import { setGitHubAccess } from "@/lib/github-access"
import { setPreviewExposure } from "@/lib/preview-exposure"

import { createConfigured, getConfig, type ScreenplayConfig } from "./config"

/**
 * Server start: build the implementation the config file names for each
 * interface and hand it to the module that uses it. An interface the file
 * leaves out keeps that module's own default, so a server with no file (Hosted,
 * the Mac app) is unchanged.
 */
export async function applyConfiguredInterfaces(
  config: ScreenplayConfig = getConfig()
): Promise<void> {
  for (const key of config.named) {
    switch (key) {
      case "githubAccess": {
        const [access] = await createConfigured("githubAccess", config)
        if (access) setGitHubAccess(access)
        break
      }
      case "codingCli":
        setHostHarnesses(
          (await createConfigured("codingCli", config)).map(hostHarnessOf)
        )
        break
      case "previewExposure": {
        const [exposure] = await createConfigured("previewExposure", config)
        if (exposure) setPreviewExposure(exposure)
        break
      }
      case "fixture":
        break
    }
  }
}
