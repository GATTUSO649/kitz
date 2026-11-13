ALTER TABLE "laundry_bookings" ADD COLUMN "delivery_address" varchar(500);
ALTER TABLE "laundry_bookings" ADD COLUMN "preferred_delivery_at" timestamp with time zone;