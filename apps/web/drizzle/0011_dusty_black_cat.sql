ALTER TABLE "thread" ADD COLUMN "document_id" text;--> statement-breakpoint
ALTER TABLE "thread" ADD COLUMN "anchor_start" text;--> statement-breakpoint
ALTER TABLE "thread" ADD COLUMN "anchor_end" text;--> statement-breakpoint
ALTER TABLE "thread" ADD COLUMN "quoted_text" text;--> statement-breakpoint
CREATE INDEX "thread_document_idx" ON "thread" USING btree ("document_id");