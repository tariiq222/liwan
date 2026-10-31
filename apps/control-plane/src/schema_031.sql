-- Restoring an archived branch is a priced order, quoted like adding a branch: the quote request lists the branches
-- to restore, and the order kind says so. The restore reservation moves an archived branch back to pending (its
-- Odoo company is kept); every other way out of archived stays closed.
ALTER TABLE branch_quote_requests ADD COLUMN restore jsonb NOT NULL DEFAULT '[]';
ALTER TABLE orders DROP CONSTRAINT orders_kind_check;
ALTER TABLE orders ADD CONSTRAINT orders_kind_check CHECK(kind IN ('new','change','renewal','branch_add','branch_archive','branch_restore'));
CREATE OR REPLACE FUNCTION commercial_branch_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'branch_never_deleted'; END IF;
  IF OLD.state='archived' AND NEW.state NOT IN ('archived','pending') THEN RAISE EXCEPTION 'branch_archived_immutable'; END IF;
  IF OLD.state='archived' AND NEW.state='pending' AND OLD.odoo_company_id IS NULL THEN RAISE EXCEPTION 'branch_archived_immutable'; END IF;
  IF NEW.id<>OLD.id OR NEW.subscription_id<>OLD.subscription_id OR NEW.kind<>OLD.kind THEN RAISE EXCEPTION 'branch_identity_immutable'; END IF;
  RETURN NEW;
END $$;
