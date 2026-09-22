# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.addons.nasq_platform.commercial_config import load_classification


def _invalid(message):
    raise ValueError(message)


def migrate(cr, version):
    if not version:
        return
    cr.execute('SELECT id, valid_until FROM nasq_tenant_profile FOR UPDATE')
    rows = cr.fetchall()
    if len(rows) != 1:
        _invalid('nasq commercial migration: exactly one profile required')
    profile_id, valid_until = rows[0]
    classification = load_classification(cr.dbname, valid_until)
    cr.execute("""
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'nasq_tenant_profile'
          AND column_name IN ('commercial_mode', 'entitlement_source')
    """)
    columns = {row[0] for row in cr.fetchall()}
    if columns and len(columns) != 2:
        _invalid('nasq commercial migration: partial classification schema')
    if columns:
        cr.execute('SELECT commercial_mode, entitlement_source FROM nasq_tenant_profile WHERE id = %s', [profile_id])
        existing = cr.fetchone()
        desired = (classification['commercial_mode'], classification['entitlement_source'])
        if existing != (None, None):
            if existing != desired:
                _invalid('nasq commercial migration: classified installation cannot be converted')
            if existing[0] == 'non_saas' and valid_until:
                _invalid('nasq commercial migration: classified independent cutoff is invalid')
            return
    # Input is fully validated before DDL or data changes. All changes stay in the upgrade transaction.
    cr.execute('ALTER TABLE nasq_tenant_profile ADD COLUMN IF NOT EXISTS commercial_mode varchar')
    cr.execute('ALTER TABLE nasq_tenant_profile ADD COLUMN IF NOT EXISTS entitlement_source varchar')
    cr.execute("""
        UPDATE nasq_tenant_profile SET commercial_mode = %s, entitlement_source = %s,
            valid_until = CASE WHEN %s THEN NULL ELSE valid_until END
        WHERE id = %s
    """, [classification['commercial_mode'], classification['entitlement_source'],
          classification['clear_valid_until'], profile_id])
