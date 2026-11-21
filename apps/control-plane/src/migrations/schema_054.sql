-- A free trial is claimed once per company, not once per address: the sign-up claim now also holds the registrable
-- domain of the work email (rule in signup/company-domain.ts), unique, so a second address at the same company cannot
-- start a second trial. The claim is inserted in the transaction that creates the customer, so the database decides
-- a race. Email and mobile stay unique as before.
ALTER TABLE public_signup_trials ADD COLUMN company_domain text;

-- Existing claims get the domain by the same rule as signup/company-domain.ts, which must stay in step with this SQL:
-- when the last label is a two-letter country code and the label before it is a generic second-level label
-- (com, co, net, org, gov, edu, ac, mil, sch, med, pub, ltd, plc, me, info, biz, name, nom, or, ne, go, gob, gouv, k12)
-- the public suffix is those two labels, otherwise the last label; the domain is the suffix plus one label. An address
-- directly on a suffix, or under a shared-hosting suffix (github.io, web.app, ...), has no domain and keeps no claim on one.
-- (Stored emails are ASCII, so the IDN step of the application rule has nothing to do here.)
-- Claims made before this version that already share a domain were granted under the old rule and are kept: the earliest
-- customer keeps the domain, the later ones keep their claim with no domain, so the constraint applies from now on.
WITH parts AS (
  SELECT t.customer_id, c.created_at, lower(regexp_replace(split_part(t.email, '@', 2), '\.+$', '')) AS host
  FROM public_signup_trials t JOIN customers c ON c.id = t.customer_id
), split AS (
  SELECT customer_id, created_at, host, string_to_array(host, '.') AS labels FROM parts
), measured AS (
  SELECT customer_id, created_at, host, labels, cardinality(labels) AS n,
    CASE WHEN cardinality(labels) >= 2 AND labels[cardinality(labels)] ~ '^[a-z]{2}$' AND labels[cardinality(labels) - 1] = ANY (ARRAY[
      'com','co','net','org','gov','edu','ac','mil','sch','med','pub','ltd','plc','me','info','biz','name','nom',
      'or','ne','go','gob','gouv','k12']) THEN 2 ELSE 1 END AS suffix_length
  FROM split
), derived AS (
  SELECT customer_id, created_at,
    CASE WHEN n <= suffix_length OR host = ANY (ARRAY['github.io','gitlab.io','web.app','firebaseapp.com','pages.dev','workers.dev',
           'vercel.app','netlify.app','herokuapp.com','blogspot.com','wordpress.com'])
           OR host ~ '\.(github\.io|gitlab\.io|web\.app|firebaseapp\.com|pages\.dev|workers\.dev|vercel\.app|netlify\.app|herokuapp\.com|blogspot\.com|wordpress\.com)$'
         THEN NULL
         ELSE array_to_string(labels[n - suffix_length:], '.') END AS domain
  FROM measured
), ranked AS (
  SELECT customer_id, domain, row_number() OVER (PARTITION BY domain ORDER BY created_at, customer_id) AS place FROM derived
  WHERE domain IS NOT NULL
)
UPDATE public_signup_trials t SET company_domain = r.domain FROM ranked r WHERE r.customer_id = t.customer_id AND r.place = 1;

ALTER TABLE public_signup_trials
  ADD CONSTRAINT public_signup_trials_company_domain_key UNIQUE (company_domain),
  ADD CONSTRAINT public_signup_trials_company_domain_check CHECK (company_domain IS NULL OR length(company_domain) > 0);
