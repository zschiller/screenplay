ALTER TABLE "thread" ADD COLUMN IF NOT EXISTS "document_id" text;--> statement-breakpoint
ALTER TABLE "thread" ADD COLUMN IF NOT EXISTS "anchor_start" text;--> statement-breakpoint
ALTER TABLE "thread" ADD COLUMN IF NOT EXISTS "anchor_end" text;--> statement-breakpoint
ALTER TABLE "thread" ADD COLUMN IF NOT EXISTS "quoted_text" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "thread_document_idx" ON "thread" USING btree ("document_id");