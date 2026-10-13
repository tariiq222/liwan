# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Convert a personal task into a task of a project (the tasks/PMO bridge).

The convert runs in the caller's environment, without ``sudo()``. Two checks
decide it: ``tasks.tasks.write`` on the personal task and ``pmo.tasks.create``
on the target project, both through the access service. The writes need
fields PMO keeps out of a client write (``project_id`` and the sub-task
parent); the bridge opens them for exactly the checked tasks through a
cursor-local marker (``CONVERT_MARKER``), and PMO's visibility and
``pmo.tasks.write`` checks still run on every write.
"""
from odoo import api, models
from odoo.exceptions import AccessError

from .project_task_personal import CONVERT_MARKER
from .task_links_pmo import OPEN_STATE
from odoo.addons.nasq_api.controllers.common import ApiError
from odoo.addons.nasq_tasks.models.my_task_service import _is_id

MAX_TARGETS = 20


def _reject(message, field):
    raise ApiError(422, 'invalid', message, field=field)


class NasqMyTaskConvert(models.AbstractModel):
    _name = 'nasq.my.task.convert'
    _description = 'Convert a personal task into a project task'
    _nasq_scope = 'global'

    @api.model
    def _has_capability(self, key, record=None):
        return self.env['nasq.access.service']._nasq_has_capability(self.env.user, key, record=record)

    @api.model
    def _require(self, key):
        if not self._has_capability(key):
            raise ApiError(403, 'forbidden', 'forbidden')

    @api.model
    def _targets(self, q=None, limit=MAX_TARGETS):
        """Active, readable projects of the current company where the caller may create tasks."""
        # pmo.tasks.write is global on purpose: PMO's write guard checks it on the project-less task.
        if not all(self._has_capability(key) for key in (
            'pmo.projects.read', 'pmo.tasks.create', 'pmo.tasks.write',
        )):
            return self.env['project.project']
        domain = [('active', '=', True), ('company_id', '=', self.env.company.id)]
        if q:
            # Odoo's ilike keeps % and _ as wildcards; search the text literally.
            literal = q.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
            domain.append(('name', '=ilike', f'%{literal}%'))
        try:
            projects = self.env['project.project'].search(domain, order='name, id', limit=limit)
        except AccessError:
            return self.env['project.project']
        return projects.filtered(lambda project: self._has_capability('pmo.tasks.create', record=project))

    @api.model
    def _target_project(self, project_id):
        project = self.env['project.project'].browse(project_id).exists()
        try:
            project._nasq_check_visible_current()
            usable = project.active
        except AccessError:
            usable = False
        if not usable:
            _reject('project_id must be an active project of this company', 'project_id')
        if not (
            self._has_capability('pmo.tasks.create', record=project)
            and self._has_capability('pmo.tasks.write')
        ):
            raise ApiError(403, 'forbidden', 'forbidden')
        return project

    @api.model
    def _personal_task(self, task_id):
        """The writable personal task; a task that already has a project the caller can read is a 422."""
        service = self.env['nasq.my.task.service']
        service._require('tasks.tasks.write')
        task = service._find_personal(task_id)
        if not task:
            if not _is_id(task_id):
                raise ApiError(404, 'not_found', 'not_found')
            try:
                has_project = bool(self.env['project.task'].search([
                    ('id', '=', task_id), ('nasq_personal', '=', False)], limit=1))
            except AccessError:
                has_project = False
            if has_project:
                _reject('this task already belongs to a project', 'project_id')
            raise ApiError(404, 'not_found', 'not_found')
        return service._writable_personal(task)

    @api.model
    def _check_convertible(self, task):
        if not task.nasq_personal:
            _reject('this task already belongs to a project', 'project_id')
        if task.state != OPEN_STATE:
            _reject('only an open task can be converted', 'state')
        if task.nasq_parent_id:
            _reject('a sub-task cannot be converted; convert its parent', 'parent_id')

    @api.model
    def _convert(self, task_id, project_id):
        """Turn the personal task into a task of ``project_id`` and return its project href. Irreversible."""
        task = self._personal_task(task_id)
        self._check_convertible(task)
        if not _is_id(project_id):
            _reject('project_id must be an active project of this company', 'project_id')
        project = self._target_project(project_id)
        # PMO's own order: project row, then task rows. A second convert of the same task, or a
        # sub-task created meanwhile (its foreign key waits on the parent row), meets the result
        # of this one instead of racing it.
        Task = self.env['project.task']
        Task._nasq_lock_projects_then_tasks(project, task)
        task.invalidate_recordset()
        self._check_convertible(task)
        # Odoo forbids a parent on a project-less task, so a personal sub-task points at its
        # parent through nasq_parent_id; once the parent has a project the sub-tasks follow it
        # and use Odoo's own parent_id. Archived sub-tasks move too. The parent is written
        # first: _check_nasq_parent only looks at the sub-task's own write.
        children = Task.with_context(active_test=False).search([('nasq_parent_id', '=', task.id)])
        if children.filtered(lambda child: not child.has_access('write')):
            _reject('a sub-task of this task cannot be changed by you; convert after it is removed', 'parent_id')
        if project.nasq_completion_approval != 'none' and children.filtered(lambda child: child.state == '1_done'):
            _reject('done sub-tasks need approval in this project', 'state')
        marker = self.env.cr.precommit.data
        previous = marker.get(CONVERT_MARKER)
        marker[CONVERT_MARKER] = (self.env.uid, self.env.company.id, frozenset((task | children).ids))
        try:
            task.write({'project_id': project.id, 'state': OPEN_STATE})
            if children:
                children.write({
                    'project_id': project.id, 'nasq_parent_id': False, 'parent_id': task.id,
                })
        finally:
            if previous is None:
                marker.pop(CONVERT_MARKER, None)
            else:
                marker[CONVERT_MARKER] = previous
        return f'/projects/{project.id}/tasks/{task.id}'
