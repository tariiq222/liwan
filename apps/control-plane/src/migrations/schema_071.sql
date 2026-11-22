-- The mobile the sign-up verified by SMS, handed to the first administrator so the first-login mobile gate is skipped.
-- E.164 only; cleared with the other personal fields when the workspace is deleted.
ALTER TABLE shared_onboardings ADD COLUMN admin_mobile text CHECK (admin_mobile ~ '^\+[1-9][0-9]{7,14}$');
