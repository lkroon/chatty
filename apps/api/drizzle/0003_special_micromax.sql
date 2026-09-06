CREATE TABLE "proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" integer NOT NULL,
	"conversation_id" uuid,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"external_id" text,
	"external_link" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proposals_kind_check" CHECK ("proposals"."kind" in ('calendar_event','task','email')),
	CONSTRAINT "proposals_status_check" CHECK ("proposals"."status" in ('pending','executing','executed','discarded','failed'))
);
--> statement-breakpoint
ALTER TABLE "message_tool_calls" ADD COLUMN "proposal_id" uuid;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "proposals_account_id_status_idx" ON "proposals" USING btree ("account_id","status");--> statement-breakpoint
ALTER TABLE "message_tool_calls" ADD CONSTRAINT "message_tool_calls_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE set null ON UPDATE no action;