# apps/app — Canvas & Agent Runtime

Domain language for the screenplay web app: the collaborative canvas (the
spatial, real-time surface of a room and the layers, groups, and chat tabs on
it, held in the room's Y.Doc) and the agent runtime that drives it (chat
targets, tools, runs). This file names those concepts so code and conversation
use the same words.

**Naming convention — code = concept, UI = label.** Code uses the structural
term; the UI shows a friendlier label, and the two are deliberately decoupled.
The three nested concepts are **Room** (shown to users as "Canvas") → **Repo**
(shown as "Repository") → **Branch** (shown as "Workspace"). Code — types, files,
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
_Shown to users as_: "Canvas". It is what the UI treats as the project (#880):
its chat works like a project chat, its Workspaces like threads, and its
canvas-wide setup lives in Canvas settings.
_Avoid_: project as a UI word (it once labelled a Repo; since #880 the UI uses
neither); "canvas" in code
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
is the code identifier everywhere it denotes this entity. Its run settings are
edited in Canvas settings › Repositories (#883). Its short name is its label
(`name`) when set, else the repository's name (`repoShortName`).
_Shown to users as_: "Repository" (it read "Project" until #883).
_Avoid_ as a code identifier: workspace (collides with the `@workspace/ui`
package and the everyday meaning), project; "agent" (an agent is the AI, not a
Repo).

**Repo Config** (Repository preset):
A saved, reusable bundle of a repo's run settings — setup/dev scripts, Dev
Server Port (hosted) or files-to-copy globs (desktop), env vars, default Iframe
Layer size, and system prompt. Sourced three ways through one shared picker — a
GitHub pick, a clone URL, or (desktop only) a **local folder** — and identified
by its git **remote** whenever one is detectable (`repoFullName` / `cloneUrl`),
falling back to the folder's path only when there is no remote; it carries an
optional `localPath` acquisition hint (the remote names it, the path is what's
opened — ADR 0013) and an optional `name` so one repo can carry several (e.g.
"web", "api" across a monorepo). That `name` is **deliberately seeded into the
live Repo's display name** (`RepoData.name`) at add time: one GitHub repo may be
added to a single Room more than once as distinct Repos (each from a different
preset), and the preset name is what tells those instances apart in the sidebar
— not accidental coupling, the whole reason the field exists. User-private and
stored encrypted in KV
(`user-workspace-configs:{userId}`), **never** in a Room's Y.Doc. Its sole job
is to **seed** a live Repo when that repo is added to a Room: the copy is
**one-way** — afterwards the Repo (`RepoData`) and the preset diverge, and
editing either never touches the other. Managed on the homescreen Settings
surface; `RepoConfig` is the code identifier everywhere. The user-facing label
tracks the Repo's own label, so it was renamed with it (#883).
_Shown to users as_: "Repository preset".
_Avoid_: template (implies scaffolding or cloning the repo's source — a preset
carries only run settings, not code); calling the live in-Room Repo settings a
"preset" (the preset is the reusable seed, `RepoData` is the instance it seeds);
bare "config" for the Repo entity itself (that entity is the Repo / `RepoData`).

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
error**, never silently shares or steals a checkout. A Branch has exactly one
chat, its **Workspace Chat** (#1315). Rendered in the sidebar by
its branch's name. Lives in the room's Y.Doc as the `branches` collection
(`BranchData`).
_Shown to users as_: "Workspace".
_Avoid_: agent (reserve for the AI runtime — see Agent below); sandbox, run;
calling one-Branch-per-ref a domain invariant (it is the desktop storage model
surfacing, absent on the hosted backend) — and equally, assuming the hosted
backend's no-limit applies on desktop.

**Workspace State** (`@/lib/branch/workspace-state`, #1247):
What a Branch shows about itself anywhere it appears: its **label**, its
**status line** (setting up, Agent working, Needs you, Ready, Stopped, Done, or
the failed step), its **section** in the Chats menu, and whether it
**needs you**. A pure function of the Branch plus the Room's Chat Sessions (a
turn in flight) and plans (one waiting for approval). `useWorkspaceStates`
reads those once from the Room doc and hands every caller a lookup, so callers
pass the Branch, never the facts: mentions, the hover card and the Getting
started checklist read the same state for the same Workspace.
_Avoid_: building `{ agentWorking, planPending }` at a call site; defaulting a
mention to "not working"; "agent status" (a Branch has no status field of its
own; its working state comes from its chats).

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

**Room Access** (`@/lib/room-access`, #900):
The one way a server entry point turns (session, Room) into room-scoped
capabilities: `openRoom(roomId)` resolves the session, requires membership
(`room_member` on the hosted build; always the single local user on the local
build, see **Multi-user surface**), and hands back a handle whose
`mutateDoc`/`readDoc` are the only room-doc access the caller gets. A
non-member is rejected before anything touches the Room. Every server action,
route and page that reads or writes a room doc goes through it (#904, #906).
Route handlers use `openRoomForRoute(roomId, chatId?)`, which returns the 401
or 403 response instead of throwing and, given a `chatId`, refuses a chat
recorded under another Room. Code working on a member's behalf is handed the
opened Room (a `RoomDoc`, or a read-only `RoomReader`) rather than a
`roomId`: an agent turn's tools and naming get it from the agent route, and the
comment doorbells, PR create, thumbnail capture and Room teardown take it from
their caller. The one session-less opener, `readRoomForServer`, is read only
and serves the server-triggered thumbnail layout rebuild. The raw
`mutateRoomDoc`/`readRoomDoc` helpers are private to Room Access, and
`room-access-guard.test.ts` fails if anything else imports them. See ADR 0017.
_Avoid_: checking membership ad hoc in a new action; passing a bare `roomId` to
code that touches the room doc; "permissions" (Room Access is membership, not
per-comment or per-role rules).

**Comments** (`@/lib/comments`, #911):
The server module that owns comment threads: it opens the thread's Room through
**Room Access**, enforces the same `comment-permissions` rules the thread card
reads (any member replies and resolves; only a comment's author edits or
deletes it; only a thread's starter deletes the thread; every other attempt
fails with one `NotYourCommentError`), gates the local build in one place,
creates a thread with its first comment in one SQL statement, and rings the
comment doorbells. Listing never writes. `comments-actions.ts` is transport
only.
_Avoid_: permission checks or `isLocalBuild` in the comment actions.

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
_Avoid_: "login"/"auth" for the _Connection itself_ (it is API access only —
the token layer, not a user session). Keep that distinct from the **`gh` CLI's
own auth**, a lower layer the app may help you _set up_ (install `gh`, run its
sign-in) but never tears down: disconnect clears only the app's stored
device-flow token, and the app never runs `gh auth logout` — a `gh` login is
yours, used outside the app too, so the help is one-directional (in, never out).

**Dev Server Restart**:
Bouncing the `devScript` process (and its bridge proxy) inside the _existing_
Sandbox — no VM cycle, filesystem and working tree untouched. The cheap, common
recovery for a wedged preview, and the only restart that stays available while
the Agent is working, so a broken preview can be fixed mid-turn. The Agent
can run it itself (`restart_dev_server`), next to `read_dev_server_logs` for
the log the Logs panel tails (`lib/agent/dev-server-tools.ts`; a desktop
harness reaches both over the MCP route).
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
A reference (`{ kind, id }`) from a Group to the Iframe Layer, Markdown Layer or
Mockup Layer it contains.
_Avoid_: child, item.

**Layer**:
The umbrella for the kinds of content a Group's Member references — an **Iframe
Layer**, a **Markdown Layer** or a **Mockup Layer**. All are positioned in world space, selectable,
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
the layer's collection record. A Document a chat made records that chat as
its **owner** (`ownerChatId`, #1314): only the owner edits it with tools, and
it shows the owner's name by the Group label rule. One a person made has no
owner and no name. Every chat reads every Document.
_Avoid_: note, text layer; "document chat" (Documents are not Chat Targets
since #1314).

**Mockup Layer** (Mockup):
A static HTML page a chat wrote, shown on the canvas with no Sandbox
(#1309). Its page is a `Y.Text` keyed `mockup-layer-{id}` beside its record
(`MockupLayerData`: size, title, the `ownerChatId` of the chat that made
it, and a **Mockup Status** of `set-aside`, `current` or `built` (#1310),
which anyone on the canvas or its owning chat sets; nothing else reads it, and
an unset status reads as `current`).
It renders in an `<iframe srcdoc sandbox="allow-scripts">` with no
`allow-same-origin` and a Content Security Policy that blocks the network, so
the page can never reach the app, its cookies or the canvas, and has no
browser chrome. A Workspace chat creates one with `create_mockup` and rewrites
its own (page, title or status) with `update_mockup`; a new one joins the Group of the chat's latest
Mockup, else of its Workspace's frames. Like a chat-made Document, it names
its chat's Workspace by the Group label rule. Not a Chat Target. Canvas selection carries it
in the Markdown Layer Set: selection only tells frames apart from the other
kinds.
_Avoid_: prototype (that's a running Workspace), wireframe, design layer;
"artifact".

**Layer Shell**:
The canvas frame that wraps every Layer kind: it owns the world-space container,
the selection wiring, the drag (group-move / merge routing plus the deferred
click-to-select), the resize handles, and the LayerTitleBar. An Iframe Layer and a
Markdown Layer and a Mockup Layer plug in as **content adapters** — the shell renders the frame, the
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

**Workspace Chat** (#1315, spec #1308):
A Branch's one Chat Session, and the only chat that changes its code. Every
Branch gets it when it starts, whatever the default tab kind, and a Branch never
gets a second: more parallel work means more Branches. It is always open (no
close) and is where every prompt to the Branch lands, busy
or not (a message mid-turn steers or queues): the Coordinator's
`send_to_workspace`, comment requests, Reply in chat on its Documents, Ask for a
knob. Other chats read its code (`read_code_file`, `search_code`,
`find_code_files`) and never write it. The rule is one pure function,
`workspaceChatId` in `lib/chat/workspace-chat` — the newest Chat Session on the
Branch, closed or not — so the panel, the prompt dispatch, the Coordinator's
delegation and the stream route agree. When the first message titles the
Workspace, the chat takes the same title: a Workspace and its chat share a name,
which is why frames and Documents show the Workspace's title. A Branch from
before #1315 can hold several chats; the others are its **earlier chats**:
kept, but the panel has no way to open them (no Chat history button). They
never send: if a remembered selection lands on
one, the panel shows it read-only with Open chat in place of the composer, and
the stream route refuses them with `earlier_chat`.
_Avoid_: "new chat" on a Branch that has one; bumping a busy Branch to a fresh
chat; a second rule for "which chat" at a call site.

**Chat Session Writes**:
The single small owner of the three thin **Canvas Operation** wrappers for Chat
Session identity — `addChatSession`, `updateChatSession`, `removeChatSession`
(`useChatSessionWrites`, PRD #588). They used to be root-level `useCallback`
pass-throughs the composition root only defined to thread straight back into Tab
Pool, Branch Intake, Branch Actions, and the Chat Sync owner; now those consumers read the verbs from this one owner. Like the rest of the
canvas decomposition it is the **React binding, not a new write path**: every
write routes through the Canvas Operation seam (`ops`, ADR 0001), never the Y.Doc
directly (the field write is `ops.patch`; add / remove are the meaning-bearing
`ops` verbs).
_Avoid_: redefining these wrappers as facades on the composition root (the
consumers read them from the owner); writing a Chat Session record outside `ops`.

**Chat Sync**:
The single owner of the chat-store ↔ Y.Doc synchronization effects
(`useChatSync`, PRD #588; run by `useChatTabs` for the Canvas and the player) — the three sync effects that used to sit among the
orphan effects on the composition root, sharing one home because they all
reconcile the client chat-store against the room's synced chat state: the
**history load** (load past messages for every Chat Session so other clients see
history for chats they haven't opened — Terminal Tabs can't reach it, they're
never in `chatSessions`); the **streaming-heal hydration** (the first time
`chatSessions` has entries, mirror each storage-`streaming` chat into the client
store and ask the heal endpoint to verify the run is still live, unsticking a
spinner whose `chat-stream-end` was missed — moved here from **Sandbox
Reconnect**, since it is chat-store hydration, not Sandbox lifecycle); and the
**broadcast handling** (`useChatStreamEvents` → `chatStore.handleBroadcastEvent`,
mirroring the streaming signals into the Chat Session so late joiners see them).
It is the **React effects, not a new write path**: storage writes go through the
injected `updateChatSession` (a Chat Session Writes wrapper, ADR 0001), the
chat-store calls are the existing `chatStore` API. Names are not synced here:
**the server writes names, clients observe** (#910). Turn Launch writes a new
chat's label, the Workspace's title (only when it has none) and the Branch's
auto-named ref and flag to the room doc, then renames the git branch itself
(`lib/agent/auto-naming.ts`), exactly once whatever surfaces or clients are
open; no browser applies a rename. The doc write is the claim: one transaction
checks the Branch is still auto-named and flips the flag, so racing turns can't
both rename it, and a git refusal puts the Branch back unless someone renamed it
again meanwhile. Branch Intake still asks `/api/agent/generate-names` for names
when it creates prompt-seeded Branches; that picks a new Branch's name up front
and is not auto-naming. See ADR 0017.
_Avoid_: putting these sync effects back on the composition root (instantiate the
owner); folding the streaming-heal back into Sandbox Reconnect (it is chat-store
hydration); a client-side rename callback or broadcast for auto-naming (it made
the git rename depend on which surfaces were mounted).

**Busy Indicator**:
The two spinners, split by what is busy. The **GripSpinner** (the 9-dot grid,
`components/grip-spinner.tsx`) means **LLM activity**: the agent thinking, a
reply streaming, a subagent (Task) running, a live chat tab. The **Spinner**
(`@workspace/ui/components/spinner`) means **progress**: loading, a request in
flight, a tool call running, a Sandbox booting.
_Avoid_: the grid for plain progress; `Spinner` or a raw `Loader2` for model
activity; a third spinner style.

**Chat Target**:
What a Chat Session talks to — a Branch's **sandbox**, or the whole **Room**
(see **Room Target**). A Document is not one: a Workspace chat writes
Documents with its own tools (#1314). The target decides the
system prompt and which Tools the model is given. On the client it is one
value, `ChatTarget` in `lib/chat/chat-target` (kinds `agent`, `room`), which the chat store maps to the wire target in one place. What the
Composer offers for each kind (skills, plan mode, element picking, placeholder,
empty state and starters) is one row of the capability table in
`lib/chat/chat-capabilities`; only the `agent` kind has a sandbox, so only it
turns on skills, plan mode and element picking.
_Avoid_: subject, destination.

**Room Target** (planned, wayfinder #856):
The Chat Target of a chat that works on the whole Room rather than one Branch
or document: it sees every Repo, Branch and Layer, arranges the Canvas, creates
Branches, and hands work to their agents through **Delegated Messages**. It
makes nothing itself: Documents, Mockups and code all come from a Branch's
chat, and only the Room Target arranges the Canvas or moves the view (#1316).
Its kind is `room`, named for its target like the other kinds, never for its role.
It works like a Claude Projects chat: a Room has **exactly one** Room Target
chat, it hears every Branch's turns (Branches are its threads), and it stays
quiet unless there is a result, a blocker or a decision.
_Shown to users as_: "Coordinator" (the chat panel's home, and the first crumb
of "Coordinator / <Workspace>" when a Workspace is open).
_Avoid_: coordinator or orchestrator as a code identifier (the UI word only);
"Canvas" as its UI name (Canvas is the Room); `canvas` as the kind (in code,
Canvas is the spatial surface only).

**Delegated Message**:
A message a Room Target chat sends into a Branch's Chat Session. It is an
ordinary turn in that chat that the user can read and take over, marked with
where it came from.
_Shown to users as_: one collapsed row, "Received a message from the
Coordinator", that expands to the message and links back to the sending chat
(like a Claude Projects thread receiving a coordinator message).
_Avoid_: forwarding, relay; hidden subagent work (delegation is always visible
in the Branch's own chat).

**User-turn projection**:
The one mapping from a user turn's wire text (persisted, or echoed live) to the
message the chat draws: the human's text without server markers or footers,
plus typed fields saying whether it is a Coordinator wake or a Delegated
Message and which preview elements it targets (`lib/agent/user-turn.ts`). The
server runs it, on reload and in every live echo (Turn Launch and taken
Steers), and the Composer hands the same shape for the sender's own message.
The UI reads those fields, never the markers, so a chat looks the same live
and after a reload.
_Avoid_: parsing markers in the UI.

**Steer**:
A user message sent into a Chat Session while its run is `running`. It joins
that run instead of starting a new one: it is **pending** until the Engine takes
it at a step boundary, and **taken** from then on, when it becomes an ordinary
user message where the Engine took it. A Steer the run never took starts the
next turn, or, when the user stopped the run, goes back to its sender. Whether a
run takes Steers is a fact about the run, recorded once its Engine's session
opens: yes on the in-process engine, on a Harness that queues prompts (Claude
Code) and on one that takes a steering request (Codex), no elsewhere. Until the run says yes, a mid-run message waits in
the client's queue.
_Shown to users as_: a dimmed user message, "Waiting for the agent", at the end
of the chat.
_Avoid_: queued message (the fallback where a chat can't steer), interrupt;
calling it a Delegated Message or a supersession (a Steer never supersedes the
run).

**Chat-Target selection**:
_Which_ Chat Target the agent panel shows — the other half of the panel model
from the Tab Pool, which owns the tabs _within_ a target. Owned by the
**Chat-Target controller** (`useChatTarget`, PRD #569): the selected agent /
chat, the **per-target memory** (last chat per agent; last agent per repo) that restores your place when you switch back, and the **pending-agent
readiness** (a just-created agent renders a LogProbe; selection flips to it once
its sandbox streams logs). The decisions are **pure functions** (`lib/chat/chat-target`,
the sibling of `lib/chat/tab-pool`): resolving the `ChatPanelTarget`, the
remembered-chat rule (the remembered chat if still open, else the first open
one), and the readiness transitions; the controller applies them and exposes the
resolved `target` plus selection verbs (`selectAgent`, `selectChat`,
`selectAgentChat`, …). The Tab Pool and Branch Intake controllers **compose with it**
for their selection side effects rather than poking raw setters. Same shape as
the Tab Pool: decide purely, apply at the call site (the call site is the
controller). With nothing selected the panel shows the Room: `ChatPanel` takes a
`room` target too and draws the Coordinator chat under the same header
(`ChatPanelHeader`, the one Collapse chat button) as a Workspace.
_Avoid_: conflating _which_ target is shown (this) with the tabs within it (Tab
Pool); reaching around the controller to set `selectedAgentId` / `selectedChatId`
directly; folding the pure decisions into the controller.

**Element Reference**:
How the Canvas points at an element or a Document passage. Owned by the
**Element Reference controller** (`useElementReference`, PRD #570): the
comment-mode placement state (`newCommentPos`, the open inline thread, the
inspect-hover overlay) and the two ref-backed registries the flow reads — the
per-Iframe-Layer DOM accessors and the per-Markdown-Layer TipTap editors, each
with a version counter so membership changes re-render their consumers — plus
the `replyInChat` verb, which hands a Document passage to **Chat Quote**. A
passage from a Document a chat owns goes to that chat, brought on screen; any
other goes to the foreground chat (#1314). The
old "anchor a doc text span and **Send to agent**" path (a fresh Document chat
sent from the comment composer, `lib/canvas/chat-reference`) was retired by
Reply in chat (#1243), after the frame element → owning-agent route (#570) went
the same way for the composer token flow (#621).
_Avoid_: sending from the comment composer; resurrecting the frame→agent send
path here instead of the composer token flow; calling this "comments" (the
persisted thread is its own surface).

**Chat Quote**:
A Document passage quoted into a chat's composer by **Reply in chat** (#1243),
the last button of a Document's selection toolbar on the web and desktop. It
lands in the composer of the Document's **owner** chat when a chat made it,
which the panel switches to (`quoteInto`, #1314); otherwise in the chat the
panel is **showing** — the Coordinator, or the active chat tab of a Workspace —
the way an element token lands
in the composer that picked it, and opens the panel if it's collapsed. The
quote sits above the input (the Document's title and line range, up to three
lines of the text, an X) and nothing is sent until the person sends; that send
carries it ahead of the typed text as `formatQuoteForChat` writes it. A chat
holds one quote, and a second Reply in chat replaces it. The bridge is the
`chatQuoteStore` singleton (`lib/chat-quote-store`): a chat on screen claims the
**foreground** (the newest claim wins), and a quote asked for while no chat is
on screen waits for the next chat to claim it.
_Avoid_: opening a fresh chat for the quote; sending it without the person's
own words; routing a hand-made Document's quote anywhere but the panel.

**Canvas View**:
What a member had selected and on screen when they sent a chat message, carried
to the model in a `Canvas view:` footer (`buildCanvasViewFooter`) so "this" or
"that frame" resolves to what they meant. The sender's own browser reads it at
send time (`canvasViewSource`, which the mounted Canvas registers), so on a
shared canvas each message carries its sender's view, under their name. It
names layers with ids: the selection (Groups first), then the frames, documents
and mockups with at least a quarter of them on screen, the largest first. The
chat never shows it. Both the Workspace and Coordinator prompts say "this"
means the selection first, then the screen.
_Avoid_: streaming the view as it changes; reading another member's presence to
fill it.

**Question Card**:
A question a chat asks with the `ask_question` Tool (#1312): one sentence, 2 to
4 options, optionally one marked recommended, drawn with shadcn's Questionnaire
(`@workspace/ui/components/questionnaire`). Every Chat Target has the Tool,
and a Harness reaches it over MCP. The call's arguments are the card; picking
an option sends its label as the person's next message through the chat's own
send path (`inputStore.send`), so it steers or queues like anything typed. The
in-process Engine ends the turn on the call. Nothing else is stored: a card is
answered once a user message follows it, and the option that message names is
the chosen one (`questionAnswers`, `lib/agent/question.ts`).
_Avoid_: a pending-tool-call row or a paused run for it (that's the plan gate);
answering on the person's behalf.

**Element Targeting**:
A Composer's one-shot crosshair **pick** of an element in one of its own
Branch's preview frames, inserted as an element token (PRD #616). The Composer
asks through `targetingStore.requestPick`; the Canvas is the sole fulfiller,
through the **Element Targeting controller** (`useElementTargeting`, #705), which
also draws the outline for a hovered element token. The decisions live in a
**React-free core** (`lib/canvas/element-targeting`): the **pick state machine**
(idle → armed → resolving → idle; a new request **supersedes** the pending pick,
resolving it `null`; cancel, a **miss**, or a **closed frame** (no DOM bridge)
resolve `null`; a late element-at-point answer for a pick already settled is
dropped, so every request settles exactly once), the hit-test against frame
layouts, the highlight sequencing (a newer hover supersedes an in-flight
resolve), and **one eligibility rule** — a frame is targetable iff its
`branchId` equals the pick's Branch id — from which the eligible frames, the
**dimmed** frames, and the per-Branch "has a targetable frame" publish (the
Composer's disabled target icon and tooltip) all derive. The pick key is a
**Branch id**: an agent chat holds it as its `sandboxId` (a sandbox-backed
agent's id is its Branch's id). Escape during an armed pick is the top step of
the shared Escape precedence (`resolveEscapeAction` → `cancel-target-pick`),
applied by **Canvas Keyboard**, not a private listener.
_Avoid_: putting pick state, the hit-test, or the eligibility filter back in
`canvas.tsx`; a second eligibility predicate for dimming or the publish; a
private Escape listener for the pick; calling it "inspect" or "comment" (those
are the comment-mode placement in **Element Reference**); cross-Branch targeting.

**Terminal Tab**:
A plain shell surfaced as a tab in the **Terminal Pane**, attached to one
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
New tabs never launch a **Harness** (#1343): harnesses run as the chat, and a
row saved earlier with a harness key keeps launching it until it's closed.
One module owns the list, **Terminal Tabs** (`useTerminalTabs`, #1265), and
nothing else changes it: its verbs are **open** (create the tab, save its row),
**close**, **rename**, and the two it runs itself, **restore** (the first-paint
seed from the server-fetched rows, then a re-fetch-and-**merge** — pure
`mergeRestoredTabs`, restored-first, never replace, so a tab opened mid-resolve
isn't dropped) and **prune** (a tab whose Branch is gone, over the pure
`partitionTerminalsByBranch`). **Close and prune guarantee the same three
things**: the tab leaves the pane, its row is deleted (it never comes back on
reload), and its session is killed (the shell and anything running in it stop).
Prune kills with no Sandbox to name, since the Sandbox went with the Branch: the
hosted tmux session died with it, and the desktop PTY, which lives in the
sidecar, is killed there. The row and the session sit behind one
`TerminalTabStore` adapter (`lib/terminal/tab-store.ts`): the server actions in
production, in memory in tests. The Tab Pool controller **composes it** (the way
it composes Chat-Target) for its verbs but never sets the list; Terminal Tabs
are not in the Tab Pool (#1341).
_Avoid_: chat tab; terminal session (reserve "tmux session" for the hosted
backend's in-sandbox multiplexer, "Terminal Tab" for the UI surface); harness
(that's the tool the operator runs _inside_ the tab — see Engine for why the
app's own loop isn't one); calling the transport "ttyd" unqualified (it's ttyd on
Vercel, node-pty on the desktop build).

**Terminal Pane**:
The resizable pane under a Workspace's chat (#1341, spec #1340): a stock
vertical Resizable whose terminals are **Dev server** first, always, then the
person's Terminal Tabs. Dev server is the Sandbox's log stream (the logs route,
a follow of the dev server log) shown read-only: it owns no process, has no
close or rename, and keeps the pane from ever emptying, so closing a shell
lands on its neighbour, then Dev server. Closed, the pane is a borderless
**footnote** under the composer naming the terminals; a name opens the pane on
it. Open, that line is the pane's tab strip with + and a hide caret. ⌃`, the
caret and dragging the divider to the bottom close it; a frame's Open logs
opens it on Dev server; nothing opens it by itself. Open/closed and height are
a **per-person pref** (localStorage, keyed by User), the same in every
Workspace; which terminal each Workspace shows is session state. The pure rules
live in `lib/chat/terminal-pane` (order, selection, the close fallback, the
pref's shape); the **Terminal Pane controller** (`useTerminalPaneController`)
holds the state; `TerminalPane` draws it. The Coordinator's panel has none.
_Avoid_: calling Dev server "logs" in UI (the frame menu's "Open logs" opens
it); a drawer (it's a split under the chat, not a sheet); putting the
Workspace's chat in the pane's tabs.

**Tab Pool**:
The per-Chat-Target set of open chats in the agent panel — a Branch's open
Chat Sessions, filtered by `branchId`. **Invariant: while the target lives, its
pool is never empty.** The **Workspace Chat** is always in its Branch's pool
(closed or not) and never closes, so in practice the pool only empties on a
Branch with no chat (one made terminal-first before #1315); closing its last
chat respawns the user's **preferred default tab kind**, and seeding a Branch
always makes its chat, with a terminal beside it when that is the default. The
panel shows no tab strip (#1341): the Workspace's chat fills it. Terminal Tabs left
the pool with #1341 and live in the **Terminal Pane**. The close decision is a
**pure function** (`resolveTabClose`: pool + closing chat → what survives, the
next selection, and whether to respawn); the **Tab Pool controller**
(`useTabPool`, PRD #563) applies the effects (the chat writes, Terminal Tabs'
open / close / rename, the selection write) and exposes the apply-side as plain
verbs — `open`, `close`, `remove`, `rename`, `reopen`, and the `seed` entry
Branch Intake calls. Mirrors the Gesture Intent shape: decide purely, apply at
the call site (the call site is the controller, not the component). The pool is
**per Branch and shared by the Canvas and the player**: the Chat Session half
and Chat Sync live in `useChatTabs`, which the player's chat host uses directly
and `useTabPool` composes (adding Terminal Tabs, the per-user default tab kind
and Chat-Target selection).
_Avoid_: tab bar / tab list (that's the rendered strip; the Pool is the model behind
it); treating an empty pool as a valid resting state
for a live target; folding the respawn effects into the decision (it returns whether
to respawn; the controller performs it); re-implementing tab creation outside the
controller (Branch Intake's seed step calls `useTabPool().seed`).

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
(`AGENT_ENGINE=in-process|external`, default in-process — `resolve-live-engine.ts`), not a
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

**Turn Launch**:
The module that starts one agent turn for a Chat Target
(`lib/agent/turn-launch.ts`), and the only place the start-up ordering lives:
resolve the Engine before any side effect, let the target prepare, resolve the
chat's plan, persist the user message, start the run, broadcast
`chat-stream-start` before the plan card flip and the user echo (so a client
joining mid-stream replays them), then, after the response, rename the git
branch the target claimed and drive the Engine turn, with the comment request
started before it and settled after it. A sandbox target writes the
first-message names to the room doc while preparing (see **Chat Sync**). It is
also the one way a plan is resolved: resuming from an explicit accept or reject
(the plan route) and the implicit reject of a follow-up message take the same
step. Each Chat Target kind supplies only its own setup (`turn-launch-live.ts`);
the stream and plan routes are auth, body parsing and HTTP mapping. The abort
watchdog stays at the Engine drive (ADR 0006).
Turn Launch also owns stopping a turn (`stopTurn`, what `/api/agent/stop`
calls) and the one decision about how an unfinished run reads, live and on
reload: a user stop records `aborted` (`STOPPED_RUN_STATUS`) and ends in a
"Stopped" marker, which `stopTurn` broadcasts live and the history route rebuilds
from the run's status; a run `superseded` by a plan decision or a new message
leaves nothing, since the next turn carries on. Neither is an error: every
Engine reports both as a `cancelled` stop, and the consumer shows no error
bubble. `stopTurn` records the status before the marker, and ends the stream
even when no run is active; the abort watchdog sees the status and aborts the
Engine. See ADR 0017.
_Avoid_: copying these steps into a route; resolving a plan outside Turn
Launch; a stop path that ends the stream without recording `aborted` (reload
would show a finished run).

**Harness** (BYO Coding CLI):
An external, bring-your-own coding agent CLI — Claude Code, Codex, aider —
someone else's tool we install (or detect) and step out of the way for, as
opposed to screenplay's owned in-process Agent Loop. **One descriptor, one key per
CLI** (`lib/agent/harnesses/`): the single catalog key (`claude-code`) is the
`SANDBOX_HARNESSES` token, the (legacy) Terminal Tab key, _and_ the `harness:<key>` model
id — there is no separate adapter-key namespace. A Harness is consumed two ways
off that one descriptor: installed in the sandbox, where someone can type it in
a Terminal Tab's shell, or spawned as the **ACP backing of the external Engine** to drive agent chat (its
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
`session/set_config_option` on the `"model"`-category option; a spawn-env adapter
(codex, which advertises no models) takes it at launch as `--model <id>`. See ADR
0011 for the capability binding and the `harness:<key>:<modelId>` wire format.
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
sidecar. Returns a per-Harness **status**, not a bare `{key,label}`:
`{ installed, authenticated }`, where `authenticated` (a per-descriptor auth
probe, ADR 0015) is read only by the **Harness Setup** Settings surface to label a
row — the dropdown / terminal folds ignore it, so listing stays gated on
**presence**, never auth. The desktop probe is memoized once per launch for the
hot path, but a connect through Harness Setup **invalidates** that memo (live
re-probe), so a freshly installed/authenticated CLI shows up app-wide without a
restart. The desktop model fold (`harnessModels`)
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

**Harness Setup** (desktop):
The one module that knows how this build **installs and signs in** a Harness's
host CLI (`lib/agent/harnesses/setup.ts`, ADR 0015) — the sibling of the **GitHub
Connection**'s guided `gh` setup (ADR 0014), built on the same reusable
**host-tool setup step** (`lib/host-tool/setup-step.ts`) and inline **host-session
terminal** (`HostSessionTerminal` + `/api/terminal/host`). Three calls are its
whole surface: `rows()` (the live per-CLI setup rows), `commandsFor(key, kind)`
(what a row's action runs in the PTY), and `markConnected()` (bust the
availability memo, hand back freshly probed rows). Both surfaces — the
`isLocalBuild`-gated "Coding agents" Settings section and the **first-run gate**
(ADR 0016) — only _render_ those rows; no setup policy lives in a component.
One **setup row** per distinct installable CLI — **deduped by `hostBinary`**
through the single `distinctByHostBinary` rule, so the two opencode slots collapse
to one row — carrying the live `{ installed, authenticated }` facts (the
descriptor's `hostBinary` probe plus its per-descriptor **auth probe**), the
reducer's `DetectionResult`, the row's state line, and the **action** to offer.
From not-installed, one action installs (via the descriptor's
npm-free-preferring **install-command builder**, the sibling of
`gh-install-command.ts`, against the one `probeHostFacts` read) then chains
straight into the CLI's own sign-in argv in a visible PTY; a signed-out CLI just
signs in; an authed one offers only a re-run. On PTY exit the row re-detects
**live** and invalidates the shared Harness Availability memo, so the connect
lands app-wide with no restart. The host-binary prober and the host process runner
are **injected ports**, so every rule above is unit-tested against a fake host.
The help is **one-directional**, exactly as the GitHub Connection's is toward the
`gh` CLI: the app installs and launches sign-in but never signs you **out**,
uninstalls, or manages the CLI's credentials beyond launching its own login.
_Avoid_: treating it as a second setup machine (it is a sibling _instance_ of the
ADR 0014 step, reducer reused verbatim); a second host-facts probe or a second
dedupe-by-`hostBinary` rule (one of each: `probeHostFacts`,
`distinctByHostBinary`); row policy in the panel or the gate (they render
`rows()`); reading setup rows off the launch-memoized availability resolver (rows
are probed live — that freshness is the point); gating the availability list on the
auth fact it surfaces (auth is a Settings label, presence still lists); a per-slot
opencode row (dedupe by `hostBinary`); picking a Harness's model here (that's the
model dropdown / **Harness model catalog**, ADR 0011); signing a harness _out_ or
uninstalling it (one-directional — help in, never out).

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
across `canvas.tsx`). The pure decision core (`reduceGesture`) and the input edge
(see **Pointer→Gesture Routing**) are both attached behind one React seam,
`useCanvasGesture` — the component spreads the hook's pointer handlers onto the
canvas root and stops defining its own. Gestures that begin **on a Layer** —
group move (with edge-snap and merge-snap), in-flow reorder, and device-resize —
enter the _same_ seam, not a separate machine: the Layer components dispatch
through the controller's Layer handlers (`onGroupDragStart`/`onGroupDragEnd`/
`onMove`/`onRequestReorderDrag`/`onResize*`), which assemble the `start` context
from plain snapshots (the pure `assembleMoveStart` / `assembleReorderStart`) and
reduce through the one FSM. The controller also owns the gesture-phase
book-keeping (`activeGapHandle`, the hovered reorder dot, the move/resize
meta-key window listeners) so the component stops tracking it out of band.
_Avoid_: handler, drag state (casual); a separate machine per gesture (one FSM
enforces the single-active invariant); a bespoke Layer drag path in `canvas.tsx`
(the Layer drags route through the same controller); mutating the Y.Doc from the
gesture (it emits a Gesture Intent, never calls a Canvas Operation itself);
recomputing layout inside the gesture (it emits a Preview that
`deriveCanvasLayout` consumes).

**Pointer→Gesture Routing**:
The input edge of the triad — the pure decision "which gesture (if any) does this
pointer-down begin." `routePointerToGesture` (`lib/canvas/route.ts`) takes a
pointer-down position in canvas space, the live reorder/gap handle geometry, the
interaction-mode flags, and plain group/layout snapshots, and returns the
**Gesture Start** to dispatch (a `start` of kind `reorder` / `gap` / `marquee`) or
`null` — encoding the reorder-dot-over-gap-handle precedence and the
mode-suppression gate as one testable decision. React-free, Yjs-free, DOM-free: the
sibling of `reduceGesture` and `computeMoveSnap`, asserted against plain values. The
coordinate and hit math (`screenToCanvas`, `hitTestReorderHandle`,
`hitTestGapHandle`, `hitTestMarquee`) lives here too, next to the routing that
consumes it, as do the pure **start-context assemblers** — `assembleReorderStart`
(here) and `assembleMoveStart` (in `lib/canvas/gesture.ts`) — that turn the
selection + group/layout snapshots into the `reorder` / `move` Gesture Start a
Layer-initiated drag dispatches. A pointer-down on the canvas root routes through
`routePointerToGesture`; a drag that begins on a Layer skips the router (it
already knows its kind) and calls the matching assembler directly — both paths
feed the same `start`. The hook (`useCanvasGesture`) owns the DOM-side wiring —
event attachment, pointer capture, `stopPropagation` — and converts the raw event
into these plain inputs.
_Avoid_: pointer handler, adapter (too vague); reading component state inside the
routing (it takes resolved flags and snapshots); deciding gestures from handler
ordering (the precedence is pinned in the pure function); assembling the move/
reorder start inline in the component (it's a pure function with a fixture test).

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

**Canvas Selection**:
The single owner of what is selected on the Canvas — three coordinated Sets
(selected Iframe Layers, Groups, Markdown Layers) kept apart so a member is
never represented twice (a selected Group supersedes its children). Split like
the rest of the canvas triad: a React-free pure core (`lib/canvas/selection.ts`)
holds the decisions — the cascade of a selected Group to its Members across
both kinds, the delete resolution (a single Iframe Layer delete keeps the
right/left neighbor, multi-selection clears), the shift-toggle rule, and the
derived projections (the overlay id union, the group-selected member ids) — and
a thin controller (`useCanvasSelection`) owns the Sets, the internal mirror refs
the global keydown handler reads via `current()`, and `deleteSelected()`, which
applies removals through a Canvas Operation (never the Y.Doc directly) and then
sets the next selection. The render tree and sidebar read its projections rather
than recomputing them inline.
_Avoid_: a shadow copy of selection in the keydown handler (it asks the
controller via `current()`); recomputing the overlay / group-member projections
in the render tree; mutating the Y.Doc to delete (the controller goes through
`ops`); a fourth selection Set for documents-in-groups (the Group cascade covers
it).

**Tool Mode**:
The armed draw tool on the canvas toolbar — `ToolMode = "select" | "frame" |
"comment" | "document"` — modeled as one discriminated value so "exactly one
tool active" holds by construction, replacing the three independent booleans
that every button and shortcut had to hand-clear. The pure transition
(`reduceToolMode` in `lib/canvas/tool-mode.ts`) decides the next mode; the
controller (`useToolMode`) owns the React state, mirrors the mode into a ref for
the keydown handler (which feeds it to the Escape resolver), and exposes
`set` / `toggle` plus boolean reads.
_Avoid_: re-introducing per-mode booleans; folding Focus mode or Create-Flow
mode into Tool Mode (those stay in **interaction-mode** — they govern frame
interaction, not draw-tool selection); putting the comment-placement sub-state
(new-comment position, inspect hover) in Tool Mode (it stays in the component for
now and moves with the Send-to-Agent work).

**Canvas Camera**:
The single owner of the canvas viewport — zoom, position, persistence, presence
broadcast, and following another user. The pure core (`lib/canvas/camera.ts`)
holds the zoom-to-fit math: given a target rect (or element bounds) and the
viewport size, compute the `{ x, y, zoom }` transform that frames it with
padding and min/max-zoom clamping. The controller (`useCanvasCamera`) owns the
`react-zoom-pan-pinch` transform, the `zoom` / viewport mirrors, debounced
viewport persistence (through `ops.saveViewport`), the presence viewport
broadcast, the follow-another-user effect, and the Figma-style wheel pan/zoom; it
exposes the verbs (`zoomToElement` / `zoomToRect` / `getViewportCenter` /
`follow`) and the `TransformWrapper` props the wiring shrinks to. Overlays, the
comments transform, the gesture inputs, and the sidebar zoom-to actions all read
this one interface. As the canvas **presence owner** (PRD #588) it also holds the
awareness-publish effects beyond the viewport broadcast: the **identity +
stable-color publish** (with the placeholder-viewport seed so `useSelfPresence`
is non-null before `onInit`) and the **selection → presence broadcast** remote
selection rings read; the **scroll-pin** effect that keeps the wrapper / transform
wrapper from drifting off-axis homes here too, beside the transform it guards.
_Avoid_: scattering `transformRef.current.setTransform` math across the render
tree (it goes through the camera verbs / the pure fit math); recomputing
zoom-to-fit inline; writing the viewport to the Y.Doc directly (persistence goes
through `ops.saveViewport`); putting the identity / selection presence-publish or
the scroll-pin effects back on the composition root (they are the presence
owner's, not orphan root effects).

**Layer Mutation**:
The bundle of thin per-Layer **Canvas Operation** writers that used to be ~13
one-line `useCallback`s inlined in `canvas.tsx` and drilled into
`CanvasMemberLayer` as separate props. The **Layer Mutation controller**
(`useLayerMutations`, PRD #579) groups them into one `LayerMutations` object —
the Iframe Layer field writers (`rename`, `assignAgent`, `updateState`,
`updateScroll`, `updateKnobs`, `updateKnobValues`, `updateSharedState`,
`updateRoute`, `fitToContent`) and the Markdown Layer writers (`resizeDocument`,
`setTitle`, `setTitleCache`) — passed to
`CanvasMemberLayer` (and onward to the Iframe Layer / Markdown Layer adapters) as
a **single prop**, exactly the way `selection` / `camera` / `reference` already
are. It is the **React binding, not a new write path**: every write routes
through the Canvas Operations seam (`ops`, ADR 0001) and never touches the Y.Doc
directly. The two verbs that carry real composition keep their bodies — the
controller is constructed from `ops`, `collections`, and the dirty-frame
`captureTracker` so `updateRoute` can apply the Create-Flow trail pan (via the
`transformRef` it reads through a ref) and `fitToContent` can mark a frame's
thumbnail dirty only when its size actually changes. Its **structural sibling**
is the **Group Operations** controller (below): this bundle writes a field on one
Layer; that one creates / moves / reorders / removes the groups and frames.
_Avoid_: reintroducing per-mutator props on `CanvasMemberLayer` (add a field to
`LayerMutations` instead); writing a Layer record outside `ops` (the bundle is a
binding over the already-tested verbs); flattening `updateRoute`'s pan or
`fitToContent`'s `markDirty` into a bare `patch`. Frame/document creation, group
teardown, and cross-group moves are **not** here — they live in Group Operations.

**Group Operations** (Group Actions):
The structural sibling of **Layer Mutation** — where that bundle writes a field
on one Layer, the **Group Operations controller** (`useGroupActions`, PRD #588)
**creates / moves / reorders / removes the groups and frames themselves**. It
owns the ~structural canvas mutations that used to sit as loose `useCallback`s in
`canvas.tsx`: frame creation (`addFrame` blank, `addIframeLayer` for-agent,
`addRoutesGroupForAgent`, `addIframeLayerToGroup` append-to-group), document
creation (`addDocumentLayer`), cross-group member move (`moveMember`), group
reorder (`reorderIframeLayerGroups`), group rename (`renameIframeLayerGroup`),
and group delete (`removeIframeLayerGroup`) — bundled into one `GroupActions`
object the Canvas root threads into the render tree, the way `layerMutations` /
`selection` / `camera` already are. Like Layer Mutation it is the **React
binding, not a new write path**: **every mutation routes through the Canvas
Operations seam (`ops`, ADR 0001), never the Y.Doc directly**, so the
single-transaction entry point and the Group-invariant chokepoint are preserved.
The composed verbs keep their full bodies rather than flattening to a bare
`patch`: `moveMember` keeps its cross-group splice + new-group placement
(and takes its `into-group` index in the space callers see, lifting the moving
member out itself — see **Sidebar Drop**),
`removeIframeLayerGroup` keeps its chat-store cleanup + selection follow, and the
route/seed creators keep their viewport-centered placement. Constructed from
`ops`, the live `collections`, the viewport-center reader (**Canvas Camera**),
and the **Canvas Selection**
controller (for the delete-follow on group teardown).
_Avoid_: putting these structural mutations back as loose callbacks on the
composition root (add a field to `GroupActions` instead); writing a Group / Layer
record outside `ops`; flattening a composed verb (the `moveMember` splice,
`removeIframeLayerGroup`'s cleanup, the creators' placement) into a bare `patch`;
folding the thin multi-Layer remove wrappers (`removeIframeLayers` /
`removeDocumentLayers`) in here — they stay on the composition root because the
Selection controller consumes them at construction, ahead of this controller.

**Sidebar Drop**:
The one decision behind a drag in the Room Sidebar's Canvas list (Groups and
their Members): `resolveSidebarDrop` in `lib/sidebar-drop.ts`, React-free and
dnd-kit-free. Given the visible rows, the Groups in sidebar order, the dragged
row, the row or `gap:N` strip under the pointer, and which half of that row the
pointer is in, it returns **both** the drop indicator (`into` ring or a
before/after `line`, with "after this member" painted as "before the next
member" so each gap is one pixel) and the move to commit (`move-member` into a
Group or out to a new one, or `reorder-groups`). The sidebar calls it on every
drag move for the hint and again on drop for the intent, so the commit always
lands where the indicator pointed; the sidebar itself keeps only the dnd-kit
plumbing (collision, pointer tracking) and rendering. Member indices in the
intent are gaps **as the sidebar shows them**; turning that into the
post-removal splice index a same-Group reorder needs belongs to **Group
Operations** (`moveMember`), not the caller.
The Repositories list (Repos and their Branches) goes through the same module:
`resolveRepoListDrop` returns the Branch before/after `line` and a
`reorder-repos` or `reorder-branches` intent, with a Branch confined to its own
Repo. Groups, Repos and Branches all reorder with one gap algorithm,
`reorderToGap`; a before/after drop on a row is the gap on that side of it.
_Avoid_: deciding the hint and the move in two places again; adjusting a
member index for the dragged member's own removal in UI code; a second
reorder algorithm for one of the lists.

**Sandbox Reconnect**:
The Canvas's mount-time Sandbox-lifecycle orchestration, split the way the rest
of the canvas triad already is: a React-free, Yjs-free **decision**
(`resolveReconnect` in `lib/sandbox/reconnect.ts`) plus a thin controller that
**applies** it (`useSandboxReconnect`, PRD #579). `resolveReconnect(agent, repo)`
returns a discriminated `ReconnectAction` over the recovery branches —
`resume-create` (creating + a `sandboxName`: ask the server to resume the create
pipeline), `unrecoverable` (creating, no `sandboxName`: the VM never existed,
error it), `reconnect` (a sandbox + resolvable Repo: probe + reattach), and
`repo-missing` (sandbox, no Repo: stop with a retry hint), plus `none` for a
Branch with nothing to recover. The controller owns the **mount-once guard** and
the visibility-gated **~20-minute keep-alive heartbeat**, so the Sandbox-lifecycle
recovery shares one home. (The streaming-heal hydration that used to ride along
here is chat-store hydration, not Sandbox lifecycle — it moved to the **Chat
Sync** owner, PRD #588.) The `reconnect` action carries the Repo and ref
precisely so a resume that fails on an **expired snapshot** routes to an explicit
**Recreate** (ADR 0005) — never a silent reclone, never stranding the user at
"stopped". The async apply (the resume POST, `reconnectSandbox` /
`recreateSandbox`, the `updateAgentInStorage` writes) lives in the controller;
only the per-Branch branch selection is pure.
_Avoid_: putting branch selection back in `canvas.tsx` (it goes through
`resolveReconnect`); re-adding a silent reclone fallback to the resume failure
path (ADR 0005); splitting the heartbeat back out into its own composition-root
effect; folding the chat heal hydration back in here (it is the Chat Sync owner's).

**Canvas Interaction**:
The single home for the cross-cutting interaction state no other controller
owned — the **focused** ("interactive") Iframe Layer, the **Create-Flow**
("flow") Iframe Layer, the **hovered** Iframe Layer, the inline-edited
**Markdown Layer**, the **space-held** (pan) flag, and the **cursor-chat
anchor** — lifted out of the composition root, where it was smeared across half a
dozen `useState`s and three effects, into one controller (`useCanvasInteraction`,
PRD #588). It is the **React state + effects, not a new decision**: it **wraps**
the two unchanged pure modules without touching them — `reconcileInteractionMode`
(`lib/canvas/interaction-mode.ts`, pinned by `interaction-mode.test.ts`) drives
the effect that drops Focus / Create-Flow mode the instant the frame backing it
is deleted **or** deselected, and `resolveEscapeAction` (`lib/canvas/escape.ts`,
pinned by `escape.test.ts`) reads this controller's `escapeState` (its own
slice of the Escape input, from mirror refs), which **Canvas Keyboard** merges
with the Tool Mode / target-pick / comment bits it reads elsewhere. Focus, Create-Flow,
hover, document-editing, space-pan, and Escape now behave identically to before
but are described in one place. Cursor chat **spans** this state and awareness:
the controller owns the anchor and the open/close verbs but reads the awareness
mirrors (`selfPointerRef` / `selfMessageRef`) and broadcasts the live message
through the injected `setPresence` — the same seam the root used. The mode/edit
state is mirrored into refs (`createFlowIframeLayerIdRef` for the route writer,
the Focus / editing ids for `escapeState`) so its verbs read the latest
snapshot without re-binding; the cursor-chat awareness refs are declared **ahead
of** the controller so no ordering cycle is reintroduced.
_Avoid_: putting this interaction state back as loose `useState`s on the
composition root (instantiate the controller and consume its interface);
modifying `reconcileInteractionMode` / `resolveEscapeAction` to absorb React
state (they stay React-free, pure-fixture-tested); folding the draw-tool **Tool
Mode** selection into here (that stays in **Tool Mode** — this governs frame
interaction, not the armed tool); re-deriving cursor-chat-open from the anchor
instead of the awareness message.

**Frame Control**:
Who drives a frame (#1387, spec #1386): one party at a time, a person or the
agent, and only the driver's input reaches the page. The pure reducer
(`reduceFrameControl` in `lib/canvas/frame-control.ts`, pinned by
`frame-control.test.ts`) owns every handoff rule over the record `{ live,
driver, requests[] }` in the Room's `frameControl` Yjs map: the driver lets
people drive (grant / decline), requests queue, a driver who leaves keeps
control for 5 seconds, the agent always yields and asks again, and a chat ask
grants the agent control when the asker drives or nobody does. Records are
keyed per **copy** of a frame (`frameControlKey`): until shared frames, every
viewer runs their own copy, whose parties are that viewer and the agent.
`useFrameControl` is the React adapter: **Interact is the driver's seat**
(entering asks to drive, leaving lets go). The Interact button is the driver
button, and the Layer Shell draws the title-line tag.
_Avoid_: a second affordance for control beside Interact; writing `driver`
outside the reducer; one record per frame for copies that aren't shared.

**Canvas Keyboard**:
The global `keydown`/`keyup` listeners for the canvas (`useCanvasKeyboard`, PRD
#579), a dispatch from action to verb. Which key means what lives in one table,
**Canvas Shortcuts** (`CANVAS_KEYS` in `lib/canvas/shortcuts.ts`, #1264): each
row is a key match, its action, its key caps, and where it is allowed (in text
entry, in the Composer, in an open overlay, on a keyboard-focused control). The
React-free `matchCanvasKey` walks the table over where the key landed
(`keyTargetOf`); the `?` sheet and the zoom menu read their caps from the same
rows, and the player reuses the matcher for ⌘I. The controller dispatches into
**Tool Mode**, **Canvas Selection**, **Element Reference**, **Element
Targeting**, the Yjs history, the **Canvas Interaction** verbs and the panel
refs it is handed. Escape is one action in the table; its **precedence** stays
in the React-free `resolveEscapeAction` (`lib/canvas/escape.ts`, pinned by
`escape.test.ts`), whose inputs the keyboard gathers in one place
(`readEscapeState`, with **Canvas Interaction**'s `escapeState`); the keyboard
only **applies** the chosen exit.
_Avoid_: putting the shortcut map or the window listeners back in `canvas.tsx`;
matching a key outside the table (a new Canvas key is a new row, so the sheet
lists it); a private copy of a key's rule on another surface (use
`matchCanvasKey`); duplicating the Escape precedence in the dispatch (it goes
through `resolveEscapeAction`); reading selection / Tool Mode through a shadow
copy instead of the controllers' `current()`.
