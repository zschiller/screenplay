import { cookies } from "next/headers"

import { isFixtureWorld } from "@/lib/fixture-world"

/**
 * A **reachable model** for a Fixture World capture. The capture machine has no
 * hosted key and no signed-in harness CLI, so model-assisted settings detection
 * on Add project has nothing to call there. A screen in
 * `screenshots/screens/list/` seeds this cookie to have that call answer with
 * {@link FIXTURE_DETECTION_REPLY}, the reply a model gives for the fixture
 * `storefront` checkout. Without the cookie the Fixture World has no model, so
 * every other capture keeps the rule-based result and never shells a real CLI.
 *
 * Only ever honoured under {@link isFixtureWorld}, so the hosted app and a real
 * desktop install never read it.
 */
const COOKIE_NAME = "screenplay_fixture_model"

/** The cookie a capture screen sets to make a model reachable. */
export function fixtureModelCookieName(): string {
  return COOKIE_NAME
}

/** How long the `slow` fixture model takes, so a capture can catch it reading. */
const SLOW_REPLY_MS = 20_000

/** The fixture model's answer to the settings-detection prompt. */
export const FIXTURE_DETECTION_REPLY = JSON.stringify({
  setupScript: "pnpm install && pnpm db:generate",
  devScript: "pnpm dev",
  devServerPort: 4000,
})

/**
 * The fixture model's reply when the capture asked for one (`connected`, or
 * `slow` to answer after {@link SLOW_REPLY_MS}), `null` for "no model".
 * `undefined` outside the Fixture World: use the real transport.
 */
export async function fixtureModelReply(): Promise<string | null | undefined> {
  if (!isFixtureWorld) return undefined
  const cookieStore = await cookies()
  const value = cookieStore.get(COOKIE_NAME)?.value
  if (value === "slow") {
    await new Promise((resolve) => setTimeout(resolve, SLOW_REPLY_MS))
  }
  return value === "connected" || value === "slow"
    ? FIXTURE_DETECTION_REPLY
    : null
}
