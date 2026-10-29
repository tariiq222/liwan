# Part of Odoo. See LICENSE file for full copyright and licensing details.
import base64

from odoo.tests import tagged

from .campaign_common import BASE, CampaignCase

IMPORT = f'{BASE}/contacts/import'
BOM = '﻿'


@tagged('post_install', '-at_install', 'webvue')
class TestContactImport(CampaignCase):

    def setUp(self):
        super().setUp()
        self.login(self.campaigns_only)

    def upload(self, text, **overrides):
        body = {
            'name': 'list.csv', 'data': base64.b64encode(text.encode()).decode(), 'tag_ids': [], 'consent': 'unknown', **overrides,
        }
        return self.api('POST', IMPORT, body)

    def contact_of(self, digits):
        return self.env['webvue.inbox.contact.identity'].search([('address', '=', digits)]).contact_id

    def test_a_file_with_a_byte_order_mark_creates_contacts_with_tags_and_no_consent(self):
        response = self.upload(f'{BOM}phone,name,tags\n+966501110001,Sara,vip;new\n00966501110002,Omar,\n966501110003,,vip\n', tag_ids=[self.tag.id])
        self.assertEqual(response.json(), {'created': 3, 'updated': 0, 'skipped': 0, 'errors': []})
        sara, omar, nameless = (self.contact_of(f'96650111000{n}') for n in (1, 2, 3))
        self.assertEqual((sara.name, sara.phone, sara.marketing_consent, sara.imported), ('Sara', '+966501110001', 'unknown', True))
        self.assertEqual((set(sara.tag_ids.ids), omar.tag_ids.ids, nameless.name), ({self.tag.id, self.other_tag.id}, [self.tag.id], '+966501110003'))

    def test_local_numbers_need_the_default_country_code(self):
        refused = self.upload('phone\n0501110004\n')
        self.assertEqual(refused.json()['skipped'], 1)
        self.assertEqual(refused.json()['errors'][0]['line'], 2)
        self.assertIn('country code', refused.json()['errors'][0]['message'])
        self.settings.default_country_code = '966'
        accepted = self.upload('phone\n0501110004\n')
        self.assertEqual(accepted.json()['created'], 1)
        self.assertTrue(self.contact_of('966501110004'))
        self.settings.default_country_code = False

    def test_bad_rows_are_reported_and_skipped(self):
        response = self.upload('phone,tags\n123,\n+966501110005,unknown-tag\n+966501110006,vip\n+966501110006,vip\nabc,\n').json()
        self.assertEqual((response['created'], response['skipped']), (1, 4))
        self.assertEqual([error['line'] for error in response['errors']], [2, 3, 5, 6])
        self.assertIn('unknown tag', response['errors'][1]['message'])
        self.assertIn('twice', response['errors'][2]['message'])

    def test_the_errors_are_capped_but_every_row_counts(self):
        rows = '\n'.join(['phone'] + ['12'] * 60)
        response = self.upload(rows).json()
        self.assertEqual((response['skipped'], len(response['errors'])), (60, 50))

    def test_an_opted_in_import_records_the_proof_and_never_overrides_an_opt_out(self):
        out = self.make_contact(consent='opted_out', address='966501110007')
        known = self.make_contact(consent=None, address='966501110008')
        response = self.upload(
            'phone\n+966501110007\n+966501110008\n+966501110009\n', tag_ids=[self.tag.id], consent='opted_in', consent_note='signed form',
        ).json()
        self.assertEqual((response['created'], response['updated']), (1, 2))
        self.assertEqual(out.marketing_consent, 'opted_out')
        self.assertEqual((known.marketing_consent, known.marketing_consent_source), ('opted_in', 'import'))
        self.assertEqual(known.consent_ids.note, 'signed form')
        self.assertEqual(known.tag_ids, self.tag)
        self.assertEqual(self.contact_of('966501110009').marketing_consent, 'opted_in')

    def test_a_contact_already_opted_in_gets_no_second_event(self):
        known = self.make_contact(address='966501110010')
        self.upload('phone\n+966501110010\n', consent='opted_in', consent_note='again')
        self.assertEqual(len(known.consent_ids), 1)

    def test_every_invalid_request_answers_422(self):
        cases = [
            ('phone\n+966501110011', {'consent': 'opted_in'}, 'consent_note'),
            ('phone\n+966501110011', {'consent': 'opted_out'}, 'consent'),
            ('phone\n+966501110011', {'tag_ids': [999999999]}, 'tag_ids'),
            ('name\nSara', {}, 'data'),
            ('phone\n' + '\n'.join(['+966501110012'] * 10001), {}, 'data'),
        ]
        for text, overrides, field in cases:
            with self.subTest(field=field, text=text[:20]):
                self.assertError(self.upload(text, **overrides), 422, 'invalid')
        bad = self.api('POST', IMPORT, {'name': 'x.csv', 'data': base64.b64encode(b'\xff\xfe\x00phone').decode(), 'tag_ids': [], 'consent': 'unknown'})
        self.assertError(bad, 422, 'invalid')
        self.assertError(self.api('POST', IMPORT, {'name': 'x.csv', 'data': 'not base64!', 'tag_ids': [], 'consent': 'unknown'}), 422, 'invalid')

    def test_a_file_over_two_megabytes_is_refused(self):
        big = 'phone\n' + '+966501110013\n' * 200_000
        self.assertGreater(len(big), 2 * 1024 * 1024)
        self.assertError(self.upload(big), 413, 'payload_too_large')

    def test_imported_contacts_survive_the_retention_purge(self):
        self.upload('phone\n+966501110014\n')
        self.env['webvue.inbox.conversation']._webvue_purge_expired(self.env.company, fields_now())
        self.assertTrue(self.contact_of('966501110014'))


def fields_now():
    from odoo import fields  # noqa: PLC0415 - one use
    return fields.Datetime.now()


@tagged('post_install', '-at_install', 'webvue')
class TestContactMarketingApi(CampaignCase):

    def path(self, contact):
        return f'{BASE}/contacts/{contact.id}/marketing'

    def test_an_agent_records_an_opt_in_with_its_proof_and_an_opt_out_without_one(self):
        conversation = self.make_conversation()
        contact = conversation.contact_id
        conversation.assignee_id = self.agent
        self.login(self.agent)
        empty = self.get(self.path(contact)).json()
        self.assertEqual((empty['consent'], empty['history'], empty['tags']), ('unknown', [], []))
        self.assertError(self.api('PATCH', self.path(contact), {'consent': {'state': 'opted_in'}}), 422, 'invalid')
        marketing = self.api('PATCH', self.path(contact), {'consent': {'state': 'opted_in', 'note': 'website form'}}).json()
        self.assertEqual((marketing['consent'], marketing['consent_source'], marketing['history'][0]['note']), ('opted_in', 'agent', 'website form'))
        self.assertEqual(marketing['history'][0]['author']['id'], self.agent.id)
        out = self.api('PATCH', self.path(contact), {'consent': {'state': 'opted_out'}}).json()
        self.assertEqual((out['consent'], [event['state'] for event in out['history']]), ('opted_out', ['opted_out', 'opted_in']))
        tagged_contact = self.api('PATCH', self.path(contact), {'tag_ids': [self.tag.id]}).json()
        self.assertEqual(tagged_contact['tags'], [{'id': self.tag.id, 'name': 'vip'}])
        self.assertError(self.api('PATCH', self.path(contact), {}), 422, 'invalid')

    def test_a_reader_may_read_but_not_write(self):
        conversation = self.make_conversation()
        self.login(self.reader_only)
        self.assertEqual(self.get(self.path(conversation.contact_id)).status_code, 200)
        self.assertError(self.api('PATCH', self.path(conversation.contact_id), {'tag_ids': []}), 403, 'forbidden')

    def test_an_agent_cannot_reach_a_contact_of_a_conversation_they_cannot_see(self):
        conversation = self.make_conversation(assignee_id=self.agent2.id)
        self.login(self.agent)
        self.assertError(self.get(self.path(conversation.contact_id)), 404, 'not_found')

    def test_a_campaign_manager_reaches_any_contact_of_the_company(self):
        contact = self.make_contact()
        self.login(self.campaigns_only)
        self.assertEqual(self.get(self.path(contact)).json()['consent'], 'opted_in')
        patched = self.api('PATCH', self.path(contact), {'consent': {'state': 'opted_out', 'note': 'asked by phone'}}).json()
        self.assertEqual(patched['consent'], 'opted_out')
