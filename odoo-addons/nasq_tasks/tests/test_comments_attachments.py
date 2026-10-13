# Part of Odoo. See LICENSE file for full copyright and licensing details.
import base64
from unittest.mock import patch

from odoo.tests import tagged

from odoo.addons.nasq_api.controllers.common import ApiError
from odoo.addons.nasq_platform.models.entitlement_service import OPERATOR_CONTEXT
from odoo.addons.nasq_tasks.tests.routes_common import BASE, TasksRoutesCase

# An 8-byte PNG signature is enough for the mimetype sniffer.
PNG = b'\x89PNG\r\n\x1a\n' + b'\x00' * 32
MAX_BYTES = 10 * 1024 * 1024


def upload(name='note.txt', raw=b'hello', **extra):
    return {'name': name, 'data': base64.b64encode(raw).decode(), **extra}


class TasksFilesCase(TasksRoutesCase):
    def make_task(self, login='tasks_alice', **vals):
        return self.ok(login, 'POST', BASE, {'name': 'Task', **vals})

    def comments_path(self, task_id):
        return self.task_path(task_id, '/comments')

    def attachments_path(self, task_id, att_id=None):
        return self.task_path(task_id, '/attachments' + (f'/{att_id}' if att_id else ''))


@tagged('post_install', '-at_install', 'nasq', 'nasq_tasks')
class TestMyTaskComments(TasksFilesCase):
    def test_comment_roundtrip_plain_text(self):
        task = self.make_task()
        posted = self.ok('tasks_alice', 'POST', self.comments_path(task['id']),
                         {'body': '  <b>x</b> & <script>1</script>  '})
        self.assertEqual(set(posted), {'id', 'body', 'author', 'created_at'})
        self.assertEqual(posted['body'], '<b>x</b> & <script>1</script>')
        self.assertEqual(posted['author'], {
            'id': self.alice.id, 'name': 'Alice', 'user_id': self.alice.id})
        listed = self.ok('tasks_alice', 'GET', self.comments_path(task['id']))
        self.assertEqual(listed, {'items': [posted], 'total': 1})
        message = self.env['mail.message'].browse(posted['id'])
        self.assertEqual((message.model, message.res_id, message.message_type),
                         ('project.task', task['id'], 'comment'))
        self.assertNotIn('<b>', message.body)
        self.assertIn('&lt;b&gt;', message.body)

    def test_comments_are_oldest_first_and_assignee_can_post(self):
        task = self.make_task(assignees=[self.bob.id])
        first = self.ok('tasks_alice', 'POST', self.comments_path(task['id']), {'body': 'one'})
        second = self.ok('tasks_bob', 'POST', self.comments_path(task['id']), {'body': 'two'})
        listed = self.ok('tasks_bob', 'GET', self.comments_path(task['id']))
        self.assertEqual([item['id'] for item in listed['items']], [first['id'], second['id']])
        self.assertEqual(listed['total'], 2)
        self.assertEqual(second['author']['id'], self.bob.id)

    def test_multiline_comment_keeps_its_lines(self):
        task = self.make_task()
        posted = self.ok('tasks_alice', 'POST', self.comments_path(task['id']), {'body': 'a\nb'})
        self.assertEqual(posted['body'], 'a\nb')

    def test_comment_requires_write_capability(self):
        self.managed_user('tasks_nocap', [])
        reader = self.managed_user('tasks_readonly', ['tasks.tasks.read'])
        task = self.make_task(assignees=[reader.id])
        path = self.comments_path(task['id'])
        self.assertError(self.call('tasks_nocap', 'GET', path), 403, 'forbidden')
        self.assertError(self.call('tasks_nocap', 'POST', path, {'body': 'x'}), 403, 'forbidden')
        # The capability is checked before the body, so a malformed body does not leak validation.
        self.assertError(self.call('tasks_readonly', 'POST', path, {'body': ''}), 403, 'forbidden')
        self.assertError(self.call('tasks_readonly', 'POST', path, {'body': 'x'}), 403, 'forbidden')
        self.assertEqual(self.ok('tasks_readonly', 'GET', path), {'items': [], 'total': 0})

    def test_comment_stranger_404(self):
        task = self.make_task(assignees=[])
        path = self.comments_path(task['id'])
        self.assertError(self.call('tasks_carol', 'GET', path), 404, 'not_found')
        self.assertError(self.call('tasks_carol', 'POST', path, {'body': 'x'}), 404, 'not_found')
        self.assertError(self.call('tasks_alice', 'GET', self.comments_path(2 ** 31 + 5)), 404, 'not_found')
        self.assertEqual(self.ok('tasks_alice', 'GET', path)['total'], 0)

    def test_comment_on_project_task_404(self):
        project_task = self.make_project_task()
        path = self.comments_path(project_task.id)
        self.assertError(self.call('tasks_alice', 'GET', path), 404, 'not_found')
        self.assertError(self.call('tasks_alice', 'POST', path, {'body': 'x'}), 404, 'not_found')
        self.assertFalse(self.env['mail.message'].search([
            ('model', '=', 'project.task'), ('res_id', '=', project_task.id),
            ('message_type', '=', 'comment')]))

    def test_comment_validation_422(self):
        task = self.make_task()
        path = self.comments_path(task['id'])
        for body in ({}, {'body': ''}, {'body': '   \n '}, {'body': 'x' * 5001},
                     {'body': 'a\x00b'}, {'body': 5}, {'body': None}, {'body': ['x']}):
            with self.subTest(body=body):
                self.assertError(self.call('tasks_alice', 'POST', path, body), 422, 'invalid', 'body')
        for key in ('mentions', 'task_refs', 'author_id'):
            with self.subTest(key=key):
                self.assertError(
                    self.call('tasks_alice', 'POST', path, {'body': 'x', key: []}), 422, 'invalid', key)
        self.assertError(self.call('tasks_alice', 'POST', path, []), 422, 'invalid', 'body')
        self.assertEqual(self.ok('tasks_alice', 'GET', path)['total'], 0)
        self.assertEqual(self.ok('tasks_alice', 'POST', path, {'body': 'x' * 5000})['body'], 'x' * 5000)

    def test_comment_lone_surrogate_422(self):
        task = self.make_task()
        path = self.comments_path(task['id'])
        for text in ('a\ud800b', '\udfff', 'ok \ude00'):
            with self.subTest(text=ascii(text)):
                self.assertError(self.call('tasks_alice', 'POST', path, {'body': text}), 422, 'invalid', 'body')
        self.assertEqual(self.ok('tasks_alice', 'GET', path)['total'], 0)
        # A well-formed surrogate pair is an ordinary astral character.
        self.assertEqual(self.ok('tasks_alice', 'POST', path, {'body': '\ud83d\ude00'})['body'], '\U0001f600')

    def test_comment_stranger_gets_404_before_body_validation(self):
        task = self.make_task(assignees=[])
        path = self.comments_path(task['id'])
        for body in ({'body': ''}, {'body': 'a\ud800'}, {'nope': 1}, []):
            with self.subTest(body=body):
                self.assertError(self.call('tasks_carol', 'POST', path, body), 404, 'not_found')

    def test_subtask_comments_are_its_own(self):
        parent = self.make_task()
        sub = self.make_task(parent_id=parent['id'])
        self.ok('tasks_alice', 'POST', self.comments_path(sub['id']), {'body': 'sub'})
        self.assertEqual(self.ok('tasks_alice', 'GET', self.comments_path(parent['id']))['total'], 0)
        self.assertEqual(self.ok('tasks_alice', 'GET', self.comments_path(sub['id']))['total'], 1)

    def test_comment_sends_no_bell_row_and_no_new_followers(self):
        """With nasq_pmo installed its project.task mail hooks must not turn a personal comment into a bell row."""
        task = self.make_task(assignees=[self.bob.id, self.carol.id])
        record = self.env['project.task'].browse(task['id'])
        Message = self.env['mail.message'].sudo()
        bell_domain = [('model', '=', 'project.task'), ('res_id', '=', record.id),
                       ('nasq_notification', '=', True)]
        before = Message.search(bell_domain).ids
        followers_before = record.sudo().message_partner_ids
        self.ok('tasks_alice', 'POST', self.comments_path(task['id']), {'body': 'hello team'})
        self.assertEqual(Message.search(bell_domain).ids, before)
        for user in (self.bob, self.carol):
            items = self.env['nasq.notify.service'].with_user(user)._nasq_list(50)['items']
            self.assertNotIn('comment', {item['kind'] for item in items})
        self.assertLessEqual(record.sudo().message_partner_ids - followers_before, self.alice.partner_id)


@tagged('post_install', '-at_install', 'nasq', 'nasq_tasks')
class TestMyTaskAttachments(TasksFilesCase):
    def test_attachment_upload_list_delete(self):
        task = self.make_task()
        path = self.attachments_path(task['id'])
        self.assertEqual(self.ok('tasks_alice', 'GET', path), {'items': [], 'total': 0})
        text = self.ok('tasks_alice', 'POST', path, upload('note.txt', b'hello'))
        image = self.ok('tasks_alice', 'POST', path, upload('pic.png', PNG, mimetype='image/png'))
        self.assertEqual(set(text), {'id', 'name', 'mimetype', 'url'})
        self.assertEqual((text['name'], text['mimetype']), ('note.txt', 'text/plain'))
        self.assertEqual(image['mimetype'], 'image/png')
        self.assertEqual(text['url'], f'/web/content/{text["id"]}?download=true')
        record = self.env['ir.attachment'].browse(text['id'])
        self.assertEqual((record.res_model, record.res_id, record.type, record.raw),
                         ('project.task', task['id'], 'binary', b'hello'))
        self.assertFalse(record.public)
        listed = self.ok('tasks_alice', 'GET', path)
        self.assertEqual(listed, {'items': [text, image], 'total': 2})
        self.assertEqual(self.ok('tasks_alice', 'GET', self.task_path(task['id']))['attachment_count'], 2)
        status, body = self.call('tasks_alice', 'DELETE', self.attachments_path(task['id'], text['id']))
        self.assertEqual(status, 204, body)
        self.assertFalse(self.env['ir.attachment'].browse(text['id']).exists())
        self.assertEqual(self.ok('tasks_alice', 'GET', path), {'items': [image], 'total': 1})
        self.assertEqual(self.ok('tasks_alice', 'GET', self.task_path(task['id']))['attachment_count'], 1)

    def test_assignee_uploads_and_stranger_cannot_see_or_touch(self):
        task = self.make_task(assignees=[self.bob.id])
        path = self.attachments_path(task['id'])
        made = self.ok('tasks_bob', 'POST', path, upload())
        self.assertEqual(self.ok('tasks_alice', 'GET', path)['items'], [made])
        for method, target, body in (
            ('GET', path, None), ('POST', path, upload()),
            ('DELETE', self.attachments_path(task['id'], made['id']), None),
        ):
            with self.subTest(method=method):
                self.assertError(self.call('tasks_carol', method, target, body), 404, 'not_found')
        self.assertTrue(self.env['ir.attachment'].browse(made['id']).exists())

    def test_attachment_requires_capabilities(self):
        self.managed_user('tasks_nocap', [])
        reader = self.managed_user('tasks_readonly', ['tasks.tasks.read'])
        task = self.make_task(assignees=[reader.id])
        made = self.ok('tasks_alice', 'POST', self.attachments_path(task['id']), upload())
        path = self.attachments_path(task['id'])
        one = self.attachments_path(task['id'], made['id'])
        self.assertError(self.call('tasks_nocap', 'GET', path), 403, 'forbidden')
        self.assertEqual(self.ok('tasks_readonly', 'GET', path)['items'], [made])
        for login in ('tasks_nocap', 'tasks_readonly'):
            for method, target, body in (('POST', path, upload()), ('POST', path, {}),
                                         ('DELETE', one, None)):
                with self.subTest(login=login, method=method):
                    self.assertError(self.call(login, method, target, body), 403, 'forbidden')
        self.assertTrue(self.env['ir.attachment'].browse(made['id']).exists())

    def test_attachment_rejects_bad_mimetype_and_over_10mib(self):
        task = self.make_task()
        path = self.attachments_path(task['id'])
        too_big = upload('big.txt', b'a' * (MAX_BYTES + 1))
        for body, field in (
            (upload('run.exe', b'MZ\x90\x00\x03\x00\x00\x00' + b'\x00' * 64), 'data'),
            (upload('page.html', b'<html><body>x</body></html>', mimetype='text/html'), 'mimetype'),
            (upload('pic.png', b'not really a png', mimetype='image/png'), None),
            (too_big, 'data'),
            ({'name': 'x.txt', 'data': '!!!'}, 'data'),
            ({'name': '../x.txt', 'data': upload()['data']}, 'name'),
            ({'data': upload()['data']}, 'name'),
            ({'name': 'x.txt'}, 'data'),
            (upload(extra='1'), 'extra'),
        ):
            with self.subTest(name=body.get('name'), field=field):
                status, payload = self.call('tasks_alice', 'POST', path, body)
                if field is None:
                    # sniffed as plain text: accepted, and the sniffed type wins over the hint
                    self.assertEqual((status, payload['mimetype']), (200, 'text/plain'))
                else:
                    self.assertError((status, payload), 422, 'invalid', field)
        exact = self.call('tasks_alice', 'POST', path, upload('exact.txt', b'a' * MAX_BYTES))
        self.assertEqual(exact[0], 200, exact[1])

    def test_attachment_quota_exceeded(self):
        task = self.make_task()
        path = self.attachments_path(task['id'])
        profile = self.env.ref('nasq_platform.tenant_profile')
        profile.with_context(**{OPERATOR_CONTEXT: True}).write(
            {'features': {**profile.features, 'storage.limit_mb': 0}})
        status, payload = self.call('tasks_alice', 'POST', path, upload())
        self.assertEqual(status, 403, payload)
        self.assertEqual(payload['code'], 'feature_not_included')
        self.assertEqual(payload['details'], {'reason': 'limit', 'limit_key': 'storage.limit_mb'})
        self.assertEqual(self.ok('tasks_alice', 'GET', path)['total'], 0)

    def test_delete_attachment_of_other_task_404(self):
        mine = self.make_task()
        other = self.make_task('tasks_bob')
        theirs = self.ok('tasks_bob', 'POST', self.attachments_path(other['id']), upload())
        ours = self.ok('tasks_alice', 'POST', self.attachments_path(mine['id']), upload())
        # Bob's attachment through Alice's task, and Alice's through Bob's: both 404.
        self.assertError(self.call('tasks_alice', 'DELETE',
                                   self.attachments_path(mine['id'], theirs['id'])), 404, 'not_found')
        self.assertError(self.call('tasks_bob', 'DELETE',
                                   self.attachments_path(other['id'], ours['id'])), 404, 'not_found')
        self.assertError(self.call('tasks_alice', 'DELETE',
                                   self.attachments_path(mine['id'], 2 ** 31 + 1)), 404, 'not_found')
        self.assertTrue(self.env['ir.attachment'].browse([theirs['id'], ours['id']]).exists())

    def test_delete_does_not_touch_an_unrelated_attachment_id(self):
        task = self.make_task()
        stray = self.env['ir.attachment'].create({'name': 'stray', 'raw': b'x', 'res_model': 'res.partner',
                                                  'res_id': self.alice.partner_id.id})
        self.assertError(self.call('tasks_alice', 'DELETE',
                                   self.attachments_path(task['id'], stray.id)), 404, 'not_found')
        self.assertTrue(stray.exists())

    def test_attachment_routes_404_for_project_task(self):
        project_task = self.make_project_task()
        attachment = self.env['ir.attachment'].create({
            'name': 'p.txt', 'raw': b'x', 'res_model': 'project.task', 'res_id': project_task.id})
        path = self.attachments_path(project_task.id)
        for method, target, body in (
            ('GET', path, None), ('POST', path, upload()),
            ('DELETE', self.attachments_path(project_task.id, attachment.id), None),
        ):
            with self.subTest(method=method):
                self.assertError(self.call('tasks_alice', method, target, body), 404, 'not_found')
        self.assertTrue(attachment.exists())

    def test_subtask_attachments_are_its_own(self):
        parent = self.make_task()
        sub = self.make_task(parent_id=parent['id'])
        made = self.ok('tasks_alice', 'POST', self.attachments_path(sub['id']), upload())
        self.assertEqual(self.ok('tasks_alice', 'GET', self.attachments_path(parent['id']))['total'], 0)
        self.assertEqual(self.ok('tasks_alice', 'GET', self.task_path(parent['id']))['attachment_count'], 0)
        self.assertEqual(self.ok('tasks_alice', 'GET', self.task_path(sub['id']))['attachment_count'], 1)
        self.assertError(self.call('tasks_alice', 'DELETE',
                                   self.attachments_path(parent['id'], made['id'])), 404, 'not_found')

    def test_attachment_name_lone_surrogate_422(self):
        task = self.make_task()
        path = self.attachments_path(task['id'])
        self.assertError(self.call('tasks_alice', 'POST', path, upload('a\ud800.txt')), 422, 'invalid', 'name')
        self.assertEqual(self.ok('tasks_alice', 'GET', path)['total'], 0)

    def test_stranger_upload_is_refused_before_the_file_is_decoded(self):
        task = self.make_task(assignees=[])
        path = self.attachments_path(task['id'])
        target = 'odoo.addons.nasq_tasks.controllers.my_task_attachments.parse_attachment_upload'
        with patch(target) as parse:
            for body in (upload(), {'name': 'x.txt', 'data': '!!!'}, {}, []):
                with self.subTest(body=str(body)[:20]):
                    self.assertError(self.call('tasks_carol', 'POST', path, body), 404, 'not_found')
            parse.assert_not_called()
        self.managed_user('tasks_nocap', [])
        with patch(target) as parse:
            self.assertError(self.call('tasks_nocap', 'POST', path, upload()), 403, 'forbidden')
            parse.assert_not_called()

    def test_attachment_upload_failure_leaves_nothing_behind(self):
        task = self.make_task()
        before = self.env['ir.attachment'].search_count([('res_model', '=', 'project.task')])
        self.assertEqual(self.call('tasks_alice', 'POST', self.attachments_path(task['id']), {})[0], 422)
        self.assertEqual(self.env['ir.attachment'].search_count([('res_model', '=', 'project.task')]), before)


@tagged('post_install', '-at_install', 'nasq', 'nasq_tasks')
class TestMyTaskCommentRecipients(TasksFilesCase):
    """A comment reaches the people who can read the task, never a removed assignee."""

    def notified(self, comment_id):
        message = self.env['mail.message'].browse(comment_id)
        return message.notification_ids.res_partner_id

    def test_removed_assignee_is_not_notified_of_a_comment(self):
        task = self.make_task(assignees=[self.alice.id, self.bob.id, self.carol.id])
        self.ok('tasks_alice', 'PATCH', self.task_path(task['id']), {'assignees': [self.alice.id, self.carol.id]})
        posted = self.ok('tasks_alice', 'POST', self.comments_path(task['id']), {'body': 'for the team'})
        notified = self.notified(posted['id'])
        self.assertNotIn(self.bob.partner_id, notified)
        self.assertEqual(notified, self.carol.partner_id)
        record = self.env['project.task'].browse(task['id'])
        self.assertNotIn(self.bob.partner_id, record.message_partner_ids)

    def test_a_readded_assignee_is_notified_again(self):
        task = self.make_task(assignees=[self.alice.id, self.bob.id])
        self.ok('tasks_alice', 'PATCH', self.task_path(task['id']), {'assignees': [self.alice.id]})
        self.ok('tasks_alice', 'PATCH', self.task_path(task['id']), {'assignees': [self.alice.id, self.bob.id]})
        posted = self.ok('tasks_alice', 'POST', self.comments_path(task['id']), {'body': 'back'})
        self.assertEqual(self.notified(posted['id']), self.bob.partner_id)

    def test_a_follower_added_by_odoo_is_not_notified(self):
        task = self.make_task(assignees=[self.alice.id])
        record = self.env['project.task'].browse(task['id'])
        record.message_subscribe(partner_ids=self.carol.partner_id.ids)
        posted = self.ok('tasks_alice', 'POST', self.comments_path(task['id']), {'body': 'private'})
        self.assertNotIn(self.carol.partner_id, self.notified(posted['id']))

    def test_the_creator_stays_notified_after_leaving_the_assignees(self):
        task = self.make_task(assignees=[self.bob.id])
        record = self.env['project.task'].browse(task['id'])
        record.message_subscribe(partner_ids=self.alice.partner_id.ids)
        posted = self.ok('tasks_bob', 'POST', self.comments_path(task['id']), {'body': 'hello'})
        self.assertEqual(self.notified(posted['id']), self.alice.partner_id)

    def test_a_sub_task_comment_skips_a_removed_assignee_and_keeps_parent_participants(self):
        parent = self.make_task(assignees=[self.alice.id, self.carol.id])
        sub = self.make_task(parent_id=parent['id'], assignees=[self.alice.id, self.bob.id])
        self.env['project.task'].browse(sub['id']).message_subscribe(partner_ids=self.carol.partner_id.ids)
        self.ok('tasks_alice', 'PATCH', self.task_path(sub['id']), {'assignees': [self.alice.id]})
        posted = self.ok('tasks_alice', 'POST', self.comments_path(sub['id']), {'body': 'sub'})
        self.assertEqual(self.notified(posted['id']), self.carol.partner_id)

    def test_a_project_task_still_notifies_its_followers(self):
        task = self.make_project_task()
        task.message_subscribe(partner_ids=self.bob.partner_id.ids)
        message = task.with_user(self.alice).message_post(
            body='hi', message_type='comment', subtype_xmlid='mail.mt_comment')
        self.assertEqual(
            set(message.notification_ids.res_partner_id.ids),
            {self.bob.partner_id.id},
        )


@tagged('post_install', '-at_install', 'nasq', 'nasq_tasks')
class TestMyTaskSearchText(TasksFilesCase):
    def test_search_text_with_a_lone_surrogate_is_422(self):
        service = self.env['nasq.my.task.service'].with_user(self.alice)
        for q in ('a\ud800', 'a\x00b'):
            with self.subTest(q=ascii(q)), self.assertRaises(ApiError) as caught:
                service._search_list(closed=False, q=q, assigned=True, created=True,
                                     sort='deadline', limit=5, offset=0)
            self.assertEqual((caught.exception.status, caught.exception.field), (422, 'q'))

    def test_search_text_over_http_never_500s(self):
        for q in ('%ED%A0%80', '%00', 'ok'):
            with self.subTest(q=q):
                self.assertLess(self.call('tasks_alice', 'GET', f'{BASE}?q={q}')[0], 500)


@tagged('post_install', '-at_install', 'nasq', 'nasq_tasks')
class TestMyTaskFilesFeatureGate(TasksFilesCase):
    def close_feature(self, retain_reads=False):
        profile = self.env.ref('nasq_platform.tenant_profile')
        retained = [key for key in (profile.retained_read_features or []) if key != 'tasks.enabled']
        profile.with_context(**{OPERATOR_CONTEXT: True}).write({
            'features': {**profile.features, 'tasks.enabled': False},
            'retained_read_features': [*retained, 'tasks.enabled'] if retain_reads else retained,
        })

    def routes(self, task_id, att_id):
        return (
            ('GET', self.comments_path(task_id), None),
            ('POST', self.comments_path(task_id), {'body': 'x'}),
            ('GET', self.attachments_path(task_id), None),
            ('POST', self.attachments_path(task_id), upload()),
            ('DELETE', self.attachments_path(task_id, att_id), None),
        )

    def test_feature_gate_403_when_disabled(self):
        task = self.make_task()
        made = self.ok('tasks_alice', 'POST', self.attachments_path(task['id']), upload())
        self.close_feature()
        for method, target, body in self.routes(task['id'], made['id']):
            with self.subTest(method=method, path=target):
                status, payload = self.call('tasks_alice', method, target, body)
                self.assertEqual(status, 403, payload)
                self.assertEqual(payload['code'], 'feature_not_included')
                self.assertEqual(payload['details'], {'reason': 'feature', 'feature': 'tasks.enabled'})
        self.assertTrue(self.env['ir.attachment'].browse(made['id']).exists())

    def test_retained_reads_stay_open_but_writes_close(self):
        task = self.make_task()
        made = self.ok('tasks_alice', 'POST', self.attachments_path(task['id']), upload())
        self.close_feature(retain_reads=True)
        for method, target, body in self.routes(task['id'], made['id']):
            status, payload = self.call('tasks_alice', method, target, body)
            if method == 'GET':
                self.assertEqual(status, 200, payload)
            else:
                self.assertEqual((status, payload['code']), (403, 'feature_not_included'))
