#!/usr/bin/env tsx
import { seedFixtureWorld } from "../fixtures/seed"
import { applyHostedFlag, boolFlag, parseArgs } from "../lib/args"
import { resolveCaptureProfile } from "../profile"

/**
 * `pnpm screenshots:seed` — write the Fixture World into the harness's state dir.
 *
 * Standalone so you can re-seed under a running server's feet… except you can't,
 * and that is the point of having it: PGlite allows exactly one opener of a data
 * dir, so this refuses loudly if the server is up rather than corrupting the
 * database. Stop the server, re-seed, start it again.
 *
 *   --fresh   delete the existing database, Y.Docs, and blobs first
 *   --hosted  seed the hosted build's state dir, with its members and comments
 */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  applyHostedFlag(args)
  const profile = resolveCaptureProfile()

  console.log(`Seeding the fixture world into ${profile.stateRoot}`)
  const result = await seedFixtureWorld(profile, {
    fresh: boolFlag(args, "fresh"),
  })
  console.log(
    `Done: ${result.rooms} canvases, ${result.folders} folders, ${result.captures} frame captures.`
  )
  console.log(`Next: pnpm screenshots:boot   (or pnpm screenshots:shots)`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
