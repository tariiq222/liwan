# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.addons.nasq_api.tests.common import NasqApiCase


class NasqHrCase(NasqApiCase):
    """The shared nasq_api fixture (employee/admin users, api() helper) for the
    HR pillar's endpoint tests. HR records (departments, employees, documents)
    are created per test class, since each exercises a different shape."""
