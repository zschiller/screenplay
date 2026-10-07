# 22. One kind of chat, and every chat gets its own new branch

Date: 2026-10-03

Status: Accepted (backfilled 2026-10-07)

## Context

Screenplay once had several chat kinds (code, Mockup, Document) and several
ways to attach a chat to a branch: open an existing git branch, "New chat from
here", several chats on one Workspace. Each Workspace is one checkout with one
running dev server, so two chats on one branch share a worktree and push to the
same ref.

## Decision

- **One kind of chat** (spec #1308): any chat can change code, make Mockups and
  make Documents.
- **Every chat with a repo starts on its own new branch**, in its own
  Workspace. More branches means more chats; a chat never gets a second branch.
- **Nothing attaches a chat to an existing branch** (PR #1562). Open existing
  git branch, New chat from here, Rename branch and the New chat dialog's branch
  picker are gone. The Coordinator's `create_workspaces` `base_branch` always
  forks a new branch from it.
- **One chat per Workspace** (#1315, PR #1331): `workspaceChatId` (newest chat
  on the Branch) answers "which chat" everywhere; older chats on a Branch are
  read-only and have no UI entry since PR #1378.

## Consequences

- Two agents never push to the same branch from different windows.
- Continuing work on a branch a chat didn't create means asking the
  Coordinator to fork it.
- A chat's frames, PR and preview all belong to one branch, so labels can show
  the chat name instead of the branch.

Rejected: chat kinds per artifact; opening or continuing an existing branch;
several branches per chat (needs one sandbox per branch anyway).
