# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import HttpCase, new_test_user

from odoo.addons.nasq_platform.models.entitlement_service import OPERATOR_CONTEXT

# A test-only boolean feature for shared-service tests that must not depend on
# an application being installed. nasq_platform owns it, so it counts as
# installed wherever the test runs.
PROBE_FEATURE = 'test_probe.enabled'


def register_probe_feature(case, key=PROBE_FEATURE):
    """Add ``key`` to the feature registry for the length of one test."""
    env = case.env
    profile = env.ref('nasq_platform.tenant_profile')
    # Initialise the tenant before the registry grows: the one-shot legacy
    # policy validates the complete feature set and does not know the probe.
    profile._nasq_initialize_legacy_policy(env['nasq.feature.registry']._nasq_installed_module_ids())
    registry = type(env['nasq.feature.registry'])
    definitions = registry._nasq_feature_definitions
    probe = {'key': key, 'type': 'boolean', 'owner': 'nasq_platform', 'module': 'nasq_platform'}
    case.patch(registry, '_nasq_feature_definitions', lambda model: (*definitions(model), probe))


def set_probe_feature(case, key=PROBE_FEATURE, enabled=True, retained=False):
    """Switch a registered probe feature; ``retained`` keeps its reads open while it is off."""
    profile = case.env.ref('nasq_platform.tenant_profile')
    kept = [item for item in (profile.retained_read_features or []) if item != key]
    profile.sudo().with_context(**{OPERATOR_CONTEXT: True}).write({
        'features': {**(profile.features or {}), key: enabled},
        'retained_read_features': [*kept, key] if retained else kept,
    })


class NasqApiCase(HttpCase):
    """Shared HTTP fixture: the base nasq employee role plus a JSON ``api()`` helper.

    Holds nothing pillar-specific — a pillar addon subclasses this and adds
    its own records (see ``nasq_pmo/tests/common.py``) so the pillars never
    write to this file.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        profile = cls.env.ref('nasq_platform.tenant_profile', raise_if_not_found=False)
        if profile:
            profile._nasq_initialize_legacy_policy(
                cls.env['nasq.feature.registry']._nasq_installed_module_ids(),
            )
        cls.employee = new_test_user(cls.env, login='api_emp', password='api_emp_pass_123',
                                     name='Sara', groups='nasq_core.group_employee')

    def api(self, method, path, json=None, timeout=None):
        headers = {'Content-Type': 'application/json'}
        kwargs = {} if timeout is None else {'timeout': timeout}
        return self.url_open(path, json=json, headers=headers, method=method, **kwargs)
