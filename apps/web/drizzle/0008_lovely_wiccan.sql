ALTER TABLE "thread" ALTER COLUMN "x" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "thread" ALTER COLUMN "y" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "thread" ADD COLUMN "branch" text;--> statement-breakpoint
CREATE INDEX "thread_room_branch_idx" ON "thread" USING btree ("room_id","branch");