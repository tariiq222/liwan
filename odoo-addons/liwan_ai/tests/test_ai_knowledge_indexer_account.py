# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import new_test_user, tagged

from odoo.addons.liwan_ai.tests.common import AiProbe
from odoo.addons.liwan_api.tests.common import LiwanApiCase
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule


@tagged('post_install', '-at_install', 'liwan')
class TestAiIndexerAccount(AiProbe, LiwanApiCase):
    """No access administrator can wake, sign in as or change the technical indexer user."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.admin = new_test_user(
            cls.env, login='ai_indexer_admin', password='ai_indexer_admin_pass_123',
            groups='liwan_core.group_access_admin',
        )

    def setUp(self):
        super().setUp()
        self._install_probe()
        self._install_knowledge()
        self.indexer = self.env.ref('liwan_ai.user_ai_indexer')
        self.authenticate('ai_indexer_admin', 'ai_indexer_admin_pass_123')

    def _keys(self, acting, company=None):
        return self.env['liwan.access.service'].with_user(acting)._liwan_capability_keys(self.indexer, company=company or self.env.company)

    def test_the_inactive_indexer_acting_as_itself_holds_the_declared_capabilities(self):
        self.assertIn('ai.use', self._keys(self.indexer))

    def test_nobody_else_is_given_the_indexer_capabilities(self):
        self.assertNotIn('ai.use', self._keys(self.env.ref('base.user_root')))
        self.assertNotIn('ai.use', self._keys(self.admin))

    def test_an_active_indexer_gets_no_capabilities(self):
        self.indexer.active = True
        self.env['liwan.access.service']._liwan_clear_branch_cache()
        self.assertNotIn('ai.use', self._keys(self.indexer))

    def test_an_access_administrator_cannot_reactivate_the_indexer(self):
        response = self.api('POST', f'/api/v1/admin/users/{self.indexer.id}/reactivate', {
            'expected_version': self.indexer.liwan_access_version,
        })
        self.assertIn(response.status_code, (403, 404), response.text)
        self.assertFalse(self.indexer.active)

    def test_the_reactivation_guard_itself_refuses_the_indexer(self):
        with self.assertRaises(LiwanAccessRule) as caught:
            self.env['liwan.access.service']._liwan_assert_account_reactivation(self.indexer)
        self.assertEqual(caught.exception.status, 403)

    def test_an_access_administrator_cannot_send_it_a_reset_link_or_change_it(self):
        response = self.api('POST', f'/api/v1/admin/users/{self.indexer.id}/reset-link', {
            'expected_version': self.indexer.liwan_access_version,
        })
        self.assertEqual(response.status_code, 404, response.text)
        self.assertFalse(self.indexer.password)
        for path, body in (
            (f'/api/v1/admin/users/{self.indexer.id}/disable', {'expected_version': 0}),
            (f'/api/v1/admin/users/{self.indexer.id}/access', {'expected_version': 0, 'assignments': []}),
        ):
            with self.subTest(path=path):
                self.assertIn(self.api('POST' if path.endswith('disable') else 'PATCH', path, body).status_code, (404, 422))
                self.assertFalse(self.env['liwan.access.assignment'].search([('user_id', '=', self.indexer.id)]))

    def test_the_indexer_is_not_listed_among_the_users(self):
        listed = self.api('GET', '/api/v1/admin/users?status=stopped&limit=200').json()
        self.assertNotIn(self.indexer.id, [item['id'] for item in listed['items']])
        self.assertNotIn(self.indexer.id, [item['id'] for item in self.api('GET', '/api/v1/admin/users?q=indexer').json()['items']])
