CREATE TABLE IF NOT EXISTS "room_folder" (
	"user_id" text NOT NULL,
	"room_id" text NOT NULL,
	"folder_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "room_folder_user_id_room_id_pk" PRIMARY KEY("user_id","room_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "room_folder" ADD CONSTRAINT "room_folder_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "room_folder" ADD CONSTRAINT "room_folder_room_id_room_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."room"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "room_folder" ADD CONSTRAINT "room_folder_folder_id_folder_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folder"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "room_folder_user_folder_idx" ON "room_folder" USING btree ("user_id","folder_id");
