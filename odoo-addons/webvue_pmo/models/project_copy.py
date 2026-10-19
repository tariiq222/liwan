# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Project creation and structure copy for project.project."""
from datetime import date, datetime

from odoo import models
from odoo.exceptions import AccessError, ValidationError

from . import project_project
from .project_constants import POLICY_CREATE_MARKER
from .project_task import PROJECT_COPY_MARKER


class ProjectProject(models.Model):
    _inherit = 'project.project'

    def _webvue_create_from_policy(self, name, extra=None, user_id=None, date_end=None):
        """Create a project the webvue way: policy check, defaults, default stages.

        When the company policy lets every employee create projects, the create
        itself runs in sudo (Odoo's ACL reserves project creation to managers);
        the policy is the explicit, admin-set widening of that ACL, and
        ``create_uid``/``user_id`` still record the employee. Second documented
        ``sudo()`` in webvue_pmo.

        Required-on-create company settings are enforced here for every
        policy create, including ordinary ORM callers of this helper, even
        when the subsequent ``create`` is elevated. Stock superuser
        ``project.create`` used by install/import fixtures is the documented
        compatibility boundary and is not a caller-controlled exemption.
        """
        if not self._webvue_can_create():
            raise AccessError(self.env._("You are not allowed to create projects."))
        vals = self._webvue_create_vals(name, user_id=user_id, date_end=date_end)
        if extra:
            vals.update(extra)
        env = self.env if self._webvue_is_manager() else self.sudo().env
        marker = self.env.cr.precommit.data
        previous = marker.get(POLICY_CREATE_MARKER)
        marker[POLICY_CREATE_MARKER] = True
        try:
            project = env['project.project'].create(vals)
        finally:
            if previous is None:
                marker.pop(POLICY_CREATE_MARKER, None)
            else:
                marker[POLICY_CREATE_MARKER] = previous
        return self.browse(project.id)

    def _webvue_create_vals(self, name, user_id=None, date_end=None):
        stages = self.env['webvue.pmo.settings']._default_stage_vals()
        settings = self.env['webvue.pmo.settings'].get()
        manager_id = self.env.uid if user_id is None else user_id
        vals = {
            'name': name,
            'user_id': manager_id or False,
            'company_id': self.env.company.id,
            'privacy_visibility': 'employees',
            'allow_milestones': True,
            'webvue_completion_approval': settings['default_completion_approval'],
            'type_ids': [(0, 0, s) for s in stages],
            'webvue_code': self._webvue_next_code(),
        }
        if date_end:
            # Upstream project.create preserves a lone end date. Do not invent
            # a start date; only persist the supplied end.
            vals['date'] = date_end
        return vals

    def _webvue_copy_structure(self, name, start_date, *, serialize=None):
        """Create a new project holding this project's structure; return it.

        Copies stages, milestones, active top-level tasks (stage, milestone,
        planned dates, dependencies, tags) and the type / owning unit /
        dependency setting. Dates move by ``start_date`` minus the source
        start. Assignees, followers, chatter, state, governance and finance
        are not copied. The source is read with the caller's own access.

        serialize is supplied only by the private Python caller, never accepted
        from an HTTP/RPC payload. Serializing before the population scope is
        cleared lets a caller receive project counts without generic task
        reads. Any failure rolls back the whole copy and clears the scope.
        """
        self.ensure_one()
        source = self._webvue_copy_source()
        project_name = self._webvue_copy_project_name(name)
        start = self._webvue_copy_start_date(start_date)
        tasks, milestones, stages = self._webvue_copy_components(source)
        delta = self._webvue_copy_delta(source, tasks, milestones, start)
        end = self._webvue_copy_shift(source.date, delta, source.env)
        extra = self._webvue_copy_extra(source, start, end, stages)
        with source.env.cr.savepoint():
            project = source.env['project.project']._webvue_create_from_policy(
                project_name, extra=extra, user_id=source.env.uid, date_end=end or None,
            )
            return self._webvue_copy_populate(source, project, tasks, milestones, stages, delta, serialize)

    def _webvue_copy_source(self):
        """Read the source project under a copy-only context.

        Only language/company/session context survives. Client defaults must
        never seed assignees, parent tasks, followers, activities or schedules.
        """
        source = self.with_context({
            key: value for key, value in self.env.context.items()
            if not key.startswith('default_')
        }, tracking_disable=True, mail_create_nosubscribe=True)
        source._webvue_check_visible_current()
        env = source.env
        if not env['webvue.access.service']._webvue_has_capability(env.user, 'pmo.tasks.read'):
            raise AccessError(env._("You are not allowed to copy this project."))
        if not source._webvue_can_create():
            raise AccessError(env._("You are not allowed to create projects."))
        return source

    def _webvue_copy_project_name(self, name):
        if not isinstance(name, str) or not name.strip() or len(name.strip()) > 255:
            raise ValidationError(self.env._("name must be a non-empty string of at most 255 characters."))
        return name.strip()

    def _webvue_copy_start_date(self, start_date):
        if isinstance(start_date, str):
            try:
                start = date.fromisoformat(start_date)
            except ValueError as error:
                raise ValidationError(self.env._("start_date must be a valid ISO date.")) from error
            if start.isoformat() != start_date:
                raise ValidationError(self.env._("start_date must use YYYY-MM-DD."))
            return start
        if isinstance(start_date, date) and not isinstance(start_date, datetime):
            return start_date
        raise ValidationError(self.env._("start_date must be a valid ISO date."))

    def _webvue_copy_components(self, source):
        env = source.env
        Task = env['project.task']
        task_domain = [('project_id', '=', source.id), ('parent_id', '=', False), ('active', '=', True)]
        if Task.search_count(task_domain) > project_project.MAX_COPY_TASKS:
            raise ValidationError(env._("A project with more than %(max)s tasks cannot be copied.", max=project_project.MAX_COPY_TASKS))
        if len(source.milestone_ids) > project_project.MAX_COPY_MILESTONES:
            raise ValidationError(env._(
                "A project with more than %(max)s milestones cannot be copied.", max=project_project.MAX_COPY_MILESTONES,
            ))
        tasks = Task.search(task_domain, order='sequence, id')
        milestones = source.milestone_ids.sorted(lambda milestone: (milestone.deadline or date.max, milestone.id))
        stages = source.type_ids.sorted(lambda stage: (stage.sequence, stage.id))
        return tasks, milestones, stages

    def _webvue_copy_delta(self, source, tasks, milestones, start):
        anchor = source.date_start
        if not anchor:
            candidates = [task.webvue_planned_start for task in tasks if task.webvue_planned_start]
            candidates += [
                task.date_deadline.date() for task in tasks
                if task.date_deadline and not task.webvue_planned_start
            ]
            candidates += [milestone.deadline for milestone in milestones if milestone.deadline]
            anchor = min(candidates) if candidates else None
        return start - anchor if anchor else None

    def _webvue_copy_shift(self, value, delta, env):
        if not value or delta is None:
            return False
        try:
            return value + delta
        except OverflowError as error:
            raise ValidationError(env._("A copied date falls outside the calendar range.")) from error

    def _webvue_copy_extra(self, source, start, end, stages):
        extra = {
            'date_start': start,
            'allow_task_dependencies': bool(source.allow_task_dependencies),
            'webvue_type_id': source.webvue_type_id.id or False,
            'webvue_owning_unit_id': source.webvue_owning_unit_id.id or False,
        }
        if end:
            extra['date'] = end
        if stages:
            extra['type_ids'] = [
                (0, 0, {'name': stage.name, 'fold': stage.fold, 'sequence': (index + 1) * 10})
                for index, stage in enumerate(stages)
            ]
        return extra

    def _webvue_copy_populate(self, source, project, tasks, milestones, stages, delta, serialize):
        env = source.env
        marker = env.cr.precommit.data
        previous = marker.get(PROJECT_COPY_MARKER)
        marker[PROJECT_COPY_MARKER] = (env.uid, env.company.id, project.id)
        try:
            stage_map = self._webvue_copy_stage_map(project, stages)
            milestone_map = self._webvue_copy_milestones(project, milestones, delta, env)
            task_map = self._webvue_copy_tasks(env, project, tasks, stage_map, milestone_map, delta)
            self._webvue_copy_dependencies(source, tasks, task_map)
            result = serialize(project) if serialize is not None else project
            # Settle stored computations while the narrow scope still owns
            # population, before savepoint release flushes without it.
            env.flush_all()
        finally:
            if previous is None:
                marker.pop(PROJECT_COPY_MARKER, None)
            else:
                marker[PROJECT_COPY_MARKER] = previous
        return result

    def _webvue_copy_stage_map(self, project, stages):
        new_stages = project.type_ids.sorted(lambda stage: (stage.sequence, stage.id))
        return {stage.id: new_stages[index].id for index, stage in enumerate(stages)}

    def _webvue_copy_milestones(self, project, milestones, delta, env):
        milestone_map = {}
        for milestone in milestones:
            milestone_map[milestone.id] = project._webvue_create_milestone(
                milestone.name, deadline=self._webvue_copy_shift(milestone.deadline, delta, env) or None,
            ).id
        return milestone_map

    def _webvue_copy_tasks(self, env, project, tasks, stage_map, milestone_map, delta):
        task_map = {}
        for task in tasks:
            values = {
                'name': task.name,
                'description': task.description,
                'project_id': project.id,
                'stage_id': stage_map.get(task.stage_id.id, False),
                'milestone_id': milestone_map.get(task.milestone_id.id, False),
                'tag_ids': [(6, 0, task.tag_ids.ids)],
                'state': '01_in_progress',
                'user_ids': [(6, 0, [])],
                'parent_id': False,
            }
            if task.date_deadline and not task.webvue_planned_start and delta is not None:
                # Deadline-only task: no schedule pair, so the deadline
                # is an ordinary whitelisted create field.
                values['date_deadline'] = self._webvue_copy_shift(task.date_deadline, delta, env)
            new_task = env['project.task']._webvue_create_for_copy(project, values)
            if task.webvue_planned_start and task.date_deadline and delta is not None:
                new_task._webvue_set_schedule(
                    self._webvue_copy_shift(task.webvue_planned_start, delta, env),
                    self._webvue_copy_shift(task.date_deadline.date(), delta, env),
                )
            task_map[task.id] = new_task
        return task_map

    def _webvue_copy_dependencies(self, source, tasks, task_map):
        # Stock keeps links when the toggle is turned off; do not copy them.
        for task in (tasks if source.allow_task_dependencies else tasks.browse()):
            dependencies = [
                task_map[dependency.id].id for dependency in task.depend_on_ids
                if dependency.id in task_map
            ]
            if dependencies:
                task_map[task.id]._webvue_set_dependencies(dependencies)
