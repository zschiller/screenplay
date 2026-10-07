import type { ComponentType } from "react"

import type { CodingCli } from "@/lib/agent/harnesses/coding-cli-types"
import type { GitHubAccess } from "@/lib/github-access/types"
import type { PreviewExposure } from "@/lib/preview-exposure/types"

import type { Fixture, FixtureBadgeProps } from "./fixture"
import type { AnyOptions, Implementation } from "./types"

/**
 * Every interface an extension can implement, registered as it lands: add the
 * interface's type here and its built-ins and config shape to `INTERFACES`
 * (`./built-ins.ts`). Types only, so an extension that imports them doesn't
 * pull in the server.
 * The key is also the interface's field in the config file.
 */
export interface ServerInterfaces {
  fixture: Fixture
  githubAccess: GitHubAccess
  codingCli: CodingCli
  previewExposure: PreviewExposure
}

/** Browser pieces an extension can add, keyed like {@link ServerInterfaces}. */
export interface ClientInterfaces {
  fixture: ComponentType<FixtureBadgeProps>
}

/** One interface's entry in the config file: `{ "use": "<id>", …options }`. */
export interface InterfaceEntry {
  use: string
  [option: string]: unknown
}

export interface InterfaceSpec<T> {
  /** Implementations that ship in the repo, by bare id. */
  builtIns: Record<string, Implementation<T, AnyOptions>>
  /**
   * What the config file means when it leaves this interface out, written as
   * it would be in the file (a list when `many`). The server only builds an
   * interface the file names (`lib/extensions/apply.ts`); left out, each keeps
   * the default its own module picks for the profile, which this mirrors for
   * Headless.
   */
  defaultEntry: InterfaceEntry | InterfaceEntry[]
  /**
   * The config file takes a list, every entry its own implementation (a box
   * can offer several coding CLIs), instead of one `{ use }` object.
   */
  many?: boolean
}
