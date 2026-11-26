# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import new_test_user

from odoo.addons.liwan_api.tests.common import LiwanApiCase


class LiwanTelephonyCase(LiwanApiCase):
    """The shared liwan_api fixture plus a telephony manager, a listener and a call."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.manager = new_test_user(
            cls.env, login='telephony_manager', password='telephony_manager_pass_123',
            name='Telephony Manager', groups='liwan_core.group_employee',
        )
        cls.env['liwan.access.service']._liwan_replace_assignments(cls.manager, [{
            'role_id': cls.env.ref('liwan_telephony.role_telephony_manager').id,
            'company_id': cls.env.company.id,
        }])
        cls.outsider = new_test_user(
            cls.env, login='telephony_outsider', password='telephony_outsider_pass_123',
            name='No Telephony access', groups='base.group_user',
        )
        cls.line = cls.env['liwan.telephony.line'].create({
            'name': 'Main trunk',
            'kind': 'sip_trunk',
            'auth_method': 'credentials',
            'provider_host': 'sip.provider.test',
            'numbers': '+966500000001',
        })
        cls.extension = cls.env['liwan.telephony.extension'].create({
            'number': '1001',
            'user_id': cls.manager.id,
        })
        cls.call = cls.env['liwan.telephony.call'].create({
            'linkedid': '1764049999.1',
            'direction': 'in',
            'state': 'answered',
            'remote_number': '+966500000000',
            'extension_number': '1001',
            'user_id': cls.manager.id,
            'started_at': '2026-11-25 09:00:00',
            'answered_at': '2026-11-25 09:00:05',
            'ended_at': '2026-11-25 09:02:05',
        })
