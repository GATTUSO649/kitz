ALTER TABLE "payments"
  ADD COLUMN "application_id" varchar(16) NOT NULL DEFAULT 'KITZ';
ALTER TABLE "payments" ADD CONSTRAINT "payments_application_id_check"
  CHECK ("application_id" = 'KITZ');