# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Put the e2e scratch tenant into a test state, or restore its baseline.

Scenarios about plans, limits and subscription states need the tenant profile
changed, which only the trusted operator may do. Run through the Odoo shell:

    E2E_TENANT_STATE='{"off": ["finance.enabled"], "drop_retained": ["finance.enabled"]}' \\
        odoo-bin shell -c <scratch conf> -d liwan_scratch_e2e --no-http < tools/e2e_tenant_state.py

State keys: ``off`` (feature keys set to false), ``drop_retained`` (keys removed
from the retained read features), ``limits`` (feature key -> value, e.g.
``{"projects.max_projects": 1}``), ``users_limit_delta`` (users.limit = current
users + delta), ``status`` (``active`` or ``suspended``), ``expired`` (true gives
a past ``valid_until``, the read-only state). Every state starts from the
baseline saved to ``.e2e/tenant_baseline.json`` before the first change on a
database instance (keyed by ``database.uuid``, so a rebuilt database saves its own);
``E2E_TENANT_STATE='{}'`` restores it exactly.
"""
import datetime
import json
import os
from pathlib import Path

from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT

DB_GUARD = 'liwan_scratch_e2e'
BASELINE = Path('.e2e/tenant_baseline.json')

if env.cr.dbname != DB_GUARD:  # noqa: F821
    raise SystemExit(f'e2e_tenant_state refuses database {env.cr.dbname!r}; only {DB_GUARD} is allowed')  # noqa: F821

profile = env['liwan.tenant.profile'].search([])  # noqa: F821
if len(profile) != 1:
    raise SystemExit('e2e_tenant_state expects exactly one tenant profile')
# The baseline belongs to one database instance: a rebuilt scratch database
# (E2E_ODOO_RESET=1) gets a new uuid, so its fresh policy is saved again.
database_uuid = env['ir.config_parameter'].get_param('database.uuid')  # noqa: F821
saved = json.loads(BASELINE.read_text(encoding='utf-8')) if BASELINE.exists() else {}
if saved.get('database_uuid') != database_uuid:
    BASELINE.write_text(json.dumps({
        'database_uuid': database_uuid,
        'features': profile.features, 'retained_read_features': profile.retained_read_features,
        'status': profile.status,
    }, ensure_ascii=False, indent=1), encoding='utf-8')
baseline = json.loads(BASELINE.read_text(encoding='utf-8'))
state = json.loads(os.environ.get('E2E_TENANT_STATE', '{}'))

features = dict(baseline['features'])
retained = list(baseline['retained_read_features'])
for key in state.get('off', []):
    features[key] = False
features.update(state.get('limits', {}))
if 'users_limit_delta' in state:
    features['users.limit'] = env['liwan.entitlement.service']._liwan_count_users() + int(state['users_limit_delta'])  # noqa: F821
retained = [key for key in retained if key not in state.get('drop_retained', [])]
valid_until = datetime.date.today() - datetime.timedelta(days=3) if state.get('expired') else False

# sudo: liwan.tenant.profile - the system-only access_liwan_tenant_profile_system row blocks the shell user's
# write; OPERATOR_CONTEXT is the trusted-operator path the platform requires for policy changes.
profile.with_context(**{OPERATOR_CONTEXT: True}).sudo().write({
    'features': features, 'retained_read_features': retained,
    'status': state.get('status', baseline['status']),
    'valid_until': valid_until, 'commercial_valid_until': False,
})
env.cr.commit()  # noqa: F821
profile.invalidate_recordset()
print('e2e tenant state:', profile.status, 'off', sorted(k for k, v in profile.features.items() if v is False),  # noqa: T201
      'valid_until', profile.valid_until)
