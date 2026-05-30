# apps/web — Canvas & Agent Runtime

Domain language for the screenplay web app: the collaborative canvas (the
spatial, real-time surface of a room and the layers, groups, and chat tabs on
it, held in the room's Y.Doc) and the agent runtime that drives it (chat
targets, tools, runs). This file names those concepts so code and conversation
use the same words.

## Language

**Canvas**:
The shared, collaboratively-edited spatial surface of a room. Its committed
state lives in the room's Y.Doc.
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
What a Chat Session talks to — either an agent's **sandbox** or a Markdown
Layer (a document). The target decides the system prompt and which Tools the
model is given.
_Avoid_: subject, destination.

**Tool**:
A capability the model can call during a chat turn (read_file, run_command,
read_document, …). Each Tool's availability is scoped by Chat Target.
_Avoid_: function, action (action = server action), command.

**Engine** (Agent Loop):
The owned, server-side turn loop that drives a Chat Session against a model
via the AI SDK — it replays the persisted conversation, runs Tools, and
broadcasts deltas to every client in the room. The app owns this loop; it is
deliberately **not** an external coding harness (Claude Code, Codex, …).
_Avoid_: harness (reserve that word for an external/BYO agent tool), runtime.

**Canvas Operation**:
A verb that mutates committed canvas state across one or more collections while
preserving canvas invariants (e.g. Group pruning). The deep module fronting the
generic `YjsCollection` CRDT wrapper.
_Avoid_: handler, mutation helper; "action" means a server action.
