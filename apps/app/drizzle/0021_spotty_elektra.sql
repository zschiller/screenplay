CREATE TABLE "pin" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"room_id" text,
	"folder_id" text,
	"position" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "pin_exactly_one_target" CHECK (num_nonnulls("pin"."room_id", "pin"."folder_id") = 1)
);
--> statement-breakpoint
ALTER TABLE "pin" ADD CONSTRAINT "pin_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pin" ADD CONSTRAINT "pin_room_id_room_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."room"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pin" ADD CONSTRAINT "pin_folder_id_folder_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folder"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pin_user_room_idx" ON "pin" USING btree ("user_id","room_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pin_user_folder_idx" ON "pin" USING btree ("user_id","folder_id");--> statement-breakpoint
CREATE INDEX "pin_user_position_idx" ON "pin" USING btree ("user_id","position");