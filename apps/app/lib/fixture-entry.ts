import { cookies } from "next/headers"

import { isFixtureWorld } from "@/lib/fixture-world"

/**
 * The **entry state** a Fixture World capture asks for (issue #738): which of the
 * screens a person meets *before* the app — the signed-out home, or the
 * first-run setup gate in one of its blocked states — the harness wants on
 * screen.
 *
 * The local build never reaches them on its own: it runs as the seeded local
 * user (so there is no signed-out home), and in fixture mode the setup gate
 * reads as released (see `getLocalSetupGateStatus`). A screen in
 * `screenshots/screens/list/` seeds this cookie to ask for one of them instead, the
 * same way it seeds a panel layout.
 *
 * Only ever honoured under {@link isFixtureWorld}, which is itself `and`-ed with
 * `isLocalBuild`, so the hosted app never reads it and a real desktop install
 * can't be talked into a signed-out or blocked state by a stray cookie.
 */
export type FixtureEntryState =
  /** The home surface as a signed-out visitor sees it. */
  | "signed-out"
  /** The setup gate with nothing done yet. */
  | "setup-pending"
  /** The setup gate with a coding agent ready and GitHub still open. */
  | "setup-agent-ready"

const COOKIE_NAME = "screenplay_fixture_entry"

const STATES: readonly FixtureEntryState[] = [
  "signed-out",
  "setup-pending",
  "setup-agent-ready",
]

/** The cookie a capture screen sets to pick an entry state. */
export function fixtureEntryCookieName(): string {
  return COOKIE_NAME
}

/** Strict parse: anything but a known state reads as none. */
export function parseFixtureEntryState(
  rawValue: string | undefined
): FixtureEntryState | null {
  return STATES.find((state) => state === rawValue) ?? null
}

/**
 * The entry state this request asked for, or `null` outside the Fixture World
 * or when no screen asked for one.
 */
export async function readFixtureEntryState(): Promise<FixtureEntryState | null> {
  if (!isFixtureWorld) return null
  const cookieStore = await cookies()
  return parseFixtureEntryState(cookieStore.get(COOKIE_NAME)?.value)
}
