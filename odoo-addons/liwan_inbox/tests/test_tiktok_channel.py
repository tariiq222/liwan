# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The TikTok channel kind: the business id it needs, the feature it is gated by and its channel slot."""
from psycopg2.errors import UniqueViolation

from odoo.exceptions import ValidationError
from odoo.tests import tagged
from odoo.tools import mute_logger

from .common import BUSINESS_ACCOUNT_ID, LiwanInboxCase
from odoo.addons.liwan_api.tests.common import set_probe_feature
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule
from odoo.addons.liwan_inbox.models.constants import (
    CHANNELS_LIMIT,
    INBOX_FEATURE,
    WHATSAPP_FEATURE,
)
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT

BUSINESS_ID = 'business-open-id-0001'


@tagged('post_install', '-at_install', 'liwan')
class TestTikTokChannel(LiwanInboxCase):

    def make_tiktok(self, business_id=BUSINESS_ID, connection=None, **values):
        connection = connection or self.make_tiktok_connection(business_id)
        return self.env['liwan.inbox.channel'].create({
            'name': 'TikTok shop', 'kind': 'tiktok', 'connection_id': connection.id, **values,
        })

    def set_channel_limit(self, limit):
        profile = self.env.ref('liwan_platform.tenant_profile')
        profile.sudo().with_context(**{OPERATOR_CONTEXT: True}).write({
            'features': {**(profile.features or {}), CHANNELS_LIMIT: limit},
        })

    def test_whatsapp_needs_a_phone_number_id_and_a_meta_connection_of_its_company(self):
        base = {
            'name': 'WhatsApp', 'kind': 'whatsapp', 'phone_number_id': '100000000011',
            'connection_id': self.make_connection(BUSINESS_ACCOUNT_ID).id,
        }
        other = self.env['res.company'].create({'name': 'Other channel company'})
        for change in (
            {'phone_number_id': False}, {'phone_number_id': 'not-a-number'},
            {'connection_id': self.make_tiktok_connection(BUSINESS_ID).id},
            {'connection_id': self.make_connection('400000000004', other).id},
        ):
            with self.assertRaises(ValidationError), self.env.cr.savepoint():
                self.env['liwan.inbox.channel'].create({**base, **change})

    def test_a_tiktok_channel_needs_only_its_connection(self):
        channel = self.make_tiktok()
        self.assertEqual(
            (channel.kind, channel.connection_id.external_id, channel.phone_number_id, channel.state),
            ('tiktok', BUSINESS_ID, False, 'draft'),
        )
        with self.assertRaises(ValidationError), self.env.cr.savepoint():
            self.make_tiktok(connection=self.make_connection('400000000003'))

    def test_creating_a_tiktok_channel_follows_the_inbox_feature_alone(self):
        set_probe_feature(self, key=WHATSAPP_FEATURE, enabled=False)
        self.make_tiktok()
        with self.assertRaises(LiwanAccessRule) as refused, self.env.cr.savepoint():
            self.make_channel(phone_id='100000000009')
        self.assertEqual(refused.exception.code, 'feature_not_included')
        set_probe_feature(self, key=INBOX_FEATURE, enabled=False)
        with self.assertRaises(LiwanAccessRule) as refused:
            self.make_tiktok(business_id='business-open-id-0003')
        self.assertEqual(refused.exception.code, 'feature_not_included')

    def test_a_tiktok_account_has_one_channel(self):
        channel = self.make_tiktok()
        with mute_logger('odoo.sql_db'), self.assertRaises(UniqueViolation), self.env.cr.savepoint():
            self.make_tiktok(connection=channel.connection_id)
            self.env.flush_all()
        self.make_channel(phone_id='100000000012')
        self.make_channel(phone_id='100000000013')

    def test_tiktok_channels_count_against_the_channel_limit(self):
        service = self.env['liwan.entitlement.service']
        before = service._liwan_count_usage(CHANNELS_LIMIT)
        channel = self.make_tiktok()
        self.assertEqual(service._liwan_count_usage(CHANNELS_LIMIT), before + 1)
        self.set_channel_limit(before + 1)
        with self.assertRaises(LiwanAccessRule) as refused:
            self.make_tiktok(business_id='business-open-id-0002')
        self.assertEqual(refused.exception.details.get('limit_key'), CHANNELS_LIMIT)
        channel.unlink()
        self.assertEqual(service._liwan_count_usage(CHANNELS_LIMIT), before)

    def test_an_identity_can_be_addressed_on_tiktok(self):
        contact = self.env['liwan.inbox.contact'].create({'name': 'Sara', 'company_id': self.env.company.id})
        identity = self.env['liwan.inbox.contact.identity'].create({
            'contact_id': contact.id, 'channel_kind': 'tiktok', 'address': BUSINESS_ID,
            'company_id': self.env.company.id,
        })
        self.assertEqual(identity.channel_kind, 'tiktok')
