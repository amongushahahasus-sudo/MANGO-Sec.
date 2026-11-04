CREATE TABLE `mango_accounts` (
  `user_id` text PRIMARY KEY NOT NULL,
  `state_json` text NOT NULL,
  `version` integer DEFAULT 0 NOT NULL,
  `watchlist_json` text DEFAULT '[]' NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mango_login_codes` (
  `code_hash` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `display_name` text NOT NULL,
  `email` text NOT NULL,
  `challenge` text NOT NULL,
  `state` text NOT NULL,
  `expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mango_login_codes_expiry` ON `mango_login_codes` (`expires_at`);
--> statement-breakpoint
CREATE TABLE `mango_sessions` (
  `token_hash` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `display_name` text NOT NULL,
  `email` text NOT NULL,
  `expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mango_sessions_expiry` ON `mango_sessions` (`expires_at`);
