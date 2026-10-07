import "server-only"

import { codingCliBuiltIns } from "@/lib/agent/harnesses/coding-cli"
import { githubAccessBuiltIns } from "@/lib/github-access/implementations"
import { previewExposureBuiltIns } from "@/lib/preview-exposure/builtins"

import { fixtureBuiltIns } from "./fixture"
import type { InterfaceSpec, ServerInterfaces } from "./interfaces"

/** Each interface's built-ins and what the config file means when it leaves it out. */
export const INTERFACES: {
  [K in keyof ServerInterfaces]: InterfaceSpec<ServerInterfaces[K]>
} = {
  fixture: { builtIns: fixtureBuiltIns, defaultEntry: { use: "plain" } },
  githubAccess: {
    builtIns: githubAccessBuiltIns,
    defaultEntry: { use: "gh-cli" },
  },
  codingCli: {
    builtIns: codingCliBuiltIns,
    defaultEntry: [
      { use: "claude-code" },
      { use: "codex" },
      { use: "opencode" },
    ],
    many: true,
  },
  previewExposure: {
    builtIns: previewExposureBuiltIns,
    defaultEntry: { use: "loopback" },
  },
}
