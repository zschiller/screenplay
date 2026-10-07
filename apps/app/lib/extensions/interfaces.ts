import type { ComponentType } from "react"

import {
  type Fixture,
  type FixtureBadgeProps,
  fixtureBuiltIns,
} from "./fixture"
import type { AnyOptions, Implementation } from "./types"

/**
 * Every interface an extension can implement, registered as it lands: add the
 * interface's type here and its built-ins and config shape to `INTERFACES`.
 * The key is also the interface's field in the config file.
 */
export interface ServerInterfaces {
  fixture: Fixture
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
   * it would be in the file (a list when `many`).
   */
  defaultEntry: InterfaceEntry | InterfaceEntry[]
  /**
   * The config file takes a list, every entry its own implementation (a box
   * can offer several coding CLIs), instead of one `{ use }` object.
   */
  many?: boolean
}

export const INTERFACES: {
  [K in keyof ServerInterfaces]: InterfaceSpec<ServerInterfaces[K]>
} = {
  fixture: { builtIns: fixtureBuiltIns, defaultEntry: { use: "plain" } },
}
