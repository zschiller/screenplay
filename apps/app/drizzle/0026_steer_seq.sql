DROP INDEX "agent_steer_run_idx";--> statement-breakpoint
ALTER TABLE "agent_steer" ADD COLUMN "seq" bigserial NOT NULL;--> statement-breakpoint
CREATE INDEX "agent_steer_run_idx" ON "agent_steer" USING btree ("run_id","seq");