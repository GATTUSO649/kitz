CREATE TABLE "marketplace_admin_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketplace_admin_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(254) NOT NULL,
	"password_hash" varchar(100) NOT NULL,
	"role" varchar(32) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketplace_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_user_id" uuid,
	"action" varchar(100) NOT NULL,
	"resource_type" varchar(80) NOT NULL,
	"resource_id" varchar(100),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketplace_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"slug" varchar(120) NOT NULL,
	"parent_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketplace_contact_unlocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketplace_counties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(2) NOT NULL,
	"name" varchar(100) NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketplace_featured_products" (
	"product_id" uuid PRIMARY KEY NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketplace_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_id" uuid,
	"kind" varchar(50) NOT NULL,
	"status" varchar(24) DEFAULT 'pending' NOT NULL,
	"provider_reference" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "marketplace_payment_callbacks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"payload_hash" varchar(64) NOT NULL,
	"payload" jsonb NOT NULL,
	"outcome" varchar(24) DEFAULT 'received' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "marketplace_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_reference" varchar(40) NOT NULL,
	"merchant_request_id" varchar(100) NOT NULL,
	"checkout_request_id" varchar(100),
	"purpose" varchar(32) NOT NULL,
	"product_id" uuid,
	"amount_kes" bigint NOT NULL,
	"phone" varchar(16) NOT NULL,
	"status" varchar(24) DEFAULT 'initiated' NOT NULL,
	"provider_details" jsonb,
	"callback_processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketplace_product_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"storage_key" varchar(512) NOT NULL,
	"image_url" varchar(2048) NOT NULL,
	"content_type" varchar(50) NOT NULL,
	"byte_size" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketplace_product_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"reason" varchar(60) NOT NULL,
	"details" varchar(1000),
	"reporter_email" varchar(254),
	"status" varchar(24) DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "marketplace_product_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketplace_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" varchar(24) NOT NULL,
	"slug" varchar(180) NOT NULL,
	"title" varchar(160) NOT NULL,
	"description" text NOT NULL,
	"category_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"condition" varchar(20) NOT NULL,
	"price_kes" bigint NOT NULL,
	"negotiable" boolean DEFAULT false NOT NULL,
	"status" varchar(24) DEFAULT 'pending_payment' NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketplace_sellers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"phone" varchar(16) NOT NULL,
	"whatsapp" varchar(16),
	"email" varchar(254),
	"county_id" uuid NOT NULL,
	"subcounty" varchar(100) NOT NULL,
	"town" varchar(100) NOT NULL,
	"area" varchar(120),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketplace_settings" (
	"key" varchar(100) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketplace_subcategories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"slug" varchar(120) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "marketplace_admin_sessions" ADD CONSTRAINT "marketplace_admin_sessions_admin_user_id_marketplace_admin_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."marketplace_admin_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_audit_logs" ADD CONSTRAINT "marketplace_audit_logs_admin_user_id_marketplace_admin_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."marketplace_admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_contact_unlocks" ADD CONSTRAINT "marketplace_contact_unlocks_product_id_marketplace_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."marketplace_products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_contact_unlocks" ADD CONSTRAINT "marketplace_contact_unlocks_payment_id_marketplace_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."marketplace_payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_featured_products" ADD CONSTRAINT "marketplace_featured_products_product_id_marketplace_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."marketplace_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_notifications" ADD CONSTRAINT "marketplace_notifications_seller_id_marketplace_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."marketplace_sellers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_payment_callbacks" ADD CONSTRAINT "marketplace_payment_callbacks_payment_id_marketplace_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."marketplace_payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_payments" ADD CONSTRAINT "marketplace_payments_product_id_marketplace_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."marketplace_products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_product_images" ADD CONSTRAINT "marketplace_product_images_product_id_marketplace_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."marketplace_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_product_reports" ADD CONSTRAINT "marketplace_product_reports_product_id_marketplace_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."marketplace_products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_product_views" ADD CONSTRAINT "marketplace_product_views_product_id_marketplace_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."marketplace_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_products" ADD CONSTRAINT "marketplace_products_category_id_marketplace_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."marketplace_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_products" ADD CONSTRAINT "marketplace_products_seller_id_marketplace_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."marketplace_sellers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_sellers" ADD CONSTRAINT "marketplace_sellers_county_id_marketplace_counties_id_fk" FOREIGN KEY ("county_id") REFERENCES "public"."marketplace_counties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_subcategories" ADD CONSTRAINT "marketplace_subcategories_category_id_marketplace_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."marketplace_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "marketplace_admin_sessions_token_uq" ON "marketplace_admin_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "marketplace_admin_sessions_user_idx" ON "marketplace_admin_sessions" USING btree ("admin_user_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "marketplace_admin_users_email_uq" ON "marketplace_admin_users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "marketplace_audit_logs_created_idx" ON "marketplace_audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "marketplace_audit_logs_resource_idx" ON "marketplace_audit_logs" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "marketplace_categories_slug_uq" ON "marketplace_categories" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "marketplace_categories_parent_idx" ON "marketplace_categories" USING btree ("parent_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "marketplace_contact_unlock_payment_uq" ON "marketplace_contact_unlocks" USING btree ("payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "marketplace_contact_unlock_token_uq" ON "marketplace_contact_unlocks" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "marketplace_contact_unlock_product_idx" ON "marketplace_contact_unlocks" USING btree ("product_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "marketplace_counties_code_uq" ON "marketplace_counties" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "marketplace_counties_name_uq" ON "marketplace_counties" USING btree ("name");--> statement-breakpoint
CREATE INDEX "marketplace_notifications_status_idx" ON "marketplace_notifications" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "marketplace_payment_callbacks_hash_uq" ON "marketplace_payment_callbacks" USING btree ("payload_hash");--> statement-breakpoint
CREATE INDEX "marketplace_payment_callbacks_payment_idx" ON "marketplace_payment_callbacks" USING btree ("payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "marketplace_payments_reference_uq" ON "marketplace_payments" USING btree ("payment_reference");--> statement-breakpoint
CREATE UNIQUE INDEX "marketplace_payments_merchant_uq" ON "marketplace_payments" USING btree ("merchant_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "marketplace_payments_checkout_uq" ON "marketplace_payments" USING btree ("checkout_request_id");--> statement-breakpoint
CREATE INDEX "marketplace_payments_status_created_idx" ON "marketplace_payments" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "marketplace_product_images_order_idx" ON "marketplace_product_images" USING btree ("product_id","is_primary","sort_order");--> statement-breakpoint
CREATE INDEX "marketplace_product_reports_status_idx" ON "marketplace_product_reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "marketplace_product_reports_product_idx" ON "marketplace_product_reports" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "marketplace_product_views_product_time_idx" ON "marketplace_product_views" USING btree ("product_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "marketplace_products_reference_uq" ON "marketplace_products" USING btree ("reference");--> statement-breakpoint
CREATE UNIQUE INDEX "marketplace_products_slug_uq" ON "marketplace_products" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "marketplace_products_publication_idx" ON "marketplace_products" USING btree ("status","published_at");--> statement-breakpoint
CREATE INDEX "marketplace_products_category_price_idx" ON "marketplace_products" USING btree ("category_id","price_kes");--> statement-breakpoint
CREATE INDEX "marketplace_products_featured_idx" ON "marketplace_products" USING btree ("featured","published_at");--> statement-breakpoint
CREATE INDEX "marketplace_products_created_idx" ON "marketplace_products" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "marketplace_sellers_county_idx" ON "marketplace_sellers" USING btree ("county_id");--> statement-breakpoint
CREATE UNIQUE INDEX "marketplace_subcategories_slug_uq" ON "marketplace_subcategories" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "marketplace_subcategories_category_idx" ON "marketplace_subcategories" USING btree ("category_id","sort_order");