-- What a saved-card charge and a closed card form attempt must remember, so that nothing about them is read from the provider under a lock.
--  * `payment_method_id`: the saved card a charge was made with, so a failure learned later (a lookup, a webhook, the reconciler) marks
--    that card inactive on a hard decline.
--  * `charge_sent_at`: the last time the charge was sent to the provider. A lost answer is sent again (with the same attempt id) once this
--    is old enough; the reconciler's own lookups no longer move it.
--  * `payment_hold_until`: a card form attempt that was closed while its intent was fulfilled and no payment was reported may still hold a
--    payment. Until this moment (or until the payment is settled, its decline is recorded, or the order is paid or cancelled) the saved card
--    is not charged for the same invoice.
ALTER TABLE payment_attempts
  ADD COLUMN payment_method_id uuid REFERENCES payment_methods(id),
  ADD COLUMN charge_sent_at timestamptz,
  ADD COLUMN payment_hold_until timestamptz;
UPDATE payment_attempts SET charge_sent_at=created_at WHERE kind='saved_card';
