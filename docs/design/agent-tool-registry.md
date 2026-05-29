# Design note — Agent tool registry

Status: **proposed** (not yet implemented). Captured from an architecture
review + design grilling session. Pick up from here.

See `CONTEXT.md` for the domain terms (Chat Target, Tool, Chat Session,
Markdown Layer).

---

## Problem

A single agent Tool is spelled out across **four** places, in **two** different
authoring styles, and the input shape is hand-written **twice**:

- **name** — in the `CustomToolName` string union (`lib/agent/types.ts:1`)
- **input shape, as a TS type** — e.g. `ReadFileInput` (`types.ts:15`)
- **input shape again, as a hand-written JSON schema** + description — in
  `buildAgentTools` (`lib/agent/tools.ts`), bolted to the TS type with an
  `as unknown as ReadFileInput` cast that defeats type-checking if they drift
- **behaviour** — in a double `switch` in `executeCustomTool`
  (`lib/agent/tool-executor.ts`)

Two styles coexist:

- **Sandbox/agent tools** (`tools.ts`): schema inline, `execute` defers via
  `wrap(name)` to the `executeCustomTool` switch.
- **Document / read tools** (`markdown-layer-tools.ts`, `layer-read-tools.ts`):
  schema + `execute` co-located, closing over `roomId` / target.

Consequences:

- **Drift + unsafe casts.** The TS input type and the JSON schema are two
  hand-maintained copies; handlers cast `input as unknown as X`.
- **Output redaction gap (security).** Only `run_command` scrubs secrets
  (`tool-executor.ts`). `read_file` / `list_files` return raw bytes to the chat
  UI, Liveblocks broadcasts, and Anthropic history — so `read_file .env` or
  `.git/config` leaks the GitHub token baked into the sandbox's origin URL. This
  is the exact threat `lib/agent/redact.ts` documents itself as guarding.
- **Dead indirection.** `executeCustomTool` is called from exactly one place
  (`tools.ts`); the "v1 routes use it" comment is stale. The dispatcher is pure
  overhead.
- **Scattered composition.** The per-target toolset is assembled by spreading
  `{...buildAgentTools(ctx), ...buildLayerReadTools({roomId})}` in four places
  (`stream/route.ts`, `plan/route.ts`, `chat-target-kinds.ts` ×2, `engine.ts`).

## The deepening

Replace the four-places-per-tool scatter with **one descriptor object per
Tool** in a single registry. The AI-SDK tool objects, the name union, and the
name→handler lookup are all *derived* from the registry.

Today vs. after, for `read_file`:

```ts
// AFTER — one object holds everything
const readFile: ToolDescriptor = {
  name: "read_file",
  description: "Read a file from the sandbox",
  input: z.object({ path: z.string() }),            // the ONE source
  run: (input, ctx) => ctx.sandbox.readFile(input.path),
}
```

```ts
type ToolDescriptor<I = unknown> = {
  name: string
  description: string
  input: z.ZodType<I>                  // zod = single source of truth
  run?: (input: I, ctx: ToolContext) => Promise<string> | string
  //   run omitted => human-in-the-loop halt tool (submit_plan)
}
```

## Decisions settled in the grilling session

1. **zod is the single source for each Tool's input.** Written once as
   `z.object(...)`; the TS input type is *inferred* (`z.infer`), and the model's
   arguments are *validated* before `run` executes. The `as unknown as` casts
   disappear. (Adds `zod` as a dependency; the AI SDK supports it natively.)

2. **Output redaction is uniform, at one boundary.** The single place that turns
   a `run` return into a tool result runs `redactSensitiveInfo` over *every*
   tool's output. Safe by default, impossible to forget when adding a Tool —
   closes the `read_file` / `list_files` leak structurally. Per-tool *formatting*
   (e.g. `run_command`'s stdout/stderr framing + 20k truncation) stays inside
   that tool's `run`; only redaction is hoisted.

3. **Context is injected, not closed-over.** `run(input, ctx)` receives a
   per-turn `ToolContext` (the live sandbox, `roomId`, the target) at the moment
   the tool runs. Descriptors stay plain module-level data — enumerable,
   countable, unit-testable with a fake `ctx`. `ctx` is built once per turn at
   the route/engine boundary (the sandbox is resolved there, as today). A
   sandbox tool may assume `ctx.sandbox` is present because availability (below)
   guarantees it only appears in sandbox targets.

4. **Availability lives as per-target tool-name lists.** Each Chat Target in
   `chat-target-kinds.ts` carries `toolNames: CustomToolName[]`. Adding a new
   Chat Target is one new list; adding a Tool touches its descriptor + the one
   or two lists that include it. Drift is contained because:
   - the lists are typed `CustomToolName[]`, and that union is *derived from the
     registry* — a typo or removed tool fails the build;
   - a shared base set (`read_document`) is included by every target, not
     copy-pasted;
   - a registry test flags any descriptor that *no* target lists (dead tool).

5. **`submit_plan` is a descriptor with no `run`** (human-in-the-loop). The
   engine's `stopWhen` references its name; the loop halts and waits for
   approval, exactly as today.

6. **Malformed tool calls feed back to the model.** When zod rejects the
   arguments, the validation message is returned as the tool result so the model
   self-corrects, rather than hard-erroring the turn.

7. **`CustomToolName` is derived from the registry.** The hand-maintained union
   in `types.ts` goes away — a descriptor is the only place a Tool's name lives.

8. **The `executeCustomTool` switch is deleted.** Each sandbox handler
   (`readFile`, `runCommand`, …) becomes its descriptor's `run`, closing over
   `ctx` the way `read_document` already does. The dispatcher had one (stale)
   caller.

## Interface sketch

```
// registry.ts
export const TOOL_REGISTRY: readonly ToolDescriptor[] = [readFile, writeFile, ...]
export type CustomToolName = (typeof TOOL_REGISTRY)[number]["name"]

// per turn, at the route/engine boundary
toolsetFor(targetKind: ChatTargetKind, ctx: ToolContext): Record<string, AiSdkTool>
//   = filter registry by target.toolNames, validate via descriptor.input,
//     call descriptor.run(input, ctx), redact the result — all generic.
```

`ToolContext` is the per-turn superset: `{ sandbox?, roomId, target }`. The four
scattered spread-sites collapse into `toolsetFor`.

## Tests

- **Per-tool:** call each `descriptor.run(input, fakeCtx)` in isolation (fake
  sandbox / in-memory room) — no AI SDK, no live agent.
- **Registry invariants:** names are unique; every `CustomToolName` resolves to a
  descriptor; no orphan tool (every descriptor is listed by some target).
- **Redaction boundary:** a handler returning a string containing a GitHub token
  comes back `[REDACTED]`, regardless of which tool produced it.
- **Validation:** bad arguments are rejected by zod and surface as a tool result
  the model can retry against.

## Migration (incremental; each step independently reviewable)

1. Introduce `ToolDescriptor`, the registry, and `toolsetFor`; derive
   `CustomToolName` from the registry. Convert the **document/read** tools first
   (they already co-locate `run`) — smallest leap.
2. Convert the **sandbox** tools: move each `switch` arm into its descriptor's
   `run`; delete `executeCustomTool` and the `wrap` indirection.
3. Add zod schemas as the single input source; drop the `*Input` TS types and
   the `as unknown as` casts.
4. Hoist redaction to the `toolsetFor` result boundary; trim `run_command`'s own
   redaction to formatting/truncation only.
5. Replace the four spread-sites with `toolsetFor`; move tool-name lists onto the
   `ChatTargetKind` definitions.

## Notes / shared with candidate #1

- `layer-read-tools.ts:36` duplicates the `markdown-layer-${id}` fragment key —
  the same leak the Canvas Operations note proposes to fix with a
  `documentFragment(doc, id)` helper. Use that helper here too.
