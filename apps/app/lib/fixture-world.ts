import { isLocalBuild } from "@/lib/local-mode"

/**
 * The **Fixture World** switch (issue #716): this process is serving a *seeded,
 * synthetic* world rather than a real machine.
 *
 * The screenshot harness (`apps/app/screenshots/`) boots the local build against
 * a database, Y.Doc set, and blob dir it wrote itself, so that a design-polish
 * ticket can capture before/after screenshots without a GitHub login, a Postgres,
 * or a dev server per Workspace. Two things about the app assume the opposite —
 * that what is on disk reflects a machine it can go and check — and both would
 * make the fixture world un-capturable:
 *
 *  - **The first-run setup gate** (ADR 0016) blocks until a coding CLI is
 *    installed. A capture container has none, and never will; left blocking, the
 *    setup modal is the only screen the harness could ever shoot.
 *  - **Sandbox Reconnect** (`components/canvas/use-sandbox-reconnect.ts`) probes
 *    each Workspace's sandbox on canvas mount and, finding nothing, escalates to
 *    Recreate and then to an error. The fixture Workspaces have no sandboxes by
 *    design — the point of them is that one Workspace is `running`, one
 *    `starting` and one `error` — so reconciliation would erase in a second
 *    exactly the variety the fixtures exist to show.
 *
 *  - **The last-opened stamp** (`touchRoomOpened`) orders the home grid by
 *    recency. Opening a Canvas to photograph it isn't work on that Canvas, so
 *    letting it write would reshuffle the grid and rewrite every "Edited N days
 *    ago" to "just now" partway through a capture set.
 *
 * All three fall out of the same fact, so they get one switch rather than three:
 * *the world is already what it should be — don't go looking at the host, and
 * don't write to it.* Nothing here fabricates state or changes what the app
 * renders; it only suppresses the reconciliation and bookkeeping that would
 * overwrite what the seeder wrote.
 *
 * `NEXT_PUBLIC_` because the Sandbox-Reconnect half runs in the client bundle
 * while the gate half is resolved server-side, exactly like the sibling
 * {@link isLocalBuild} flag — and being a compile-time constant lets the bundler
 * drop the guarded branch from any build that doesn't set it. It is **and**-ed
 * with `isLocalBuild` so the hosted, multi-tenant app can never be placed in
 * fixture mode, whatever its environment says.
 */
export const isFixtureWorld =
  isLocalBuild && process.env.NEXT_PUBLIC_SCREENPLAY_FIXTURE_WORLD === "1"
