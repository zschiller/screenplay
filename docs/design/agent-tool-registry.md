# Design note — Agent tools cleanup

Status: **proposed** (not yet implemented). Captured from an architecture
review + design grilling session. Pick up from here.

See `CONTEXT.md` for the domain terms (Chat Target, Tool, Chat Session,
Markdown Layer).

> This started as a proposal to build a "tool registry / descriptor"
> abstraction. Grilling killed most of it: the **AI SDK's `tool()` already _is_
> the descriptor** (it co-locates description + schema + execute, and with a zod
> schema it hands `execute` typed, validated input). So this is not a new
> abstraction — it's **using `tool()` + zod the way it's designed, plus three
> thin app-level pieces.**

---

## Problem

A single sandbox Tool is spelled out across **four** places, with its input
shape hand-written **twice**:

- **name** — in the `CustomToolName` string union (`lib/agent/types.ts:1`)
- **input shape, as a TS type** — e.g. `ReadFileInput` (`types.ts:15`)
- **input shape again, as hand-written JSON schema** + description — in
  `buildAgentTools` (`lib/agent/tools.ts`), bolted to the TS type with an
  `as unknown as ReadFileInput` cast that defeats type-checking if they drift
- **behaviour** — in a double `switch` in `executeCustomTool`
  (`lib/agent/tool-executor.ts`), reached via `wrap(name)`

Crucially, the **document/read tools already do this right**
(`layer-read-tools.ts`, `markdown-layer-tools.ts`): `tool({ description,
inputSchema, execute })` with `execute` inline, closing over `roomId` / target.
Only the **sandbox** tools take the long way around — and that detour is the
source of the duplication and casts.

Consequences:

- **Drift + unsafe casts** on the sandbox tools (TS type vs JSON schema vs the
  `as unknown as` in the switch).
- **Output redaction gap (security).** Only `run_command` scrubs secrets
  (`tool-executor.ts`). `read_file` / `list_files` return raw bytes to the chat
  UI, Liveblocks broadcasts, and Anthropic history — so `read_file .env` or
  `.git/config` leaks the GitHub token baked into the sandbox's origin URL. The
  exact threat `lib/agent/redact.ts` documents itself as guarding.
- **Dead indirection.** `executeCustomTool` is called from exactly one place
  (`tools.ts`); the "v1 routes use it" comment is stale.
- **Scattered composition.** The per-target toolset is assembled by spreading
  `{...buildAgentTools(ctx), ...buildLayerReadTools({roomId})}` in four places
  (`stream/route.ts`, `plan/route.ts`, `chat-target-kinds.ts` ×2, `engine.ts`).

## What the AI SDK already gives us (so we don't build it)

- **The descriptor**: `tool({ description, inputSchema, execute })` — one object,
  the three things co-located. No custom `ToolDescriptor` type needed.
- **Typed + validated input**: pass a **zod** `inputSchema` and `execute`
  receives parsed, typed input; bad arguments are rejected before `execute`
  runs (and can be auto-repaired / fed back via the SDK's tool-input error
  handling). The `as unknown as` casts disappear for free.
- **Context binding**: closures. A `buildXTools(ctx)` factory returning a
  `ToolSet` is the idiomatic way to give `execute` its sandbox/room — and it
  tests fine: `buildSandboxTools(fakeCtx).read_file.execute(input, opts)`.
  (We considered "static descriptors + injected ctx" and rejected it — it fights
  the SDK's grain for a testability win the closure already provides.)
- **Names/typed tool calls**: derived from the `ToolSet` (`Record<string,
  Tool>`) keys, so the hand-maintained `CustomToolName` union can be derived
  rather than written out.
- **Human-in-the-loop**: a `tool()` with **no `execute`** halts the loop for
  approval — already how `submit_plan` works with `stopWhen`. Keep as-is.

## The change — ride `tool()` + zod, add three thin things

1. **Bring the sandbox tools up to the document tools' standard.** Inline each
   tool's `execute` (move the `switch` arm in), give it a **zod** `inputSchema`,
   and **delete `executeCustomTool`, `wrap`, and the `*Input` TS types**. This
   alone removes the duplication, the casts, and the dead dispatcher.

2. **Uniform output redaction (genuinely ours).** Wrap every tool's `execute`
   output with `redactSensitiveInfo` at the one place toolsets are assembled
   (below), so it can't be forgotten per tool — closing the `read_file` /
   `list_files` leak structurally. Per-tool *formatting* (e.g. `run_command`'s
   stdout/stderr framing + 20k truncation) stays in that tool's `execute`; only
   redaction is hoisted.

3. **One assembly point (genuinely ours).** Replace the four scattered spreads
   with a single `toolsetFor(target, ctx)` that composes the right builder
   outputs per Chat Target and applies the redaction wrapper:

   ```ts
   function toolsetFor(target: ChatTargetKind, ctx: ToolContext): ToolSet {
     const tools =
       target.kind === "sandbox"
         ? { ...buildSandboxTools(ctx), ...buildSharedReadTools(ctx) }
         : { ...buildDocumentTools(ctx), ...buildSharedReadTools(ctx) }
     return withRedactedOutput(tools)
   }
   ```

   Per-target selection lives here, in one switch. Adding a **new Chat Target**
   is one new case; adding a **new Tool** is one edit to the relevant builder.
   `read_document` stays in the shared set every target composes. (This is the
   "list per target" outcome from the grill — expressed as composition, not a
   parallel array of names to keep in sync.)

## Derived name union

Drop the hand-written `CustomToolName` union; derive it from the builders, e.g.

```ts
type AllTools = ReturnType<typeof buildSandboxTools> &
  ReturnType<typeof buildDocumentTools> &
  ReturnType<typeof buildSharedReadTools>
export type CustomToolName = keyof AllTools
```

so a Tool's name lives in exactly one place (its `tool()` entry).

## Tests

- **Per-tool:** `buildSandboxTools(fakeCtx).read_file.execute(input, opts)` with a
  fake sandbox / in-memory room — no live agent.
- **Redaction:** a tool whose output contains a GitHub token comes back
  `[REDACTED]` after `toolsetFor`, regardless of which tool produced it.
- **Validation:** an invalid argument is rejected by the zod schema (SDK-level)
  and surfaces as a result the model can retry against.

## Migration (incremental; each step independently reviewable)

1. Convert sandbox tools to inline `execute` + **zod** `inputSchema`; delete
   `executeCustomTool`, `wrap`, and the `*Input` types. (Document tools already
   match this shape — no change.)
2. Add `withRedactedOutput` + `toolsetFor`; replace the four spread-sites.
   Trim `run_command`'s own redaction to formatting/truncation only.
3. Derive `CustomToolName` from the builders.

## Notes / shared with candidate #1

- `layer-read-tools.ts:36` duplicates the `markdown-layer-${id}` fragment key —
  the same leak the Canvas Operations note proposes to fix with a
  `documentFragment(doc, id)` helper. Use that helper here too.
