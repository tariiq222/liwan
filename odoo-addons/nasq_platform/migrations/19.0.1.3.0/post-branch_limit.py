# Part of Odoo. See LICENSE file for full copyright and licensing details.
import json


def migrate(cr, version):
    """Add the new ``branches.extra_limit`` key to an already configured policy.

    The feature validator requires every platform limit key, so a profile
    written before 19.0.1.3.0 would reject its next policy write. ``null``
    keeps the pre-existing unlimited convention of the other legacy limits.
    """
    if not version:
        return
    cr.execute('SELECT id, features FROM nasq_tenant_profile FOR UPDATE')
    for profile_id, features in cr.fetchall():
        if not isinstance(features, dict) or 'branches.extra_limit' in features:
            continue
        features['branches.extra_limit'] = None
        cr.execute(
            'UPDATE nasq_tenant_profile SET features = %s WHERE id = %s',
            [json.dumps(features), profile_id],
        )
