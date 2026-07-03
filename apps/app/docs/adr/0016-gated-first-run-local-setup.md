# 16. Gated first-run local setup — a root-layout blocking gate that hard-requires a Harness and offers a skippable GitHub Connection, over the reusable setup steps

Date: 2026-07-03

Status: Accepted (composes ADR 0014 + ADR 0015; realizes the gated onboarding both deferred)

## Context

ADR 0014 built the **GitHub Connection** setup surface (install `gh`, sign in
in an inline host-session terminal) and ADR 0015 built the **Harness Setup**
surface ("Coding agents" in Settings — install a coding CLI, chain into its own
sign-in, live re-probe). Both are `isLocalBuild`-gated Settings sections driven
by live status server actions (`getGitHubLocalStatus()`,
`listHarnessSetupStatus()`) over the same reusable **host-tool setup step**.
ADR 0015's closing consequence named the slice this ADR realizes:

> This slice deliberately stops at the reusable step. A **gated first-run
> onboarding** that requires both a usable harness and a GitHub connection before
> the app opens is still out of scope — it composes from this step and the ADR
> 0014 step; it does not replace them.

The gap it leaves: a fresh desktop install with no coding CLI opens straight
onto an empty Recents grid with a **dark agent panel** — the app's entire value
is unusable and the only guidance lives in a Settings section the user has no
reason to visit. The two setup surfaces exist; nothing *drives the user to them*
on first launch. The desktop app needs at least one **Harness** installed and
signed in to be usable at all; a **GitHub Connection** lights up repo listing,
Branch-via-API, and PRs but is — by the standing **no-auth floor** (ADR 0008) —
explicitly optional (add a Repo by clone URL or local folder needs no token).

So the requirement is asymmetric, and that asymmetry drives the whole design: a
Harness has **no floor** (zero harnesses = nothing works), while the GitHub
Connection has a designed-in floor two ADRs went out of their way to preserve.

## Decision

- **A full-app blocking gate, mounted once at the root layout, `isLocalBuild`-gated.**
  A single `LocalSetupGate` wraps `children` in `app/layout.tsx`, so it covers
  both real desktop entry points (the home surface and a direct canvas load)
  from one mount site. On the hosted build `isLocalBuild` is a compile-time
  `false`, so the gate and its status probes are dead-code-eliminated — the
  hosted/multi-tenant path pays nothing and the sign-in surface is untouched.
  When blocking, the gate renders **only** the setup flow — not a browsable app
  behind it — because the thing being fixed *is* the dark agent panel, and
  letting the user wander a canvas first only defers the same wall.

- **The gate is a stepper wrapper around the existing setup panels, reused verbatim.**
  It reimplements no setup controls: each step mounts the ADR 0014 / ADR 0015
  panel as-is (their own inline host-session terminals, live re-detect, and
  `setupReducer` folds), so the gate and Settings stay one implementation.
  **Step 1 is the Harness** (the hard requirement, led with so it can't be
  skipped past); **Step 2 is the GitHub Connection** (the optional one, ending
  on the step that offers a skip). Both panels are **visible at once** with a
  single gated **Finish** action — a strict one-step-at-a-time wizard would fight
  the panels' self-contained live re-detect and would hide an already-green
  GitHub state from a user whose `gh` login is already present.

- **The release predicate is one shared pure function, the single source of truth.**
  `isLocalSetupComplete({ github, harnesses, githubSkipped })` =
  `harnessSatisfied(harnesses) && (githubSatisfied(github) || githubSkipped)`,
  where:
  - `harnessSatisfied` = **some** Harness Setup row is `installed &&
    authenticated !== false`. Presence is required; auth must not be *known*
    signed-out — but an **indeterminate** probe (`authenticated === null`, "can't
    tell") is tolerated rather than treated as a block. This deliberately is
    `!== false`, **not** `=== true`: ADR 0015's auth probes are best-effort and a
    genuinely signed-in CLI whose credential the probe can't read resolves to
    `null`; gating on `=== true` would **false-block** a working install, the
    exact false-negative ADR 0015 warns against. In Settings a `null` is harmless
    (it just offers a sign-in button); on a *blocking* screen it must never wall
    off a usable state.
  - `githubSatisfied` = `tokenSource !== null` (a token that actually resolved,
    via `gh` **or** device flow — exactly what the panel calls "Connected"), not
    merely "`gh` installed".

- **The Harness half hard-blocks; the GitHub half is skippable, honoring the no-auth floor.**
  There is no Harness floor, so the gate does not release without one — this is
  the app telling the truth about being unusable. The GitHub Connection's no-auth
  floor (ADR 0008) is a standing decision, so forcing it would reverse it;
  instead Step 2 offers a **"Skip for now"** that persists, releasing the GitHub
  half. After a skip the app opens with GitHub dark (repo-by-URL / local-folder
  still work) and the repo picker's existing "Connect GitHub in Settings →"
  deep-link (ADR 0014) remains the path back.

- **The skip is a persisted cookie, read server-side for a flash-free first paint.**
  The skip bit is *not* a secret and only the gate consumes it, so it does not
  earn the keychain the device token uses. It lives in a **cookie** (the
  `home-view-prefs` anti-flash pattern), so the root layout reads it *and* the
  release condition **server-side** and passes `initiallyBlocked` down — the very
  first paint is already correct, with no modal-over-app flash in either
  direction. (A client-only `localStorage` skip bit was rejected precisely
  because the server couldn't see it, reintroducing a flash for skipped users.)

- **The gate owns the release truth by polling, not by the panels reporting up.**
  On a blocking screen the failure mode is asymmetric: if a panel ever updated
  its internal status without notifying, **Finish would never enable** — a
  permanent hang on the one screen the user can't escape. So the gate reads the
  same server actions the release condition is *defined* in terms of, on its own
  schedule, and cannot go stale because a panel forgot to report. A thin server
  action `getLocalSetupGateStatus()` returns just the two booleans
  (`{ harnessSatisfied, githubSatisfied }` — no raw credential shapes crossing to
  the client), which the gate combines with the cookie-skip bit through the
  **same** shared predicate. The gate polls on a modest interval **only while
  blocked** and **stops the moment the condition is met** — no perpetual loop on
  a healthy session.

- **Re-evaluation is launch-scoped, not a mid-session watchdog.** The server
  computes `initiallyBlocked` at each hard load. A launch that lands *blocked*
  polls until released, then stops. A launch that lands *not-blocked* renders the
  app and never re-blocks mid-session — the next check is the next launch. This
  is the "self-healing across launches" of ADR 0015's live re-probe, at the right
  granularity: a background harness process dying should not slam a blocking
  modal over an active canvas.

### Considered and rejected

- **Gating only agent use (app browsable behind the gate):** too weak — the dark
  agent panel is the whole problem, and letting the user open a canvas first just
  defers the same wall to first turn.
- **Hard-blocking the GitHub half too (GitHub mandatory on desktop):** reverses
  the ADR 0008 no-auth floor, forcing a connection on a user who only wants local
  folders + a harness. The floor is a standing decision; the gate bends to it
  with a skip.
- **A one-time "onboarding complete" flag for everything:** a user whose only
  harness later breaks would land in a dark app with no gate to guide them back.
  The Harness half is re-evaluated every launch instead; only the *skip* is
  persisted.
- **Panels reporting status upward via a callback:** fragile on a blocking screen
  — a single missed transition (or a future refactor that drops the call) hangs
  Finish forever. Polling makes the gate the sole, un-stale-able owner of the
  release decision.
- **A `localStorage` skip bit:** client-only, so the server can't fold it into
  the initial paint, reintroducing the exact flash the cookie eliminates.
- **Strict `authenticated === true` for the harness half:** false-blocks a
  genuinely signed-in CLI whose best-effort auth probe returns `null`. `!== false`
  tolerates the indeterminate case without ever passing a *known* signed-out CLI.
- **A bespoke stepper that reimplements the setup controls:** duplicates UI that
  already exists in the two panels and would drift from Settings. The gate is
  chrome + release logic around the panels, nothing more.
- **A mid-session watchdog that re-blocks live:** hostile — it could cover an
  active canvas because a background process died. Launch-scoped is the right
  granularity.

## Consequences

- The desktop app now has a real first-run: a fresh install cannot reach a dark
  agent panel — it lands in the gate, installs and signs in a Harness (Step 1),
  optionally connects GitHub or skips (Step 2), and Finishes into a usable app.
  A returning or already-configured user (or one who skipped GitHub) never sees
  the gate, because the server computes `initiallyBlocked` before first paint.
- The gate adds **no new setup infrastructure** — it composes the two existing
  panels, the shared reusable setup step, and the live status actions. What is
  new is small and testable: one pure predicate (`isLocalSetupComplete`), one
  thin boolean poll action (`getLocalSetupGateStatus`), a cookie for the skip,
  and the gate component itself.
- The release predicate is the **single definition** of "set up enough to open,"
  called identically server-side (initial) and client-side (poll), so the two can
  never drift. Its `authenticated !== false` tolerance means the gate errs toward
  *letting a probably-working user in*, never toward walling one off on a probe it
  couldn't read.
- The no-auth floor survives intact: GitHub stays optional, the skip is a
  one-way persisted decision, and Settings remains the canonical connection home.
- Explicitly out of scope: a mid-session watchdog, picking a Harness's model here
  (that stays with the model dropdown / Harness model catalog, ADR 0011), and any
  sign-out / uninstall — the help stays **one-directional** (install and launch
  sign-in, never out), exactly as ADR 0014 and ADR 0015 established.
