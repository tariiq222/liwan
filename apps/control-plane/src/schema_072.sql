-- "Contact us" requests from the marketing site (site contract section 4.5). Personal data: kept inside the control plane
-- only, never logged, deleted after twelve months (contact-requests.ts).
-- The visitor's address is used for the rate limit in memory and is not stored.
CREATE TABLE public_contact_requests(
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  email text NOT NULL CHECK (char_length(email) BETWEEN 3 AND 254),
  company text CHECK (char_length(company) <= 200),
  mobile text CHECK (mobile ~ '^\+[1-9][0-9]{7,14}$'),
  users integer CHECK (users BETWEEN 1 AND 100000),
  message text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 2000),
  lang text NOT NULL CHECK (lang IN ('ar', 'en')),
  utm jsonb NOT NULL DEFAULT '{}'::jsonb,
  consent_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX public_contact_requests_created_idx ON public_contact_requests(created_at);
