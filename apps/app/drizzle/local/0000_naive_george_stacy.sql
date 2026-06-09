CREATE TABLE "agent_chat" (
	"id" text PRIMARY KEY NOT NULL,
	"room_id" text NOT NULL,
	"sandbox_name" text NOT NULL,
	"model" text NOT NULL,
	"system_prompt" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_message" (
	"id" text PRIMARY KEY NOT NULL,
	"chat_id" text NOT NULL,
	"role" text NOT NULL,
	"message" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_pending_tool_call" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"chat_id" text NOT NULL,
	"tool_name" text NOT NULL,
	"input" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"feedback" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "agent_run" (
	"id" text PRIMARY KEY NOT NULL,
	"chat_id" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "kv_store" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"expires_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "room" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text DEFAULT 'Untitled' NOT NULL,
	"owner_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"last_opened_at" timestamp,
	"thumbnail_url" text,
	"thumbnail_updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "terminal_tab" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"room_id" text NOT NULL,
	"branch" text NOT NULL,
	"label" text NOT NULL,
	"harness_key" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"organization" jsonb,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "agent_message" ADD CONSTRAINT "agent_message_chat_id_agent_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."agent_chat"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_pending_tool_call" ADD CONSTRAINT "agent_pending_tool_call_run_id_agent_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_pending_tool_call" ADD CONSTRAINT "agent_pending_tool_call_chat_id_agent_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."agent_chat"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_chat_id_agent_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."agent_chat"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room" ADD CONSTRAINT "room_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terminal_tab" ADD CONSTRAINT "terminal_tab_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terminal_tab" ADD CONSTRAINT "terminal_tab_room_id_room_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."room"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_chat_room_idx" ON "agent_chat" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX "agent_message_chat_idx" ON "agent_message" USING btree ("chat_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_pending_tool_call_chat_idx" ON "agent_pending_tool_call" USING btree ("chat_id","status");--> statement-breakpoint
CREATE INDEX "agent_pending_tool_call_run_idx" ON "agent_pending_tool_call" USING btree ("run_id","status");--> statement-breakpoint
CREATE INDEX "agent_run_chat_idx" ON "agent_run" USING btree ("chat_id","started_at");--> statement-breakpoint
CREATE INDEX "terminal_tab_user_room_branch_idx" ON "terminal_tab" USING btree ("user_id","room_id","branch");