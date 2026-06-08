# apps/app — Canvas & Agent Runtime

Domain language for the screenplay web app: the collaborative canvas (the
spatial, real-time surface of a room and the layers, groups, and chat tabs on
it, held in the room's Y.Doc) and the agent runtime that drives it (chat
targets, tools, runs). This file names those concepts so code and conversation
use the same words.

**Naming convention — code = concept, UI = label.** Code uses the structural
term; the UI shows a friendlier label, and the two are deliberately decoupled.
The three nested concepts are **Room** (shown to users as "Canvas") → **Repo**
(shown as "Project") → **Branch** (shown as "Workspace"). Code — types, files,
Y.Doc keys, props, routes — always uses the structural term; the UI labels
appear only in rendered user-facing strings, never as identifiers. The word
**agent** in code refers to the AI runtime (the Engine), never to a Branch.

## Language

**Room**:
The collaborative container for one piece of work — owns a single Y.Doc (the
canvas) and a member list, and is what gets shared, listed, and thumbnailed.
Holds one or more Repos. Backed by the `room` Postgres table.
_Shown to users as_: "Canvas".
_Avoid_: project (that's the UI label for a Repo, not a Room); "canvas" in code
(reserve that for the spatial surface below).

**Repo**:
A GitHub repository configured into a Room — its repo identity, default branch,
clone URL, and run scripts. Holds one or more Branches. Lives in the room's
Y.Doc as the `repos` collection (`RepoData`). `Repo` is the code identifier
everywhere it denotes this entity; the user-facing label still reads "Workspace"
until the separate UI-string pass renames it to "Project".
_Shown to users as_: "Project".
_Avoid_ as a code identifier: workspace (collides with the `@workspace/ui`
package and the everyday meaning), project; "agent" (an agent is the AI, not a
Repo).

**Branch**:
A single working git branch inside a Repo: its sandbox, git branch name (`ref`),
and the Engine that drives it. Each Branch maps to exactly one git branch and is
rendered in the sidebar by that branch's name. Lives in the room's Y.Doc as the
`branches` collection (`BranchData`).
_Shown to users as_: "Workspace".
_Avoid_: agent (reserve for the AI runtime — see Agent below); sandbox, run.

**Sandbox**:
The ephemeral VM a Branch's repo is checked out into — where the agent reads
and edits files, runs commands, and serves the dev-server previews the Iframe
Layers point at. One per Branch, provisioned on demand and reclaimed when idle;
its contents are never durable, so work worth keeping is committed and pushed. A
Sandbox may preserve its working tree across a restart (see Sandbox Provider)
but never outlives its Branch.
_Avoid_: VM, container, box (the backend's words); workspace (the UI label for a
Repo); using "sandbox" to mean the Branch itself.

**Sandbox Provider**:
The swappable backend that creates and reconnects Sandboxes — Vercel today, and
the only one. The surface is split into a **portable core** (the operations
every conceivable backend can honor) and an optional **Hibernation** capability:
freezing a Sandbox's filesystem when it goes idle and thawing it on return,
which is what preserves uncommitted work across a restart. A provider that can't
hibernate is not disqualified — it degrades to recloning the repo fresh, a
working Sandbox with un-pushed edits lost. The split exists so the seam tells the
truth about what a second provider would actually cost.
_Avoid_: driver, adapter (casual); naming a specific SDK; treating Hibernation as
guaranteed (it is an optional capability, not part of the core).

**Dev Server Restart**:
Bouncing the `devScript` process (and its bridge proxy) inside the *existing*
Sandbox — no VM cycle, filesystem and working tree untouched. The cheap, common
recovery for a wedged preview, and the only restart that stays available while
the Agent is working, so a broken preview can be fixed mid-turn.
_Shown to users as_: "Restart dev server".
_Avoid_: "restart" unqualified (it collapses this with the VM-cycling Sandbox
Restart and the destructive Recreate — say which one).

**Sandbox Restart**:
Cycling the whole Sandbox VM (fresh processes, dev server, port forwards) while
**preserving the working tree** — including uncommitted changes — by
snapshot-restoring onto a new VM (the Hibernation path). It is snapshot-only and
**fails loud** on a snapshot miss: it never silently reclones, because a restart
must not discard un-pushed work (see ADR 0005). Disabled while the Agent is
working, since it cycles the VM mid-turn.
_Shown to users as_: "Restart sandbox".
_Avoid_: conflating with Dev Server Restart (no VM cycle) or Recreate (which
destroys the working tree).

**Recreate** (Recreate from scratch):
The explicit, destructive rebuild of a Sandbox: delete the VM and reclone the
branch fresh from git, discarding the working tree. This is the only path that
throws away uncommitted work, so it is gated behind a confirm and is never a
silent fallback (see ADR 0005). Also the auto-recovery path when a Sandbox's
snapshot has fully expired and there is nothing left to restore.
_Shown to users as_: "Recreate from scratch".
_Avoid_: "reset", "reclone" (casual); using it for the working-tree-preserving
Sandbox Restart.

**Agent**:
The AI runtime that operates inside a Branch — concretely the Engine (the agent
loop), its tools, providers, and persisted runs (`lib/agent/`, the
`agentChat`/`agentMessage`/`agentRun` tables, the `/api/agent/*` AI routes).
"Agent" is the AI, never an entity on the canvas.
_Avoid_: using "agent" for a Branch (the entity); harness (reserve that for an
external/BYO agent tool).

**Canvas**:
The shared, collaboratively-edited spatial surface of a Room. Its committed
state lives in the room's Y.Doc. (Note: "Canvas" is also the user-facing label
for a Room; in code, Canvas means this surface specifically.)
_Avoid_: board, whiteboard, scene.

**Group** (Iframe Layer Group):
A positioned container on the canvas holding one or more Members; carries its
own x/y, name, gap, and sidebar order. Invariant: a Group is **never committed
to the Y.Doc with zero members** — removing its last member deletes it. Empty
groups may exist only in uncommitted, client-side drag state.
_Avoid_: cluster, stack, frame group.

**Member**:
A reference (`{ kind, id }`) from a Group to the Iframe Layer or Markdown Layer
it contains.
_Avoid_: child, item.

**Iframe Layer**:
A live preview pane on the canvas rendering a sandbox dev-server URL (or a blank
frame). Belongs to exactly one Group.
_Avoid_: screen, window, panel; "frame" is the UI label only.

**Markdown Layer** (Document):
A rich-text layer whose body is a TipTap-owned `Y.XmlFragment` keyed
`markdown-layer-{id}`. Its title is mirrored into both the fragment heading and
the layer's collection record.
_Avoid_: note, text layer.

**Chat Session**:
The *identity* of a chat tab (id, label, target). The conversation itself —
messages and streaming state — lives in the client chat-store, not the Y.Doc.
_Avoid_: chat, conversation; "thread" means a comment thread.

**Chat Target**:
What a Chat Session talks to — either a Branch's **sandbox** or a Markdown
Layer (a document). The target decides the system prompt and which Tools the
model is given.
_Avoid_: subject, destination.

**Terminal Tab**:
A BYO-harness shell surfaced as a tab in the agent panel, attached to one
Branch's sandbox and rendered with xterm.js in our own React, connecting to the
in-sandbox daemon's websocket directly (no iframe). Its identity — id, label,
target Branch — is persisted **per User** in Postgres (the `terminalTab` table)
and reattaches on reload to a per-tab in-sandbox **tmux session**, so a
still-running harness survives a page refresh; its *scrollback* is never
persisted and dies with the sandbox. Explicitly **not** a Chat Session: nothing
here enters the chat-store, the conversation tables, or the Y.Doc, and it is
modeled by its own `TerminalTabData`, never `ChatSessionData`.
_Avoid_: chat tab; terminal session (reserve "tmux session" for the in-sandbox
multiplexer, "Terminal Tab" for the UI surface); harness (that's the tool the
operator runs *inside* the tab — see Engine for why the app's own loop isn't one).

**Tool**:
A capability the model can call during a chat turn (read_file, run_command,
read_document, …). Each Tool's availability is scoped by Chat Target.
_Avoid_: function, action (action = server action), command.

**Skill**:
A markdown instruction document (`SKILL.md` with `name` + `description`
frontmatter) that teaches the agent how to perform a screenplay-specific task.
Surfaced to the model by name + description and loaded in full on demand, never
always-on. Exists as either an App Skill or a Repo Skill.
_Avoid_: command, macro, plugin.

**App Skill**:
A Skill screenplay ships in its own source (`lib/skills/`); branch-independent
and present in every Branch's chat. Bundled names carry a `screenplay-` prefix to
stay clear of user skills.
_Avoid_: bundled skill (casual/UI word), built-in.

**Repo Skill**:
A Skill discovered in the Branch's checked-out sandbox repo (`.claude/skills/`);
varies per branch. On a name collision it **shadows** the App Skill of the same
name — the checked-out repo overrides screenplay's bundled default.
_Avoid_: project skill, local skill.

**Engine** (Agent Loop):
A seam that drives one turn of a Chat Session to completion, **speaking ACP**:
its update vocabulary is the genuine Agent Client Protocol `session/update`
(not a bespoke wire format), and the conversation is persisted ACP-native. Two
implementations sit behind the seam — a default **in-process AI-SDK** engine
(which still runs `streamText` but now *translates*: it rebuilds its model
input from ACP-native history and emits ACP updates) and, in later slices, an
**ACP engine** driving a generic ACP agent. The server is the sole ACP peer;
browsers render the server's ACP-shaped broadcast over the Y.Doc and never open
an ACP connection (single ACP session in → N browsers out). The app owns this
seam; it is deliberately **not** an external coding harness (Claude Code,
Codex, …). See ADR 0006 for the seam, the multiplayer-brokering principle, and
the swap-to-real-client design goal.
_Avoid_: harness (reserve that word for an external/BYO agent tool — see Harness
below), runtime; treating each browser as an ACP client (breaks multiplayer).

**Harness** (BYO Coding CLI):
An external, bring-your-own coding agent CLI — Claude Code, Codex, aider — that
the operator runs *inside* a Terminal Tab against a Branch's sandbox. Distinct
from the Engine: the Engine is screenplay's owned Agent Loop; a Harness is
someone else's tool we install and step out of the way for. Each is a descriptor
in the catalog (`lib/agent/harnesses/`), enabled per deployment via
`SANDBOX_HARNESSES` (comma-separated catalog keys) and installed into the
sandbox — there is **no default**. A Harness is offered **only** when its broker
model provider is configured *and* header-brokerable (`egress()` non-null), so
it reaches its model API on the operator's key injected at the firewall without
ever holding it (ADR 0002's trust boundary).
_Avoid_: engine, agent (screenplay's owned AI loop, never a BYO CLI); treating a
Harness as a Chat Session (it produces no messages, runs, or Y.Doc state — its
scrollback dies with the sandbox).

**Composer**:
The shared rich-text input for authoring a single chat turn — owns model
selection, plan-mode, `@`-Layer mentions and `/`-Skill insertion, and serializes
its content to Message Markers. One component, rendered both inside a Chat
Session and in the New-Workspace dialog as a Branch's seed prompt (where it fires
as the first message once the Sandbox reaches `running`). An empty seed prompt
creates a bare Branch and applies no model; a non-empty one seeds a Chat Session.
_Avoid_: input box, prompt field, textarea; standing up a second divergent copy
of this UI per surface.

**Message Markers**:
The wire format that encodes a chat turn's metadata into the user-message
string the Engine replays. The server prepends `[plan mode: enabled]` and
`[branch: <ref>]`; the composer serializes a `/`-Skill as `[skill: <name>]`, an
`@`-Layer as `[@<label>](mention:<id>)`, and appends a `Referenced documents:`
footer. One isomorphic codec (`lib/agent/message-markers.ts`) owns both encode
(composer, stream route) and decode (history route, message renderer), so the
format lives in exactly one place and the system prompt references the codec's
exported tokens rather than restating them.
_Avoid_: prefix, tag, annotation; re-deriving the format with ad-hoc regex at a
call site.

**Canvas Operation**:
A verb that mutates committed canvas state across one or more collections while
preserving canvas invariants (e.g. Group pruning). The deep module fronting the
generic `YjsCollection` CRDT wrapper.
_Avoid_: handler, mutation helper; "action" means a server action.

**Canvas Layout**:
The derived geometry of the Canvas — per-Group/Member placements and bounding
boxes, the effective (mid-drag) layout shown while a Member is being moved, the
placeholder rect of where a dragged Member will land, and the gap/reorder
handles. Computed from plain Canvas snapshots by a React-free, Yjs-free module
(`lib/canvas/layout.ts`) so it is unit-testable against plain numbers. The
derive-side counterpart to the Canvas Operation write seam: derive layout →
gesture → commit via a Canvas Operation.
_Avoid_: positions, coordinates (too vague); computing this geometry inline in a
component.

**Snap**:
Gesture-time alignment on the Canvas, computed by a React-free module
(`lib/canvas/snap.ts`): move-snap (a dragged rect aligns to its peers' edges,
emitting **Snap Guides** — the alignment lines drawn during the drag),
merge-snap (a Group dragged close enough to another goes "hot" to merge into
it), and resize-snap (an Iframe Layer's size clamps to a standard device size).
Pure functions of plain geometry with the threshold as a parameter, so snapping
is pinned by fixtures and runs off the React render path.
_Avoid_: magnet, guide (reserve "Snap Guide" for the drawn line); folding snap
math into drag event handlers.
