-- A card form is opened for one person: the client secret of its intent is handed to that person's browser only, and when the form
-- asks to keep the card, that person is the one who consented. `opened_by` is the customer actor id of the principal who opened the form
-- (the id format the audit events use). A card kept from a payment records the same actor in `payment_methods.created_by`.
-- A form attempt of an earlier development database has no recorded person; its actor is 'unknown', so its card consent stays valid
-- and no later person is mistaken for it.
ALTER TABLE payment_attempts
  ADD COLUMN opened_by text,
  ADD CONSTRAINT payment_attempts_opened_by_check CHECK (opened_by IS NULL OR length(opened_by) > 0);
UPDATE payment_attempts SET opened_by='unknown' WHERE kind='form';
ALTER TABLE payment_attempts
  ADD CONSTRAINT payment_attempts_consent_actor_check CHECK (NOT save_card OR opened_by IS NOT NULL);
