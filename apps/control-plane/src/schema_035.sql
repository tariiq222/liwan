-- Owner decision 2026-11-08: the extra-branch add-on of the release 1 plan costs 70 SAR a month and 700 SAR a year
-- (it was seeded at 50 and 500). The seed edit in schema_025.sql only reaches a database that has not applied it yet, and
-- a published revision is immutable (protect_commercial_revision refuses anything but availability), so a database that
-- already sells the plan gets a NEW published revision that supersedes the old one, as schema_033 does. On a database
-- whose newest sellable revision already carries the new price nothing is written: the WHERE clause below is false.
-- Not ON COMMIT DROP: migrate() runs this file in one transaction and the statements below read these tables later.
CREATE TEMP TABLE liwan_branch_price AS
  SELECT p.* FROM plan_revisions p
  WHERE p.plan_id = '00000000-0000-4000-8000-0000000000b1' AND p.status = 'published' AND p.available
    AND p.extra_branch_prices <> '[{"cadence":{"unit":"month","count":1},"amount":{"currency":"SAR","exponent":2,"minor":7000}},{"cadence":{"unit":"year","count":1},"amount":{"currency":"SAR","exponent":2,"minor":70000}}]'::jsonb
  ORDER BY p.version DESC LIMIT 1;

CREATE TEMP TABLE liwan_branch_price_map AS
  SELECT r.id AS old_id, gen_random_uuid() AS new_id FROM liwan_branch_price r;

UPDATE plan_revisions SET available = false, edit_revision = edit_revision + 1
WHERE id IN (SELECT old_id FROM liwan_branch_price_map);

INSERT INTO plan_revisions(
  id, plan_id, version, name, audience, audience_customer_id, status, available, term_months, currency,
  prices, platform_limits, included_bundle_revision_ids, optional_bundle_revision_ids,
  included_extra_branches, extra_branch_prices, extra_branches_limit,
  included_users, included_storage_mb, storage_step_mb, storage_step_threshold_mb, storage_large_step_mb,
  user_prices, storage_prices, policy_revision_id, trial_days, grace_days, auto_suspend, auto_renew_allowed,
  content_digest, validated_digest, published_at)
SELECT m.new_id, r.plan_id,
       (SELECT max(x.version) FROM plan_revisions x WHERE x.plan_id = r.plan_id) + 1, r.name, r.audience, r.audience_customer_id,
       'published', true, r.term_months, r.currency,
       r.prices, r.platform_limits, r.included_bundle_revision_ids, r.optional_bundle_revision_ids,
       r.included_extra_branches,
       '[{"cadence":{"unit":"month","count":1},"amount":{"currency":"SAR","exponent":2,"minor":7000}},{"cadence":{"unit":"year","count":1},"amount":{"currency":"SAR","exponent":2,"minor":70000}}]'::jsonb,
       r.extra_branches_limit,
       r.included_users, r.included_storage_mb, r.storage_step_mb, r.storage_step_threshold_mb, r.storage_large_step_mb,
       r.user_prices, r.storage_prices, r.policy_revision_id, r.trial_days, r.grace_days, r.auto_suspend, r.auto_renew_allowed,
       encode(sha256(convert_to('liwan-branch-price-2026-11-08:'||r.id::text,'UTF8')),'hex'),
       encode(sha256(convert_to('liwan-branch-price-2026-11-08:'||r.id::text,'UTF8')),'hex'),
       now()
FROM liwan_branch_price r JOIN liwan_branch_price_map m ON m.old_id = r.id;

-- The superseding revision lists the same optional bundles, so it carries the same reference rows (see schema_033).
INSERT INTO revision_references(revision_id,revision_kind,referenced_by_kind,referenced_by_id)
SELECT (jsonb_array_elements_text(r.optional_bundle_revision_ids))::uuid, 'bundle', 'plan', m.new_id::text
FROM liwan_branch_price r JOIN liwan_branch_price_map m ON m.old_id = r.id
ON CONFLICT DO NOTHING;

UPDATE commercial_plans c SET next_version = GREATEST(c.next_version,
  (SELECT max(r.version)+1 FROM plan_revisions r WHERE r.plan_id = c.id))
WHERE c.id = '00000000-0000-4000-8000-0000000000b1';

DROP TABLE IF EXISTS liwan_branch_price_map, liwan_branch_price;
