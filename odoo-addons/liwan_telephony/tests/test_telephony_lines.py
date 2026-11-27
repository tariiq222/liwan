# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The lines and extensions of the settings page (design sections 5, 8): what a write accepts and what it refuses."""
import json
import urllib.error

from odoo.fields import Command
from odoo.tests import new_test_user, tagged

from .common import (
    AGENT_KEY,
    AGENT_URL,
    LINE_NUMBERS,
    LINE_SHAPE,
    MANAGER_PASSWORD,
    PHONE_USER_PASSWORD,
    LiwanTelephonyCase,
    set_feature,
)
from .test_telephony_calls import assert_refused
from odoo.addons.liwan_telephony.models.agent_client import (
    DATABASE_HEADER,
    SIGNATURE_HEADER,
    TIMESTAMP_HEADER,
    _liwan_sign_reverse,
)
from odoo.addons.liwan_telephony.models.feature_registry import (
    EVENTS_FEATURE,
    EXTENSIONS_LIMIT,
)

LINES = '/api/v1/telephony/lines'
EXTENSIONS = '/api/v1/telephony/extensions'
NEW_LINE = {'name': 'GSM gateway', 'kind': 'mobile_gateway'}


@tagged('post_install', '-at_install', 'liwan')
class TestTelephonyLines(LiwanTelephonyCase):

    def setUp(self):
        super().setUp()
        set_feature(self, EVENTS_FEATURE)
        self.sign_in(self.manager, MANAGER_PASSWORD)

    def test_the_list_is_the_target_shape(self):
        listed = self.api('GET', LINES).json()
        self.assertEqual(set(listed), {'items', 'total'})
        self.assertEqual(listed['total'], 1)
        self.assertEqual(listed['items'][0], {
            'id': self.line.id, 'name': 'Main trunk', 'kind': 'sip_trunk', 'mode': 'a',
            'authMethod': 'credentials', 'providerHost': 'sip.provider.test', 'providerPort': 5060,
            'numbers': list(LINE_NUMBERS), 'outboundFormat': None, 'callerId': None, 'maxConcurrent': 1,
        })
        self.assertEqual(set(listed['items'][0]), LINE_SHAPE)

    def test_a_line_is_created_with_its_numbers_and_patched(self):
        created = self.api('POST', LINES, json={
            **NEW_LINE, 'providerHost': '10.0.0.8', 'providerPort': 5061, 'numbers': ['+966500000003', '+966500000004'],
            'outboundFormat': '9665', 'callerId': LINE_NUMBERS[0], 'maxConcurrent': 5,
        })
        self.assertEqual(created.status_code, 200, created.text)
        line = created.json()
        self.assertEqual(set(line), LINE_SHAPE)
        self.assertEqual(
            (line['kind'], line['mode'], line['providerPort'], line['numbers']),
            ('mobile_gateway', 'b', 5061, ['+966500000003', '+966500000004']),
        )
        self.assertEqual(
            (line['outboundFormat'], line['callerId'], line['maxConcurrent']), ('9665', LINE_NUMBERS[0], 5),
        )
        self.assertEqual(self.api('GET', LINES).json()['total'], 2)
        patched = self.api('PATCH', f"{LINES}/{line['id']}", json={
            'name': 'Site gateway', 'numbers': ['+966500000009'], 'providerHost': None, 'outboundFormat': '',
        })
        self.assertEqual((patched.status_code, patched.json()['name'], patched.json()['numbers']), (200, 'Site gateway', ['+966500000009']))
        self.assertEqual((patched.json()['providerHost'], patched.json()['outboundFormat']), (None, None))
        unchanged = self.api('PATCH', f"{LINES}/{line['id']}", json={})
        self.assertEqual((unchanged.status_code, unchanged.json()['kind']), (200, 'mobile_gateway'))

    def test_an_unknown_key_a_wrong_type_and_an_out_of_range_value_answer_422(self):
        for payload, field in (
            ({'password': 'x'}, 'password'),
            ({'mode': 'b'}, 'mode'),
            ({'kind': 'existing_pbx'}, 'kind'),
            ({'kind': None}, 'kind'),
            ({'authMethod': 'token'}, 'authMethod'),
            ({'name': '   '}, 'name'),
            ({'name': 'x' * 121}, 'name'),
            ({'name': 5}, 'name'),
            ({'providerHost': 'sip provider'}, 'providerHost'),
            ({'providerHost': 'x' * 254}, 'providerHost'),
            ({'providerHost': 7}, 'providerHost'),
            ({'providerPort': 0}, 'providerPort'),
            ({'providerPort': 65536}, 'providerPort'),
            ({'providerPort': '5060'}, 'providerPort'),
            ({'providerPort': True}, 'providerPort'),
            ({'numbers': '+966500000001'}, 'numbers'),
            ({'numbers': None}, 'numbers'),
            ({'numbers': ['966500000001']}, 'numbers'),
            ({'numbers': [LINE_NUMBERS[0], LINE_NUMBERS[0]]}, 'numbers'),
            ({'outboundFormat': '966x'}, 'outboundFormat'),
            ({'outboundFormat': '1' * 11}, 'outboundFormat'),
            ({'callerId': '0500000000'}, 'callerId'),
            ({'maxConcurrent': 0}, 'maxConcurrent'),
            ({'maxConcurrent': 1001}, 'maxConcurrent'),
        ):
            assert_refused(self, self.api('POST', LINES, json={**NEW_LINE, **payload}), 422, 'invalid', field)
            assert_refused(self, self.api('PATCH', f'{LINES}/{self.line.id}', json=payload), 422, 'invalid', field)
        assert_refused(self, self.api('POST', LINES, json={}), 422, 'invalid', 'name')
        assert_refused(self, self.api('PATCH', f'{LINES}/999999999', json={'name': 'Nowhere'}), 404, 'not_found')
        self.assertEqual(self.api('GET', LINES).json()['total'], 1)
        self.assertEqual(self.line.number_ids.mapped('number'), list(LINE_NUMBERS))

    def test_another_companys_line_answers_not_found(self):
        branch = self.env['res.company'].create({'name': 'Lines branch', 'parent_id': self.company.id})
        line = self.env['liwan.telephony.line'].create({'name': 'Branch line', 'company_id': branch.id})
        result = self.api('PATCH', f'{LINES}/{line.id}', json={'name': 'Taken'})
        self.assertEqual((result.status_code, result.content), (404, self.api('PATCH', f'{LINES}/999999999', json={}).content))

    def test_only_managers_write_lines(self):
        self.sign_in(self.phone_user, PHONE_USER_PASSWORD)
        self.assertEqual(self.api('GET', LINES).status_code, 200)
        assert_refused(self, self.api('POST', LINES, json=NEW_LINE), 403, 'forbidden')
        assert_refused(self, self.api('PATCH', f'{LINES}/{self.line.id}', json={'name': 'Taken'}), 403, 'forbidden')


@tagged('post_install', '-at_install', 'liwan')
class TestTelephonyExtensions(LiwanTelephonyCase):

    def setUp(self):
        super().setUp()
        set_feature(self, EVENTS_FEATURE)
        self.sign_in(self.manager, MANAGER_PASSWORD)

    def create(self, **payload):
        return self.api('POST', EXTENSIONS, json=payload)

    def test_the_list_is_the_target_shape_with_and_without_a_user(self):
        listed = self.api('GET', EXTENSIONS).json()
        self.assertEqual(listed, {'total': 2, 'items': [
            {'id': self.extension.id, 'number': '1001', 'user': {'id': self.manager.id, 'name': self.manager.name}, 'active': True},
            {'id': self.spare_extension.id, 'number': '1002', 'user': None, 'active': True},
        ]})

    def test_an_extension_is_created_with_or_without_a_user(self):
        with_user = self.create(number='1003', userId=self.manager.id)
        self.assertEqual((with_user.status_code, with_user.json()), (200, {
            'id': with_user.json()['id'], 'number': '1003', 'user': {'id': self.manager.id, 'name': self.manager.name},
            'active': True,
        }))
        without = self.create(number='1004')
        self.assertEqual((without.status_code, without.json()['number'], without.json()['user']), (200, '1004', None))
        explicit_null = self.create(number='1005', userId=None)
        self.assertEqual(
            (explicit_null.status_code, explicit_null.json()['number'], explicit_null.json()['user']),
            (200, '1005', None),
        )
        self.assertEqual(self.api('GET', EXTENSIONS).json()['total'], 5)

    def test_a_wrong_number_user_or_key_answers_422(self):
        branch = self.env['res.company'].create({'name': 'Extensions branch', 'parent_id': self.company.id})
        elsewhere = new_test_user(
            self.env, login='telephony_elsewhere', password='telephony_elsewhere_pass_123', name='Elsewhere',
            groups='liwan_core.group_employee', company_id=branch.id, company_ids=[Command.set([branch.id])],
        )
        gone = new_test_user(self.env, login='telephony_gone', password='telephony_gone_pass_123', name='Gone',
                             groups='liwan_core.group_employee')
        gone.active = False
        portal = new_test_user(self.env, login='telephony_portal', password='telephony_portal_pass_123', name='Portal',
                               groups='base.group_portal')
        for payload, field in (
            ({}, 'number'),
            ({'number': '1'}, 'number'),
            ({'number': '12345678901'}, 'number'),
            ({'number': '10a1'}, 'number'),
            ({'number': ' 101'}, 'number'),
            ({'number': 1001}, 'number'),
            ({'number': '1001'}, 'number'),
            ({'number': '1003', 'userId': 0}, 'userId'),
            ({'number': '1003', 'userId': '3'}, 'userId'),
            ({'number': '1003', 'userId': True}, 'userId'),
            ({'number': '1003', 'userId': elsewhere.id}, 'userId'),
            ({'number': '1003', 'userId': gone.id}, 'userId'),
            ({'number': '1003', 'userId': portal.id}, 'userId'),
            ({'number': '1003', 'password': 'x'}, 'password'),
        ):
            assert_refused(self, self.create(**payload), 422, 'invalid', field)
        self.assertEqual(self.api('GET', EXTENSIONS).json()['total'], 2)

    def test_the_sixth_extension_is_refused_when_the_limit_is_five(self):
        """The limit is claimed under the tenant profile lock, the way every plan limit of the platform is."""
        set_feature(self, EXTENSIONS_LIMIT, 5)
        for number in ('1003', '1004', '1005'):
            self.assertEqual(self.create(number=number).status_code, 200)
        sixth = self.create(number='1006')
        self.assertEqual((sixth.status_code, sixth.json()), (403, {
            'code': 'feature_not_included', 'message': 'this limit has been reached',
            'details': {'reason': 'limit', 'limit_key': 'telephony.extensions'},
        }))
        self.assertEqual(self.api('GET', EXTENSIONS).json()['total'], 5)
        set_feature(self, EXTENSIONS_LIMIT, 6)
        self.assertEqual(self.create(number='1006').status_code, 200)

    def test_an_unlimited_plan_accepts_the_extension(self):
        set_feature(self, EXTENSIONS_LIMIT, None)
        self.assertEqual(self.create(number='1003').status_code, 200)

    def test_only_managers_create_extensions(self):
        self.sign_in(self.phone_user, PHONE_USER_PASSWORD)
        self.assertEqual(self.api('GET', EXTENSIONS).status_code, 200)
        assert_refused(self, self.create(number='1003'), 403, 'forbidden')

    def test_creating_an_extension_notifies_the_agent_when_configured_and_rolls_back_on_failure(self):
        self.set_agent()
        sent = []

        def record(method, url, payload, headers):
            sent.append((method, url, payload, headers))
            return {'ok': True}

        self.patch_agent(record)
        created = self.create(number='1007')
        self.assertEqual(created.status_code, 200, created.text)
        self.assertEqual(len(sent), 1)
        method, url, payload, headers = sent[0]
        self.assertEqual((method, url), ('PUT', f'{AGENT_URL}/extensions/1007'))
        self.assertEqual(json.loads(payload), {'database': self.env.cr.dbname, 'active': True})
        self.assertEqual(headers[DATABASE_HEADER], self.env.cr.dbname)
        self.assertEqual(
            headers[SIGNATURE_HEADER],
            _liwan_sign_reverse(AGENT_KEY, headers[TIMESTAMP_HEADER], 'PUT', '/extensions/1007', payload),
        )

        def fail(method, url, payload, headers):
            reason = 'agent down'
            raise urllib.error.URLError(reason)

        self.patch_agent(fail)
        refused = self.create(number='1008')
        assert_refused(self, refused, 503, 'unavailable')
        self.assertFalse(self.env['liwan.telephony.extension'].search([('number', '=', '1008')]))
