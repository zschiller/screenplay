CREATE TABLE "comment" (
	"id" text PRIMARY KEY NOT NULL,
	"thread_id" text NOT NULL,
	"author_id" text NOT NULL,
	"body" text NOT NULL,
	"agent_chat_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"edited_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "thread" (
	"id" text PRIMARY KEY NOT NULL,
	"room_id" text NOT NULL,
	"x" double precision,
	"y" double precision,
	"iframe_layer_id" text,
	"selector" text,
	"offset_x" double precision,
	"offset_y" double precision,
	"workspace_id" text,
	"route" text,
	"anchor" jsonb,
	"viewport_width" double precision,
	"viewport_height" double precision,
	"snapshot" text,
	"document_id" text,
	"anchor_start" text,
	"anchor_end" text,
	"quoted_text" text,
	"branch" text,
	"agent_status" text,
	"agent_chat_id" text,
	"agent_base_commit" text,
	"agent_commit" text,
	"resolved" boolean DEFAULT false NOT NULL,
	"resolved_at" timestamp,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thread_read" (
	"thread_id" text NOT NULL,
	"user_id" text NOT NULL,
	"last_read_at" timestamp NOT NULL,
	CONSTRAINT "thread_read_thread_id_user_id_pk" PRIMARY KEY("thread_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_thread_id_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread" ADD CONSTRAINT "thread_room_id_room_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."room"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread" ADD CONSTRAINT "thread_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_read" ADD CONSTRAINT "thread_read_thread_id_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_read" ADD CONSTRAINT "thread_read_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comment_thread_idx" ON "comment" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "thread_room_idx" ON "thread" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX "thread_room_branch_idx" ON "thread" USING btree ("room_id","branch");--> statement-breakpoint
CREATE INDEX "thread_document_idx" ON "thread" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "thread_read_user_idx" ON "thread_read" USING btree ("user_id");