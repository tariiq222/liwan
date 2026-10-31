# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Per-request company isolation for the catalog and order GET record routes of the inbox payments bridge."""
import base64
import os
from unittest.mock import patch

from odoo.tests import new_test_user, tagged

from odoo.addons.liwan_api.tests.common import (
    CompanyIsolationCase,
    assert_isolation_discovery,
    cover_isolation_routes,
    exempt_isolation_route,
)
from odoo.addons.liwan_inbox.models.secret_box import KEY_ENV
from odoo.addons.liwan_inbox.tests.common import ACCESS_TOKEN, APP_SECRET
from odoo.addons.liwan_inbox_payments.tests.common import CATALOG_ID, image_bytes

EXPECTED_GET_RECORD_ROUTES = 9
PASSWORD = 'iso_inbox_pay_nocap_pass_123'
# Visible and hidden company tags per session company. iso_user holds the inbox manager role in the parent
# and both branches, so a parent session reads its branches; a branch session never reads the parent or a
# sibling, and the independent company C is hidden from every other session.
MATRIX = (
    ('p', ('p', 'p1', 'p2'), ('c',)),
    ('p1', ('p1',), ('p', 'p2', 'c')),
    ('p2', ('p2',), ('p', 'p1', 'c')),
    ('c', ('c',), ('p', 'p1', 'p2')),
)


@tagged('post_install', '-at_install', 'liwan')
class TestInboxPaymentsCompanyIsolation(CompanyIsolationCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        env_patch = patch.dict(os.environ, {KEY_ENV: base64.urlsafe_b64encode(os.urandom(32)).decode()})
        env_patch.start()
        cls.addClassCleanup(env_patch.stop)
        cls.by_tag = {'p': cls.company_p, 'p1': cls.company_p1, 'p2': cls.company_p2, 'c': cls.company_c}
        Assignment = cls.env['liwan.access.assignment'].sudo()
        manager = cls.env.ref('liwan_inbox.role_inbox_manager')
        for company in cls.by_tag.values():
            Assignment.create({'user_id': cls.iso_user.id, 'role_id': manager.id, 'company_id': company.id})
        cls.no_cap = new_test_user(
            cls.env, login='iso_inbox_pay_nocap', password=PASSWORD, name='No inbox',
            groups='liwan_core.group_employee', company_id=cls.company_p.id,
        )
        cls.no_cap.company_ids = [(6, 0, [cls.company_p.id])]
        Assignment.create({
            'user_id': cls.no_cap.id, 'role_id': cls.env.ref('liwan_core.role_employee').id,
            'company_id': cls.company_p.id,
        })
        Channel = cls.env['liwan.inbox.channel']
        cls.recs = {}
        for i, (tag, company) in enumerate(cls.by_tag.items(), start=1):
            account = f'20000000{i:04d}'
            channel = Channel.create({
                'name': f'Channel {tag}', 'phone_number_id': f'90000000{i:04d}', 'business_account_id': account,
                'state': 'connected', 'owner_company_id': company.id,
                **Channel._liwan_secret_values(access_token=ACCESS_TOKEN, app_secret=APP_SECRET),
            })
            catalog = cls.env['liwan.inbox.catalog'].create({
                'company_id': company.id, 'business_account_id': account, 'meta_catalog_id': CATALOG_ID,
                'name': f'Shop {tag}', 'brand': 'Acme',
            })
            product = cls.env['product.product'].create({
                'name': f'Product {tag}', 'type': 'consu', 'list_price': 10.0, 'company_id': company.id,
                'image_1920': base64.b64encode(image_bytes()),
            })
            item = cls.env['liwan.inbox.catalog.item'].create({
                'catalog_id': catalog.id, 'product_id': product.id, 'retailer_id': f'iso-{tag}',
            })
            contact = cls.env['liwan.inbox.contact'].create({
                'name': f'Customer {tag.upper()}', 'phone': f'+96650000{i:04d}', 'company_id': company.id,
            })
            identity = cls.env['liwan.inbox.contact.identity'].create({
                'contact_id': contact.id, 'channel_kind': 'whatsapp', 'address': f'96650000{i:04d}', 'company_id': company.id,
            })
            conversation = cls.env['liwan.inbox.conversation'].create({
                'channel_id': channel.id, 'contact_id': contact.id, 'identity_id': identity.id, 'company_id': company.id,
            })
            order = cls.env['liwan.inbox.order'].create({
                'company_id': company.id, 'conversation_id': conversation.id, 'catalog_id': catalog.id,
                'cart_total': 10.0, 'cart_currency': 'SAR',
            })
            cls.recs[tag] = {
                'channel': channel, 'catalog': catalog, 'item': item, 'conversation': conversation, 'order': order,
            }

    @staticmethod
    def paths(rec):
        return {
            'catalog': f'/api/v1/inbox/catalogs/{rec["catalog"].id}',
            'items': f'/api/v1/inbox/catalogs/{rec["catalog"].id}/items',
            'products': f'/api/v1/inbox/catalogs/{rec["catalog"].id}/products',
            'item': f'/api/v1/inbox/catalog-items/{rec["item"].id}',
            'pick': f'/api/v1/inbox/conversations/{rec["conversation"].id}/catalog-items',
            'commerce': f'/api/v1/inbox/channels/{rec["channel"].id}/commerce',
            'order': f'/api/v1/inbox/orders/{rec["order"].id}',
            'conversation_orders': f'/api/v1/inbox/conversations/{rec["conversation"].id}/orders',
        }

    @staticmethod
    def hidden_id(kind, rec):
        return {
            'catalog': rec['catalog'], 'items': rec['catalog'], 'products': rec['catalog'], 'item': rec['item'],
            'pick': rec['conversation'], 'commerce': rec['channel'], 'order': rec['order'],
            'conversation_orders': rec['conversation'],
        }[kind].id

    def test_record_matrix(self):
        """Visible companies answer 200 on every record route; every other company answers the not-found."""
        for current, visible, hidden in MATRIX:
            self.env_in(self.by_tag[current])
            for tag in visible:
                for kind, path in self.paths(self.recs[tag]).items():
                    with self.subTest(current=current, visible=tag, route=kind):
                        self.assertVisible(path)
            for tag in hidden:
                rec = self.recs[tag]
                for kind, path in self.paths(rec).items():
                    with self.subTest(current=current, hidden=tag, route=kind):
                        self.assertHiddenEveryWay('GET', path, self.hidden_id(kind, rec))

    def test_lists_never_show_another_company(self):
        for current, visible, hidden in MATRIX:
            self.env_in(self.by_tag[current])
            for path, key in (('/api/v1/inbox/catalogs', 'catalog'), ('/api/v1/inbox/orders', 'order')):
                ids = {item['id'] for item in self.assertVisible(path).json()['items']}
                for tag in visible:
                    self.assertIn(self.recs[tag][key].id, ids, f'{path}: {tag} missing from {current}')
                for tag in hidden:
                    self.assertNotIn(self.recs[tag][key].id, ids, f'{path}: {tag} leaked into {current}')

    def test_missing_capability_in_the_same_company_stays_forbidden(self):
        self.authenticate('iso_inbox_pay_nocap', PASSWORD)
        for path in self.paths(self.recs['p']).values():
            self.assertEqual(self.api('GET', path).status_code, 403, path)

    def test_discovery_covers_every_get_record_route(self):
        assert_isolation_discovery(self, 'liwan_inbox_payments', EXPECTED_GET_RECORD_ROUTES)


cover_isolation_routes((
    '/api/v1/inbox/catalogs/<int:catalog_id>',
    '/api/v1/inbox/catalogs/<int:catalog_id>/items',
    '/api/v1/inbox/catalogs/<int:catalog_id>/products',
    '/api/v1/inbox/catalog-items/<int:item_id>',
    '/api/v1/inbox/conversations/<int:conversation_id>/catalog-items',
    '/api/v1/inbox/channels/<int:channel_id>/commerce',
    '/api/v1/inbox/orders/<int:order_id>',
    '/api/v1/inbox/conversations/<int:conversation_id>/orders',
), source='liwan_inbox_payments/tests/test_company_isolation.py')
exempt_isolation_route(
    '/api/v1/public/inbox/catalog/images/<int:item_id>/<string:token>',
    'public route for Meta, authorized by the item token alone and covered by test_public_image.py (owner decision D3)',
)
