CREATE INDEX "marketplace_products_condition_status_idx" ON "marketplace"."marketplace_products" USING btree ("condition","status","published_at");--> statement-breakpoint
CREATE INDEX "marketplace_sellers_subcounty_town_idx" ON "marketplace"."marketplace_sellers" USING btree ("subcounty","town");--> statement-breakpoint
INSERT INTO "marketplace"."marketplace_categories" ("name", "slug", "sort_order") VALUES
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
INSERT INTO "marketplace"."marketplace_counties" ("code", "name") VALUES
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
INSERT INTO "marketplace"."marketplace_settings" ("key", "value") VALUES
	('publication_fee_basis_points', '1000'::jsonb),
	('contact_unlock_fee_basis_points', '500'::jsonb)
ON CONFLICT ("key") DO NOTHING;