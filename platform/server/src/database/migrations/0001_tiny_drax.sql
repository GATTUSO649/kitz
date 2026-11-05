ALTER TABLE "marketplace_counties" ALTER COLUMN "code" SET DATA TYPE varchar(3);--> statement-breakpoint
ALTER TABLE "marketplace_products" ADD COLUMN "subcategory_id" uuid;--> statement-breakpoint
ALTER TABLE "marketplace_categories" ADD CONSTRAINT "marketplace_categories_parent_id_marketplace_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."marketplace_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_products" ADD CONSTRAINT "marketplace_products_subcategory_id_marketplace_subcategories_id_fk" FOREIGN KEY ("subcategory_id") REFERENCES "public"."marketplace_subcategories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_payments" ADD CONSTRAINT "marketplace_payments_purpose_ck" CHECK ("marketplace_payments"."purpose" IN ('PRODUCT_PUBLICATION', 'CONTACT_UNLOCK'));--> statement-breakpoint
ALTER TABLE "marketplace_payments" ADD CONSTRAINT "marketplace_payments_status_ck" CHECK ("marketplace_payments"."status" IN ('initiated', 'pending', 'succeeded', 'failed', 'cancelled', 'ambiguous', 'reversed', 'refunded'));--> statement-breakpoint
ALTER TABLE "marketplace_payments" ADD CONSTRAINT "marketplace_payments_amount_positive_ck" CHECK ("marketplace_payments"."amount_kes" > 0);--> statement-breakpoint
ALTER TABLE "marketplace_products" ADD CONSTRAINT "marketplace_products_price_positive_ck" CHECK ("marketplace_products"."price_kes" > 0);--> statement-breakpoint
ALTER TABLE "marketplace_products" ADD CONSTRAINT "marketplace_products_condition_ck" CHECK ("marketplace_products"."condition" IN ('new', 'like_new', 'good', 'fair', 'used'));--> statement-breakpoint
ALTER TABLE "marketplace_products" ADD CONSTRAINT "marketplace_products_status_ck" CHECK ("marketplace_products"."status" IN ('pending_payment', 'published', 'sold', 'expired', 'suspended', 'removed'));
INSERT INTO "marketplace_categories" ("name", "slug", "sort_order") VALUES
	('Phones and accessories', 'phones-and-accessories', 1),
	('Computers and laptops', 'computers-and-laptops', 2),
	('Electronics', 'electronics', 3),
	('Furniture', 'furniture', 4),
	('Home appliances', 'home-appliances', 5),
	('Vehicles', 'vehicles', 6),
	('Motorcycles and spare parts', 'motorcycles-and-spare-parts', 7),
	('Fashion and clothing', 'fashion-and-clothing', 8),
	('Shoes and bags', 'shoes-and-bags', 9),
	('Property', 'property', 10),
	('Construction equipment', 'construction-equipment', 11),
	('Agriculture and farming equipment', 'agriculture-and-farming-equipment', 12),
	('Sports and fitness', 'sports-and-fitness', 13),
	('Musical instruments', 'musical-instruments', 14),
	('Business equipment', 'business-equipment', 15),
	('Other products', 'other-products', 16)
ON CONFLICT ("slug") DO NOTHING;--> statement-breakpoint
INSERT INTO "marketplace_counties" ("code", "name") VALUES
	('001', 'Mombasa'), ('002', 'Kwale'), ('003', 'Kilifi'), ('004', 'Tana River'), ('005', 'Lamu'),
	('006', 'Taita-Taveta'), ('007', 'Garissa'), ('008', 'Wajir'), ('009', 'Mandera'), ('010', 'Marsabit'),
	('011', 'Isiolo'), ('012', 'Meru'), ('013', 'Tharaka-Nithi'), ('014', 'Embu'), ('015', 'Kitui'),
	('016', 'Machakos'), ('017', 'Makueni'), ('018', 'Nyandarua'), ('019', 'Nyeri'), ('020', 'Kirinyaga'),
	('021', 'Murang''a'), ('022', 'Kiambu'), ('023', 'Turkana'), ('024', 'West Pokot'), ('025', 'Samburu'),
	('026', 'Trans Nzoia'), ('027', 'Uasin Gishu'), ('028', 'Elgeyo-Marakwet'), ('029', 'Nandi'), ('030', 'Baringo'),
	('031', 'Laikipia'), ('032', 'Nakuru'), ('033', 'Narok'), ('034', 'Kajiado'), ('035', 'Kericho'),
	('036', 'Bomet'), ('037', 'Kakamega'), ('038', 'Vihiga'), ('039', 'Bungoma'), ('040', 'Busia'),
	('041', 'Siaya'), ('042', 'Kisumu'), ('043', 'Homa Bay'), ('044', 'Migori'), ('045', 'Kisii'),
	('046', 'Nyamira'), ('047', 'Nairobi City')
ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "marketplace_products_title_trgm_idx" ON "marketplace_products" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "marketplace_products_description_trgm_idx" ON "marketplace_products" USING gin ("description" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "marketplace_products_condition_status_idx" ON "marketplace_products" USING btree ("condition", "status", "published_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "marketplace_sellers_subcounty_town_idx" ON "marketplace_sellers" USING btree ("subcounty", "town");--> statement-breakpoint