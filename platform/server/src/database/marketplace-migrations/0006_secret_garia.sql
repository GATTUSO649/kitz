ALTER TABLE "marketplace"."marketplace_payments" ADD COLUMN "stk_push_submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "marketplace"."marketplace_payments" ADD COLUMN "stk_push_response_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "marketplace"."marketplace_payments" ADD COLUMN "callback_received_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "marketplace"."marketplace_payments" ADD COLUMN "verification_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "marketplace"."marketplace_payments" ADD COLUMN "finalized_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "marketplace"."marketplace_payments" ADD COLUMN "provider_response_code" varchar(48);--> statement-breakpoint
ALTER TABLE "marketplace"."marketplace_payments" ADD COLUMN "provider_response_description" varchar(240);--> statement-breakpoint
ALTER TABLE "marketplace"."marketplace_payments" ADD COLUMN "failure_category" varchar(48);--> statement-breakpoint
ALTER TABLE "marketplace"."marketplace_payments" ADD COLUMN "failure_reason" varchar(240);