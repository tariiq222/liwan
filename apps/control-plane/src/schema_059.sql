-- A payment attempt always says what it is. A bank transfer is its own kind (its provider reference is the transfer reference, not an
-- invoice or a payment at a provider), and no insert may leave the kind to a default that would label it a hosted invoice.
ALTER TABLE payment_attempts DROP CONSTRAINT payment_attempts_kind_check;
ALTER TABLE payment_attempts ADD CONSTRAINT payment_attempts_kind_check CHECK (kind IN ('hosted_invoice','form','saved_card','bank_transfer'));
UPDATE payment_attempts SET kind = 'bank_transfer' WHERE provider = 'bank_transfer';
ALTER TABLE payment_attempts ALTER COLUMN kind DROP DEFAULT;
ALTER TABLE payment_attempts ADD CONSTRAINT payment_attempts_bank_transfer_kind_check CHECK ((provider = 'bank_transfer') = (kind = 'bank_transfer'));
