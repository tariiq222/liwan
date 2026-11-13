-- A free trial is claimed once per company, not once per address: the sign-up claim now also holds the registrable
-- domain of the work email (rule in signup/company-domain.ts), unique, so a second address at the same company cannot
-- start a second trial. The claim is inserted in the transaction that creates the customer, so the database decides
-- a race. Email and mobile stay unique as before.
ALTER TABLE public_signup_trials ADD COLUMN company_domain text;

-- Existing claims get the domain by the same rule (last two labels, three under a listed second-level suffix). Claims
-- made before this version that already share a domain were granted under the old rule and are kept: the earliest
-- customer keeps the domain, the later ones keep their claim with no domain, so the constraint applies from now on.
WITH parts AS (
  SELECT t.customer_id, c.created_at, string_to_array(lower(regexp_replace(split_part(t.email, '@', 2), '\.+$', '')), '.') AS labels
  FROM public_signup_trials t JOIN customers c ON c.id = t.customer_id
), derived AS (
  SELECT customer_id, created_at,
    CASE WHEN cardinality(labels) < 2 THEN array_to_string(labels, '.')
         WHEN cardinality(labels) >= 3 AND labels[cardinality(labels) - 1] || '.' || labels[cardinality(labels)] = ANY (ARRAY[
           'com.sa','net.sa','org.sa','edu.sa','gov.sa','med.sa','sch.sa','pub.sa',
           'co.uk','org.uk','ac.uk','gov.uk','me.uk','ltd.uk','plc.uk','net.uk',
           'com.eg','net.eg','org.eg','edu.eg','gov.eg',
           'com.au','net.au','org.au','edu.au','gov.au',
           'co.ae','net.ae','org.ae','ac.ae','gov.ae',
           'com.kw','com.qa','com.bh','com.om','com.jo','com.lb',
           'com.tr','com.br','com.pk','co.in','co.jp','co.za','co.nz','com.sg','com.my'])
         THEN array_to_string(labels[cardinality(labels) - 2:], '.')
         ELSE array_to_string(labels[cardinality(labels) - 1:], '.') END AS domain
  FROM parts
), ranked AS (
  SELECT customer_id, domain, row_number() OVER (PARTITION BY domain ORDER BY created_at, customer_id) AS place FROM derived
)
UPDATE public_signup_trials t SET company_domain = r.domain FROM ranked r WHERE r.customer_id = t.customer_id AND r.place = 1;

ALTER TABLE public_signup_trials
  ADD CONSTRAINT public_signup_trials_company_domain_key UNIQUE (company_domain),
  ADD CONSTRAINT public_signup_trials_company_domain_check CHECK (company_domain IS NULL OR length(company_domain) > 0);
