CREATE TABLE "branch_comment" (
	"id" text PRIMARY KEY NOT NULL,
	"room_id" text NOT NULL,
	"branch" text NOT NULL,
	"author_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"edited_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "branch_comment" ADD CONSTRAINT "branch_comment_room_id_room_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."room"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_comment" ADD CONSTRAINT "branch_comment_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "branch_comment_room_branch_idx" ON "branch_comment" USING btree ("room_id","branch");