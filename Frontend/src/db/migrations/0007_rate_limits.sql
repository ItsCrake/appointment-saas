CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "rate_limits_expires_idx" ON "rate_limits" USING btree ("expires_at");
--> statement-breakpoint
-- Keys embed client IPs and phone numbers, so this is as sensitive as any
-- other table. RLS on with no policy at all: only the app's `postgres`
-- connection (which bypasses RLS) may touch it — never the public anon key.
ALTER TABLE "rate_limits" ENABLE ROW LEVEL SECURITY;
