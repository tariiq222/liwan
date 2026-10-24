-- Metered subscription quantities. Users and storage are chosen by the customer, so their
-- minimums and unit prices live on the plan next to the included branch count.
ALTER TABLE plan_revisions
  ADD COLUMN included_users integer NOT NULL DEFAULT 0 CHECK (included_users >= 0),
  ADD COLUMN included_storage_mb integer NOT NULL DEFAULT 0 CHECK (included_storage_mb >= 0),
  ADD COLUMN user_prices jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN storage_prices jsonb NOT NULL DEFAULT '[]'::jsonb;

-- PLACEHOLDER, not approved: the owner replaces every amount from the vendor console.
-- The WebVue plan is the single sellable platform plan: the base price covers the platform,
-- and every application is an optional, separately priced bundle. Prices here are development
-- placeholders only; a real tenant must never be sold from them.
UPDATE plan_revisions SET available=false, edit_revision=edit_revision+1 WHERE status='published' AND available;

-- Application prices live on a new revision: a published revision is immutable. The old
-- revision is withdrawn in the same migration, so the catalog never lists one application twice.
CREATE TEMP TABLE webvue_seeded_bundle_revisions AS
  SELECT id AS old_id, bundle_id FROM bundle_revisions
  WHERE status='published' AND available AND prices='[]'::jsonb;

INSERT INTO bundle_revisions(id,bundle_id,version,edit_revision,name,description,audience,audience_customer_id,catalog_release_id,selections,domain_limits,prices,status,available,content_digest,validated_digest,published_at)
SELECT gen_random_uuid(), s.bundle_id,
  (SELECT max(x.version) FROM bundle_revisions x WHERE x.bundle_id=s.bundle_id) + 1, 1,
  b.name, b.description, b.audience, b.audience_customer_id, b.catalog_release_id, b.selections, b.domain_limits,
  '[{"cadence":{"unit":"month","count":1},"amount":{"currency":"SAR","exponent":2,"minor":19900}},{"cadence":{"unit":"year","count":1},"amount":{"currency":"SAR","exponent":2,"minor":199000}}]'::jsonb,
  'published', true,
  encode(sha256(convert_to('webvue-bundle-seed:'||s.bundle_id::text,'UTF8')),'hex'),
  encode(sha256(convert_to('webvue-bundle-seed:'||s.bundle_id::text,'UTF8')),'hex'),
  now()
FROM webvue_seeded_bundle_revisions s JOIN bundle_revisions b ON b.id=s.old_id;

UPDATE bundle_revisions SET available=false, edit_revision=edit_revision+1
WHERE id IN (SELECT old_id FROM webvue_seeded_bundle_revisions);
UPDATE commercial_bundles c SET next_version = GREATEST(c.next_version,
  (SELECT max(r.version)+1 FROM bundle_revisions r WHERE r.bundle_id=c.id))
WHERE EXISTS (SELECT 1 FROM webvue_seeded_bundle_revisions s WHERE s.bundle_id=c.id);

INSERT INTO commercial_plans(id) VALUES('00000000-0000-4000-8000-0000000000b1');
INSERT INTO plan_revisions(
  id, plan_id, version, name, audience, audience_customer_id, status, available, term_months, currency,
  prices, platform_limits, included_bundle_revision_ids, optional_bundle_revision_ids,
  included_extra_branches, extra_branch_prices, extra_branches_limit,
  included_users, included_storage_mb, user_prices, storage_prices,
  policy_revision_id, trial_days, grace_days, auto_suspend, auto_renew_allowed,
  content_digest, validated_digest, published_at)
VALUES(
  '00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000b1', 1, 'WebVue',
  '{"kind":"public"}', NULL, 'published', true, 12, 'SAR',
  '[{"cadence":{"unit":"month","count":1},"amount":{"currency":"SAR","exponent":2,"minor":29900}},{"cadence":{"unit":"year","count":1},"amount":{"currency":"SAR","exponent":2,"minor":299000}}]'::jsonb,
  '{}'::jsonb, '[]'::jsonb,
  COALESCE((SELECT jsonb_agg(id ORDER BY created_at,id) FROM bundle_revisions WHERE status='published' AND available), '[]'::jsonb),
  0,
  '[{"cadence":{"unit":"month","count":1},"amount":{"currency":"SAR","exponent":2,"minor":5000}},{"cadence":{"unit":"year","count":1},"amount":{"currency":"SAR","exponent":2,"minor":50000}}]'::jsonb,
  NULL,
  3, 5120,
  '[{"cadence":{"unit":"month","count":1},"amount":{"currency":"SAR","exponent":2,"minor":1000}},{"cadence":{"unit":"year","count":1},"amount":{"currency":"SAR","exponent":2,"minor":10000}}]'::jsonb,
  '[{"cadence":{"unit":"month","count":1},"amount":{"currency":"SAR","exponent":2,"minor":100}},{"cadence":{"unit":"year","count":1},"amount":{"currency":"SAR","exponent":2,"minor":1000}}]'::jsonb,
  '6f1c3d8e-0000-4000-8000-000000000001', 14, 7, true, true,
  encode(sha256(convert_to('webvue-plan-seed-v1','UTF8')),'hex'),
  encode(sha256(convert_to('webvue-plan-seed-v1','UTF8')),'hex'),
  now()
);

INSERT INTO revision_references(revision_id,revision_kind,referenced_by_kind,referenced_by_id)
SELECT (jsonb_array_elements_text(optional_bundle_revision_ids))::uuid, 'bundle', 'plan', id
FROM plan_revisions WHERE id='00000000-0000-4000-8000-0000000000b2'
ON CONFLICT DO NOTHING;

DROP TABLE webvue_seeded_bundle_revisions;
