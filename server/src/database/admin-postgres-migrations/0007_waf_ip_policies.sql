CREATE TABLE "waf_ip_policies" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"name" varchar(80) NOT NULL,
	"action" varchar(16) NOT NULL,
	"type" varchar(8) NOT NULL,
	"value" varchar(128) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 50 NOT NULL,
	"reason" text NOT NULL,
	"expires_at" timestamp with time zone,
	"created_by_operations_user_id" integer,
	"created_by_admin_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "waf_ip_policies_action_check" CHECK ("action" IN ('allow', 'block', 'challenge')),
	CONSTRAINT "waf_ip_policies_type_check" CHECK ("type" IN ('ip', 'cidr')),
	CONSTRAINT "waf_ip_policies_priority_check" CHECK ("priority" BETWEEN 0 AND 1000)
);
ALTER TABLE "waf_ip_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "waf_ip_policies" ADD CONSTRAINT "waf_ip_policies_created_by_operations_user_id_operations_users_id_fk" FOREIGN KEY ("created_by_operations_user_id") REFERENCES "public"."operations_users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "waf_ip_policies" ADD CONSTRAINT "waf_ip_policies_created_by_admin_user_id_admin_users_id_fk" FOREIGN KEY ("created_by_admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;
CREATE INDEX "waf_ip_policies_enabled_priority_idx" ON "waf_ip_policies" USING btree ("enabled","priority");
