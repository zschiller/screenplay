import { z } from "zod"

import { defineImplementation } from "./types"

/**
 * A stand-in interface that proves the extensions pipeline end to end (folder
 * scan, typed registries, config selection) before the real interfaces land.
 * Nothing in the product reads it; tests and a fixture extension do.
 */
export interface Fixture {
  describe(): string
}

/** Props of the fixture's browser piece. */
export interface FixtureBadgeProps {
  label: string
}

/** The built-in fixture, used when the config file names none. */
export const fixtureBuiltIns = {
  plain: defineImplementation({
    options: z.object({ text: z.string().default("plain") }),
    create: ({ text }): Fixture => ({ describe: () => text }),
  }),
}
