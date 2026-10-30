# Part of Odoo. See LICENSE file for full copyright and licensing details.
import base64
from datetime import timedelta
from unittest.mock import MagicMock, patch

import requests

from odoo import Command, fields
from odoo.tests import new_test_user, tagged

from .common import PASSWORD, TEMPLATE_KEYS, LiwanInboxCase
from .media_samples import MP4, OGG, PDF, PNG
from odoo.addons.liwan_api.tests.common import set_probe_feature
from odoo.addons.liwan_inbox.adapters import whatsapp

BASE = '/api/v1/inbox'
STANDARD = {
    'name': 'order_ready', 'language': 'ar', 'category': 'utility', 'allow_category_change': False, 'header': None,
    'body': 'Hi {{1}}', 'body_examples': ['Sara'], 'footer': None, 'buttons': [],
}
AUTHENTICATION = {
    'name': 'login_code', 'language': 'en', 'category': 'authentication', 'add_security_recommendation': True,
    'code_expiration_minutes': 10, 'otp_button_text': 'Copy code',
}
CREATED = {'id': '555000001', 'status': 'PENDING', 'category': 'UTILITY'}


def response(status, body=None):
    mocked = MagicMock(status_code=status)
    mocked.json.return_value = body if body is not None else {}
    return mocked


@tagged('post_install', '-at_install', 'liwan')
class TestTemplatesApi(LiwanInboxCase):

    def setUp(self):
        super().setUp()
        self.login(self.manager)

    @property
    def templates(self):
        return f'{BASE}/channels/{self.channel.id}/templates'

    def create(self, payload=None, **overrides):
        return self.api('POST', self.templates, {**(payload or STANDARD), **overrides})

    def upload(self, name='sample.png', content=PNG, mimetype='image/png'):
        return self.api('POST', f'{self.templates}/uploads', {
            'name': name, 'mimetype': mimetype, 'data': base64.b64encode(content).decode(),
        })

    # reading

    def test_list_and_detail_return_the_whole_structure(self):
        template = self.make_template(
            name='full', header_type='text', header_text='Order {{1}}', header_example='42', body='Hi {{1}} and {{2}}',
            example_ids=['Sara', 'Ali'], footer='Thanks', quality='green', status='rejected', status_reason='INVALID_FORMAT',
            button_ids=[
                {'kind': 'quick_reply', 'text': 'Yes'},
                {'kind': 'url', 'text': 'Track', 'url': 'https://example.com/{{1}}', 'example': 'https://example.com/9'},
                {'kind': 'url', 'text': 'Home', 'url': 'https://example.com'},
                {'kind': 'phone_number', 'text': 'Call', 'phone_number': '+966500000000'},
                {'kind': 'copy_code', 'example': 'SAVE10'},
            ],
        )
        self.login(self.agent)
        listed = self.get(self.templates).json()
        item = next(row for row in listed['items'] if row['id'] == template.id)
        self.assertEqual(set(item), TEMPLATE_KEYS)
        self.assertEqual(item, {
            'id': template.id, 'name': 'full', 'language': 'ar', 'category': 'utility', 'status': 'rejected',
            'status_reason': 'INVALID_FORMAT', 'quality': 'green',
            'header': {'type': 'text', 'text': 'Order {{1}}', 'example': '42'},
            'body': 'Hi {{1}} and {{2}}', 'body_examples': ['Sara', 'Ali'], 'footer': 'Thanks',
            'buttons': [
                {'type': 'quick_reply', 'text': 'Yes'},
                {'type': 'url', 'text': 'Track', 'url': 'https://example.com/{{1}}', 'example': 'https://example.com/9'},
                {'type': 'url', 'text': 'Home', 'url': 'https://example.com', 'example': None},
                {'type': 'phone_number', 'text': 'Call', 'phone_number': '+966500000000'},
                {'type': 'copy_code', 'example': 'SAVE10'},
            ],
            'add_security_recommendation': False, 'code_expiration_minutes': None, 'otp_button_text': None, 'param_count': 2, 'editable': True,
            'supported': True,
        })
        self.assertEqual(self.get(f'{BASE}/templates/{template.id}').json(), item)
        self.assertEqual(listed['total'], len(listed['items']))

    def test_header_shapes_and_the_authentication_button(self):
        media = self.make_template(header_type='image')
        sample = self.env['ir.attachment'].create({
            'name': 's.png', 'raw': PNG, 'mimetype': 'image/png', 'res_model': media._name, 'res_id': media.id,
        })
        media.header_example_attachment_id = sample
        located = self.make_template(header_type='location')
        otp = self.make_template(
            category='authentication', body='{{1}} is your code.', add_security_recommendation=True,
            code_expiration_minutes=5, button_ids=[{'kind': 'otp', 'text': 'Copy code'}],
        )
        bare = self.make_template(header_type='image')
        fetch = lambda template: self.get(f'{BASE}/templates/{template.id}').json()  # noqa: E731
        self.assertEqual(fetch(media)['header'], {
            'type': 'image', 'example_attachment': {'id': sample.id, 'name': 's.png', 'mimetype': 'image/png', 'size': len(PNG)},
        })
        self.assertEqual(fetch(bare)['header'], {'type': 'image', 'example_attachment': None})
        self.assertEqual(fetch(located)['header'], {'type': 'location'})
        auth = fetch(otp)
        self.assertEqual((auth['buttons'], auth['otp_button_text'], auth['add_security_recommendation'], auth['code_expiration_minutes']),
                         ([], 'Copy code', True, 5))
        self.assertEqual(auth['param_count'], 1)

    def test_list_filters_and_paging(self):
        self.make_template(name='alpha_one', category='marketing', status='pending')
        self.make_template(name='beta_two', category='utility', status='approved')
        names = lambda query: [t['name'] for t in self.get(f'{self.templates}?{query}').json()['items']]  # noqa: E731
        self.assertEqual(names('status=pending'), ['alpha_one'])
        self.assertEqual(names('category=utility&status=approved'), ['beta_two'])
        self.assertEqual(names('q=ALPHA'), ['alpha_one'])
        paged = self.get(f'{self.templates}?limit=1&offset=1').json()
        self.assertEqual((len(paged['items']), paged['total']), (1, 2))
        for bad in ('status=bogus', 'category=bogus', f'q={"x" * 129}'):
            self.assertError(self.get(f'{self.templates}?{bad}'), 422, 'invalid')

    def test_missing_and_foreign_records_are_404(self):
        self.assertError(self.get(f'{BASE}/templates/999999999'), 404, 'not_found')
        self.assertError(self.get(f'{BASE}/channels/999999999/templates'), 404, 'not_found')
        for method, path in (('PATCH', '/templates/999999999'), ('DELETE', '/templates/999999999')):
            self.assertError(self.api(method, BASE + path, STANDARD), 404, 'not_found')
        self.assertError(self.api('POST', f'{BASE}/channels/999999999/templates', STANDARD), 404, 'not_found')
        self.assertError(self.api('POST', f'{BASE}/channels/999999999/templates/uploads', {}), 404, 'not_found')
        self.assertError(self.api('POST', f'{BASE}/channels/999999999/templates/sync'), 404, 'not_found')

    # create

    def test_create_submits_the_template_to_meta_and_returns_201(self):
        buttons = [
            {'type': 'quick_reply', 'text': 'Yes'}, {'type': 'quick_reply', 'text': 'No'},
            {'type': 'url', 'text': 'Track', 'url': 'https://example.com/t/{{1}}', 'example': 'https://example.com/t/7'},
            {'type': 'phone_number', 'text': 'Call', 'phone_number': '+966500000000'},
            {'type': 'copy_code', 'example': 'SAVE10'},
        ]
        payload = {**STANDARD, 'category': 'marketing', 'allow_category_change': True,
                   'header': {'type': 'text', 'text': 'Order {{1}}', 'example': '42'}, 'footer': 'Thanks', 'buttons': buttons}
        with patch.object(whatsapp, 'create_template', return_value={**CREATED, 'category': 'MARKETING'}) as create:
            result = self.api('POST', self.templates, payload)
        self.assertEqual(result.status_code, 201, result.text)
        body = result.json()
        self.assertEqual(set(body), TEMPLATE_KEYS)
        self.assertEqual((body['status'], body['category'], body['buttons'], body['body_examples']), ('pending', 'marketing', buttons, ['Sara']))
        credentials, sent = create.call_args.args
        self.assertEqual(credentials.business_account_id, self.channel.business_account_id)
        self.assertEqual(sent, {
            'name': 'order_ready', 'language': 'ar', 'category': 'MARKETING', 'allow_category_change': True,
            'components': [
                {'type': 'HEADER', 'format': 'TEXT', 'text': 'Order {{1}}', 'example': {'header_text': ['42']}},
                {'type': 'BODY', 'text': 'Hi {{1}}', 'example': {'body_text': [['Sara']]}},
                {'type': 'FOOTER', 'text': 'Thanks'},
                {'type': 'BUTTONS', 'buttons': [
                    {'type': 'QUICK_REPLY', 'text': 'Yes'}, {'type': 'QUICK_REPLY', 'text': 'No'},
                    {'type': 'URL', 'text': 'Track', 'url': 'https://example.com/t/{{1}}', 'example': ['https://example.com/t/7']},
                    {'type': 'PHONE_NUMBER', 'text': 'Call', 'phone_number': '+966500000000'},
                    {'type': 'COPY_CODE', 'example': 'SAVE10'},
                ]},
            ],
        })
        stored = self.env['liwan.inbox.template'].browse(body['id'])
        self.assertEqual((stored.provider_template_id, stored.channel_id, stored.company_id), ('555000001', self.channel, self.channel.owner_company_id))

    def test_meta_may_move_the_category_and_a_minimal_template_sends_no_optional_parts(self):
        with patch.object(whatsapp, 'create_template', return_value={**CREATED, 'category': 'MARKETING'}) as create:
            result = self.create({**STANDARD, 'body': 'Hello', 'body_examples': []})
        self.assertEqual((result.status_code, result.json()['category']), (201, 'marketing'))
        self.assertEqual(create.call_args.args[1]['components'], [{'type': 'BODY', 'text': 'Hello'}])
        self.assertNotIn('allow_category_change', create.call_args.args[1])

    def test_create_an_authentication_template(self):
        with patch.object(whatsapp, 'create_template', return_value={**CREATED, 'category': 'AUTHENTICATION'}) as create:
            result = self.create(AUTHENTICATION)
        self.assertEqual(result.status_code, 201, result.text)
        body = result.json()
        self.assertEqual((body['category'], body['body'], body['param_count'], body['header'], body['footer']), ('authentication', '{{1}}', 1, None, None))
        self.assertEqual((body['buttons'], body['otp_button_text'], body['add_security_recommendation'], body['code_expiration_minutes']),
                         ([], AUTHENTICATION['otp_button_text'], True, 10))
        self.assertEqual(create.call_args.args[1]['components'], [
            {'type': 'BODY', 'add_security_recommendation': True},
            {'type': 'FOOTER', 'code_expiration_minutes': 10},
            {'type': 'BUTTONS', 'buttons': [{'type': 'OTP', 'otp_type': 'COPY_CODE', 'text': 'Copy code'}]},
        ])
        with patch.object(whatsapp, 'create_template', return_value={**CREATED, 'id': '555000002'}) as create:
            self.create({**AUTHENTICATION, 'name': 'login_two', 'add_security_recommendation': False, 'code_expiration_minutes': None})
        self.assertEqual([part['type'] for part in create.call_args.args[1]['components']], ['BODY', 'BUTTONS'])

    def test_a_media_header_uploads_its_sample_with_the_resumable_upload_api(self):
        header = {'type': 'image', 'example_attachment_id': 0}
        self.assertError(self.create(header=header), 422, 'invalid')
        upload = self.upload()
        self.assertEqual((upload.status_code, set(upload.json())), (201, {'id', 'name', 'mimetype', 'size'}))
        header['example_attachment_id'] = upload.json()['id']
        self.assertEqual(self.create(header=header).json()['field'], 'app_id')
        self.channel.app_id = '123456789'
        calls = [response(200, {'id': 'upload:abc'}), response(200, {'h': 'HANDLE-1'}), response(200, {'id': '555000003'})]
        with patch.object(requests, 'request', MagicMock(side_effect=calls)) as mocked:
            result = self.create(name='with_image', header=header)
        self.assertEqual(result.status_code, 201, result.text)
        (begin, finish, submit) = mocked.call_args_list
        self.assertEqual(begin.args[1].split('/v')[-1].split('/', 1)[1], '123456789/uploads')
        self.assertEqual(begin.kwargs['params'], {'file_name': 'sample.png', 'file_length': len(PNG), 'file_type': 'image/png'})
        self.assertEqual(begin.kwargs['headers']['Authorization'].split()[0], 'Bearer')
        self.assertTrue(finish.args[1].endswith('/upload:abc'))
        self.assertEqual((finish.kwargs['headers']['Authorization'].split()[0], finish.kwargs['headers']['file_offset'], finish.kwargs['data']),
                         ('OAuth', '0', PNG))
        self.assertEqual(submit.kwargs['json']['components'][0], {
            'type': 'HEADER', 'format': 'IMAGE', 'example': {'header_handle': ['HANDLE-1']},
        })
        stored = self.env['liwan.inbox.template'].browse(result.json()['id'])
        self.assertEqual((stored.header_example_attachment_id.res_model, stored.header_example_attachment_id.res_id), ('liwan.inbox.template', stored.id))
        self.assertEqual(result.json()['header']['example_attachment']['name'], 'sample.png')
        # The sample now belongs to the template: another template may not claim it from the channel slot.
        self.assertError(self.create(name='another', header=header), 422, 'invalid')

    def test_meta_rejection_is_a_422_with_its_message_and_nothing_is_stored(self):
        before = self.env['liwan.inbox.template'].search_count([])
        rejected = response(400, {'error': {'message': 'Template name already exists'}})
        with patch.object(requests, 'request', MagicMock(return_value=rejected)):
            result = self.create()
        self.assertError(result, 422, 'invalid')
        self.assertEqual(result.json()['message'], 'Template name already exists')
        unreachable = requests.ConnectionError('boom')
        with patch.object(requests, 'request', MagicMock(side_effect=unreachable)):
            self.assertError(self.create(), 422, 'invalid')
        with patch.object(requests, 'request', MagicMock(return_value=response(200, {'status': 'PENDING'}))):
            self.assertError(self.create(), 422, 'invalid')
        self.assertEqual(self.env['liwan.inbox.template'].search_count([]), before)

    def test_create_validates_every_limit_again(self):
        sample = self.upload().json()['id']
        quick = {'type': 'quick_reply', 'text': 'Ok'}
        url = {'type': 'url', 'text': 'Go', 'url': 'https://example.com', 'example': None}
        call = {'type': 'phone_number', 'text': 'Call', 'phone_number': '+966500000000'}
        bad_payloads = [
            {**STANDARD, 'name': 'Upper'}, {**STANDARD, 'name': ''}, {**STANDARD, 'language': 'arabic'},
            {**STANDARD, 'category': 'bogus'}, {**STANDARD, 'category': 'authentication'},
            {**STANDARD, 'allow_category_change': 'yes'}, {**STANDARD, 'unknown': 1},
            {key: value for key, value in STANDARD.items() if key != 'footer'},
            {**STANDARD, 'body': ''}, {**STANDARD, 'body': 'x' * 1025, 'body_examples': []},
            {**STANDARD, 'body': 'Hi {{2}}', 'body_examples': ['a']}, {**STANDARD, 'body_examples': []},
            {**STANDARD, 'body_examples': ['a', 'b']}, {**STANDARD, 'body_examples': ['']},
            {**STANDARD, 'footer': 'x' * 61}, {**STANDARD, 'footer': ''},
            {**STANDARD, 'header': {'type': 'text', 'text': 'x' * 61, 'example': None}},
            {**STANDARD, 'header': {'type': 'text', 'text': 'Hi {{1}}', 'example': None}},
            {**STANDARD, 'header': {'type': 'text', 'text': 'Hi', 'example': 'x'}},
            {**STANDARD, 'header': {'type': 'text', 'text': '{{1}} {{2}}', 'example': 'x'}},
            {**STANDARD, 'header': {'type': 'audio'}}, {**STANDARD, 'header': {'type': 'location', 'x': 1}},
            {**STANDARD, 'header': {'type': 'image', 'example_attachment_id': 999999999}},
            {**STANDARD, 'header': {'type': 'video', 'example_attachment_id': sample}},
            {**STANDARD, 'buttons': [quick] * 11}, {**STANDARD, 'buttons': [url, url, url]},
            {**STANDARD, 'buttons': [call, call]},
            {**STANDARD, 'buttons': [{'type': 'copy_code', 'example': 'A'}, {'type': 'copy_code', 'example': 'B'}]},
            {**STANDARD, 'buttons': [quick, call, quick]},
            {**STANDARD, 'buttons': [{**quick, 'text': 'x' * 26}]}, {**STANDARD, 'buttons': [{**quick, 'text': ''}]},
            {**STANDARD, 'buttons': [{'type': 'flow', 'text': 'x'}]}, {**STANDARD, 'buttons': [{**quick, 'extra': 1}]},
            {**STANDARD, 'buttons': [{**url, 'url': 'http://example.com'}]},
            {**STANDARD, 'buttons': [{**url, 'url': 'https://example.com/{{1}}'}]},
            {**STANDARD, 'buttons': [{**url, 'example': 'https://example.com/1'}]},
            {**STANDARD, 'buttons': [{**url, 'url': 'https://example.com/{{2}}', 'example': 'https://example.com/1'}]},
            {**STANDARD, 'buttons': [{**url, 'url': 'https://example.com/{{1}}/x{{1}}', 'example': 'https://example.com/1'}]},
            {**STANDARD, 'buttons': [{**call, 'phone_number': '0500000000'}]},
            {**STANDARD, 'buttons': [{'type': 'copy_code', 'example': 'x' * 16}]},
            {**AUTHENTICATION, 'otp_button_text': ''}, {**AUTHENTICATION, 'code_expiration_minutes': 0},
            {**AUTHENTICATION, 'code_expiration_minutes': 91}, {**AUTHENTICATION, 'code_expiration_minutes': True},
            {**AUTHENTICATION, 'add_security_recommendation': 1}, {**AUTHENTICATION, 'body': 'my own text'},
        ]
        with patch.object(whatsapp, 'create_template') as create:
            for bad in bad_payloads:
                self.assertError(self.api('POST', self.templates, bad), 422, 'invalid')
        create.assert_not_called()

    def test_a_duplicate_name_and_language_is_a_422_on_name(self):
        self.make_template(name='order_ready', language='ar')
        with patch.object(whatsapp, 'create_template') as create:
            result = self.create()
        self.assertEqual((result.status_code, result.json()['field']), (422, 'name'))
        create.assert_not_called()
        with patch.object(whatsapp, 'create_template', return_value=CREATED):
            self.assertEqual(self.create(language='en').status_code, 201)

    # edit

    def test_edit_replaces_the_structure_and_returns_the_template_to_review(self):
        template = self.make_template(
            name='order_ready', body='Hi {{1}}', example_ids=['Sara'], footer='Old', status='rejected', status_reason='bad',
            button_ids=[{'kind': 'quick_reply', 'text': 'Old'}],
        )
        payload = {**STANDARD, 'category': 'marketing', 'body': 'Hello {{1}} {{2}}', 'body_examples': ['a', 'b'],
                   'footer': None, 'buttons': [{'type': 'quick_reply', 'text': 'New'}]}
        with patch.object(whatsapp, 'edit_template') as edit:
            result = self.api('PATCH', f'{BASE}/templates/{template.id}', payload)
        self.assertEqual(result.status_code, 200, result.text)
        body = result.json()
        self.assertEqual((body['status'], body['status_reason'], body['category'], body['footer']), ('pending', None, 'marketing', None))
        self.assertEqual((body['body'], body['body_examples'], body['buttons']), ('Hello {{1}} {{2}}', ['a', 'b'], [{'type': 'quick_reply', 'text': 'New'}]))
        self.assertEqual(self.env['liwan.inbox.template.button'].search_count([('template_id', '=', template.id)]), 1)
        _credentials, template_id, components, category = edit.call_args.args
        self.assertEqual((template_id, category, components[0]['text']), (template.provider_template_id, 'MARKETING', 'Hello {{1}} {{2}}'))
        self.assertEqual(components[-1]['buttons'], [{'type': 'QUICK_REPLY', 'text': 'New'}])

    def test_edit_sends_the_category_only_when_it_changes(self):
        template = self.make_template(name='order_ready', status='paused', example_ids=['Sara'], body='Hi {{1}}')
        path = f'{BASE}/templates/{template.id}'
        with patch.object(whatsapp, 'edit_template') as edit:
            self.api('PATCH', path, {**STANDARD, 'category': 'utility'})
            self.assertEqual(edit.call_args.args[3:], (None,))
            template.status = 'rejected'
            self.api('PATCH', path, {**STANDARD, 'category': 'marketing'})
            self.assertEqual(edit.call_args.args[3:], ('MARKETING',))

    def test_edit_rules(self):
        template = self.make_template(name='order_ready', body='Hi {{1}}', example_ids=['Sara'])
        path = f'{BASE}/templates/{template.id}'
        with patch.object(whatsapp, 'edit_template') as edit:
            for bad in ({**STANDARD, 'name': 'renamed'}, {**STANDARD, 'language': 'en'}, {**STANDARD, 'category': 'marketing'},
                        {**STANDARD, 'body': ''}, {**AUTHENTICATION, 'name': 'order_ready', 'language': 'ar'}):
                self.assertError(self.api('PATCH', path, bad), 422, 'invalid')
            self.assertEqual(self.api('PATCH', path, {**STANDARD, 'name': 'renamed'}).json()['field'], 'name')
            for status in ('pending', 'disabled', 'in_appeal', 'flagged', 'pending_deletion'):
                template.status = status
                self.assertError(self.api('PATCH', path, STANDARD), 422, 'invalid')
            self.assertEqual(edit.call_count, 0)
            template.status = 'approved'
            self.assertEqual(self.api('PATCH', path, STANDARD).status_code, 200)
        with patch.object(requests, 'request', MagicMock(return_value=response(400, {'error': {'message': 'Too many edits'}}))):
            template.status = 'approved'
            result = self.api('PATCH', path, {**STANDARD, 'body': 'Changed {{1}}'})
        self.assertEqual((result.status_code, result.json()['message']), (422, 'Too many edits'))
        self.assertEqual((template.body, template.status), ('Hi {{1}}', 'approved'))

    def test_edit_authentication_keeps_metas_text(self):
        template = self.make_template(
            name='login_code', language='en', category='authentication', body='{{1}} is your code.',
            button_ids=[{'kind': 'otp', 'text': 'Copy'}],
        )
        with patch.object(whatsapp, 'edit_template') as edit:
            result = self.api('PATCH', f'{BASE}/templates/{template.id}', {**AUTHENTICATION, 'otp_button_text': 'Copy it'})
        self.assertEqual((result.status_code, result.json()['body']), (200, '{{1}} is your code.'))
        self.assertEqual(edit.call_args.args[2][-1]['buttons'][0]['text'], 'Copy it')

    # delete

    def test_delete_removes_the_template_at_meta_and_fails_its_queued_replies(self):
        template = self.make_template(name='gone')
        conversation = self.make_conversation()
        queued = self.env['liwan.inbox.message'].create({
            'conversation_id': conversation.id, 'direction': 'out', 'kind': 'template', 'body': 'x', 'delivery_state': 'queued',
            'template_name': 'gone', 'template_language': 'ar', 'template_params': [], 'template_id': template.id,
            'next_attempt_at': fields.Datetime.now() - timedelta(seconds=1),
        })
        mocked = MagicMock(return_value=response(200, {'success': True}))
        provider_id = template.provider_template_id
        with patch.object(requests, 'request', mocked):
            result = self.api('DELETE', f'{BASE}/templates/{template.id}')
        self.assertEqual(result.status_code, 204)
        method, url = mocked.call_args.args
        self.assertEqual((method, url.endswith(f'/{self.channel.business_account_id}/message_templates'), mocked.call_args.kwargs['params']),
                         ('DELETE', True, {'hsm_id': provider_id, 'name': 'gone'}))
        self.assertFalse(template.exists())
        self.run_outbox_offline()
        self.assertEqual((queued.delivery_state, queued.error), ('failed', 'The template was removed by the provider.'))
        self.assertFalse(queued.template_id)

    def test_a_meta_error_keeps_the_template(self):
        template = self.make_template()
        with patch.object(requests, 'request', MagicMock(return_value=response(400, {'error': {'message': 'Not allowed'}}))):
            result = self.api('DELETE', f'{BASE}/templates/{template.id}')
        self.assertEqual((result.status_code, result.json()['message']), (422, 'Not allowed'))
        self.assertTrue(template.exists())

    # sample upload

    def test_sample_upload_accepts_an_image_an_mp4_and_a_pdf_only(self):
        for name, content, mimetype in (('a.png', PNG, 'image/png'), ('a.mp4', MP4, 'video/mp4'), ('a.pdf', PDF, 'application/pdf')):
            result = self.upload(name, content, mimetype)
            self.assertEqual((result.status_code, result.json()['mimetype']), (201, mimetype), result.text)
            attachment = self.env['ir.attachment'].browse(result.json()['id'])
            self.assertEqual((attachment.res_model, attachment.res_id, attachment.create_uid), ('liwan.inbox.template', 0, self.manager))
        for name, content, mimetype in (('a.gif', b'GIF89a\x01\x00\x01\x00', 'image/gif'), ('a.ogg', OGG, 'audio/ogg'), ('a.txt', b'hello', 'text/plain'), ('a.bin', b'\x00\x01', 'application/octet-stream')):
            self.assertError(self.upload(name, content, mimetype), 422, 'invalid')
        self.assertError(self.api('POST', f'{self.templates}/uploads', {'name': 'a.png'}), 422, 'invalid')

    # sync

    def test_sync_stores_the_full_structure_of_every_listed_template(self):
        stale = self.make_template(name='stale')
        remote = [{
            'id': '777001', 'name': 'rich', 'language': 'ar', 'category': 'MARKETING', 'status': 'REJECTED',
            'rejected_reason': 'INCORRECT_CATEGORY', 'quality_score': {'score': 'YELLOW'},
            'components': [
                {'type': 'HEADER', 'format': 'TEXT', 'text': 'Order {{1}}', 'example': {'header_text': ['42']}},
                {'type': 'BODY', 'text': 'Hi {{1}}, {{2}}', 'example': {'body_text': [['Sara', 'Ali']]}},
                {'type': 'FOOTER', 'text': 'Thanks'},
                {'type': 'BUTTONS', 'buttons': [
                    {'type': 'QUICK_REPLY', 'text': 'Yes'},
                    {'type': 'URL', 'text': 'Track', 'url': 'https://example.com/{{1}}', 'example': ['https://example.com/9']},
                    {'type': 'PHONE_NUMBER', 'text': 'Call', 'phone_number': '+966500000000'},
                    {'type': 'COPY_CODE', 'example': 'SAVE10'},
                    {'type': 'FLOW', 'text': 'Unsupported', 'flow_id': '1'},
                ]},
            ],
        }, {
            'id': '777002', 'name': 'photo', 'language': 'en_US', 'category': 'UTILITY', 'status': 'APPROVED',
            'components': [
                {'type': 'HEADER', 'format': 'IMAGE', 'example': {'header_handle': ['https://scontent/x']}},
                {'type': 'BODY', 'text': 'See'},
            ],
        }, {
            'id': '777003', 'name': 'otp', 'language': 'en', 'category': 'AUTHENTICATION', 'status': 'APPROVED',
            'components': [
                {'type': 'BODY', 'add_security_recommendation': True, 'text': '{{1}} is your code.'},
                {'type': 'FOOTER', 'code_expiration_minutes': 5},
                {'type': 'BUTTONS', 'buttons': [{'type': 'OTP', 'otp_type': 'COPY_CODE', 'text': 'Copy code'}]},
            ],
        }, {'id': '777004', 'name': 'odd', 'language': 'ar', 'category': 'SOMETHING', 'status': 'LIMIT_EXCEEDED', 'components': []}]
        with patch.object(whatsapp, 'list_templates', return_value=remote):
            result = self.api('POST', f'{self.templates}/sync')
        self.assertEqual(result.status_code, 200, result.text)
        items = {t['name']: t for t in result.json()['items']}
        self.assertEqual(set(items), {'rich', 'photo', 'otp', 'odd'})
        self.assertFalse(stale.exists())
        for item in items.values():
            self.assertEqual(set(item), TEMPLATE_KEYS)
        rich = items['rich']
        self.assertEqual((rich['category'], rich['status'], rich['status_reason'], rich['quality'], rich['param_count']),
                         ('marketing', 'rejected', 'INCORRECT_CATEGORY', 'yellow', 2))
        self.assertEqual((rich['header'], rich['body_examples'], rich['footer']), ({'type': 'text', 'text': 'Order {{1}}', 'example': '42'}, ['Sara', 'Ali'], 'Thanks'))
        self.assertEqual([button['type'] for button in rich['buttons']], ['quick_reply', 'url', 'phone_number', 'copy_code', 'flow'])
        self.assertEqual(rich['buttons'][1]['example'], 'https://example.com/9')
        self.assertEqual(items['photo']['header'], {'type': 'image', 'example_attachment': None})
        self.assertEqual((items['otp']['add_security_recommendation'], items['otp']['code_expiration_minutes']), (True, 5))
        self.assertEqual((items['otp']['buttons'], items['otp']['otp_button_text'], items['otp']['quality']), ([], 'Copy code', 'unknown'))
        self.assertEqual((items['odd']['status'], items['odd']['status_reason'], items['odd']['category']), ('disabled', 'LIMIT_EXCEEDED', 'utility'))
        stored = self.env['liwan.inbox.template'].search([('channel_id', '=', self.channel.id), ('name', '=', 'rich')])
        self.assertEqual(stored.provider_template_id, '777001')
        # A second sync replaces the structure instead of piling rows up.
        with patch.object(whatsapp, 'list_templates', return_value=remote):
            self.api('POST', f'{self.templates}/sync')
        self.assertEqual(len(stored.button_ids), 5)
        self.assertEqual(len(stored.example_ids), 2)

    def test_the_listing_asks_meta_for_the_ids_and_the_quality(self):
        mocked = MagicMock(return_value=response(200, {'data': []}))
        with patch.object(requests, 'request', mocked):
            self.api('POST', f'{self.templates}/sync')
        self.assertEqual(mocked.call_args.kwargs['params']['fields'], 'id,name,language,category,status,components,quality_score,rejected_reason')

    def test_a_template_with_parts_liwan_cannot_represent_is_flagged_unsupported(self):
        ids = iter(range(880001, 880100))

        def item(name, components, **extra):
            return {'id': str(next(ids)), 'name': name, 'language': 'ar', 'category': 'UTILITY', 'status': 'APPROVED',
                    'components': components, **extra}
        body = {'type': 'BODY', 'text': 'Hello'}
        quick = {'type': 'QUICK_REPLY', 'text': 'Yes'}
        url = {'type': 'URL', 'text': 'Track', 'url': 'https://example.com/{{1}}', 'example': ['https://example.com/1']}
        remote = [
            item('plain', [body]),
            item('gap_button', [body, {'type': 'BUTTONS', 'buttons': [quick, {'type': 'CATALOG', 'text': 'Open'}, url]}]),
            item('catalog_button', [body, {'type': 'BUTTONS', 'buttons': [{'type': 'CATALOG', 'text': 'Shop'}]}]),
            item('voice_button', [body, {'type': 'BUTTONS', 'buttons': [{'type': 'VOICE_CALL', 'text': 'Call'}]}]),
            item('named_body', [{'type': 'BODY', 'text': 'Hi {{first_name}}'}]),
            item('named_format', [body], parameter_format='NAMED'),
            item('named_url', [body, {'type': 'BUTTONS', 'buttons': [{'type': 'URL', 'text': 'Go', 'url': 'https://e.com/{{order}}'}]}]),
            item('carousel', [body, {'type': 'CAROUSEL', 'cards': []}]),
            item('odd_header', [{'type': 'HEADER', 'format': 'PRODUCT'}, body]),
            item('one_tap', [body, {'type': 'BUTTONS', 'buttons': [{'type': 'OTP', 'otp_type': 'ONE_TAP', 'text': 'Autofill'}]}]),
        ]
        with patch.object(whatsapp, 'list_templates', return_value=remote):
            result = self.api('POST', f'{self.templates}/sync')
        items = {t['name']: t for t in result.json()['items']}
        self.assertEqual({name: (t['supported'], t['editable']) for name, t in items.items()},
                         {'plain': (True, True), **{name: (False, False) for name in items if name != 'plain'}})
        stored = self.env['liwan.inbox.template'].search([('channel_id', '=', self.channel.id), ('name', '=', 'gap_button')])
        # Meta's own indexes survive: the skipped catalog button leaves a gap at 1.
        self.assertEqual(stored.button_ids.sorted('sequence').mapped('sequence'), [0, 2])
        self.assertEqual(stored.supported, False)
        self.assertError(self.api('PATCH', f'{BASE}/templates/{stored.id}', STANDARD), 422, 'invalid')
        self.assertEqual(self.get(f'{BASE}/templates/{stored.id}').json()['supported'], False)

    # samples

    def test_a_replaced_or_dropped_header_sample_is_deleted(self):
        self.channel.app_id = '123456789'
        template = self.make_template(name='order_ready', header_type='image')
        calls = lambda: MagicMock(side_effect=[response(200, {'id': 'upload:a'}), response(200, {'h': 'H'}), response(200, {})])  # noqa: E731
        first = self.upload().json()['id']
        header = {'type': 'image', 'example_attachment_id': first}
        payload = {**STANDARD, 'body': 'Hi', 'body_examples': [], 'header': header}
        with patch.object(requests, 'request', calls()):
            self.assertEqual(self.api('PATCH', f'{BASE}/templates/{template.id}', payload).status_code, 200)
        template.status = 'approved'
        # The template's own sample may be sent again; a new one replaces and deletes it.
        with patch.object(requests, 'request', calls()):
            self.assertEqual(self.api('PATCH', f'{BASE}/templates/{template.id}', payload).status_code, 200)
        self.assertTrue(self.env['ir.attachment'].browse(first).exists())
        second = self.upload(content=PNG + b'\x00', name='second.png').json()['id']
        template.status = 'approved'
        with patch.object(requests, 'request', calls()):
            self.assertEqual(self.api('PATCH', f'{BASE}/templates/{template.id}', {**payload, 'header': {**header, 'example_attachment_id': second}}).status_code, 200)
        self.assertFalse(self.env['ir.attachment'].browse(first).exists())
        self.assertEqual(template.header_example_attachment_id.id, second)
        template.status = 'approved'
        with patch.object(whatsapp, 'edit_template'):
            self.assertEqual(self.api('PATCH', f'{BASE}/templates/{template.id}', {**STANDARD, 'body': 'Hi', 'body_examples': []}).status_code, 200)
        self.assertFalse(self.env['ir.attachment'].browse(second).exists())
        self.assertEqual((template.header_type, template.header_example_attachment_id.id), ('none', False))

    def test_deleting_a_template_deletes_its_sample(self):
        template = self.make_template(header_type='image')
        sample = self.env['ir.attachment'].create({'name': 's.png', 'raw': PNG, 'mimetype': 'image/png', 'res_model': template._name, 'res_id': template.id})
        template.header_example_attachment_id = sample
        with patch.object(whatsapp, 'delete_template'):
            self.assertEqual(self.api('DELETE', f'{BASE}/templates/{template.id}').status_code, 204)
        self.assertFalse(sample.exists())

    def test_an_unused_sample_of_another_user_cannot_be_claimed(self):
        self.channel.app_id = '123456789'
        other = self.env['ir.attachment'].create({
            'name': 'x.png', 'raw': PNG, 'mimetype': 'image/png', 'res_model': 'liwan.inbox.template', 'res_id': 0,
        })
        self.env.cr.execute('UPDATE ir_attachment SET create_uid = %s WHERE id = %s', [self.agent.id, other.id])
        other.invalidate_recordset()
        header = {'type': 'image', 'example_attachment_id': other.id}
        self.assertError(self.create(header=header), 422, 'invalid')

    def test_stale_loose_samples_are_purged_and_owned_ones_kept(self):
        template = self.make_template(header_type='image')
        owned = self.env['ir.attachment'].create({'name': 'o.png', 'raw': PNG, 'mimetype': 'image/png', 'res_model': template._name, 'res_id': template.id})
        loose = self.env['ir.attachment'].create({'name': 'l.png', 'raw': PNG, 'mimetype': 'image/png', 'res_model': template._name, 'res_id': 0})
        self.env.cr.execute('UPDATE ir_attachment SET create_date = create_date - interval \'3 days\' WHERE id IN %s', [(owned.id, loose.id)])
        self.env['ir.attachment'].invalidate_model(['create_date'])
        self.env['liwan.inbox.conversation']._liwan_run_maintenance()
        self.assertEqual((owned.exists().id, loose.exists().id), (owned.id, False))

    # access

    def test_capabilities(self):
        template = self.make_template()
        write_calls = (
            ('POST', self.templates, STANDARD), ('PATCH', f'{BASE}/templates/{template.id}', STANDARD),
            ('DELETE', f'{BASE}/templates/{template.id}', None), ('POST', f'{self.templates}/uploads', {}),
            ('POST', f'{self.templates}/sync', None),
        )
        for user in (self.agent, self.supervisor, self.reader_only, self.outsider):
            self.login(user)
            for method, path, body in write_calls:
                self.assertError(self.api(method, path, body), 403, 'forbidden')
        for user in (self.agent, self.supervisor, self.reader_only):
            self.login(user)
            self.assertEqual(self.get(self.templates).status_code, 200)
            self.assertEqual(self.get(f'{BASE}/templates/{template.id}').status_code, 200)
        self.login(self.outsider)
        self.assertError(self.get(self.templates), 403, 'forbidden')
        self.assertError(self.get(f'{BASE}/templates/{template.id}'), 403, 'forbidden')

    def test_a_channels_only_custom_role_reads_but_cannot_write(self):
        self.login(self._capability_user('inbox_channels_only', 'inbox.channels.manage'))
        self.assertEqual(self.get(self.templates).status_code, 200)
        self.assertError(self.api('POST', self.templates, STANDARD), 403, 'forbidden')

    def test_a_templates_only_manager_works_without_channel_administration(self):
        template = self.make_template()
        self.login(self.templates_only)
        self.assertError(self.get(f'{BASE}/channels/{self.channel.id}'), 403, 'forbidden')
        self.assertEqual(self.get(f'{BASE}/channels/{self.channel.id}/ref').json(), {'id': self.channel.id, 'name': self.channel.name})
        self.assertEqual(self.get(f'{BASE}/channels/999999999/ref').status_code, 404)
        listed = self.get(self.templates).json()
        self.assertIn(template.id, [row['id'] for row in listed['items']])
        self.assertEqual(self.get(f'{BASE}/templates/{template.id}').status_code, 200)

    def test_the_channel_ref_is_closed_to_users_without_a_template_or_channel_capability(self):
        for user in (self.agent, self.reader_only, self.outsider):
            self.login(user)
            self.assertError(self.get(f'{BASE}/channels/{self.channel.id}/ref'), 403, 'forbidden')
        self.login(self.manager)
        self.assertEqual(self.get(f'{BASE}/channels/{self.channel.id}/ref').status_code, 200)

    def test_the_templates_sub_feature_closes_the_writes_only(self):
        template = self.make_template()
        set_probe_feature(self, key='inbox.templates', enabled=False)
        for method, path, body in (
            ('POST', self.templates, STANDARD), ('PATCH', f'{BASE}/templates/{template.id}', STANDARD),
            ('DELETE', f'{BASE}/templates/{template.id}', None), ('POST', f'{self.templates}/uploads', {}),
            ('POST', f'{self.templates}/sync', None),
        ):
            self.assertEqual(self.api(method, path, body).status_code, 403)
        self.assertEqual(self.get(self.templates).status_code, 200)

    def test_the_inbox_feature_closes_every_route(self):
        template = self.make_template()
        set_probe_feature(self, key='inbox.enabled', enabled=False)
        self.assertEqual(self.get(self.templates).status_code, 403)
        self.assertEqual(self.get(f'{BASE}/templates/{template.id}').status_code, 403)
        self.assertEqual(self.api('POST', self.templates, STANDARD).status_code, 403)


@tagged('post_install', '-at_install', 'liwan')
class TestTemplateCompanyScope(LiwanInboxCase):
    """A manager of a child company never reaches the templates of the current company's channel."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.child = cls.env['res.company'].create({'name': 'Template child company', 'parent_id': cls.env.company.id})
        cls.child_channel = cls.make_channel(phone_id='810000000001', owner_company_id=cls.child.id)
        cls.child_manager = new_test_user(
            cls.env, login='template_child_manager', password=PASSWORD, name='Child manager',
            groups='base.group_user', company_id=cls.env.company.id,
            company_ids=[Command.set((cls.env.company | cls.child).ids)],
        )
        cls.env['liwan.access.assignment'].create({
            'user_id': cls.child_manager.id, 'company_id': cls.child.id,
            'role_id': cls.env.ref('liwan_inbox.role_inbox_manager').id,
        })

    def test_parent_templates_are_not_found_for_every_route(self):
        template = self.make_template()
        self.login(self.child_manager)
        base = f'{BASE}/channels/{self.channel.id}/templates'
        for method, path, body in (
            ('GET', base, None), ('POST', base, STANDARD), ('POST', f'{base}/uploads', {}), ('POST', f'{base}/sync', None),
            ('GET', f'{BASE}/templates/{template.id}', None), ('PATCH', f'{BASE}/templates/{template.id}', STANDARD),
            ('DELETE', f'{BASE}/templates/{template.id}', None),
        ):
            self.assertError(self.api(method, path, body), 404, 'not_found')
        self.assertTrue(template.exists())

    def test_the_child_manager_manages_the_child_channel(self):
        self.login(self.child_manager)
        path = f'{BASE}/channels/{self.child_channel.id}/templates'
        with patch.object(whatsapp, 'create_template', return_value=CREATED):
            result = self.api('POST', path, STANDARD)
        self.assertEqual(result.status_code, 201, result.text)
        self.assertEqual(self.env['liwan.inbox.template'].browse(result.json()['id']).company_id, self.child)


@tagged('post_install', '-at_install', 'liwan')
class TestTemplatesOnlyRole(LiwanInboxCase):
    """A custom role that holds nothing but `inbox.templates.manage` can run the whole template life cycle."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.channel.app_id = '123456789'
        cls.read_only = cls._capability_user('inbox_conversations_read_only', 'inbox.conversations.read')

    def test_the_whole_life_cycle_works(self):
        stale = self.make_template(name='stale')
        self.login(self.templates_only)
        templates = f'{BASE}/channels/{self.channel.id}/templates'
        self.assertEqual(self.get(templates).status_code, 200)
        self.assertEqual(self.get(f'{BASE}/templates/{stale.id}').status_code, 200)
        sample = self.api('POST', f'{templates}/uploads', {'name': 's.png', 'mimetype': 'image/png', 'data': base64.b64encode(PNG).decode()})
        self.assertEqual(sample.status_code, 201, sample.text)
        header = {'type': 'image', 'example_attachment_id': sample.json()['id']}
        calls = [response(200, {'id': 'upload:1'}), response(200, {'h': 'H1'}), response(200, {'id': '555000010'})]
        with patch.object(requests, 'request', MagicMock(side_effect=calls)):
            created = self.api('POST', templates, {**STANDARD, 'header': header})
        self.assertEqual(created.status_code, 201, created.text)
        template_id = created.json()['id']
        self.assertEqual(created.json()['header']['example_attachment']['name'], 's.png')
        template = self.env['liwan.inbox.template'].browse(template_id)
        template.status = 'approved'
        edit_calls = [response(200, {'id': 'upload:2'}), response(200, {'h': 'H2'}), response(200, {})]
        with patch.object(requests, 'request', MagicMock(side_effect=edit_calls)):
            edited = self.api('PATCH', f'{BASE}/templates/{template_id}', {**STANDARD, 'footer': 'Thanks', 'header': header})
        self.assertEqual((edited.status_code, edited.json()['footer']), (200, 'Thanks'), edited.text)
        remote = [{'id': '777', 'name': 'listed', 'language': 'ar', 'category': 'UTILITY', 'status': 'APPROVED', 'components': [{'type': 'BODY', 'text': 'Hi'}]}]
        with patch.object(whatsapp, 'list_templates', return_value=remote):
            synced = self.api('POST', f'{templates}/sync')
        self.assertEqual((synced.status_code, [t['name'] for t in synced.json()['items']]), (200, ['listed']), synced.text)
        listed = self.env['liwan.inbox.template'].search([('name', '=', 'listed')])
        with patch.object(whatsapp, 'delete_template'):
            self.assertEqual(self.api('DELETE', f'{BASE}/templates/{listed.id}').status_code, 204)

    def test_it_reaches_only_its_own_companies_channels(self):
        child = self.env['res.company'].create({'name': 'Templates-only child', 'parent_id': self.env.company.id})
        foreign = self.make_channel(phone_id='820000000001', owner_company_id=child.id)
        self.login(self.templates_only)
        self.assertError(self.get(f'{BASE}/channels/{foreign.id}/templates'), 404, 'not_found')

    def test_a_read_only_role_cannot_write(self):
        template = self.make_template()
        self.login(self.read_only)
        templates = f'{BASE}/channels/{self.channel.id}/templates'
        self.assertEqual(self.get(templates).status_code, 200)
        for method, path, body in (
            ('POST', templates, STANDARD), ('PATCH', f'{BASE}/templates/{template.id}', STANDARD),
            ('DELETE', f'{BASE}/templates/{template.id}', None), ('POST', f'{templates}/uploads', {}),
            ('POST', f'{templates}/sync', None),
        ):
            self.assertError(self.api(method, path, body), 403, 'forbidden')
        self.assertTrue(template.exists())
