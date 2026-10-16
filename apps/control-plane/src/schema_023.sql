-- users.limit must admit the required customer administrator: null (unlimited) or an
-- integer >= 1, the same rule as admitsRequiredAdmin in @webvue/commercial-contracts.
-- Validated against existing rows: there are no live customers yet.
CREATE FUNCTION commercial_users_limit_admits_admin(limits jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN limits IS NULL OR NOT limits ? 'users.limit' THEN true
    ELSE CASE jsonb_typeof(limits->'users.limit')
      WHEN 'null' THEN true
      WHEN 'number' THEN (limits->>'users.limit')::numeric >= 1
        AND (limits->>'users.limit')::numeric = trunc((limits->>'users.limit')::numeric)
      ELSE false
    END
  END
$$;
ALTER TABLE plan_revisions ADD CONSTRAINT plan_revisions_users_limit_admits_admin
  CHECK (commercial_users_limit_admits_admin(platform_limits));
ALTER TABLE customer_terms_revisions ADD CONSTRAINT customer_terms_users_limit_admits_admin
  CHECK (commercial_users_limit_admits_admin(payload->'limits'));
