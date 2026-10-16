# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.addons.webvue_api.tests.common import WebVueApiCase


class WebVueHrCase(WebVueApiCase):
    """The shared webvue_api fixture (employee/admin users, api() helper) for the
    HR pillar's endpoint tests. HR records (departments, employees, documents)
    are created per test class, since each exercises a different shape."""
