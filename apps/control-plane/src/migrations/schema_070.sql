-- Trials already issued retain their existing clock. New public trials wait for their invited administrator.
ALTER TABLE public_signup_trials
  ADD COLUMN requires_first_login boolean NOT NULL DEFAULT false,
  ADD COLUMN first_admin_user_id integer CHECK (first_admin_user_id > 1);
