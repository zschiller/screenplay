ALTER TABLE "thread" ADD COLUMN "workspace_id" text;--> statement-breakpoint
ALTER TABLE "thread" ADD COLUMN "route" text;--> statement-breakpoint
ALTER TABLE "thread" ADD COLUMN "anchor" jsonb;--> statement-breakpoint
ALTER TABLE "thread" ADD COLUMN "viewport_width" double precision;--> statement-breakpoint
ALTER TABLE "thread" ADD COLUMN "viewport_height" double precision;--> statement-breakpoint
ALTER TABLE "thread" ADD COLUMN "snapshot" text;