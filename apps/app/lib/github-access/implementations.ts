import "server-only"

import { z } from "zod"

import { defineImplementation } from "@/lib/extensions/types"

import { createGhCliAccess, GH_CLI_ID } from "./gh-cli"
import { createOAuthAccountAccess, OAUTH_ACCOUNT_ID } from "./oauth-account"
import type { GitHubAccess } from "./types"

const urlBase = z.url()

/**
 * The built-ins as the config file's `githubAccess` field names them
 * (`lib/extensions/interfaces.ts`). The schemas let the server check the file
 * before it starts; each built-in still checks its own options too.
 */
export const githubAccessBuiltIns = {
  [OAUTH_ACCOUNT_ID]: defineImplementation({
    options: z.object({
      apiUrl: urlBase.optional(),
      webUrl: urlBase.optional(),
    }),
    create: (options): GitHubAccess => createOAuthAccountAccess(options),
  }),
  [GH_CLI_ID]: defineImplementation({
    options: z.object({
      /** A name, or a list of words like `["corp", "gh"]`. */
      command: z
        .union([z.string().min(1), z.array(z.string().min(1)).min(1)])
        .optional(),
      hostname: z.string().min(1).optional(),
      apiUrl: urlBase.optional(),
      webUrl: urlBase.optional(),
    }),
    create: (options): GitHubAccess => createGhCliAccess(options),
  }),
}
