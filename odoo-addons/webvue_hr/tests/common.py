# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.addons.webvue_api.tests.common import WebVueApiCase
from odoo.addons.webvue_platform.models.entitlement_service import OPERATOR_CONTEXT


def set_hr_feature(case, key, enabled=True):
    """Switch one registered HR feature for the length of a test.

    The tenant policy is a protected record, so the write runs under the operator
    context like ``webvue_api.tests.common.set_probe_feature``. The key is dropped from
    ``retained_read_features`` so switching an area off closes its reads too.
    """
    profile = case.env.ref('webvue_platform.tenant_profile')
    retained = [item for item in (profile.retained_read_features or []) if item != key]
    profile.sudo().with_context(**{OPERATOR_CONTEXT: True}).write({
        'features': {**(profile.features or {}), key: enabled},
        'retained_read_features': retained,
    })


class WebVueHrCase(WebVueApiCase):
    """The shared webvue_api fixture (employee/admin users, api() helper) for the
    HR pillar's endpoint tests. HR records (departments, employees, documents)
    are created per test class, since each exercises a different shape."""
