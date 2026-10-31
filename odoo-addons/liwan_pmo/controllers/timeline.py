# Part of Odoo. See LICENSE file for full copyright and licensing details.
from markupsafe import Markup, escape

from odoo import http
from odoo.http import request
from odoo.tools.mail import plaintext2html

from .records import get_visible_record
from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    declare_read_capability_scope,
    requires_feature,
)
from odoo.addons.liwan_pmo.serializers.timeline import dump_message

MAX_REFERENCES = 20


def _parse_ids(value, field):
    """Optional list of unique positive ints from a JSON body → ApiError(422) otherwise."""
    if value is None:
        return []
    valid = isinstance(value, list) and len(value) <= MAX_REFERENCES and all(
        isinstance(item, int) and not isinstance(item, bool) and item > 0 for item in value
    )
    if not valid or len(set(value)) != len(value):
        raise ApiError(422, 'invalid', f"{field} must be a list of unique positive ids", field=field)
    return value


class TimelineController(http.Controller):

    def _thread_tasks(self, task):
        """The task family sharing one conversation: the topmost readable ancestor and
        every descendant. Runs in the caller's environment, so ordinary ACLs and record
        rules decide which relatives take part; an unreadable parent simply ends the climb."""
        root = task
        while root.parent_id and root.parent_id.has_access('read'):
            root = root.parent_id
        return request.env['project.task'].search([('id', 'child_of', root.id)]) | task

    def _timeline_messages(self, task):
        # Comments are shared by the whole family; tracking stays the log of this task only.
        # tracking_value_ids is group_system-only on mail.message (see mail_message.py); read it
        # sudo'd purely to test presence, mirroring the pattern mail's own Store computation uses.
        comment_subtype = request.env.ref('mail.mt_comment')
        comments = self._thread_tasks(task).message_ids.filtered(
            lambda m: m.message_type == 'comment' and m.subtype_id == comment_subtype and not m.sudo().tracking_value_ids,
        )
        tracking = task.message_ids.filtered(lambda m: m.sudo().tracking_value_ids)
        return (comments | tracking).sorted(key=lambda m: (m.date, m.id), reverse=True)

    def _mentioned_users(self, ids):
        # Same population as the /api/v1/people picker, in the caller's environment.
        users = request.env['liwan.directory']._liwan_people(ids)
        if len(users) != len(ids):
            raise ApiError(422, 'invalid', "mentions must be people of the current company", field='mentions')
        return users

    def _comment_html(self, body, users, tasks):
        """Escape the plain-text body, then turn each `@name` / `/task name` token the
        client declared into markup. Longest labels first so a name that prefixes another
        cannot claim its token; a declared reference whose token is absent is dropped."""
        html = str(plaintext2html(body.replace('\x00', '')))
        tokens = [(f'@{user.name}', user, None) for user in users] + [(f'/{task.name}', None, task) for task in tasks]
        kept_users = request.env['res.users']
        markups = []
        for label, user, task in sorted(tokens, key=lambda token: len(token[0]), reverse=True):
            token = str(escape(label))
            if token not in html:
                continue
            if user:
                kept_users |= user
                markups.append(f'<strong>{token}</strong>')
            else:
                markups.append(f'<a href="/tasks/{task.id}">{token}</a>')
            # Park a NUL-delimited placeholder so a later token can never match inside this markup.
            html = html.replace(token, f'\x00{len(markups) - 1}\x00', 1)
        for index, markup in enumerate(markups):
            html = html.replace(f'\x00{index}\x00', markup)
        # Safe to mark up: plaintext2html output plus escaped labels and integer ids only.
        return Markup(html), kept_users

    @http.route('/api/v1/tasks/<int:task_id>/timeline', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('pmo.enabled', operation='read')
    def timeline(self, task_id):
        declare_read_capability_scope('pmo.tasks.read')
        task = get_visible_record('project.task', task_id)
        return [dump_message(m) for m in self._timeline_messages(task)]

    @http.route('/api/v1/tasks/<int:task_id>/thread-tasks', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('pmo.enabled', operation='read')
    def thread_tasks(self, task_id):
        declare_read_capability_scope('pmo.tasks.read')
        """Tasks a comment on this task may reference with `/`: its family, minus itself."""
        task = get_visible_record('project.task', task_id)
        relatives = (self._thread_tasks(task) - task).sorted(key=lambda t: (t.name or '', t.id))
        return [{'id': relative.id, 'name': relative.name} for relative in relatives]

    @http.route('/api/v1/tasks/<int:task_id>/comments', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('pmo.enabled', operation='write')
    def post_comment(self, task_id, body=None, mentions=None, task_refs=None, **_):
        if not isinstance(body, str) or not body.strip():
            raise ApiError(422, 'invalid', "body must not be empty", field='body')
        mention_ids = _parse_ids(mentions, 'mentions')
        ref_ids = _parse_ids(task_refs, 'task_refs')
        task = get_visible_record('project.task', task_id)
        users = self._mentioned_users(mention_ids)
        referenced = self._thread_tasks(task).filtered(lambda t: t.id in ref_ids)
        if len(referenced) != len(ref_ids):
            raise ApiError(422, 'invalid', "task_refs must be tasks of this conversation", field='task_refs')
        # The composer posts *plain text*. body_is_html=True made Odoo take it
        # as authored HTML: a typed '<' started a tag and every newline was
        # dropped, collapsing a multi-line comment into one paragraph.
        # message_post's own plain-text path only html-escapes (mail_thread.py
        # `escape(body)`) and still leaves newlines as literal '\n', so run
        # plaintext2html here: it escapes, turns newlines into <br/>, and
        # returns Markup that message_post passes through untouched.
        html, mentioned = self._comment_html(body, users, referenced)
        message = task.with_context(liwan_mention_user_ids=mentioned.ids).message_post(
            body=html, message_type='comment', subtype_xmlid='mail.mt_comment',
        )
        return request.make_json_response(dump_message(message), status=201)
