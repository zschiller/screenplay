CREATE TABLE IF NOT EXISTS "folder" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"parent_folder_id" text,
	"name" text DEFAULT 'Untitled folder' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "folder" ADD CONSTRAINT "folder_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "folder" ADD CONSTRAINT "folder_parent_folder_id_folder_id_fk" FOREIGN KEY ("parent_folder_id") REFERENCES "public"."folder"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "folder_owner_parent_idx" ON "folder" USING btree ("owner_id","parent_folder_id");
