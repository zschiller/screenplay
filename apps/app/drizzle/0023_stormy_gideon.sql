ALTER TABLE "comment" ADD COLUMN "agent_chat_id" text;--> statement-breakpoint
ALTER TABLE "thread" ADD COLUMN "agent_status" text;--> statement-breakpoint
ALTER TABLE "thread" ADD COLUMN "agent_chat_id" text;--> statement-breakpoint
ALTER TABLE "thread" ADD COLUMN "agent_base_commit" text;--> statement-breakpoint
ALTER TABLE "thread" ADD COLUMN "agent_commit" text;