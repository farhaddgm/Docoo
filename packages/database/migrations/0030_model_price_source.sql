ALTER TABLE "model_prices" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "model_prices" ADD COLUMN "source_ref" text;--> statement-breakpoint
ALTER TABLE "model_prices" ADD COLUMN "catalog_hash" text;
--> statement-breakpoint
-- A price is either typed by an administrator or taken from the public price catalog; a catalog price
-- always says where and from which catalog content, so any figure can be traced back.
ALTER TABLE "model_prices" ADD CONSTRAINT "model_prices_source_check" CHECK (
  ("source" = 'manual' AND "source_ref" IS NULL AND "catalog_hash" IS NULL)
  OR ("source" = 'catalog' AND "source_ref" IS NOT NULL AND char_length("source_ref") <= 300
      AND "catalog_hash" ~ '^[0-9a-f]{64}$')
);
