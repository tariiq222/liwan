-- One trial per customer: the timestamp is the durable record that the trial was consumed.
ALTER TABLE customers ADD COLUMN trial_used_at timestamptz;
