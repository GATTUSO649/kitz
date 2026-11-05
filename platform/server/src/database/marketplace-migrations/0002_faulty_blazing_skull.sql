CREATE TABLE "marketplace"."marketplace_email_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_key" varchar(180) NOT NULL,
	"kind" varchar(48) NOT NULL,
	"recipient_email" varchar(254) NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"provider_message_id" varchar(180),
	"last_error_code" varchar(48),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "marketplace_email_events_status_ck" CHECK ("marketplace"."marketplace_email_events"."status" IN ('pending', 'sending', 'sent', 'failed', 'uncertain')),
	CONSTRAINT "marketplace_email_events_attempts_ck" CHECK ("marketplace"."marketplace_email_events"."attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "marketplace"."marketplace_payments" DROP CONSTRAINT "marketplace_payments_status_ck";--> statement-breakpoint
ALTER TABLE "marketplace"."marketplace_payments" ADD COLUMN "customer_email" varchar(254);--> statement-breakpoint
ALTER TABLE "marketplace"."marketplace_payments" ADD COLUMN "provider_receipt" varchar(32);--> statement-breakpoint
ALTER TABLE "marketplace"."marketplace_payments" ADD COLUMN "transaction_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "marketplace"."marketplace_payments" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "marketplace"."marketplace_payments" ADD COLUMN "last_reconciliation_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "marketplace"."marketplace_payments" ADD COLUMN "reconciliation_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "marketplace_email_events_key_uq" ON "marketplace"."marketplace_email_events" USING btree ("event_key");--> statement-breakpoint
CREATE INDEX "marketplace_email_events_delivery_idx" ON "marketplace"."marketplace_email_events" USING btree ("status","next_attempt_at","created_at");--> statement-breakpoint
ALTER TABLE "marketplace"."marketplace_payments" ADD CONSTRAINT "marketplace_payments_status_ck" CHECK ("marketplace"."marketplace_payments"."status" IN ('initiated', 'pending', 'processing', 'succeeded', 'failed', 'cancelled', 'expired', 'ambiguous', 'reversed', 'refunded'));