# Part of Odoo. See LICENSE file for full copyright and licensing details.
import re
from datetime import date, datetime, timedelta

from odoo import api, fields, models
from odoo.exceptions import AccessError, ValidationError

from .project_task import TEMPLATE_APPLY_MARKER

TEMPLATE_KEY_RE = re.compile(r'^[A-Za-z][A-Za-z0-9_-]{0,63}$')
MAX_TEMPLATE_ITEMS = 100
MAX_TEMPLATE_OFFSET = 3650
MAX_TEMPLATE_DURATION = 3650
TEMPLATE_READ_CAPABILITIES = (
    'pmo.projects.read',
    'pmo.projects.create',
    'pmo.settings.manage',
)
DEFINITION_ERROR = 'definition must contain only stages, milestones and tasks.'
LISTS_ERROR = 'stages, milestones and tasks must be lists.'
CYCLE_ERROR = 'task dependencies cannot contain a cycle.'
DATE_ERROR = 'start_date must be a valid ISO date.'
DATE_FORMAT_ERROR = 'start_date must use YYYY-MM-DD.'
DESCRIPTION_ERROR = 'description must be a string.'


def _error(message):
    return ValidationError(message)


def _template_name(value, label):
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > 255:
        raise ValidationError(f'{label} must be a non-empty string of at most 255 characters.')
    return value.strip()


def _template_key(value, label):
    if not isinstance(value, str) or not TEMPLATE_KEY_RE.fullmatch(value):
        raise ValidationError(
            f'{label} must start with a letter and contain only letters, numbers, underscores or hyphens.',
        )
    return value


def _template_integer(value, label, minimum, maximum):
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise ValidationError(f'{label} must be an integer between {minimum} and {maximum}.')
    return value


def validate_template_definition(definition):
    """Validate and return a detached, normalized template definition."""
    if not isinstance(definition, dict) or set(definition) != {'stages', 'milestones', 'tasks'}:
        raise _error(DEFINITION_ERROR)
    stages = definition['stages']
    milestones = definition['milestones']
    tasks = definition['tasks']
    if not all(isinstance(rows, list) for rows in (stages, milestones, tasks)):
        raise _error(LISTS_ERROR)
    if not stages or len(stages) > MAX_TEMPLATE_ITEMS:
        raise ValidationError(f'templates must contain between 1 and {MAX_TEMPLATE_ITEMS} stages.')
    if len(milestones) > MAX_TEMPLATE_ITEMS or len(tasks) > MAX_TEMPLATE_ITEMS:
        raise ValidationError(f'templates may contain at most {MAX_TEMPLATE_ITEMS} milestones and tasks.')

    stage_keys = set()
    normalized_stages = []
    for index, row in enumerate(stages):
        if not isinstance(row, dict) or set(row) != {'key', 'name', 'fold'}:
            raise ValidationError(f'stages[{index}] must contain exactly key, name and fold.')
        key = _template_key(row['key'], f'stages[{index}].key')
        if key in stage_keys:
            raise ValidationError(f'duplicate stage key: {key}.')
        if not isinstance(row['fold'], bool):
            raise ValidationError(f'stages[{index}].fold must be a boolean.')
        stage_keys.add(key)
        normalized_stages.append({'key': key, 'name': _template_name(row['name'], f'stages[{index}].name'), 'fold': row['fold']})

    milestone_keys = set()
    normalized_milestones = []
    for index, row in enumerate(milestones):
        if not isinstance(row, dict) or set(row) != {'key', 'name', 'offset_days'}:
            raise ValidationError(f'milestones[{index}] must contain exactly key, name and offset_days.')
        key = _template_key(row['key'], f'milestones[{index}].key')
        if key in milestone_keys:
            raise ValidationError(f'duplicate milestone key: {key}.')
        milestone_keys.add(key)
        normalized_milestones.append({
            'key': key,
            'name': _template_name(row['name'], f'milestones[{index}].name'),
            'offset_days': _template_integer(row['offset_days'], f'milestones[{index}].offset_days', -MAX_TEMPLATE_OFFSET, MAX_TEMPLATE_OFFSET),
        })

    task_keys = set()
    normalized_tasks = []
    for index, row in enumerate(tasks):
        expected = {'key', 'name', 'stage_key', 'start_offset', 'duration_days', 'milestone_key', 'dependency_keys'}
        if not isinstance(row, dict) or set(row) != expected:
            raise ValidationError(f'tasks[{index}] must contain exactly {sorted(expected)}.')
        key = _template_key(row['key'], f'tasks[{index}].key')
        if key in task_keys:
            raise ValidationError(f'duplicate task key: {key}.')
        if not isinstance(row['stage_key'], str) or row['stage_key'] not in stage_keys:
            raise ValidationError(f'tasks[{index}].stage_key must reference a stage.')
        milestone_key = row['milestone_key']
        if milestone_key is not None and (not isinstance(milestone_key, str) or milestone_key not in milestone_keys):
            raise ValidationError(f'tasks[{index}].milestone_key must reference a milestone or null.')
        dependencies = row['dependency_keys']
        if not isinstance(dependencies, list) or any(not isinstance(value, str) for value in dependencies):
            raise ValidationError(f'tasks[{index}].dependency_keys must be a list of keys.')
        if len(dependencies) != len(set(dependencies)):
            raise ValidationError(f'tasks[{index}].dependency_keys must contain unique keys.')
        start_offset = _template_integer(row['start_offset'], f'tasks[{index}].start_offset', -MAX_TEMPLATE_OFFSET, MAX_TEMPLATE_OFFSET)
        duration = _template_integer(row['duration_days'], f'tasks[{index}].duration_days', 1, MAX_TEMPLATE_DURATION)
        task_keys.add(key)
        normalized_tasks.append({
            'key': key,
            'name': _template_name(row['name'], f'tasks[{index}].name'),
            'stage_key': row['stage_key'],
            'start_offset': start_offset,
            'duration_days': duration,
            'milestone_key': milestone_key,
            'dependency_keys': list(dependencies),
        })

    for index, row in enumerate(normalized_tasks):
        unknown = set(row['dependency_keys']) - task_keys
        if unknown:
            raise ValidationError(f'tasks[{index}].dependency_keys contains an unknown task key.')

    graph = {row['key']: set(row['dependency_keys']) for row in normalized_tasks}
    visiting = set()
    visited = set()

    def visit(key):
        if key in visiting:
            raise _error(CYCLE_ERROR)
        if key in visited:
            return
        visiting.add(key)
        for dependency in graph[key]:
            visit(dependency)
        visiting.remove(key)
        visited.add(key)

    for key in graph:
        visit(key)

    return {
        'stages': normalized_stages,
        'milestones': normalized_milestones,
        'tasks': normalized_tasks,
    }


def _template_date(value):
    if isinstance(value, date) and not isinstance(value, (bool, datetime)):
        return value
    if isinstance(value, str):
        try:
            parsed = date.fromisoformat(value)
        except (TypeError, ValueError) as error:
            raise _error(DATE_ERROR) from error
        if parsed.isoformat() != value:
            raise _error(DATE_FORMAT_ERROR)
        return parsed
    raise _error(DATE_ERROR)


def _template_offset_date(start, offset, label):
    try:
        return start + timedelta(days=offset)
    except OverflowError as error:
        raise ValidationError(f'{label} falls outside the calendar range.') from error


class ProjectTemplate(models.Model):
    _name = 'nasq.project.template'
    _description = 'Nasq reusable project template'
    _order = 'name, id'
    _check_company_auto = True

    name = fields.Char(required=True, index=True)
    description = fields.Text(default='')
    definition = fields.Json(required=True, default=lambda self: {'stages': [], 'milestones': [], 'tasks': []})
    company_id = fields.Many2one(
        'res.company', required=True, index=True, default=lambda self: self.env.company, ondelete='restrict',
    )

    def _nasq_is_privileged(self):
        return self.env.is_superuser()

    def _nasq_can_read_catalog(self):
        if self._nasq_is_privileged():
            return True
        service = self.env['nasq.access.service']
        return any(service._nasq_has_capability(self.env.user, key) for key in TEMPLATE_READ_CAPABILITIES)

    def _nasq_can_manage(self):
        return self._nasq_is_privileged() or self.env['nasq.access.service']._nasq_has_capability(
            self.env.user, 'pmo.settings.manage',
        )

    def _nasq_can_apply(self):
        return self._nasq_can_read_catalog() and self.env['project.project']._nasq_can_create()

    def _nasq_check_visible_current(self):
        if not self:
            return self
        if any(template.company_id != self.env.company for template in self):
            raise AccessError(self.env._('Template is outside the current company.'))
        self.check_access('read')
        return self

    @api.model
    def _search(self, domain, offset=0, limit=None, order=None, *, active_test=True, bypass_access=False):
        if not bypass_access and not self._nasq_is_privileged():
            if not self._nasq_can_read_catalog():
                raise AccessError(self.env._('You are not allowed to read project templates.'))
            domain = list(domain) + [('company_id', '=', self.env.company.id)]
        return super()._search(domain, offset=offset, limit=limit, order=order, active_test=active_test, bypass_access=bypass_access)

    def check_access(self, operation):
        if not self._nasq_is_privileged():
            if operation == 'read':
                if not self._nasq_can_read_catalog():
                    raise AccessError(self.env._('You are not allowed to read project templates.'))
            elif operation in ('write', 'create', 'unlink') and not self._nasq_can_manage():
                raise AccessError(self.env._('Only a settings manager can change project templates.'))
        return super().check_access(operation)

    @api.model_create_multi
    def create(self, vals_list):
        if not self._nasq_can_manage():
            raise AccessError(self.env._('Only a settings manager can create project templates.'))
        prepared = []
        for values in vals_list:
            values = dict(values)
            company_id = values.get('company_id', self.env.company.id)
            if company_id != self.env.company.id:
                raise AccessError(self.env._('Template company cannot be changed.'))
            values['company_id'] = self.env.company.id
            values['name'] = _template_name(values.get('name'), 'name')
            description = values.get('description', '')
            if not isinstance(description, str):
                raise _error(DESCRIPTION_ERROR)
            values['description'] = description or ''
            values['definition'] = validate_template_definition(values.get('definition'))
            prepared.append(values)
        return super().create(prepared)

    def write(self, values):
        if not self._nasq_can_manage():
            raise AccessError(self.env._('Only a settings manager can change project templates.'))
        self._nasq_check_visible_current()
        if 'company_id' in values:
            raise AccessError(self.env._('Template company cannot be changed.'))
        values = dict(values)
        if 'name' in values:
            values['name'] = _template_name(values['name'], 'name')
        if 'description' in values and not isinstance(values['description'], str):
            raise _error(DESCRIPTION_ERROR)
        if 'definition' in values:
            values['definition'] = validate_template_definition(values['definition'])
        return super().write(values)

    def unlink(self):
        if not self._nasq_can_manage():
            raise AccessError(self.env._('Only a settings manager can delete project templates.'))
        self._nasq_check_visible_current()
        return super().unlink()

    def _nasq_apply(self, name, start_date, *, serialize=None):
        """Populate a fresh project; optionally serialize inside the same scope.

        serialize is supplied only by the private Python caller, never accepted
        from an HTTP/RPC payload. Serializing before scope cleanup lets a native
        project-only creator receive project counts without generic task reads.
        Serializer failure rolls back population and always clears the scope.
        """
        self.ensure_one()
        # Only language/company/session context survives. Client defaults must
        # never seed assignees, parent tasks, followers, activities or schedules.
        self = self.with_context({
            key: value for key, value in self.env.context.items()
            if not key.startswith('default_')
        }, tracking_disable=True, mail_create_nosubscribe=True)
        self._nasq_check_visible_current()
        if not self._nasq_can_apply():
            raise AccessError(self.env._('You are not allowed to apply this project template.'))
        project_name = _template_name(name, 'name')
        start = _template_date(start_date)
        definition = validate_template_definition(self.definition)
        span = 0
        for milestone in definition['milestones']:
            span = max(span, milestone['offset_days'])
        for task in definition['tasks']:
            span = max(span, task['start_offset'] + task['duration_days'] - 1)
        end = _template_offset_date(start, max(0, span), 'template end')
        extra = {
            'date_start': start,
            'date': end,
            'allow_task_dependencies': bool(any(task['dependency_keys'] for task in definition['tasks'])),
            'type_ids': [
                (0, 0, {'name': row['name'], 'fold': row['fold'], 'sequence': (index + 1) * 10})
                for index, row in enumerate(definition['stages'])
            ],
        }
        with self.env.cr.savepoint():
            project = self.env['project.project']._nasq_create_from_policy(
                project_name, extra=extra, user_id=self.env.uid, date_end=end,
            )
            marker = self.env.cr.precommit.data
            previous = marker.get(TEMPLATE_APPLY_MARKER)
            marker[TEMPLATE_APPLY_MARKER] = (self.env.uid, self.env.company.id, project.id)
            try:
                stages = project.type_ids.sorted(lambda stage: (stage.sequence, stage.id))
                stage_ids = {
                    row['key']: stages[index].id for index, row in enumerate(definition['stages'])
                }
                milestones = {}
                for row in definition['milestones']:
                    milestones[row['key']] = project._nasq_create_milestone(
                        row['name'], deadline=_template_offset_date(start, row['offset_days'], 'milestone'),
                    )
                tasks = {}
                for row in definition['tasks']:
                    task = self.env['project.task']._nasq_create_for_template(project, {
                        'name': row['name'],
                        'project_id': project.id,
                        'stage_id': stage_ids[row['stage_key']],
                        'milestone_id': milestones[row['milestone_key']].id if row['milestone_key'] else False,
                        'state': '01_in_progress',
                        'user_ids': [(6, 0, [])],
                        'parent_id': False,
                    })
                    task._nasq_set_schedule(
                        _template_offset_date(start, row['start_offset'], 'task start'),
                        _template_offset_date(start, row['start_offset'] + row['duration_days'] - 1, 'task end'),
                    )
                    tasks[row['key']] = task
                for row in definition['tasks']:
                    if row['dependency_keys']:
                        tasks[row['key']]._nasq_set_dependencies([
                            tasks[key].id for key in row['dependency_keys']
                        ])
                result = serialize(project) if serialize is not None else project
                # Settle stored computations while the narrow scope still owns
                # population, before savepoint release flushes without it.
                self.env.flush_all()
            finally:
                if previous is None:
                    marker.pop(TEMPLATE_APPLY_MARKER, None)
                else:
                    marker[TEMPLATE_APPLY_MARKER] = previous
            return result
