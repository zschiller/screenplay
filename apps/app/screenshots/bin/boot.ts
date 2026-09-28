#!/usr/bin/env tsx
import { seedFixtureWorld } from "../fixtures/seed"
import { applyHostedFlag, boolFlag, parseArgs } from "../lib/args"
import { isServerUp, startCaptureStack } from "../lib/server"
import { resolveCaptureProfile } from "../profile"

/**
 * `pnpm screenshots:boot` — **the one command** that takes a fresh container to a
 * browsable, fully-populated local build.
 *
 * Seeds the Fixture World, then runs the local build in the foreground until you
 * stop it, so you can click around the same world a capture run shoots. Seeding
 * happens *before* the server starts because both want the PGlite data dir and
 * only one process may hold it.
 *
 *   --no-seed        start the server against whatever is already in the state dir
 *   --fresh=false    keep the existing state dir (default is a clean world)
 *   --hosted         the hosted build, signed in as the fixture user (comments)
 */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  applyHostedFlag(args)
  const profile = resolveCaptureProfile()
  const seed = !boolFlag(args, "no-seed")
  // A boot run wants a clean world by default: the whole value of the harness is
  // that the app looks the same every time you open it.
  const fresh = args.flags.fresh === undefined ? true : boolFlag(args, "fresh")

  if (await isServerUp(profile)) {
    console.error(
      `Something is already serving ${profile.baseUrl}. Stop it first — two servers can't share the PGlite data dir.`
    )
    process.exit(1)
  }

  if (seed) {
    console.log(`Seeding the fixture world into ${profile.stateRoot}`)
    await seedFixtureWorld(profile, { fresh })
  }

  const stack = await startCaptureStack(profile)
  console.log("")
  const build = profile.hosted ? "hosted" : "local"
  const flag = profile.hosted ? " --hosted" : ""
  console.log(
    `  Screenplay (${build} build, fixture world) → ${profile.baseUrl}`
  )
  console.log(`  Capture it:  pnpm screenshots:shots --label after${flag}`)
  console.log(`  Stop it:     Ctrl-C`)
  console.log("")

  // The server runs in its own process group (so stopping it takes Turbopack's
  // workers with it), which also means Ctrl-C here does *not* reach it — forward
  // the signal ourselves. Leaving it behind would strand the port and the PGlite
  // data-dir lock, and the next run couldn't open the database.
  let stopping = false
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      // A second Ctrl-C while the first shutdown is in flight means "stop
      // asking" — exit immediately rather than starting another teardown.
      if (stopping) process.exit(1)
      stopping = true
      console.log(`\nStopping the local build…`)
      // Exit even if a child refuses to die: holding this process open would
      // keep the fixture ports bound, and the next run would fail to start with
      // no clue why.
      const giveUp = setTimeout(() => process.exit(1), 15_000)
      giveUp.unref()
      void stack
        .stop()
        .catch(() => {})
        .then(() => process.exit(0))
    })
  }

  // `startServer` resolves as soon as the server is healthy; hold this process
  // open so the child keeps running until a signal arrives.
  await new Promise(() => {})
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
