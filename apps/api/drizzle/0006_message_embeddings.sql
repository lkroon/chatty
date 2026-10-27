CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TABLE "message_embeddings" (
	"message_id" uuid PRIMARY KEY REFERENCES "messages"("id") ON DELETE CASCADE NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
