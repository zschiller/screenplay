-- Contract half of the run-lifecycle migration (#154 / #170). Backfill the
-- truthful status onto existing rows *before* the `aborted` boolean is dropped,
-- then drop it. The TypeScript `status` enum is a plain text column, so the
-- removal of the legacy `ended` value carries no DDL — only this data backfill.

-- A user /stop (the only writer of `aborted=true`) becomes a real `aborted`.
UPDATE "agent_run" SET "status" = 'aborted' WHERE "aborted" = true;--> statement-breakpoint
-- Every remaining legacy `ended` run finished without being aborted. Old data
-- can't tell a clean finish from an error, so they all land as `completed`
-- (acceptable per #154).
UPDATE "agent_run" SET "status" = 'completed' WHERE "status" = 'ended';--> statement-breakpoint
ALTER TABLE "agent_run" DROP COLUMN "aborted";
