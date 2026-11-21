CREATE TABLE "marketplace"."marketplace_shop_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"slug" varchar(180) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "marketplace"."marketplace_shops" ADD COLUMN "category_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "marketplace_shop_categories_slug_uq" ON "marketplace"."marketplace_shop_categories" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "marketplace_shop_categories_active_idx" ON "marketplace"."marketplace_shop_categories" USING btree ("active","sort_order");--> statement-breakpoint
ALTER TABLE "marketplace"."marketplace_shops" ADD CONSTRAINT "marketplace_shops_category_id_marketplace_shop_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "marketplace"."marketplace_shop_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "marketplace_shops_category_idx" ON "marketplace"."marketplace_shops" USING btree ("category_id");