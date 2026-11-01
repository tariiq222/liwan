# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date

from odoo.addons.liwan_api.tests.common import LiwanApiCase
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT


def set_hr_feature(case, key, enabled=True):
    """Switch one registered HR feature for the length of a test.

    The tenant policy is a protected record, so the write runs under the operator
    context like ``liwan_api.tests.common.set_probe_feature``. The key is dropped from
    ``retained_read_features`` so switching an area off closes its reads too.
    """
    profile = case.env.ref('liwan_platform.tenant_profile')
    retained = [item for item in (profile.retained_read_features or []) if item != key]
    profile.sudo().with_context(**{OPERATOR_CONTEXT: True}).write({
        'features': {**(profile.features or {}), key: enabled},
        'retained_read_features': retained,
    })


def use_hr_decision_path(case):
    """Test HR's own approve and refuse path even when an approval workflow bridge is installed.

    A bridge governs every new leave while its workflow feature is on, so these tests switch that
    feature off, which is the documented way back to the HR roles; the bridge's own tests switch it on.
    """
    key = 'operations.enabled'
    if key in case.env['liwan.entitlement.service']._liwan_registry()._liwan_feature_map():
        set_hr_feature(case, key, False)


def make_archivable(env, employees):
    """Give employees a departure date and a confirmed settlement, so the exit check lets them be archived.

    The settlement row is written directly: these tests are about the archive, not the settlement figures.
    """
    for employee in employees:
        departure = employee.departure_date or date.today()
        employee.write({'departure_date': departure})
        env['liwan.hr.payroll.eos.settlement'].create({
            'employee_id': employee.id, 'departure_date': departure, 'case': 'resignation', 'state': 'confirmed',
        })
    return employees


class LiwanHrCase(LiwanApiCase):
    """The shared liwan_api fixture (employee/admin users, api() helper) for the
    HR pillar's endpoint tests. HR records (departments, employees, documents)
    are created per test class, since each exercises a different shape."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        use_hr_decision_path(cls)
