ALTER TABLE "admin_biometric_challenges" DROP CONSTRAINT "admin_biometric_challenges_purpose_check";--> statement-breakpoint
ALTER TABLE "admin_biometric_challenges" ALTER COLUMN "admin_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "admin_biometric_challenges" ALTER COLUMN "admin_session_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "admin_biometric_challenges" ADD CONSTRAINT "admin_biometric_challenges_purpose_check" CHECK ("admin_biometric_challenges"."purpose" IN ('registration', 'authentication', 'login'));