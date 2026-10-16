# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import new_test_user

from odoo.addons.webvue_api.tests.common import WebVueApiCase


class WebVueMeetingsCase(WebVueApiCase):
    """The shared webvue_api fixture plus a second internal user; no project records."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.manager = new_test_user(cls.env, login='api_mgr', password='api_mgr_pass_123',
                                    name='Mona', groups='webvue_core.group_employee')
