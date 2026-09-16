CREATE TABLE "tool_call_errors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"account_id" integer NOT NULL,
	"tool_name" text NOT NULL,
	"failure_kind" text NOT NULL,
	"raw_arguments" text,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tool_call_errors" ADD CONSTRAINT "tool_call_errors_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_call_errors" ADD CONSTRAINT "tool_call_errors_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tool_call_errors_message_id_idx" ON "tool_call_errors" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "tool_call_errors_kind_created_at_idx" ON "tool_call_errors" USING btree ("failure_kind","created_at");--> statement-breakpoint
CREATE INDEX "tool_call_errors_account_id_created_at_idx" ON "tool_call_errors" USING btree ("account_id","created_at");