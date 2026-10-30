# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The personal task service: every read and write of /api/v1/my-tasks goes through here.

``project_todo`` grants every internal user full CRUD on ``project.task``, so the ORM does
not enforce the ``tasks.tasks.*`` capabilities: each method checks its own capability first.
Nothing here uses ``sudo()``; every call runs with the caller's ACLs and record rules.
"""
import re
from datetime import datetime, time

from odoo import api, fields, models
from odoo.exceptions import AccessError
from odoo.fields import Command, Domain
from odoo.tools import plaintext2html

from odoo.addons.liwan_api.controllers.common import ApiError

STATE_TO_WIRE = {'01_in_progress': 'open', '1_done': 'done', '1_canceled': 'cancelled'}
WIRE_TO_STATE = {wire: state for state, wire in STATE_TO_WIRE.items()}
CLOSED_STATES = ('1_done', '1_canceled')
PRIORITY_TO_STORED = {'normal': '0', 'high': '1'}
# action -> (states it may start from, state it ends in)
TRANSITIONS = {
    'done': (('01_in_progress',), '1_done'),
    'cancel': (('01_in_progress',), '1_canceled'),
    'reopen': (CLOSED_STATES, '01_in_progress'),
}
# Cursor-local marker minted only by ``_archive``: (uid, company id, ids). A bridge that guards the
# ``active`` field of a task (liwan_tasks_pmo) opens it for exactly these tasks while the write runs.
ARCHIVE_MARKER = 'liwan_tasks.archive_scope'
SORTS = {
    'deadline': 'date_deadline asc nulls last, id asc',
    'created': 'create_date desc, id desc',
    'name': 'name asc, id asc',
}
MAX_LIMIT = 100
MAX_NAME_LENGTH = 255
MAX_ID = 2 ** 31  # PostgreSQL integer ids
CREATE_FIELDS = frozenset({'name', 'description', 'date_deadline', 'priority', 'assignees', 'parent_id'})
UPDATE_FIELDS = CREATE_FIELDS - {'parent_id'}


def _reject(message, field):
    raise ApiError(422, 'invalid', message, field=field)


def _parse_deadline(value, key='date_deadline'):
    """Coerce an ISO 8601 UTC string (``...Z`` or bare) into a naive UTC datetime, or False."""
    if value in (None, ''):
        return False
    message = 'date_deadline must be an ISO 8601 UTC date or datetime string'
    if not isinstance(value, str):
        _reject(message, key)
    text = re.sub(r'\.\d+$', '', value.strip().replace('T', ' ').removesuffix('Z'))
    try:
        return fields.Datetime.to_datetime(text)
    except (TypeError, ValueError):
        _reject(message, key)


def _bad_text(value):
    """True for a string PostgreSQL cannot store: a NUL or a lone surrogate (JSON accepts both,
    so either would surface as a 500). Non-strings are the caller's type check."""
    if not isinstance(value, str):
        return False
    if '\x00' in value:
        return True
    try:
        value.encode('utf-8')
    except UnicodeEncodeError:
        return True
    return False


def _is_id(value):
    return isinstance(value, int) and not isinstance(value, bool) and 0 < value < MAX_ID


class LiwanMyTaskService(models.AbstractModel):
    _name = 'liwan.my.task.service'
    _description = 'Personal task service'
    _liwan_scope = 'global'

    # capabilities and lookups

    @api.model
    def _has_capability(self, key):
        return self.env['liwan.access.service']._liwan_has_capability(self.env.user, key)

    @api.model
    def _require(self, key):
        allowed = (self.env['liwan.access.service']._liwan_has_operation_capability(self.env.user, key)
                   if key == 'tasks.tasks.read' else self._has_capability(key))
        if not allowed:
            raise ApiError(403, 'forbidden', 'forbidden')

    @api.model
    def _find_personal(self, task_id):
        """The readable personal task ``task_id``, archived or not (empty when absent, unreadable or a project task)."""
        if not _is_id(task_id):
            return self.env['project.task']
        try:
            return self.env['project.task'].with_context(active_test=False).search(
                [('id', '=', task_id), ('liwan_personal', '=', True)], limit=1)
        except AccessError:
            return self.env['project.task']

    @api.model
    def _personal(self, task_id):
        task = self._find_personal(task_id)
        if not task:
            raise ApiError(404, 'not_found', 'not_found')
        return task

    @api.model
    def _writable_personal(self, task, *, archived=False):
        """Capability, personal-task and write-access checks shared by every mutation.

        An archived task is read-only until restored: ``archived`` says which side the caller works on
        (only ``_archive`` passes True, to restore it).
        """
        self._require('tasks.tasks.write')
        task.ensure_one()
        task = self._personal(task.id)
        if not task.has_access('write'):
            raise ApiError(403, 'forbidden', 'forbidden')
        if bool(task.active) == archived:
            _reject('the task is not archived' if archived else 'an archived task must be restored first', 'action')
        return task

    @api.model
    def _get_personal(self, task_id):
        self._require('tasks.tasks.read')
        task = self._personal(task_id)
        companies = self.env['liwan.access.service']._liwan_operation_capability_company_ids('tasks.tasks.read')
        if task.company_id.id not in companies:
            raise ApiError(404, 'not_found', 'not_found')
        return task

    # list

    @api.model
    def _list_domain(self, *, q, assigned, created, closed=None, archived=False):
        """The domain of the unified list; ``closed`` None leaves the open/closed split to the caller.

        ``archived`` lists the caller's archived personal tasks instead (other applications' tasks never join).
        """
        uid = self.env.uid
        links = self.env['liwan.task.links']
        personal = Domain([
            ('liwan_personal', '=', True),
            ('create_uid', '!=', self.env.ref('base.user_root').id),
        ])
        if archived:
            # Archived sub-tasks are listed too: the parent's detail leaves inactive children out, so
            # this list is the only place to find and restore one.
            domain = personal & Domain('active', '=', False)
        else:
            domain = Domain.OR([personal & Domain('liwan_parent_id', '=', False),
                                Domain(links._liwan_project_task_domain(uid))])
        scopes = []
        if assigned:
            scopes.append(Domain('user_ids', 'in', [uid]))
        if created:
            scopes.append(Domain('create_uid', '=', uid))
        domain &= Domain.OR(scopes)
        if closed is not None:
            state_domain = Domain('state', 'in', CLOSED_STATES)
            domain &= state_domain if closed else ~state_domain
        if _bad_text(q):
            _reject('q must not contain NUL or unpaired surrogates', 'q')
        if q:
            # Odoo's ilike keeps % and _ as wildcards; search the text literally.
            literal = q.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
            domain &= Domain('name', '=ilike', f'%{literal}%')
        companies = self.env['liwan.access.service']._liwan_operation_capability_company_ids('tasks.tasks.read')
        return domain & Domain('company_id', 'in', companies)

    @api.model
    def _search_list(self, *, closed, q, assigned, created, sort, limit, offset, archived=False):
        """The unified list: ``(tasks, total)`` of personal tasks plus the bridge's project tasks."""
        self._require('tasks.tasks.read')
        if sort not in SORTS:
            _reject(f'sort must be one of {sorted(SORTS)}', 'sort')
        domain = self._list_domain(q=q, assigned=assigned, created=created, closed=None if archived else closed, archived=archived)
        Task = self.env['project.task']
        limit = max(1, min(limit, MAX_LIMIT))
        tasks = Task.search(domain, order=SORTS[sort], limit=limit, offset=max(0, offset))
        # A row of another application without a project ref has no valid wire shape: drop it.
        # The page may then hold fewer than ``limit`` rows; ``total`` stays the domain count.
        links = self.env['liwan.task.links']
        tasks = tasks.filtered(lambda task: task.liwan_personal or links._liwan_project_ref(task))
        return tasks, Task.search_count(domain)

    @api.model
    def _summary(self, *, q, assigned, created):
        """Counts over the tasks the list filters select (the open/closed split is the summary's own output).

        ``open`` is every non-closed task, ``overdue`` the open ones whose deadline day (UTC date part, as
        the list shows it) is before the caller's local day, ``done`` completed tasks only (a cancelled
        task counts in ``total`` alone).
        """
        self._require('tasks.tasks.read')
        domain = self._list_domain(q=q, assigned=assigned, created=created)
        Task = self.env['project.task']
        open_domain = domain & ~Domain('state', 'in', CLOSED_STATES)
        today_start = datetime.combine(fields.Date.context_today(self), time.min)
        return {
            'total': Task.search_count(domain),
            'open': Task.search_count(open_domain),
            'overdue': Task.search_count(open_domain & Domain('date_deadline', '<', today_start)),
            'done': Task.search_count(domain & Domain('state', '=', '1_done')),
        }

    # create and update

    @api.model
    def _clean_vals(self, vals, allowed, *, creating):
        """Validate the wire ``vals`` and map them to ORM values (``parent_id`` is handled apart)."""
        for key in vals:
            if key not in allowed:
                _reject(f'{key} is not supported', key)
        out = {}
        if creating or 'name' in vals:
            name = vals.get('name')
            name = name.strip() if isinstance(name, str) else None
            if not name or len(name) > MAX_NAME_LENGTH or _bad_text(name):
                _reject(f'name is required, at most {MAX_NAME_LENGTH} characters and without NUL or unpaired surrogates', 'name')
            out['name'] = name
        if 'description' in vals:
            description = vals['description']
            if description is not None and (not isinstance(description, str) or _bad_text(description)):
                _reject('description must be plain text without NUL or unpaired surrogates', 'description')
            out['description'] = plaintext2html(description) if description else False
        if 'date_deadline' in vals:
            out['date_deadline'] = _parse_deadline(vals['date_deadline'])
        if 'priority' in vals:
            if not isinstance(vals['priority'], str) or vals['priority'] not in PRIORITY_TO_STORED:
                _reject(f'priority must be one of {sorted(PRIORITY_TO_STORED)}', 'priority')
            out['priority'] = PRIORITY_TO_STORED[vals['priority']]
        if 'assignees' in vals:
            out['user_ids'] = [Command.set(self._check_assignees(vals['assignees']))]
        return out

    @api.model
    def _check_assignees(self, assignees):
        if not isinstance(assignees, list) or not all(_is_id(user_id) for user_id in assignees):
            _reject('assignees must be a list of user ids', 'assignees')
        ids = list(dict.fromkeys(assignees))
        if len(self.env['liwan.directory']._liwan_people(ids)) != len(ids):
            _reject('assignees must be active people of this company', 'assignees')
        return ids

    @api.model
    def _check_parent(self, parent_id):
        parent = self._find_personal(parent_id)
        if not parent or parent.company_id != self.env.company:
            _reject('parent_id must be a readable personal task of this company', 'parent_id')
        if not parent.active:
            _reject('parent_id must not be an archived task', 'parent_id')
        if parent.liwan_parent_id:
            _reject('a sub-task cannot have sub-tasks', 'parent_id')
        return parent

    @api.model
    def _create_task(self, vals):
        self._require('tasks.tasks.create')
        out = self._clean_vals(vals, CREATE_FIELDS, creating=True)
        if vals.get('parent_id') is not None:
            out['liwan_parent_id'] = self._check_parent(vals['parent_id']).id
        # Odoo leaves company_id empty on a project-less task, which the personal-task rule
        # hides from everyone; project_id is left out so PMO's create gate sees a personal create.
        out['company_id'] = self.env.company.id
        task = self.env['project.task'].create(out)
        self._notify_assigned(task, task.user_ids.browse())
        return task

    @api.model
    def _update_task(self, task, vals):
        task = self._writable_personal(task.with_env(self.env))
        out = self._clean_vals(vals, UPDATE_FIELDS, creating=False)
        if out:
            previous = task.user_ids
            task.write(out)
            self._unsubscribe_removed(task, previous)
            self._notify_assigned(task, previous)
        return task

    @api.model
    def _unsubscribe_removed(self, task, previous):
        """Odoo keeps a removed assignee as a follower: drop them unless they still read the task."""
        removed = (previous - task.user_ids).partner_id - task._liwan_participant_partners()
        if removed:
            task.message_unsubscribe(partner_ids=removed.ids)

    @api.model
    def _notify_assigned(self, task, previous):
        """Tell every user newly added to ``task`` (other than the actor) through the bell.

        Only real additions notify, and a repeat replaces the user's earlier row (key per task and recipient). The elevated create lives in
        ``liwan.notify.service`` (spec section 7); nothing here uses ``sudo()``.
        """
        if not self.env['liwan.entitlement.service'].get('tasks.enabled'):
            return
        service = self.env['liwan.notify.service']
        for user in task.user_ids - previous - self.env.user:
            service._liwan_deliver(
                task._name, task.id, 'tasks.assigned', user.partner_id,
                self.env._('%(actor)s assigned you the task %(task)s', actor=self.env.user.name, task=task.name),
                key=f'tasks.assigned:{task.id}:{user.partner_id.id}',
                values={'liwan_tasks_task_id': task.id, 'liwan_tasks_task_name': task.name},
                replace=True,
            )

    # transitions

    @api.model
    def _transition(self, task, action):
        task = self._writable_personal(task.with_env(self.env))
        if not isinstance(action, str) or action not in TRANSITIONS:
            _reject(f'action must be one of {sorted(TRANSITIONS)}', 'action')
        sources, target = TRANSITIONS[action]
        if task.state not in sources:
            _reject(f'a {STATE_TO_WIRE.get(task.state, task.state)} task cannot be moved by {action}', 'action')
        task.write({'state': target})
        return task

    @api.model
    def _archive(self, task, *, archive):
        """Withdraw a done or cancelled personal task from the lists (``archive``) or restore it.

        A plain ``active`` write in the caller's environment: nothing is deleted, so the comments,
        attachments and sub-tasks stay with the task. No ``perm_unlink`` is granted anywhere.
        """
        task = self._writable_personal(task.with_env(self.env), archived=not archive)
        if archive and task.state not in CLOSED_STATES:
            _reject('only a done or cancelled task can be archived', 'action')
        data = self.env.cr.precommit.data
        data[ARCHIVE_MARKER] = (self.env.uid, self.env.company.id, frozenset(task.ids))
        try:
            task.write({'active': not archive})
        finally:
            data.pop(ARCHIVE_MARKER, None)
        return task

    @api.model
    def _allowed_actions(self, task):
        task = task.with_env(self.env)
        if not (task.has_access('read') and task.liwan_personal):
            # Rows of other applications (the bridge's project tasks) and rows the caller
            # cannot read offer no personal action.
            return dict.fromkeys(('write', 'done', 'reopen', 'cancel', 'convert', 'archive', 'unarchive'), False)
        can_write = self._has_capability('tasks.tasks.write') and task.has_access('write')
        # An archived task is read-only: restoring it is its only action.
        editable = can_write and task.active
        is_open = task.state == '01_in_progress'
        return {
            'write': editable,
            'done': editable and is_open,
            'reopen': editable and task.state in CLOSED_STATES,
            'cancel': editable and is_open,
            'convert': bool(
                editable and is_open and not task.liwan_parent_id
                and self.env['liwan.task.links']._liwan_can_convert(task)),
            'archive': editable and task.state in CLOSED_STATES,
            'unarchive': can_write and not task.active,
        }
