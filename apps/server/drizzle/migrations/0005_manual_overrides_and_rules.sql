CREATE TABLE "bucket_corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"email_id" uuid NOT NULL,
	"from_address" text,
	"from_bucket_id" uuid,
	"to_bucket_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sender_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"from_address" text NOT NULL,
	"bucket_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sender_rules_user_address_unique" UNIQUE("user_id","from_address")
);
--> statement-breakpoint
ALTER TABLE "classification_results" ADD COLUMN "is_manual_override" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bucket_corrections" ADD CONSTRAINT "bucket_corrections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bucket_corrections" ADD CONSTRAINT "bucket_corrections_email_id_emails_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."emails"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bucket_corrections" ADD CONSTRAINT "bucket_corrections_from_bucket_id_buckets_id_fk" FOREIGN KEY ("from_bucket_id") REFERENCES "public"."buckets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bucket_corrections" ADD CONSTRAINT "bucket_corrections_to_bucket_id_buckets_id_fk" FOREIGN KEY ("to_bucket_id") REFERENCES "public"."buckets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_rules" ADD CONSTRAINT "sender_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_rules" ADD CONSTRAINT "sender_rules_bucket_id_buckets_id_fk" FOREIGN KEY ("bucket_id") REFERENCES "public"."buckets"("id") ON DELETE cascade ON UPDATE no action;