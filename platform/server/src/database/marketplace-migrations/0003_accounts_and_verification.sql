CREATE TABLE "marketplace"."marketplace_admin_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketplace"."marketplace_seller_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(254) NOT NULL,
	"password_hash" varchar(100) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"email_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketplace_seller_accounts_status_ck" CHECK ("marketplace"."marketplace_seller_accounts"."status" IN ('pending', 'active', 'suspended'))
);
--> statement-breakpoint
CREATE TABLE "marketplace"."marketplace_seller_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_account_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketplace"."marketplace_seller_verification_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_account_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "marketplace"."marketplace_admin_users" ADD COLUMN "full_name" varchar(120) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "marketplace"."marketplace_admin_users" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
UPDATE "marketplace"."marketplace_admin_users" SET "email_verified_at" = now() WHERE "active" = true AND "email_verified_at" IS NULL;--> statement-breakpoint
ALTER TABLE "marketplace"."marketplace_sellers" ADD COLUMN "account_id" uuid;--> statement-breakpoint
ALTER TABLE "marketplace"."marketplace_admin_invitations" ADD CONSTRAINT "marketplace_admin_invitations_admin_user_id_marketplace_admin_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "marketplace"."marketplace_admin_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace"."marketplace_seller_sessions" ADD CONSTRAINT "marketplace_seller_sessions_seller_account_id_marketplace_seller_accounts_id_fk" FOREIGN KEY ("seller_account_id") REFERENCES "marketplace"."marketplace_seller_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace"."marketplace_seller_verification_tokens" ADD CONSTRAINT "marketplace_seller_verification_tokens_seller_account_id_marketplace_seller_accounts_id_fk" FOREIGN KEY ("seller_account_id") REFERENCES "marketplace"."marketplace_seller_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "marketplace_admin_invitations_token_uq" ON "marketplace"."marketplace_admin_invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "marketplace_admin_invitations_admin_idx" ON "marketplace"."marketplace_admin_invitations" USING btree ("admin_user_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "marketplace_seller_accounts_email_uq" ON "marketplace"."marketplace_seller_accounts" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "marketplace_seller_sessions_token_uq" ON "marketplace"."marketplace_seller_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "marketplace_seller_sessions_account_idx" ON "marketplace"."marketplace_seller_sessions" USING btree ("seller_account_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "marketplace_seller_verification_token_uq" ON "marketplace"."marketplace_seller_verification_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "marketplace_seller_verification_account_idx" ON "marketplace"."marketplace_seller_verification_tokens" USING btree ("seller_account_id","expires_at");--> statement-breakpoint
ALTER TABLE "marketplace"."marketplace_sellers" ADD CONSTRAINT "marketplace_sellers_account_id_marketplace_seller_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "marketplace"."marketplace_seller_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "marketplace_sellers_account_idx" ON "marketplace"."marketplace_sellers" USING btree ("account_id");