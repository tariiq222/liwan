# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import timedelta

from odoo import fields
from odoo.exceptions import ValidationError
from odoo.tests import tagged
from odoo.tools import mute_logger

from .common import LiwanInboxCase
from odoo.addons.liwan_inbox.controllers import reply_parsing

CATALOG = '300000000001'
PRODUCT = {'type': 'product', 'body': 'Nice', 'footer': None, 'product_retailer_id': 'sku-1'}
LIST = {'type': 'product_list', 'header': 'Offers', 'body': 'Pick', 'footer': 'Today', 'sections': [
    {'title': 'Shirts', 'product_retailer_ids': ['sku-1', 'sku-2']}, {'title': 'Hats', 'product_retailer_ids': ['sku-3']},
]}


@tagged('post_install', '-at_install', 'liwan')
class TestContractSerialization(LiwanInboxCase):
    """Real serializer output for the fields the zod contract types as strings (recorded as contract fixtures)."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.settings.visibility_policy = 'all'
        cls.conversation = cls.make_conversation()
        cls.channels_manager = cls._capability_user('inbox_channels_serialization', 'inbox.channels.manage')

    def message(self, **values):
        return self.env['liwan.inbox.message'].create({
            'conversation_id': self.conversation.id, 'company_id': self.conversation.company_id.id,
            'date': fields.Datetime.now() + timedelta(seconds=1), **values,
        })

    def thread(self):
        self.login(self.agent)
        response = self.get(f'/api/v1/inbox/conversations/{self.conversation.id}/messages')
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()['items']

    def test_a_whatsapp_channel_lists_its_phone_number_id_and_a_tiktok_channel_none(self):
        tiktok = self.make_tiktok_channel()
        self.login(self.channels_manager)
        rows = {row['id']: row for row in self.get('/api/v1/inbox/channels').json()['items']}
        self.assertIsInstance(rows[self.channel.id]['phone_number_id'], str)
        self.assertIsNone(rows[tiktok.id]['phone_number_id'])

    def test_an_empty_phone_number_id_is_null_not_false(self):
        self.env.cr.execute('UPDATE liwan_inbox_channel SET phone_number_id = NULL WHERE id = %s', [self.channel.id])
        self.channel.invalidate_recordset()
        self.login(self.channels_manager)
        row = self.get(f'/api/v1/inbox/channels/{self.channel.id}').json()
        self.assertIsNone(row['phone_number_id'])

    def test_every_commerce_message_of_a_thread_names_its_catalog(self):
        values = reply_parsing.parse_commerce(PRODUCT)
        self.message(direction='out', body=values.pop('body'), delivery_state='sent', catalog_id=CATALOG, **values)
        listed = reply_parsing.parse_commerce(LIST)
        self.message(direction='out', body=listed.pop('body'), delivery_state='sent', catalog_id=CATALOG, **listed)
        self.message(direction='in', kind='order', body='[order]', delivery_state='received', catalog_id=CATALOG, order_line_ids=[
            (0, 0, {'sequence': index, 'retailer_id': f'sku-{index}', 'quantity': 2, 'item_price': 7.99, 'currency': 'SAR'})
            for index in range(1, 4)
        ])
        self.message(direction='in', body='Price?', delivery_state='received',
                     referred_catalog_id=CATALOG, referred_retailer_id='sku-9')
        commerce = [row['commerce'] for row in self.thread() if row['commerce']]
        self.assertEqual([block['type'] for block in commerce], ['sent', 'sent', 'order', 'inquiry'])
        self.assertEqual({block['catalog_id'] for block in commerce}, {CATALOG})

    def test_a_commerce_message_without_a_catalog_id_is_refused(self):
        values = reply_parsing.parse_commerce(PRODUCT)
        with mute_logger('odoo.sql_db'), self.assertRaises(ValidationError):
            self.message(direction='out', body=values.pop('body'), delivery_state='queued', **values)
        with self.assertRaises(ValidationError):
            self.message(direction='in', kind='order', body='[order]', delivery_state='received')
        with self.assertRaises(ValidationError):
            self.message(direction='in', body='Price?', delivery_state='received', referred_retailer_id='sku-9')
