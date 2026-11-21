CREATE TABLE "marketplace"."marketplace_rental_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(80) NOT NULL,
	"name" varchar(120) NOT NULL,
	"monthly_price_kes" bigint NOT NULL,
	"listing_allowance" integer DEFAULT 20 NOT NULL,
	"image_allowance" integer DEFAULT 8 NOT NULL,
	"features" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "marketplace"."marketplace_shop_activation_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_account_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "marketplace"."marketplace_shop_rental_application_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"admin_user_id" uuid,
	"from_status" varchar(24),
	"to_status" varchar(24) NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "marketplace"."marketplace_shop_rental_application" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_reference" varchar(32) NOT NULL,
	"source_submission_id" varchar(120) NOT NULL,
	"full_name" varchar(160) NOT NULL,
	"email" varchar(254) NOT NULL,
	"phone" varchar(16) NOT NULL,
	"alternative_phone" varchar(16),
	"county" varchar(100) NOT NULL,
	"town" varchar(120) NOT NULL,
	"business_name" varchar(160) NOT NULL,
	"business_category" varchar(120) NOT NULL,
	"business_description" text NOT NULL,
	"has_physical_shop" boolean DEFAULT false NOT NULL,
	"business_location" varchar(240) NOT NULL,
	"preferred_shop_name" varchar(160) NOT NULL,
	"preferred_slug" varchar(180) NOT NULL,
	"business_phone" varchar(16) NOT NULL,
	"business_email" varchar(254) NOT NULL,
	"preferred_plan_code" varchar(80) DEFAULT 'standard' NOT NULL,
	"launch_date" timestamp with time zone,
	"product_categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"estimated_product_count" integer DEFAULT 0 NOT NULL,
	"additional_information" text,
	"documents" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"declarations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(24) DEFAULT 'pending' NOT NULL,
	"admin_notes" text,
	"seller_account_id" uuid,
	"shop_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketplace_shop_rental_application_status_ck" CHECK ("status" IN ('pending', 'under_review', 'approved', 'declined'))
);

CREATE TABLE "marketplace"."marketplace_shop_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"status" varchar(24) DEFAULT 'pending' NOT NULL,
	"starts_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "marketplace"."marketplace_shop_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"slug" varchar(180) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "marketplace"."marketplace_shops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_account_id" uuid NOT NULL,
	"seller_id" uuid,
	"name" varchar(160) NOT NULL,
	"slug" varchar(180) NOT NULL,
	"description" text,
	"logo_url" varchar(2048),
	"cover_url" varchar(2048),
	"category_id" uuid,
	"category" varchar(120),
	"status" varchar(24) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "marketplace"."marketplace_shop_activation_tokens" ADD CONSTRAINT "marketplace_shop_activation_tokens_seller_account_id_fkey" FOREIGN KEY ("seller_account_id") REFERENCES "marketplace"."marketplace_seller_accounts"("id") ON DELETE CASCADE;
ALTER TABLE "marketplace"."marketplace_shop_activation_tokens" ADD CONSTRAINT "marketplace_shop_activation_tokens_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "marketplace"."marketplace_shop_rental_application"("id") ON DELETE CASCADE;
ALTER TABLE "marketplace"."marketplace_shop_rental_application_history" ADD CONSTRAINT "marketplace_shop_rental_application_history_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "marketplace"."marketplace_shop_rental_application"("id") ON DELETE CASCADE;
ALTER TABLE "marketplace"."marketplace_shop_rental_application_history" ADD CONSTRAINT "marketplace_shop_rental_application_history_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "marketplace"."marketplace_admin_users"("id") ON DELETE SET NULL;
ALTER TABLE "marketplace"."marketplace_shop_rental_application" ADD CONSTRAINT "marketplace_shop_rental_application_seller_account_id_fkey" FOREIGN KEY ("seller_account_id") REFERENCES "marketplace"."marketplace_seller_accounts"("id") ON DELETE SET NULL;
ALTER TABLE "marketplace"."marketplace_shop_subscriptions" ADD CONSTRAINT "marketplace_shop_subscriptions_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "marketplace"."marketplace_shops"("id") ON DELETE CASCADE;
ALTER TABLE "marketplace"."marketplace_shop_subscriptions" ADD CONSTRAINT "marketplace_shop_subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "marketplace"."marketplace_rental_plans"("id") ON DELETE RESTRICT;
ALTER TABLE "marketplace"."marketplace_shops" ADD CONSTRAINT "marketplace_shops_seller_account_id_fkey" FOREIGN KEY ("seller_account_id") REFERENCES "marketplace"."marketplace_seller_accounts"("id") ON DELETE RESTRICT;
ALTER TABLE "marketplace"."marketplace_shops" ADD CONSTRAINT "marketplace_shops_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "marketplace"."marketplace_sellers"("id") ON DELETE SET NULL;
ALTER TABLE "marketplace"."marketplace_shops" ADD CONSTRAINT "marketplace_shops_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "marketplace"."marketplace_shop_categories"("id") ON DELETE SET NULL;
ALTER TABLE "marketplace"."marketplace_products" ADD COLUMN IF NOT EXISTS "shop_id" uuid;
ALTER TABLE "marketplace"."marketplace_products" ADD CONSTRAINT "marketplace_products_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "marketplace"."marketplace_shops"("id") ON DELETE SET NULL;

CREATE UNIQUE INDEX "marketplace_rental_plans_code_uq" ON "marketplace"."marketplace_rental_plans" USING btree ("code");
CREATE INDEX "marketplace_rental_plans_active_idx" ON "marketplace"."marketplace_rental_plans" USING btree ("active");
CREATE UNIQUE INDEX "marketplace_shop_activation_token_uq" ON "marketplace"."marketplace_shop_activation_tokens" USING btree ("token_hash");
CREATE INDEX "marketplace_shop_activation_account_idx" ON "marketplace"."marketplace_shop_activation_tokens" USING btree ("seller_account_id","expires_at");
CREATE INDEX "marketplace_shop_rental_application_history_idx" ON "marketplace"."marketplace_shop_rental_application_history" USING btree ("application_id","created_at");
CREATE UNIQUE INDEX "marketplace_shop_rental_application_reference_uq" ON "marketplace"."marketplace_shop_rental_application" USING btree ("application_reference");
CREATE UNIQUE INDEX "marketplace_shop_rental_application_source_uq" ON "marketplace"."marketplace_shop_rental_application" USING btree ("source_submission_id");
CREATE INDEX "marketplace_shop_rental_application_status_idx" ON "marketplace"."marketplace_shop_rental_application" USING btree ("status","created_at");
CREATE INDEX "marketplace_shop_rental_application_email_idx" ON "marketplace"."marketplace_shop_rental_application" USING btree ("email");
CREATE UNIQUE INDEX "marketplace_shop_categories_slug_uq" ON "marketplace"."marketplace_shop_categories" USING btree ("slug");
CREATE INDEX "marketplace_shop_categories_active_idx" ON "marketplace"."marketplace_shop_categories" USING btree ("active","sort_order");
CREATE INDEX "marketplace_shop_subscriptions_shop_status_idx" ON "marketplace"."marketplace_shop_subscriptions" USING btree ("shop_id","status","expires_at");
CREATE UNIQUE INDEX "marketplace_shops_slug_uq" ON "marketplace"."marketplace_shops" USING btree ("slug");
CREATE UNIQUE INDEX "marketplace_shops_seller_account_uq" ON "marketplace"."marketplace_shops" USING btree ("seller_account_id");
CREATE INDEX "marketplace_shops_status_idx" ON "marketplace"."marketplace_shops" USING btree ("status");
CREATE INDEX "marketplace_shops_category_idx" ON "marketplace"."marketplace_shops" USING btree ("category_id");
