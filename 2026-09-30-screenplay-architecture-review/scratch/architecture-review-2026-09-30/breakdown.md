# Architecture review 2026-09-30: ticket breakdown

Source: https://claude.ai/artifact/8vpuhqbhhqS87s9N3iiWmM

Five larger candidates become a **spec** (one issue) plus tickets under it. Six smaller ones go straight to a **ticket**. That makes 5 specs and 17 tickets, all `ready-for-agent`. Blocking edges are native. They are listed only where one ticket truly gates another.

Every refactor ticket includes "Docs: internal refactor, nothing a user sees changes". The exceptions are the tickets that fix a visible bug, which say what the user now sees.

## Specs (larger items)

### S1 · Spec: decide steerability once, as a fact about the run
**Test seam:** Turn Launch, through its existing test with a scripted Engine. This is one seam, and it already exists.

1. **An Engine reports whether it steers when its session opens, and Turn Launch records that on the run.** The `steerable` broadcast and a mid-turn send both read that record. When a run declines, a later send is refused and queued, not stranded in the inbox. This is the Codex case today.
   - Blocked by: none
2. **Remove the always-true steering capability and the decline port.** chat-store reads only what the run broadcasts. `not-steerable` paths that can't be reached are deleted.
   - Blocked by: S1.1

### S2 · Spec: one user-turn projection, live and on reload
**Test seam:** a "reload == live" test for each user-turn kind. It extends the existing chat-store ACP test.

1. **One projection turns a persisted user record into what the UI shows.** Wake and Delegated Message are typed fields. Reload uses the projection. A reloaded Coordinator chat no longer shows wakes as user bubbles; a failing test is written first to reproduce this.
   - Blocked by: none
2. **The live echo and the Steer echo go through the same projection.** The UI reads fields and stops parsing marker strings. The test checks live == reload for plain, wake, delegated, Steer and plan-mode turns.
   - Blocked by: S2.1

### S3 · Spec: one Workspace State module
**Test seam:** one function from a Branch plus the Room's chats and plans to its state, and one hook over the Room doc.

1. **Add the Workspace State module and hook.** The mention, the hover card and the Getting started checklist use it. The checklist stops hard-coding "not working", and the mention has no silent default.
   - Blocked by: none
2. **The Workspaces menu and the Canvas use it.** The `activeBranchIds` prop is removed, section and needs-you move into the module, and the status-line and list-view suites merge into one fixture table.
   - Blocked by: S3.1

### S4 · Spec: one client Chat Target
**Test seam:** the request body `chatStore.send` builds for each kind, plus a capability table tested as plain data.

1. **Replace the three flags with one Chat Target value (agent, document or Room).** AgentChat, useAgentChat and chatStore take that value. The wire mapping happens once, in the store, and the type moves out of the React module.
   - Blocked by: none
2. **A capability table for each kind drives the Composer's affordances in AgentChat:** skills, plan mode, element picking, placeholder and starters.
   - Blocked by: S4.1, T1 (skills come from the catalog)
3. **The Coordinator uses ChatPanel with the Room kind,** so the header chrome and the Collapse button exist once.
   - Blocked by: S4.2

### S5 · Spec: Workspace chat tabs shared by the Canvas and the player
**Test seam:** one hook for each Branch, tested against fake Chat Session collections.

1. **Every close and remove on the Canvas goes through the existing tested Tab Pool rule.** This is the prefactor.
   - Blocked by: none
2. **Split Workspace chat tabs and Chat Sync (heal included) away from the parts only the Canvas needs.** The player uses the result. A player that misses the end of a stream no longer shows a stuck spinner.
   - Blocked by: S5.1

## Direct tickets (smaller items)

- **T1 · One model and skill catalog behind the Composer.** Create Branch now shows "no coding agent detected". The Composer drops 9 props, and one suite uses an in-memory adapter. Blocked by: none.
- **T2 · Ops verbs map the Done-hidden view back to the Room doc.** A sidebar drop into a Group that holds a Done Workspace's frame lands where it was dropped. A failing test comes first. Blocked by: none.
- **T3 · Enforce "the turn is over" once, in the consumer.** Nothing reaches the chat or the log after Stop, on either Engine. Blocked by: S1.1, since both reshape the live-turn wiring.
- **T4 · One table for Canvas Keyboard shortcuts,** shared with the player's matcher. Blocked by: none.
- **T5 · One owner for the Terminal Tabs collection.** Close and prune make the same guarantees. Blocked by: S5.2, since both split the Tab Pool.
- **T6 · Fold Engine assembly into the Harness descriptor.** Blocked by: S1.2, since S1 moves where prompt queueing is reported.

## Not changed

- #1189 and #1192 (steering, and the Codex check) stay as they are. S1 names them as context but adds no edge.
- New glossary terms go in CONTEXT.md in the ticket that introduces them: Workspace State, and the user-turn projection if it gets a name.

## Frontier once published

These can start right away: S1.1, S2.1, S3.1, S4.1, S5.1, T1, T2 and T4.
