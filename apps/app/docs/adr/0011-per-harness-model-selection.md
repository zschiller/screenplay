# 11. Per-Harness model selection — ACP capability binding + `harness:<key>:<model>` wire format

Date: 2026-06-14

Status: Accepted

## Context

A chat that runs on a **Harness** (the external engine's backing — Claude Code,
Codex — see ADR 0006) could pick _which_ Harness via its stored `model` id
(`harness:<key>`), but not _which model of that Harness_. Every Harness ran its
CLI's own default. This adds the second axis — a per-Harness model dropdown — and
two of its choices are hard to reverse once chats persist ids and operators
deploy with them, so they are recorded here as the implementation slices land
(#523–#527, parent #522).

The shape of the problem was set by a spike (#523) that probed what the real ACP
adapters actually do, and it overturned the feature's original framing. The first
plan was "discover each Harness's models from the live ACP session's
`availableModels` and bind the dropdown to ACP's model-selection capability." The
spike found that capability is real but **partial and surprising** in two ways
that shape the degradation story, and that it differs per Harness — so the design
that shipped is not the one the plan assumed.

## Decision

### (a) Bind model _application_ to ACP's `unstable_` capability — but make the curated list the source of truth

ACP carries model selection as an `unstable_`/`@experimental` capability: a
`session/new` (or `session/load`) advertises `availableModels` + `currentModelId`
(`SessionModelState`), and `unstable_setSessionModel` switches the active model.
We bind to it (`AcpSession.maybeSetModel` →
`conn.unstable_setSessionModel`, `lib/agent/acp/session.ts`) rather than to a
stable, hardcoded list — accepting an experimental surface because it is the
adapter's only in-session model lever, and it **degrades cleanly**: an adapter
that advertises no model state takes the no-op branch and the Harness runs its
own default (no picker forced, no error).

Two spike findings make this binding load-bearing, and both push the same way —
**the curated descriptor list is the source of truth; the ACP capability is only
the _application mechanism_**:

- **`availableModels` is a recommended _subset_, not the accepted id space.**
  `setSessionModel` honors aliases and full slugs the advertised list omits
  (claude-code advertises three buckets but accepts `opus`/`opusplan`/full slugs
  too). So gating the choice on `availableModels` would silently suppress valid
  curated models. The curated floor on each `Harness.models` descriptor is
  therefore a deliberate **product choice** of what to offer, not a limit forced
  by the adapter — and `maybeSetModel` forwards the chosen id **without gating on
  `availableModels`**.

- **`unstable_setSessionModel` validates lazily.** It accepts any id on the call
  and only rejects an unrunnable one on the _next prompt_, as JSON-RPC internal
  error `-32603` (`isStaleModelError`). So "clean degradation to harness default"
  cannot be "the set call rejects an unknown model" — it must be _reconcile at
  prompt time_: the first prompt that trips `-32603` falls back to the session's
  `currentModelId` (the Harness default), persists the resolved id so it stops
  re-tripping (`reconcileModel`, #526), and retries the turn once
  (`AcpSession.prompt` → `canRecoverModel` → `fallBackToDefaultModel`). A model is
  a _preference refinement, not an identity_, so a stale one (a retired alias, a
  changed subscription tier) never fails the turn — unlike a missing Harness,
  which fails loud. The recovery is narrow on purpose: only `-32603` whose message
  names the model, only when a model was applied, only once per session.

The dropdown list itself comes from the **Harness model catalog** (#527,
`harnesses/model-catalog.ts`): the descriptor's curated floor is authoritative,
and a discover-once-and-cached live augment only ever _appends_ a discovered
modelId the floor doesn't already name (`mergeHarnessModels`). The production
discovery advertises nothing today (the live augment is the deferred session-open
seam, #526), so the dropdown is exactly each Harness's curated floor.

### (b) Carry the choice as `harness:<key>:<modelId>`, stored verbatim on `agent_chat.model`

The chat's stored `model` id is the single home for the selection — no parallel
column (#524, `harnesses/model-id.ts`):

- `harness:<key>` — the Harness's own default (unchanged from before this codec;
  every pre-codec row keeps its meaning).
- `harness:<key>:<modelId>` — a specific model of that Harness.

The codec splits the remainder after the `harness:` prefix on its **first** colon:
everything before is the key, everything after is the opaque `modelId`, kept
intact. This works because `Harness.key` is invariably **colon-free and
comma-free** (`isValidHarnessKey` — the comma keeps `SANDBOX_HARNESSES`
unambiguous, the colon keeps this codec unambiguous), so the split always recovers
the key whole no matter what the model id holds — a context-window suffix
(`opus[1m]`), or even an id that itself contains colons
(`openrouter:anthropic/claude:beta`). A bare `harness:` with no key, a trailing
`harness:<key>:` with no model, and any `provider:<model>` id all decode to "not a
Harness model id," so the caller falls back to its default rather than spawning a
guessed adapter.

(Note: the wire prefix is the single-colon `harness:`. A literal double-colon
`harness::…` is an _empty_ key and decodes to null — it is not the format.)

### Per-Harness outcome, as shipped (the spike's #523 result, not the plan)

The two real adapters land on opposite sides of the capability, and the one
descriptor + codec absorbs both with no per-Harness branch above the adapter:

- **claude-code → ACP-native.** `session/new` advertises `availableModels`;
  `unstable_setSessionModel` is honored in-session. Its `acpAdapter` carries **no**
  `modelArgs`, so the model is applied via `setSessionModel` after the session
  opens. The curated floor (`default`/`fable`/`opus`/`sonnet`/`haiku`) is richer
  than what the adapter advertises — by design, per finding (a). `default` is the
  pre-selected per-Harness default and is backward-compatible with the bare
  `harness:claude-code` rows. (No `[1m]` variants or `opusplan`: the ACP adapter
  exposes context window as a derived property and has no plan/execute hybrid; the
  1M-capable pick is `fable`.)

- **codex → curated + spawn-env.** `session/new` advertises **no** model state, so
  the in-session path is a no-op for it. The choice rides the spawn instead: its
  `acpAdapter.modelArgs` appends `--model <id>` to the adapter argv
  (`resolveAcpLaunch`), against the brokered provider its seeded `~/.codex/config.toml`
  already names. The two application paths never double-apply — an adapter is
  either ACP-native (in-session, no `modelArgs`) or spawn-env (`modelArgs`, no
  advertised models).

The threading is one parse: `resolveLiveEngine` decodes the stored id once into
`{ harnessKey, modelId? }`, hands `modelId` to both the spawn factory and the
session, and the adapter's own shape decides which one actually applies it.

## Relationship to prior ADRs

- **ADR 0002 (firewall broker boundary).** The model axis is orthogonal to the
  trust boundary. Selecting a model never changes egress brokering: the Harness
  still never holds a real provider key on the hosted backend, and on the desktop
  backend — where the per-Harness model fold actually runs — the adapter rides the
  user's _own_ CLI login, not a brokered key at all. A model id refines _what runs
  inside_ the boundary; it never crosses or moves it.

- **ADR 0003 (honest provider seam / build-time backend switch).** The model
  dropdown is a **desktop-backend** surface (`harnessModels` runs only there), and
  that backend split is the same build-time switch the `SandboxProvider` and the
  Harness Availability resolver ride. The catalog's discover-once-and-cache
  staleness contract deliberately mirrors the desktop resolver's once-per-launch
  `hostBinary` detection: a model added to a subscription shows up after a restart,
  never via a mid-session re-probe.

- **ADR 0006 (ACP-native engine seam).** The model axis **refines the external
  engine's model; it never selects the engine.** A `harness:<key>:<modelId>` id
  picks which adapter the already-build-selected external engine spawns and which
  model that adapter runs — it cannot flip a deployment between in-process and
  external (`AGENT_ENGINE` is the per-deployment engine choice; the stored id is a
  per-chat refinement under it). This keeps the seam's invariant intact: the engine
  is owned, its backing is someone else's tool, and the model id only ever tunes
  the backing.

## Consequences

- Binding to an `unstable_` capability accepts a spec surface that can shift under
  us; we hold the blast radius to one module (`AcpSession`) and one bound version
  (`@agentclientprotocol/sdk@0.14.x`, `acp/schema.ts`), and the clean-degradation
  branches mean a capability that disappears falls back to "harness default"
  rather than breaking turns.
- A stored model id can outlive the model it names (retired alias, downgraded
  subscription). That is _expected_, not an error: the first prompt reconciles the
  chat's stored id to the Harness default and the chat keeps running — at the cost
  of one silent, logged fallback and a single retry on the affected turn.
- The curated floor is a maintenance commitment: new models a Harness gains are
  invisible until either the descriptor is updated or the deferred session-open
  discovery augment (#526) lands and surfaces them after a restart.
- The `harness:<key>:<modelId>` format is now part of the persisted wire contract
  (`agent_chat.model`) and the `SANDBOX_HARNESSES`/Terminal-Tab key namespace —
  the colon-free, comma-free `Harness.key` invariant must hold for every shipped
  and future descriptor (pinned by `model-id.test.ts`), or stored ids stop
  decoding.
