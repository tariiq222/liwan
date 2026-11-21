-- Public sign-up keeps proof that the company accepted the terms and privacy policy: the version shown, the moment and
-- the client address. The pending challenge carries it from the start request (short-lived rows, emptied here so the new
-- columns can be required); the durable copy sits on the per-customer sign-up claim, which survives challenge cleanup.
-- Customers created by the vendor have no claim row, so they have no acceptance (they sign a contract outside).
DELETE FROM public_signups;
ALTER TABLE public_signups
  ADD COLUMN terms_version text NOT NULL,
  ADD COLUMN terms_accepted_at timestamptz NOT NULL,
  ADD COLUMN terms_accepted_ip inet NOT NULL;
-- Claims made before this version have no acceptance on record; all three values are present together or absent together.
ALTER TABLE public_signup_trials
  ADD COLUMN terms_version text,
  ADD COLUMN terms_accepted_at timestamptz,
  ADD COLUMN terms_accepted_ip inet,
  ADD CONSTRAINT public_signup_trials_terms_check CHECK (
    (terms_version IS NULL) = (terms_accepted_at IS NULL) AND (terms_version IS NULL) = (terms_accepted_ip IS NULL));
