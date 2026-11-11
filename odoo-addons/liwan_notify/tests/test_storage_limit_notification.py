# Part of Odoo. See LICENSE file for full copyright and licensing details.
import threading

from odoo.tests import TransactionCase, new_test_user, tagged
from odoo.tools import config

from odoo.addons.liwan_core.models.access_service import LiwanAccessRule
from odoo.addons.liwan_notify.models import notify_mail
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT

KIND = 'storage.limit_warning'
LIMIT_MB = 100


@tagged('post_install', '-at_install', 'liwan')
class TestStorageLimitNotification(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.profile = cls.env.ref('liwan_platform.tenant_profile')
        cls.profile._liwan_initialize_legacy_policy(cls.env['liwan.feature.registry']._liwan_installed_module_ids())
        cls.company = cls.profile.root_company_id
        cls.access = cls.env['liwan.access.service']
        cls.admin = new_test_user(
            cls.env, login='storage_admin@example.com', name='Storage admin', groups='liwan_core.group_employee',
        )
        cls.access._liwan_replace_assignments(
            cls.admin, [{'role_id': cls.env.ref('liwan_core.role_system_admin').id, 'company_id': cls.company.id}],
        )
        cls.employee = new_test_user(
            cls.env, login='storage_employee@example.com', name='Storage employee', groups='liwan_core.group_employee',
        )
        cls.access._liwan_replace_assignments(
            cls.employee, [{'role_id': cls.env.ref('liwan_core.role_employee').id, 'company_id': cls.company.id}],
        )

    def setUp(self):
        super().setUp()
        self.env['ir.config_parameter'].set_param('mail.default.from', 'LiwanOS <no-reply@liwanos.com>')
        self.env['ir.config_parameter'].set_param('web.base.url', 'https://tenant.example.com')
        self.service = self.env['liwan.entitlement.service']
        self.used = 0
        self.patch(type(self.service), '_liwan_count_storage_bytes', lambda model: self.used)
        self._set_mode('saas')
        self._set_limit(LIMIT_MB)

    def _set_limit(self, limit_mb):
        self.profile.with_context(**{OPERATOR_CONTEXT: True}).write({
            'features': {**self.profile.features, 'storage.limit_mb': limit_mb},
        })

    def _claim(self, percent, from_percent=None, user=None):
        """Claim so that usage goes from ``from_percent`` (one byte short of ``percent`` by default) to ``percent``."""
        limit_bytes = self.profile.features['storage.limit_mb'] * 1048576
        target = limit_bytes * percent // 100
        self.used = limit_bytes * from_percent // 100 if from_percent is not None else target - 1
        return self.service.with_user(user or self.employee)._liwan_claim_storage(target - self.used)

    def _set_mode(self, mode):
        # Fixture-only conversion; production ORM conversion is deliberately forbidden.
        source = 'control_plane' if mode == 'saas' else 'local_policy'
        self.env.cr.execute(
            'UPDATE liwan_tenant_profile SET commercial_mode=%s, entitlement_source=%s, valid_until=NULL WHERE id=%s',
            [mode, source, self.profile.id],
        )
        self.profile.invalidate_recordset()

    def _bell(self, user):
        items = self.env['liwan.notify.service'].with_user(user)._liwan_list(50)['items']
        return [item for item in items if item['kind'] == KIND]

    def _emails(self, address='storage_admin@example.com'):
        """Run the postcommit hooks and the send threads they start; the messages sent to ``address``."""
        started, sent = [], []

        class CapturedThread:
            def __init__(thread, target=None, args=(), name=None, daemon=None):
                thread.target, thread.args = target, args
                started.append(thread)

            def start(thread):
                thread.started = True

        self.patch(threading, 'Thread', CapturedThread)
        self.patch(
            type(self.env['ir.mail_server']), 'send_email',
            lambda server, message, *args, **kwargs: sent.append(message),
        )
        self.env.flush_all()
        with self.enter_registry_test_mode():
            self.env.cr.postcommit.run()
            for thread in started:
                thread.target(*thread.args)
        return [message for message in sent if message['To'] == address]

    def test_below_eighty_percent_warns_nobody(self):
        self._claim(79)
        self.assertEqual(self._bell(self.admin), [])
        self.assertEqual(self._emails(), [])

    def test_eighty_percent_warns_the_administrator_and_not_an_ordinary_user(self):
        self._claim(80)
        items = self._bell(self.admin)
        self.assertEqual(len(items), 1)
        self.assertIn('80%', items[0]['title'])
        self.assertFalse(items[0]['is_read'])
        self.assertEqual(self._bell(self.employee), [])

    def test_the_uploader_need_not_be_an_administrator_or_see_the_row(self):
        self._claim(80, user=self.employee)
        self.assertEqual(len(self._bell(self.admin)), 1)
        self.assertEqual(self._bell(self.employee), [])

    def test_a_later_claim_in_the_same_band_does_not_repeat_the_notice(self):
        self._claim(80)
        self._claim(85)
        self.assertEqual(len(self._bell(self.admin)), 1)
        self.assertEqual(len(self._emails()), 1)

    def test_ninety_five_percent_sends_the_ninety_five_notice(self):
        self._claim(96, from_percent=90)
        items = self._bell(self.admin)
        self.assertEqual(len(items), 1)
        self.assertIn('95%', items[0]['title'])

    def test_crossing_both_thresholds_at_once_sends_only_the_higher_one(self):
        self._claim(70)
        self.assertEqual(self._bell(self.admin), [])
        self._claim(96, from_percent=70)
        items = self._bell(self.admin)
        self.assertEqual(len(items), 1)
        self.assertIn('95%', items[0]['title'])

    def test_each_threshold_is_told_once(self):
        self._claim(80)
        self._claim(95)
        self._claim(99)
        titles = [item['title'] for item in self._bell(self.admin)]
        self.assertEqual(len(titles), 2)
        self.assertEqual(sum('80%' in title for title in titles), 1)
        self.assertEqual(sum('95%' in title for title in titles), 1)

    def test_a_new_limit_after_an_upgrade_warns_again(self):
        self._claim(80)
        self._set_limit(LIMIT_MB * 2)
        self._claim(80)
        self.assertEqual(len(self._bell(self.admin)), 2)

    def test_another_uploader_climbing_from_eighty_five_after_a_drop_sends_nothing(self):
        other = new_test_user(
            self.env, login='storage_other@example.com', name='Other uploader', groups='liwan_core.group_employee',
        )
        self._claim(96, from_percent=70)
        self._claim(86, from_percent=85, user=other)
        titles = [item['title'] for item in self._bell(self.admin)]
        self.assertEqual(len(titles), 1)
        self.assertIn('95%', titles[0])
        self.assertEqual(len(self._emails()), 1)

    def test_dropping_below_eighty_and_climbing_again_sends_one_new_eighty_notice(self):
        other = new_test_user(
            self.env, login='storage_other2@example.com', name='Other uploader', groups='liwan_core.group_employee',
        )
        self._claim(96, from_percent=70)
        self._claim(81, from_percent=70, user=other)
        self._claim(83, from_percent=82, user=other)
        titles = [item['title'] for item in self._bell(self.admin)]
        self.assertEqual(len(titles), 2)
        self.assertEqual(sum('80%' in title for title in titles), 1)
        self.assertEqual(sum('95%' in title for title in titles), 1)

    def test_outside_saas_nobody_is_warned(self):
        self._set_mode('non_saas')
        self._claim(96, from_percent=70)
        self._claim(81, from_percent=70)
        self.assertEqual(self._bell(self.admin), [])
        self.assertEqual(self._emails(), [])

    def test_a_raised_limit_rearms_the_eighty_notice_after_the_ninety_five_notice(self):
        self._claim(96, from_percent=90)
        self._set_limit(LIMIT_MB * 2)
        self._claim(80)
        titles = [item['title'] for item in self._bell(self.admin)]
        self.assertEqual(len(titles), 2)
        self.assertEqual(sum('80%' in title for title in titles), 1)

    def test_no_limit_never_warns(self):
        self._set_limit(None)
        self.used = 10 ** 15
        self.assertTrue(self.service.with_user(self.employee)._liwan_claim_storage(1))
        self.assertEqual(self._bell(self.admin), [])

    def test_a_refused_claim_warns_nobody(self):
        self.used = LIMIT_MB * 1048576
        with self.assertRaises(LiwanAccessRule):  # the platform's own refusal, tested in liwan_platform
            self.service.with_user(self.employee)._liwan_claim_storage(1)
        self.assertEqual(self._bell(self.admin), [])

    def test_one_email_per_delivered_notice_with_the_upgrade_link(self):
        self._claim(80)
        self._claim(90)
        emails = self._emails()
        self.assertEqual(len(emails), 1)
        body = emails[0].get_body(('plain',)).get_content()
        self.assertIn('https://tenant.example.com/subscription/change', body)
        self.assertIn('80%', body)
        self.assertEqual(emails[0]['From'], 'LiwanOS <no-reply@liwanos.com>')
        self.assertEqual(self._emails(address='storage_employee@example.com'), [])

    def test_without_a_sender_address_the_bell_still_rings_and_no_email_is_sent(self):
        self.env['ir.config_parameter'].set_param('mail.default.from', '')
        self.patch(config, 'get', lambda *args, **kwargs: None)
        with self.assertLogs(notify_mail.__name__, 'WARNING'):
            self._claim(80)
        self.assertEqual(len(self._bell(self.admin)), 1)
        self.assertEqual(self._emails(), [])

    def test_a_portal_uploader_warns_nobody_and_is_not_refused(self):
        portal = new_test_user(self.env, login='storage_portal@example.com', groups='base.group_portal')
        self.assertTrue(self._claim(80, user=portal))
        self.assertEqual(self._bell(self.admin), [])

    def test_vendor_support_accounts_are_not_warned(self):
        support = new_test_user(
            self.env, login='storage_support@example.com', groups='liwan_core.group_vendor_support',
        )
        self.assertNotIn(support, self.env['liwan.notify.storage.limit']._liwan_administrators())
        self.assertIn(self.admin, self.env['liwan.notify.storage.limit']._liwan_administrators())
        self.assertNotIn(self.employee, self.env['liwan.notify.storage.limit']._liwan_administrators())

    def test_a_row_sent_to_a_non_administrator_is_not_visible(self):
        profile = self.profile
        self.env['liwan.notify.service']._liwan_deliver(
            'liwan.tenant.profile', profile.id, KIND, self.employee.partner_id, 'forged', key=f'{KIND}:forged',
        )
        self.assertEqual(self._bell(self.employee), [])

    def test_the_administrator_of_the_root_company_is_found_from_a_branch_session(self):
        branch = self.env['res.company'].create({'name': 'Storage branch', 'parent_id': self.company.id})
        self.employee.write({'company_ids': [(4, branch.id)]})
        service = self.env['liwan.notify.storage.limit'].with_company(branch)
        self.assertIn(self.admin, service._liwan_administrators())
