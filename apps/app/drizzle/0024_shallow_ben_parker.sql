CREATE TABLE "agent_steer" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"chat_id" text NOT NULL,
	"message" text NOT NULL,
	"user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"taken_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "agent_steer" ADD CONSTRAINT "agent_steer_run_id_agent_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_steer" ADD CONSTRAINT "agent_steer_chat_id_agent_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."agent_chat"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_steer_run_idx" ON "agent_steer" USING btree ("run_id","created_at");