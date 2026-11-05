CREATE TABLE "marketplace_product_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "marketplace_payments" ADD COLUMN "access_token_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "marketplace_product_access" ADD CONSTRAINT "marketplace_product_access_product_id_marketplace_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."marketplace_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "marketplace_product_access_token_uq" ON "marketplace_product_access" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "marketplace_product_access_product_idx" ON "marketplace_product_access" USING btree ("product_id","expires_at");
--> statement-breakpoint
INSERT INTO "marketplace_settings" ("key", "value") VALUES
	('publication_fee_basis_points', '1000'::jsonb),
	('contact_unlock_fee_basis_points', '500'::jsonb)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint