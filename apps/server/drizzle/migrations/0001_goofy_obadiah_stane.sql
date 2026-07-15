ALTER TABLE "buckets" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "classification_results" ALTER COLUMN "bucket_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "buckets" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "buckets" ADD COLUMN "color" text;--> statement-breakpoint
ALTER TABLE "buckets" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "classification_results" ADD COLUMN "secondary_bucket_id" uuid;--> statement-breakpoint
ALTER TABLE "classification_results" ADD COLUMN "status" text DEFAULT 'classified' NOT NULL;--> statement-breakpoint
ALTER TABLE "classification_results" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "classification_results" ADD CONSTRAINT "classification_results_secondary_bucket_id_buckets_id_fk" FOREIGN KEY ("secondary_bucket_id") REFERENCES "public"."buckets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classification_results" ADD CONSTRAINT "classification_results_email_unique" UNIQUE("email_id");