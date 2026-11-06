CREATE TABLE "marketplace"."marketplace_admin_verification_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "marketplace"."marketplace_admin_verification_tokens" ADD CONSTRAINT "marketplace_admin_verification_tokens_admin_user_id_marketplace_admin_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "marketplace"."marketplace_admin_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "marketplace_admin_verification_token_uq" ON "marketplace"."marketplace_admin_verification_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "marketplace_admin_verification_user_idx" ON "marketplace"."marketplace_admin_verification_tokens" USING btree ("admin_user_id","expires_at");