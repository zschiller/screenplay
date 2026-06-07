# 5. Branch actions route by conflict-risk and never silently destroy work

Date: 2026-06-07

Status: Accepted

## Context

The Branch menu's actions are deliberately routed three different ways:
conflict-prone git (Rebase on `main`) goes to the **Engine** so conflicts are
walked through conversationally; deterministic git (Create PR) runs as a
**direct server action** with no model turn; and the restart family cycles the
**Sandbox**. We removed the old silent reclone fallback from Sandbox Restart —
it now fails loud rather than discarding uncommitted work — so that discarding
work is only ever the explicit, confirmed **Recreate from scratch**.

## Consequences

Without this record, a future reader will wonder why Create PR is a direct
action while Rebase routes through the chat, and will be tempted to "helpfully"
re-add the reclone fallback we deliberately deleted. New Branch actions should
follow the same rule: deterministic → direct action; can-conflict → Engine;
can-destroy-work → explicit + confirmed.
