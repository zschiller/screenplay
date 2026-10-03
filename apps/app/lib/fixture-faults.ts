import { cookies } from "next/headers"

import { isFixtureWorld } from "@/lib/fixture-world"

/**
 * The **faults** a Fixture World capture can ask for (issue #725): failures the
 * harness needs on screen but can't cause from the browser, because they happen
 * in a server render or depend on host config the capture machine lacks.
 *
 * Failures of client-side calls (a server action from a dialog, the sign-in
 * request) need nothing here: the harness fails those at the network with
 * Playwright. A screen in `screenshots/screens/` seeds this cookie for the
 * rest, the same way it seeds an entry state (`@/lib/fixture-entry`).
 *
 * Only ever honoured under {@link isFixtureWorld}, so the hosted app and a real
 * desktop install never read it.
 */
export type FixtureFault =
  /** The home layout's server-side Canvas/Folder/Pin load fails. */
  | "home-load"
  /** Settings lists no Project presets, so the presets empty state shows. */
  | "no-presets"

const COOKIE_NAME = "screenplay_fixture_fault"

const FAULTS: readonly FixtureFault[] = ["home-load", "no-presets"]

/** The cookie a capture screen sets to ask for a fault. */
export function fixtureFaultCookieName(): string {
  return COOKIE_NAME
}

/** Strict parse: anything but a known fault reads as none. */
export function parseFixtureFault(
  rawValue: string | undefined
): FixtureFault | null {
  return FAULTS.find((fault) => fault === rawValue) ?? null
}

/** Whether this request asked for `fault`. Always false outside the Fixture World. */
export async function hasFixtureFault(fault: FixtureFault): Promise<boolean> {
  if (!isFixtureWorld) return false
  const cookieStore = await cookies()
  return parseFixtureFault(cookieStore.get(COOKIE_NAME)?.value) === fault
}
