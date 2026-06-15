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
Holds one or more Repos. Backed by the `room` Postgres table. In the local
desktop build the member list collapses to a single seeded local user (see
**Multi-user surface**): there is no sharing, and every Room belongs to that one
user.
_Shown to users as_: "Canvas".
_Avoid_: project (that's the UI label for a Repo, not a Room); "canvas" in code
(reserve that for the spatial surface below); "file" as a label for a Room (a
Room is shown as "Canvas" and is `Room*` in code, never "a file"). This bans
only the noun: _filing_ a Room into a Folder is the canonical verb, and the
"All files" home root, the "New canvas" action, and the `file-dnd` / `File*`
filing identifiers are all current (PRD #475) — see **Folder**.

**Folder**:
A user-private container on the homescreen for organizing Rooms into a tree:
it holds Rooms and other Folders, nests to any depth, and is navigated into
from the All-files list (with a breadcrumb showing depth). Each user owns their
own Folders and their own placement of Rooms within them — filing a Room
affects only that user's view, never a collaborator's — so a shared Room sits
at each member's own root until they file it. A Room is always a leaf: it sits
in at most one Folder and never contains sub-Folders.
_Shown to users as_: "Folder".
_Avoid_: directory; Group (that's the canvas Iframe Layer Group, a different
concept); tag/label (a Room lives in one Folder, not many); treating a Folder
as something a Room contains (the containment runs Folder → Room, never the
reverse).

**Pin**:
A per-user shortcut that surfaces a Room or Folder directly in the home sidebar
for quick access, independent of where the item sits in the Folder tree —
pinning never moves or files the item, and unpinning leaves its placement
untouched. Each user has their own pins, so pinning a shared Room adds it only
to that user's sidebar. A Room or Folder is simply pinned or not: a Pin is a
flat favorite, never a container and never a second copy.
_Shown to users as_: "Pinned" (the sidebar section).
_Avoid_: bookmark, favorite, star; conflating a Pin with Folder placement (a
Pin is a shortcut, a placement is a filing — the two are orthogonal); confusing
the home sidebar's pins with the in-room sidebar's `sidebarOrder` (a different
surface — Repos and Branches inside a Room).

**Repo**:
A GitHub repository configured into a Room — its repo identity, default branch,
**clone URL or local path**, and run scripts. Holds one or more Branches. Lives
in the room's Y.Doc as the `repos` collection (`RepoData`). A Repo resolves to a
local `.git` two ways — point at an existing local clone, or app-managed `git
clone` of the URL into a managed dir — after which both converge on one
**worktree manager** that adds/removes one worktree per Branch ref
(`lib/sandbox/local/worktree.ts`); the paths diverge only at acquisition. `Repo`
is the code identifier everywhere it denotes this entity; the user-facing label
still reads "Workspace" until the separate UI-string pass renames it to
"Project".
_Shown to users as_: "Project".
_Avoid_ as a code identifier: workspace (collides with the `@workspace/ui`
package and the everyday meaning), project; "agent" (an agent is the AI, not a
Repo).

**Branch**:
A single working git branch inside a Repo: its sandbox, git branch name (`ref`),
and the Engine that drives it. Each Branch maps to exactly one git branch; how
many Branches one ref may back is **a backend property, not a domain rule** (ADR
0009). On the hosted backend there is no limit — Sandboxes are independent
clones, and concurrent ones coordinate through git the way human collaborators
do (a non-fast-forward push is rejected and the agent pulls and resolves). On
the desktop **local** backend the limit is structural: each Branch is a git
worktree of one shared clone, and git keeps one checkout per branch — so a ref
already open (or checked out in the user's own clone) **fails loud with a named
error**, never silently shares or steals a checkout. Rendered in the sidebar by
its branch's name. Lives in the room's Y.Doc as the `branches` collection
(`BranchData`).
_Shown to users as_: "Workspace".
_Avoid_: agent (reserve for the AI runtime — see Agent below); sandbox, run;
calling one-Branch-per-ref a domain invariant (it is the desktop storage model
surfacing, absent on the hosted backend) — and equally, assuming the hosted
backend's no-limit applies on desktop.

**Sandbox**:
The environment a Branch's repo is checked out into — where the agent reads
and edits files, runs commands, and serves the dev-server previews the Iframe
Layers point at. One per Branch, provisioned on demand. **Durability is
provider-dependent** (see Sandbox Provider): the hosted Vercel backend backs it
with an ephemeral VM that is reclaimed when idle, so its contents aren't durable
and work worth keeping must be committed and pushed; the desktop local backend
backs it with a per-Branch checkout on the host disk, which _is_ durable across restarts
(the checkout and its uncommitted edits survive) even though that backend can't
hibernate. Either way a Sandbox never outlives its Branch. A Sandbox may also
preserve its working tree across a restart on a hibernating provider.
_Avoid_: VM, container, box (the backend's words — and the VM isn't even the only
backing now); workspace (the UI label for a Repo); using "sandbox" to mean the
Branch itself; calling its contents "never durable" (true only for the Vercel VM).

**Sandbox Provider**:
The swappable backend that creates and reconnects Sandboxes. There are now
**two**: the hosted **Vercel** backend (a remote VM, hibernating) and the desktop
**local** backend (a git worktree per Branch off one shared clone — one object
store per repo, one checkout per ref; non-hibernating), selected at build time
by `SANDBOX_BACKEND`.
The surface is split into a **portable core**
(the operations every conceivable backend can honor) and an optional
**Hibernation** capability: freezing a Sandbox's filesystem when it goes idle and
thawing it on return, which is what preserves uncommitted work across a _restart_.
A provider that can't hibernate is not disqualified — it degrades to recloning the
repo fresh, so on it a Sandbox Restart fails loud and Recreate (delete + re-add)
is the live rebuild path. The local backend is the first real second provider,
the event ADR 0003 named as the trigger that justifies paying for backend
selection. The split exists so the seam tells the truth about what a second
provider actually costs.
_Avoid_: driver, adapter (casual); naming a specific SDK; treating Hibernation as
guaranteed (it is an optional capability, not part of the core); saying "Vercel,
the only one" (a second backend has landed).

**Dev Server Port**:
The port the Repo's one target project serves its preview on — a logical name,
not an address. Each Sandbox maps it to the port the dev server is actually
reachable on (identity on a backend with its own network namespace, a per-Branch
allocated port on the local backend). How the real value reaches the dev script
is per-backend: hosted hands it as `$SCREENPLAY_PORT` (and `$PORT`) and expects
the script to forward it; the local backend runs the script under **portless**
pinned to the allocated port, so the script gets the standard `$PORT` (or a
recognized framework flag) and no Screenplay-specific var exists. The local
backend ensures portless's proxy daemon itself (auto-started unprivileged
before every dev launch — never a manual user prerequisite) and surfaces the
named `<branch>.<app>.localhost` route it registers as the Branch's "Open
stable URL". The dev script lives in the Repo's config, not the repo's
source. A dev server that never binds its assigned port is unsupported for
multi-Branch desktop previews and fails loud, not with a dead iframe.
_Avoid_: assuming the configured number is the bound port; `$SCREENPLAY_PORT`
on the local backend (it is hosted-only now); multiple preview targets per Repo
(a Repo targets one project — point a second Repo at the same source for
another project); asking users to modify their repo's own scripts.

**Thumbnail Capturer**:
The swappable seam that turns a **single ready frame's** preview URL into a raw
screenshot buffer — headless Chromium (puppeteer) hosted, the Tauri webview on
desktop. A Room's thumbnail is no longer one screenshot of a whole-canvas render:
each Iframe Layer is captured on its own once its live preview is ready, so a
still-booting dev server no longer degrades the whole capture. Only the
screenshot step lives behind the seam; the surrounding orchestration — resize,
store, and Thumbnail Manifest update — is shared across capturers, so a second
capturer stays a drop-in (`lib/thumbnail/`).
_Avoid_: screenshotter, renderer; the whole-canvas render page (removed — there
is no single render URL anymore); folding the resize/store/manifest steps into
the capturer (they are shared orchestration, not the seam).

**Frame Capture**:
A single Iframe Layer's stored preview screenshot, keyed by the layer and
refreshed when that frame's live preview is both ready and changed since last
time. The unit the Thumbnail Capturer produces and the Thumbnail Manifest
positions — captured from the live canvas's own frame, not a separate render
path.
_Avoid_: tile, snapshot (reserve "snapshot" for the Manifest as a whole);
re-rendering the frame in a headless pass divorced from what the canvas shows.

**Thumbnail Manifest**:
The per-Room snapshot a thumbnail is **composed from at display time**, in place
of a single baked image: each Iframe Layer's placement (rect + label) and its
Branch's color, paired with that layer's most recent Frame Capture (absent until
the preview has been captured ready). A frame with no capture yet renders as a
**branch-tinted placeholder rect**, so a Room whose dev servers are still booting
degrades to positioned, identifiable blanks rather than a broken screenshot. The
homescreen grid reads the Manifest as a cheap per-Room record and assembles the
composite itself.
_Avoid_: thumbnail (the Manifest is the data the thumbnail is drawn from, not the
image); treating it as live canvas state (it is a denormalized capture-time
snapshot, deliberately not in the Y.Doc).

**Multi-user surface**:
Everything the hosted, multi-tenant app needs to let many people share one Room
and that the **local desktop build excludes** (PRD #404): GitHub OAuth login
(`session`/`account`/`verification`) and the login screen; `room_member`
membership and sharing; Yjs **awareness/presence** (remote cursors, the follow
toolbar); and the _persisted_ comment thread (`thread`/`comment`/`thread_read` —
pins, replies, read-state, co-view). The element/selection
**reference-to-agent** path that rides on the same comment UI — anchoring an
element or doc text span and hitting "Send to Claude", which injects the
reference into a Chat Session and persists nothing — is single-user and **kept**;
only the composer's "Comment" (persist) button is dropped on the local build. It
is gated by one build-time switch, `NEXT_PUBLIC_SCREENPLAY_LOCAL` (`@/lib/local-mode`'s
`isLocalBuild`) — a sibling of the per-seam backend flags (`SANDBOX_BACKEND`,
`SCREENPLAY_DB`, `NEXT_PUBLIC_YJS_HOST`), but gating an app-level _capability_,
not a swappable backend. On the local build `canAccess`/`room_member` collapse
to a single seeded local user (`@/lib/local-user`), the app opens straight into
the work with no login, and the excluded tables aren't even created on disk: the
schema is split (`lib/db/schema-core.ts` vs `lib/db/schema-multiuser.ts`) and the
desktop PGlite backend migrates from the core half alone (`drizzle/local`). The
hosted build keeps the whole surface, unchanged. Re-enabling multi-tenant
operation on the local build is explicitly out of scope; ADR 0002's egress
key-brokering / firewall trust boundary dissolves on the host and is not ported.
_Avoid_: "auth" alone (it's more than login — it's the whole access model);
implying presence is _deleted_ (the Yjs awareness plumbing the editor needs
stays; the local build simply has one peer, so there are no others to show);
saying "comments are gone" flatly (the persisted thread is, but the
anchor-and-send-to-agent reference path survives).

**GitHub Connection** (local build):
The local desktop build's **optional, on-demand GitHub API access** (PRD #428)
— explicitly _not_ the multi-tenant login #417 stripped (no session, no
`room_member`, no login gate; the app still opens as the single seeded local
user). The existing `getGitHubToken()` seam resolves through one fixed priority
order on the local build (`lib/github-local/`): (1) the host **`gh` CLI**'s
token when installed and authenticated — the zero-config path; (2) a **device
flow** token the user authorized on demand ("Connect GitHub"), kept in the OS
keychain with a `kv_store` fallback behind one `TokenStore` interface; (3)
`null`, which keeps meaning "GitHub API features dark". A token lights up repo
listing, Branch-via-API, PRs, and Branch naming at their unchanged call sites;
no token never blocks adding a Repo — the **no-auth floor** (add by clone URL
or local folder) rides host git auth (#416). See ADR 0008.
_Avoid_: "login"/"auth" for this (it is API access only); conflating
disconnect (clears the stored device-flow token) with logging out of `gh` (the
app never touches the CLI's own auth).

**Dev Server Restart**:
Bouncing the `devScript` process (and its bridge proxy) inside the _existing_
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
working, since it cycles the VM mid-turn. **Exists only where Hibernation does**:
on a non-hibernating provider (the desktop local backend) the action is hidden
entirely — there is no VM to cycle, so the offered restarts there are Dev Server
Restart and Recreate.
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

**Layer**:
The umbrella for the two kinds of content a Group's Member references — an **Iframe
Layer** or a **Markdown Layer**. Both are positioned in world space, selectable,
draggable (group-move + merge) and resizable on the canvas; they differ only in
content. The shared frame around either is the **Layer Shell**, and the shared
gesture machinery (`useLayerDrag`, `useLayerResize`) and the common
selection/position/drag/resize props are named for the Layer, not for one of its
kinds.
_Avoid_: using "Iframe Layer" as the generic (it is one kind, not the umbrella);
naming shared layer machinery `*IframeLayer*` (it serves both kinds).

**Iframe Layer**:
A live preview pane on the canvas rendering a sandbox dev-server URL (or a blank
frame). Belongs to exactly one Group.
_Avoid_: screen, window, panel; "frame" is the UI label only.

**Markdown Layer** (Document):
A rich-text layer whose body is a TipTap-owned `Y.XmlFragment` keyed
`markdown-layer-{id}`. Its title is mirrored into both the fragment heading and
the layer's collection record.
_Avoid_: note, text layer.

**Layer Shell**:
The canvas frame that wraps either Layer kind: it owns the world-space container,
the selection wiring, the drag (group-move / merge routing plus the deferred
click-to-select), the resize handles, and the LayerTitleBar. An Iframe Layer and a
Markdown Layer plug in as **content adapters** — the shell renders the frame, the
adapter renders what's inside (the live preview, or the TipTap document) and its
content-specific toolbar. Two adapters make the seam real (one adapter is a
hypothetical seam, two is a real one). The Shell absorbs what was copy-pasted across
the two layer components: the `handleDrag` selection routing, the
`selectedOnPointerDown` deferred select, the group-label drag handlers, and the
resize wiring.
_Avoid_: layer wrapper (casual); putting content-specific behaviour (dev-server
probe, editor, route picker, inline-comment bubble) in the Shell — that stays in the
adapter; standing up a third Shell per future kind (one Shell, N content adapters).

**Chat Session**:
The _identity_ of a chat tab (id, label, target). The conversation itself —
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
backing terminal server's websocket directly (no iframe). Its identity — id,
label, target Branch — is persisted **per User** in Postgres (the `terminalTab`
table) and reattaches on reload so a still-running shell survives a page refresh;
its _scrollback_ is never persisted and dies with the sandbox. The **transport
behind it is provider-dependent**, chosen at build time by `SANDBOX_BACKEND` and
hidden behind one unchanged client + wire codec (`ttyd-protocol.ts`): the hosted
Vercel backend runs an in-sandbox **ttyd** daemon over a `domain(port)` URL and
reattaches via a per-tab in-sandbox **tmux session**; the desktop local
backend runs a **node-pty** process in the sidecar over a localhost WebSocket
(`lib/terminal/local/`) and reattaches because that PTY simply outlives the
socket — no tmux, no public URL. Explicitly **not** a Chat Session: nothing here
enters the chat-store, the conversation tables, or the Y.Doc, and it is modeled
by its own `TerminalTabData`, never `ChatSessionData`.
_Avoid_: chat tab; terminal session (reserve "tmux session" for the hosted
backend's in-sandbox multiplexer, "Terminal Tab" for the UI surface); harness
(that's the tool the operator runs _inside_ the tab — see Engine for why the
app's own loop isn't one); calling the transport "ttyd" unqualified (it's ttyd on
Vercel, node-pty on the desktop build).

**Tab Pool**:
The per-Chat-Target set of open tabs in the agent panel — a target's open Chat
Sessions plus, for an agent (Branch) target, its Terminal Tabs — treated as one
pool. **Invariant: while the target lives, its pool is never empty.** Closing the
last tab respawns the user's **preferred default tab kind** (chat or terminal for an
agent target; always a chat for a doc target), so the panel is never left blank.
Agent chats and doc chats are **separate pools** — filtered by `branchId` vs
`markdownLayerId`, since every doc chat shares an undefined `agentId` and would
otherwise collide — and a doc target has no terminals. The close decision is a
**pure function** (`resolveTabClose`: pool + closing tab → what survives, the next
selection, and whether to respawn); the component applies the effects (server
actions, killing the tmux/PTY session, the selection write). Mirrors the Gesture
Intent shape: decide purely, apply at the call site.
_Avoid_: tab bar / tab list (that's the rendered strip; the Pool is the model behind
it); mixing the agent and doc pools; treating an empty pool as a valid resting state
for a live target; folding the respawn effects into the decision (it returns whether
to respawn; the component performs it).

**Tool**:
A capability the model can call during a chat turn (read*file, run_command,
read_document, …). Each Tool's availability is scoped by Chat Target.
\_Avoid*: function, action (action = server action), command.

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
implementations sit behind the seam — a default **in-process** engine
(which runs `streamText` itself but now _translates_: it rebuilds its model
input from ACP-native history and emits ACP updates) and an **external** engine
that drives a generic ACP agent via the session module and passes its
`session/update`s through nearly natively. The external engine's production
backing, `SpawnAcpSessionFactory`, spawns the user's installed CLI's ACP adapter
as a host subprocess over stdio (`cwd` = the Branch's worktree, on the CLI's own
auth), with the spawn argv/env resolved by a harness → ACP launch resolver
(`harnesses/acp-launch.ts`) — the ACP sibling of the terminal's
`resolveLaunchArgv`. Both speak ACP at the seam; they are
named for _where the model runs_ (in-process vs. a separate external agent), not
for the protocol. Which _engine_ runs is a per-deployment choice
(`AGENT_ENGINE=in-process|external`, default in-process — `engine-select.ts`), not a
per-Chat-Session column; but which **Harness backs the external engine _is_ a
per-Chat-Session choice** — the chat's stored model id, when it carries the
`harness:<key>` form, names the Harness whose ACP adapter is spawned (so the model
dropdown selects the agent backing on desktop; `SCREENPLAY_ACP_HARNESS` is only the
default for a chat with no stored id). An engine that can't honor a capability (e.g.
prompt-cache usage) degrades via the `supports*` type guard. The shared contract
test pins both engines to the _same_ observable outcome for the same turn, so the
swap is honest. The server is the sole ACP peer;
browsers render the server's ACP-shaped broadcast over the Y.Doc and never open
an ACP connection (single ACP session in → N browsers out). What the app owns is
the **ACP seam itself** — the contract, the multiplayer broadcast, the persistence
— _not_ the model loop behind it: the in-process engine is screenplay's own loop,
while the external engine's backing is deliberately someone else's tool (a detected
**Harness** — Claude Code, Codex). The owned thing is the protocol boundary, never a
bespoke wire format. See ADR 0006 for the seam, the multiplayer-brokering principle,
and the swap-to-real-client design goal.
_Avoid_: saying the Engine is "never a harness" flatly (the external engine's
backing _is_ a Harness — what's owned is the ACP seam, not the loop); runtime;
treating each browser as an ACP client (breaks multiplayer).

**Harness** (BYO Coding CLI):
An external, bring-your-own coding agent CLI — Claude Code, Codex, aider —
someone else's tool we install (or detect) and step out of the way for, as
opposed to screenplay's owned in-process Agent Loop. **One descriptor, one key per
CLI** (`lib/agent/harnesses/`): the single catalog key (`claude-code`) is the
`SANDBOX_HARNESSES` token, the Terminal Tab key, _and_ the `harness:<key>` model
id — there is no separate adapter-key namespace. A Harness is consumed two ways
off that one descriptor: run **interactively inside a Terminal Tab**, or spawned
as the **ACP backing of the external Engine** to drive agent chat (its
`acpAdapter` argv). Both read the same entry; the descriptor also carries the
`hostBinary` the desktop detector probes and an optional **curated model list**
(`models` + `defaultModelId`) — the per-Harness set of models the desktop chat
dropdown lists nested under the Harness, each carried as `harness:<key>:<modelId>`
(the model axis refines _which model_ the Harness runs; a bare `harness:<key>`
still means "the Harness's own default"). A Harness with no `models` degrades to
that single default entry. The stored id is the **single home** for the choice
(no parallel column): the codec splits the remainder after the `harness:` prefix
on its _first_ colon, so the colon-free, comma-free `key` is always recovered
whole and the opaque `modelId` survives intact even when it holds colons
(`opus[1m]`, `openrouter:anthropic/claude:beta`); a `provider:<model>` id never
decodes as a Harness (`harnesses/model-id.ts`). The dropdown list is the
descriptor's **curated floor** plus a discover-once-and-cached live augment (the
**Harness model catalog**, below; #527). _How_ the chosen model is applied is the
adapter's call: an ACP-native adapter (claude-code) sets it in-session via ACP's
`unstable_setSessionModel`; a spawn-env adapter (codex, which advertises no
models) takes it at launch as `--model <id>`. See ADR 0011 for the capability
binding and the `harness:<key>:<modelId>` wire format.
_Which Harnesses are offered is resolved per backend by the **Harness
Availability** seam_ (below) — never a single hardcoded list. On the hosted
backend a Harness is offered only when its broker model provider is configured
_and_ header-brokerable (`egress()` non-null) and is installed into the sandbox
(ADR 0002's firewall trust boundary); on the desktop backend it is offered when
its `hostBinary` is present on the host PATH (the CLI runs on its own login, no
broker, no install).
_Avoid_: engine (the in-process loop is owned; a Harness only ever _backs_ the
external engine, it is not the seam); saying a Harness "produces no messages"
flatly (true of its Terminal Tab role — scrollback dies with the sandbox — but
when it backs the external Engine it yields ACP updates, runs, and Y.Doc state
like any engine backing); a per-CLI second key for the ACP adapter (folded into
the one descriptor).

**Harness Availability**:
The per-backend seam that answers "which Harnesses can this deployment offer,
and in what state" — folded over the **one** Harness catalog so the model
dropdown, the Terminal-Tab new-tab picker, and the external-Engine backing all
read the same answer instead of three divergent lists. Two resolvers behind it,
selected by the build-time backend the way `SandboxProvider` is (ADR 0003): the
hosted resolver returns `SANDBOX_HARNESSES ∩ broker-egress`; the desktop resolver
**detects** installed CLIs by probing each descriptor's `hostBinary` in the host
sidecar. Returns a per-Harness **status**, not a bare `{key,label}` — installed
today, with room for `authenticated` later (the auth-aware pass surfaced in a
homescreen Settings surface, deferred). The desktop model fold (`harnessModels`)
gives **each** detected chat-capable Harness its own dropdown heading with its
curated models nested as `harness:<key>:<modelId>` entries (and the first
Harness's `defaultModelId` as the overall desktop default), replacing the single
"Installed agents" heading the pre-model-selection fold drew; the hosted
`provider:` enumeration is untouched. The availability seam only _lists_ a
Harness and its models; **applying** a chosen model is the live session's job and
is per-adapter — ACP-native in-session set vs. spawn `--model` (ADR 0011).
Listing is gated on **presence**, never on auth: a detected-but-unauthenticated
Harness still lists and fails loud at turn time with the CLI's own login message,
mirroring how the hosted side lists on provider-_configured_, not
provider-_verified_; a stale per-Harness model is likewise never pre-filtered —
it lists, and reconciles to the Harness default only if the turn rejects it
(ADR 0011).
_Avoid_: detector/registry (casual); a separate availability path per consumer
(the whole point is one fold, many consumers); gating the list on auth state
(presence lists; auth is surfaced, not pre-filtered).

**Harness model catalog**:
The source the desktop model fold (`harnessModels`) reads each Harness's dropdown
list from — its **curated floor** (the descriptor's `models`, authoritative) plus
a **discover-once-and-cached** live augment (`lib/agent/harnesses/model-catalog.ts`).
Mirrors the model-provider `discover()` cache and the desktop resolver's
once-per-launch memoization: discovery runs at most once per app launch, a second
`list()` reuses it, and an unreachable/empty source degrades to the curated floor
— the same staleness contract as `hostBinary` detection (a model added to a
subscription shows up after a restart, never via a mid-session re-probe). Spike
#523 inverted the original "discover live `availableModels` as the source"
framing: enumeration is stateless and can't open a session, and the advertised set
under-delivers (claude-code advertises 3 buckets, codex none) — all ⊆ a sensible
curated set. So the curated floor is **authoritative** and discovery is **purely
additive** (a discovered modelId only appends a row the floor doesn't name).
Today the production discovery is the deferred session-open augment and advertises
nothing, so the dropdown is identical to the static-list slice.
_Avoid_: "discover the dropdown's models" framing (curated floor is the source,
discovery augments); a live re-probe on the dropdown path (it's stateless — no
session); reordering/relabelling a curated entry a discovery also advertises (the
floor wins on id collisions).

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

**Canvas Gesture**:
The in-flight interaction stage of the Canvas — the middle of the triad **derive
→ gesture → commit** (Canvas Layout derives, Canvas Operation commits). A
React-free, Yjs-free state machine (`lib/canvas/gesture.ts`) that reduces pointer
and key events against a **context snapshotted at gesture start** into the next
gesture state plus a **Gesture Preview** (snap guides, merge rects, pop-out flag,
marquee rect), and on release a **Gesture Intent**. One discriminated-union state
so **exactly one gesture is active at a time** by construction — covering reorder
(in-flow and meta-key pop-out), group move with merge-snap, edge/center move-snap,
gap-resize, marquee, and device-resize. Its Preview feeds `deriveCanvasLayout`
(which already takes the in-flight slice); it never derives geometry itself, and it
never touches the Y.Doc — it emits a Gesture Intent the component applies. The Snap
math it calls already lives behind its own seam (see **Snap**); the Canvas Gesture
module is the orchestration around it that previously had no home (~700 lines smeared
across `canvas.tsx`).
_Avoid_: handler, drag state (casual); a separate machine per gesture (one FSM
enforces the single-active invariant); mutating the Y.Doc from the gesture (it emits
a Gesture Intent, never calls a Canvas Operation itself); recomputing layout inside
the gesture (it emits a Preview that `deriveCanvasLayout` consumes).

**Gesture Intent**:
The descriptive result a completed Canvas Gesture emits — a discriminated union
(`moveBy`, `reorderMember`, `mergeGroups`, `popOutToNewGroup`, `resizeLayer`,
`setGroupGap`, `marqueeSelect`, …) that **describes** the committed change without
performing it. The component applies each Intent: canvas-mutating ones through a
Canvas Operation, selection-only ones (`marqueeSelect`) through local selection
state. Because the gesture stops at the Intent, the Intent **is** the gesture
module's test assertion — feed a synthetic pointer/key sequence, assert the Intent
and the Snap Guides against plain values.
_Avoid_: command, mutation (casual); conflating it with a Canvas Operation (the
Intent describes, the Operation performs); assuming every Intent is a Y.Doc write
(`marqueeSelect` changes selection only).

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
