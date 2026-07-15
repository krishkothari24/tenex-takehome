ALTER TABLE "classification_results" ADD COLUMN "estimated_read_minutes" real;--> statement-breakpoint
ALTER TABLE "emails" ADD COLUMN "message_count" integer;--> statement-breakpoint
ALTER TABLE "emails" ADD COLUMN "has_reply_from_user" boolean;