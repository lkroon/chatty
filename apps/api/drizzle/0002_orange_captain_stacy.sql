CREATE TABLE "google_connections" (
	"account_id" integer PRIMARY KEY NOT NULL,
	"refresh_token_sealed" text NOT NULL,
	"scopes" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "google_connections" ADD CONSTRAINT "google_connections_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;