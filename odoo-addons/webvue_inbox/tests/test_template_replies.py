# Part of Odoo. See LICENSE file for full copyright and licensing details.
import base64
from unittest.mock import MagicMock, patch

import requests

from odoo.tests import tagged

from .common import MESSAGE_KEYS, PHONE_ID, WebVueInboxCase
from .media_samples import MP4, OGG, PDF, PNG
from odoo.addons.webvue_inbox.adapters import whatsapp

URL_BUTTON = {'kind': 'url', 'text': 'Track', 'url': 'https://example.com/{{1}}', 'example': 'https://example.com/9'}
COPY_BUTTON = {'kind': 'copy_code', 'example': 'SAVE10'}
QUICK_BUTTON = {'kind': 'quick_reply', 'text': 'Yes'}
CREDENTIALS = whatsapp.Credentials(PHONE_ID, '200000000001', 'token')


def reply_response(url, **_):
    body = {'id': 'media-77'} if url.endswith('/media') else {'messages': [{'id': 'wamid.T1'}]}
    return MagicMock(status_code=200, json=MagicMock(return_value=body))


@tagged('post_install', '-at_install', 'webvue')
class TestTemplateReplies(WebVueInboxCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.settings.visibility_policy = 'all'
        cls.conversation = cls.make_conversation()

    def setUp(self):
        super().setUp()
        self.login(self.agent)

    def path(self, suffix='', conversation=None):
        return f'/api/v1/inbox/conversations/{(conversation or self.conversation).id}{suffix}'

    def reply(self, template, params=(), **extra):
        return self.api('POST', self.path('/messages'), {'template_id': template.id, 'params': list(params), **extra})

    def upload(self, content=PNG, mimetype='image/png', name='a.png', conversation=None):
        response = self.api('POST', self.path('/uploads', conversation), {
            'name': name, 'mimetype': mimetype, 'data': base64.b64encode(content).decode(),
        })
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()['id']

    def send(self):
        """Run the outbox with Meta mocked; returns the (url, json) of every call."""
        mocked = MagicMock(side_effect=lambda _method, url, **kwargs: reply_response(url, **kwargs))
        with patch.object(requests, 'request', mocked):
            self.env['webvue.inbox.message']._webvue_run_outbox()
        return [(call.args[1], call.kwargs.get('json')) for call in mocked.call_args_list]

    def sent_template(self):
        calls = [json for url, json in self.send() if json and json.get('type') == 'template']
        self.assertEqual(len(calls), 1)
        return calls[0]['template']

    # header

    def test_a_text_header_variable_is_required_and_shown_in_the_thread(self):
        template = self.make_template(header_type='text', header_text='Order {{1}}', header_example='42', footer='Thanks', body='Hello')
        for extra in ({}, {'header_param': ''}, {'header_param': 'x' * 61}, {'header_param': 5}):
            self.assertError(self.reply(template, **extra), 422, 'invalid')
        result = self.reply(template, header_param='42')
        self.assertEqual(result.status_code, 200, result.text)
        body = result.json()
        self.assertEqual(set(body), MESSAGE_KEYS)
        self.assertEqual((body['kind'], body['body'], body['template']), (
            'template', 'Hello', {'name': template.name, 'header_text': 'Order 42', 'footer': 'Thanks', 'buttons': []}))
        self.assertEqual(self.sent_template()['components'], [{'type': 'header', 'parameters': [{'type': 'text', 'text': '42'}]}])

    def test_a_header_without_a_variable_takes_no_value(self):
        template = self.make_template(header_type='text', header_text='Fixed header')
        self.assertError(self.reply(template, header_param='x'), 422, 'invalid')
        result = self.reply(template)
        self.assertEqual(result.json()['template']['header_text'], 'Fixed header')
        self.assertNotIn('components', self.sent_template())
        plain = self.make_template()
        self.assertError(self.reply(plain, header_param='x'), 422, 'invalid')
        self.assertError(self.reply(plain, header_location={'latitude': 1, 'longitude': 2}), 422, 'invalid')

    def test_a_media_header_takes_an_upload_of_the_conversation_of_the_right_kind(self):
        template = self.make_template(header_type='image')
        other = self.make_conversation()
        wrong_conversation = self.upload(conversation=other)
        document = self.upload(PDF, 'application/pdf', 'a.pdf')
        for extra in ({}, {'header_attachment_id': 999999999}, {'header_attachment_id': wrong_conversation},
                      {'header_attachment_id': document}, {'header_attachment_id': 'x'}):
            self.assertError(self.reply(template, **extra), 422, 'invalid')
        image = self.upload()
        result = self.reply(template, header_attachment_id=image)
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual([attachment['id'] for attachment in result.json()['attachments']], [image])
        # The upload now belongs to the message: it cannot be used twice.
        self.assertError(self.reply(template, header_attachment_id=image), 422, 'invalid')
        calls = self.send()
        self.assertTrue(calls[0][0].endswith(f'/{PHONE_ID}/media'))
        self.assertEqual(calls[1][1]['template']['components'], [
            {'type': 'header', 'parameters': [{'type': 'image', 'image': {'id': 'media-77'}}]},
        ])

    def test_a_document_header_sends_its_own_parameter_type(self):
        template = self.make_template(header_type='document')
        self.reply(template, header_attachment_id=self.upload(PDF, 'application/pdf', 'invoice.pdf'))
        self.assertEqual(self.sent_template()['components'][0]['parameters'], [{'type': 'document', 'document': {'id': 'media-77'}}])

    def test_a_location_header_takes_a_location(self):
        template = self.make_template(header_type='location')
        for extra in ({}, {'header_location': {'latitude': 91, 'longitude': 0}}, {'header_location': 'here'},
                      {'header_location': {'latitude': 1, 'longitude': 2, 'extra': 1}}):
            self.assertError(self.reply(template, **extra), 422, 'invalid')
        result = self.reply(template, header_location={'latitude': 24.7136, 'longitude': 46.6753, 'name': 'HQ', 'address': 'Riyadh'})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(self.sent_template()['components'], [{'type': 'header', 'parameters': [{'type': 'location', 'location': {
            'latitude': 24.7136, 'longitude': 46.6753, 'name': 'HQ', 'address': 'Riyadh'}}]}])

    def test_the_thread_shows_the_location_of_a_template_header(self):
        template = self.make_template(header_type='location')
        location = {'latitude': 24.7136, 'longitude': 46.6753, 'name': 'HQ', 'address': 'Riyadh'}
        sent = self.reply(template, header_location=location).json()
        self.assertEqual(sent['kind'], 'template')
        self.assertEqual(sent['location'], location)
        listed = next(m for m in self.get(self.path('/messages')).json()['items'] if m['id'] == sent['id'])
        self.assertEqual(listed['location'], location)
        plain = self.reply(self.make_template(), []).json()
        self.assertIsNone(plain['location'])

    # body and buttons

    def test_body_parameters_must_match_the_template(self):
        template = self.make_template(body='Hi {{1}}, order {{2}}', example_ids=['a', 'b'])
        for params in ([], ['one'], ['a', 'b', 'c'], ['a', ''], ['a', 'x' * 1025], ['a', 5]):
            self.assertError(self.reply(template, params), 422, 'invalid')
        self.assertError(self.api('POST', self.path('/messages'), {'template_id': template.id}), 422, 'invalid')
        result = self.reply(template, ['Sara', '42'])
        self.assertEqual(result.json()['body'], 'Hi Sara, order 42')
        self.assertEqual(self.sent_template()['components'], [
            {'type': 'body', 'parameters': [{'type': 'text', 'text': 'Sara'}, {'type': 'text', 'text': '42'}]},
        ])

    def test_button_values_follow_the_buttons_that_take_one(self):
        template = self.make_template(button_ids=[QUICK_BUTTON, URL_BUTTON, {**URL_BUTTON, 'url': 'https://example.com/plain', 'example': False}, COPY_BUTTON])
        value = lambda index, text='v': {'index': index, 'value': text}  # noqa: E731
        for bad in (
            [], [value(1)], [value(3)], [value(0), value(1), value(3)], [value(1), value(1), value(3)], [value(1), value(2), value(3)],
            [value(1), value(3, '')], [value(1), value(3, 'x' * 2001)], [value(1), {'index': 3}], [value(1), {'index': True, 'value': 'x'}],
            [value(1), {'index': -1, 'value': 'x'}], [value(1), {'index': 10, 'value': 'x'}], [value(1), {**value(3), 'extra': 1}],
            [value(1)] * 4, 'x',
        ):
            self.assertError(self.reply(template, button_params=bad), 422, 'invalid')
        self.assertError(self.reply(template), 422, 'invalid')
        result = self.reply(template, button_params=[value(3, 'CODE15'), value(1, 'order-7')])
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()['template']['buttons'], [
            {'type': 'quick_reply', 'text': 'Yes'}, {'type': 'url', 'text': 'Track'}, {'type': 'url', 'text': 'Track'},
            {'type': 'copy_code', 'text': 'CODE15'},
        ])
        self.assertEqual(self.sent_template()['components'], [
            {'type': 'button', 'sub_type': 'url', 'index': '1', 'parameters': [{'type': 'text', 'text': 'order-7'}]},
            {'type': 'button', 'sub_type': 'copy_code', 'index': '3', 'parameters': [{'type': 'coupon_code', 'coupon_code': 'CODE15'}]},
        ])

    def test_a_template_with_buttons_but_no_values_sends_none(self):
        template = self.make_template(button_ids=[QUICK_BUTTON])
        self.assertEqual(self.reply(template).status_code, 200)
        self.assertNotIn('components', self.sent_template())
        self.assertError(self.reply(template, button_params=[{'index': 0, 'value': 'x'}]), 422, 'invalid')

    def test_an_authentication_template_sends_the_code_in_the_body_and_the_button(self):
        template = self.make_template(
            category='authentication', language='en', body='{{1}} is your code.', button_ids=[{'kind': 'otp', 'text': 'Copy code'}],
        )
        self.assertError(self.reply(template), 422, 'invalid')
        result = self.reply(template, ['482913'])
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()['template']['buttons'], [{'type': 'copy_code', 'text': 'Copy code'}])
        self.assertEqual(self.sent_template()['components'], [
            {'type': 'body', 'parameters': [{'type': 'text', 'text': '482913'}]},
            {'type': 'button', 'sub_type': 'url', 'index': '0', 'parameters': [{'type': 'text', 'text': '482913'}]},
        ])

    def test_every_parameter_kind_together(self):
        template = self.make_template(
            header_type='text', header_text='Hi {{1}}', body='Order {{1}}', example_ids=['a'], footer='Bye',
            button_ids=[URL_BUTTON, COPY_BUTTON],
        )
        self.reply(template, ['9'], header_param='Sara', button_params=[{'index': 0, 'value': 'x'}, {'index': 1, 'value': 'C'}])
        sent = self.sent_template()
        self.assertEqual((sent['name'], sent['language']), (template.name, {'code': 'ar'}))
        self.assertEqual([component['type'] for component in sent['components']], ['header', 'body', 'button', 'button'])

    def test_button_values_are_limited_by_what_they_are(self):
        template = self.make_template(button_ids=[URL_BUTTON, COPY_BUTTON])
        for bad in ([{'index': 0, 'value': 'x' * 2001}, {'index': 1, 'value': 'C'}], [{'index': 0, 'value': 'x'}, {'index': 1, 'value': 'x' * 16}]):
            result = self.reply(template, button_params=bad)
            self.assertError(result, 422, 'invalid')
            self.assertEqual(result.json()['field'], 'button_params')
        ok = [{'index': 0, 'value': 'x' * 2000}, {'index': 1, 'value': 'x' * 15}]
        self.assertEqual(self.reply(template, button_params=ok).status_code, 200)

    def test_a_one_time_code_is_at_most_fifteen_characters(self):
        template = self.make_template(category='authentication', body='{{1}} is your code.', button_ids=[{'kind': 'otp', 'text': 'Copy'}])
        result = self.reply(template, ['1' * 16])
        self.assertEqual((result.status_code, result.json()['field']), (422, 'params'))
        self.assertEqual(self.reply(template, ['1' * 15]).status_code, 200)

    def test_buttons_are_addressed_by_metas_index(self):
        """A synchronised template keeps Meta's button index, so a gap left by a skipped button does not shift a value."""
        template = self.make_template(button_ids=[COPY_BUTTON])
        template.button_ids.sequence = 2
        self.assertError(self.reply(template, button_params=[{'index': 0, 'value': 'C'}]), 422, 'invalid')
        self.assertEqual(self.reply(template, button_params=[{'index': 2, 'value': 'C'}]).status_code, 200)
        self.assertEqual(self.sent_template()['components'][0]['index'], '2')

    def test_a_media_header_must_match_the_kind_exactly(self):
        template = self.make_template(header_type='video')
        self.assertError(self.reply(template, header_attachment_id=self.upload()), 422, 'invalid')
        self.assertError(self.reply(template, header_attachment_id=self.upload(OGG, 'audio/ogg', 'a.ogg')), 422, 'invalid')
        self.assertEqual(self.reply(template, header_attachment_id=self.upload(MP4, 'video/mp4', 'a.mp4')).status_code, 200)

    def test_an_unsupported_template_cannot_be_sent(self):
        template = self.make_template(supported=False)
        result = self.reply(template)
        self.assertEqual((result.status_code, result.json()['code'], result.json()['field']), (422, 'invalid', 'template_id'))
        self.assertFalse(self.env['webvue.inbox.message'].search([('template_id', '=', template.id)]))

    # rules

    def test_only_an_approved_template_of_the_conversation_channel_is_sent(self):
        for status in ('pending', 'rejected', 'paused', 'disabled', 'in_appeal', 'flagged', 'pending_deletion'):
            self.assertError(self.reply(self.make_template(status=status)), 422, 'invalid')
        other = self.make_channel(phone_id='100000000077')
        self.assertError(self.reply(self.make_template(channel=other)), 422, 'invalid')
        self.assertError(self.api('POST', self.path('/messages'), {'template_id': 999999999, 'params': []}), 422, 'invalid')

    def test_unknown_members_and_a_reply_target_are_refused(self):
        template = self.make_template()
        self.assertError(self.reply(template, bogus=1), 422, 'invalid')
        self.assertError(self.reply(template, reply_to_id=self.env['webvue.inbox.message'].search([], limit=1).id), 422, 'invalid')
        self.assertError(self.api('POST', self.path('/messages'), {'template_id': template.id, 'params': [], 'body': 'x'}), 422, 'invalid')

    def test_a_template_goes_out_after_the_window_closed(self):
        late = self.make_conversation(minutes_ago=25 * 60)
        template = self.make_template()
        result = self.api('POST', self.path('/messages', late), {'template_id': template.id, 'params': []})
        self.assertEqual((result.status_code, result.json()['kind']), (200, 'template'))

    def test_a_sent_reply_keeps_its_content_after_the_template_is_gone(self):
        template = self.make_template(header_type='text', header_text='Hi {{1}}', footer='Bye', button_ids=[COPY_BUTTON])
        message_id = self.reply(template, header_param='Sara', button_params=[{'index': 0, 'value': 'C1'}]).json()['id']
        name = template.name
        sent = {'name': name, 'header_text': 'Hi Sara', 'footer': 'Bye', 'buttons': [{'type': 'copy_code', 'text': 'C1'}]}
        thread = lambda: self.get(self.path('/messages')).json()['items'][-1]['template']  # noqa: E731
        self.assertEqual(thread(), sent)
        template.write({'header_text': 'Changed', 'footer': 'Other', 'button_ids': [(5, 0, 0), (0, 0, {'kind': 'quick_reply', 'text': 'New'})]})
        self.assertEqual(thread(), sent)
        template.unlink()
        message = self.env['webvue.inbox.message'].browse(message_id)
        self.assertFalse(message.template_id)
        self.assertEqual(thread(), sent)
        # Still queued, so the outbox fails it instead of sending a half-known template.
        self.run_outbox_offline()
        self.assertEqual(message.delivery_state, 'failed')


@tagged('post_install', '-at_install', 'webvue')
class TestSendTemplatePayload(WebVueInboxCase):
    """The adapter builds the wire payload of each parameter kind."""

    def payload(self, *args, **kwargs):
        mocked = MagicMock(return_value=MagicMock(status_code=200, json=MagicMock(return_value={'messages': [{'id': 'w'}]})))
        with patch.object(requests, 'request', mocked):
            whatsapp.send_template(CREDENTIALS, '966500000000', *args, **kwargs)
        return mocked.call_args.kwargs['json']

    def test_a_template_without_parameters_has_no_components(self):
        self.assertEqual(self.payload('hello', 'ar', [])['template'], {'name': 'hello', 'language': {'code': 'ar'}})

    def test_each_header_kind(self):
        for kind in ('image', 'video', 'document'):
            self.assertEqual(self.payload('t', 'ar', [], header={'type': kind, 'media_id': 'm1'})['template']['components'],
                             [{'type': 'header', 'parameters': [{'type': kind, kind: {'id': 'm1'}}]}])
        location = {'latitude': 1.5, 'longitude': 2.5, 'name': 'n', 'address': 'a'}
        self.assertEqual(self.payload('t', 'ar', [], header={'type': 'location', 'location': location})['template']['components'],
                         [{'type': 'header', 'parameters': [{'type': 'location', 'location': location}]}])

    def test_components_keep_the_header_body_button_order(self):
        components = self.payload(
            't', 'ar', ['b'], header={'type': 'text', 'text': 'h'},
            buttons=[{'index': 2, 'sub_type': 'url', 'value': 's'}, {'index': 0, 'sub_type': 'copy_code', 'value': 'c'}],
        )['template']['components']
        self.assertEqual([c['type'] for c in components], ['header', 'body', 'button', 'button'])
        self.assertEqual(components[2], {'type': 'button', 'sub_type': 'url', 'index': '2', 'parameters': [{'type': 'text', 'text': 's'}]})
        self.assertEqual(components[3]['parameters'], [{'type': 'coupon_code', 'coupon_code': 'c'}])
