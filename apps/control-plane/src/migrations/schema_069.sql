-- Existing incomplete challenges must restart and see the new offer before enrollment.
ALTER TABLE public_signups ADD COLUMN offer_revision uuid;
ALTER TABLE public_signups ADD COLUMN app_ids text[];
