CREATE TABLE "marketplace"."marketplace_seller_password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_account_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "marketplace"."marketplace_admin_users" ADD COLUMN "kitz_admin_id" integer;--> statement-breakpoint
ALTER TABLE "marketplace"."marketplace_payments" ADD COLUMN "application_id" varchar(16) DEFAULT 'MARKETHUB' NOT NULL;--> statement-breakpoint
ALTER TABLE "marketplace"."marketplace_seller_password_reset_tokens" ADD CONSTRAINT "marketplace_seller_password_reset_tokens_seller_account_id_marketplace_seller_accounts_id_fk" FOREIGN KEY ("seller_account_id") REFERENCES "marketplace"."marketplace_seller_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "marketplace_seller_password_reset_token_uq" ON "marketplace"."marketplace_seller_password_reset_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "marketplace_seller_password_reset_account_idx" ON "marketplace"."marketplace_seller_password_reset_tokens" USING btree ("seller_account_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "marketplace_admin_users_kitz_id_uq" ON "marketplace"."marketplace_admin_users" USING btree ("kitz_admin_id");--> statement-breakpoint
ALTER TABLE "marketplace"."marketplace_payments" ADD CONSTRAINT "marketplace_payments_application_id_ck" CHECK ("marketplace"."marketplace_payments"."application_id" = 'MARKETHUB');