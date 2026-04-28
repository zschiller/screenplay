CREATE TABLE "thread_read" (
	"thread_id" text NOT NULL,
	"user_id" text NOT NULL,
	"last_read_at" timestamp NOT NULL,
	CONSTRAINT "thread_read_thread_id_user_id_pk" PRIMARY KEY("thread_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "thread_read" ADD CONSTRAINT "thread_read_thread_id_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_read" ADD CONSTRAINT "thread_read_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "thread_read_user_idx" ON "thread_read" USING btree ("user_id");