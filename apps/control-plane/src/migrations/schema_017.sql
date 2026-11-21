-- Additive customer enrollment identity; existing customers remain valid.
ALTER TABLE customers ADD COLUMN admin_name text;
ALTER TABLE customers ADD COLUMN admin_login text;
ALTER TABLE customers ADD COLUMN enrollment_request_id uuid UNIQUE;
