CREATE TABLE "message_tool_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"label" text NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_tool_calls_status_check" CHECK ("message_tool_calls"."status" in ('done','failed'))
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "upstream_cost" numeric;--> statement-breakpoint
ALTER TABLE "message_tool_calls" ADD CONSTRAINT "message_tool_calls_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_tool_calls_message_id_idx" ON "message_tool_calls" USING btree ("message_id");