# Part of Odoo. See LICENSE file for full copyright and licensing details.
from contextvars import ContextVar

from odoo import api, fields, models
from odoo.exceptions import AccessError, ValidationError

_WORKSPACE_WRITE = ContextVar('nasq_meeting_workspace_write', default=False)


def workspace_write_context():
    return _WORKSPACE_WRITE


class NasqMeetingMinutesVersion(models.Model):
    _name = 'nasq.meeting.minutes.version'
    _description = 'Immutable meeting minutes version'
    _nasq_scope = 'company'
    _order = 'captured_at desc, id desc'
    _check_company_auto = True

    meeting_id = fields.Many2one('cyan.meeting.minute', required=True, ondelete='cascade', index=True, check_company=True)
    company_id = fields.Many2one(related='meeting_id.company_id', store=True, index=True)
    number = fields.Integer(required=True, index=True)
    captured_at = fields.Datetime(required=True, index=True)
    actor_id = fields.Many2one('res.users', required=True, ondelete='restrict', check_company=True)
    snapshot = fields.Json(required=True, readonly=True, groups='base.group_system')

    _number_unique = models.Constraint('unique(meeting_id, number)', 'Meeting minutes version numbers must be unique.')

    @api.model_create_multi
    def create(self, vals_list):
        if not _WORKSPACE_WRITE.get():
            raise AccessError(self.env._('Meeting minutes versions are server generated.'))
        return super().create(vals_list)

    def write(self, vals):
        raise AccessError(self.env._('Meeting minutes versions are immutable.'))

    def unlink(self):
        raise AccessError(self.env._('Meeting minutes versions are immutable.'))


class NasqMeetingEvent(models.Model):
    _name = 'nasq.meeting.event'
    _description = 'Meeting activity event'
    _nasq_scope = 'company'
    _order = 'occurred_at desc, id desc'
    _check_company_auto = True

    meeting_id = fields.Many2one('cyan.meeting.minute', required=True, ondelete='cascade', index=True, check_company=True)
    company_id = fields.Many2one(related='meeting_id.company_id', store=True, index=True)
    occurred_at = fields.Datetime(required=True, index=True)
    actor_id = fields.Many2one('res.users', ondelete='set null', check_company=True)
    kind = fields.Char(required=True, index=True)
    summary = fields.Char(required=True)

    @api.model_create_multi
    def create(self, vals_list):
        if not _WORKSPACE_WRITE.get():
            raise AccessError(self.env._('Meeting events are server generated.'))
        return super().create(vals_list)

    def write(self, vals):
        raise AccessError(self.env._('Meeting events are immutable.'))

    def unlink(self):
        raise AccessError(self.env._('Meeting events are immutable.'))


class NasqMeetingWorkspace(models.Model):
    _inherit = 'cyan.meeting.minute'

    minutes_form_data = fields.Json(copy=False, readonly=True, groups='base.group_system')
    _CONTENT_FIELDS = frozenset({
        'name', 'company_id', 'meeting_date', 'start_datetime', 'end_datetime',
        'location', 'organizer_id', 'secretary_id', 'attendee_ids', 'agenda',
        'minutes', 'meeting_url', 'series_id', 'minutes_form_data',
    })

    @api.model_create_multi
    def create(self, vals_list):
        if not _WORKSPACE_WRITE.get() and any('minutes_form_data' in vals for vals in vals_list):
            raise AccessError(self.env._('Minutes form is server controlled.'))
        records = super().create(vals_list)
        if not _WORKSPACE_WRITE.get():
            for record in records:
                record._nasq_event('meeting_created', self.env._('Meeting created.'))
        return records

    @api.model
    def _nasq_validate_minutes_form(self, form):
        if not isinstance(form, dict):
            raise ValidationError(self.env._('minutes_form must be an object.'))
        required = ('opening', 'closing', 'chairperson', 'approver_name', 'approver_title', 'topics')
        if set(form) != set(required):
            raise ValidationError(self.env._('minutes_form contains unsupported fields.'))
        for field in required[:-1]:
            if not isinstance(form[field], str) or len(form[field]) > (500 if field in ('chairperson', 'approver_name', 'approver_title') else 50000):
                raise ValidationError(self.env._('Invalid minutes form field: %s', field))
        topics = form['topics']
        if not isinstance(topics, list) or len(topics) > 100:
            raise ValidationError(self.env._('minutes_form topics must contain at most 100 items.'))
        keys = set()
        resolution_ids = []
        total_text = sum(len(form[field]) for field in required[:-1])
        for topic in topics:
            if not isinstance(topic, dict) or set(topic) != {'key', 'title', 'discussion', 'project_id', 'resolution_ids'}:
                raise ValidationError(self.env._('Each minutes topic must have the supported fields.'))
            key = topic['key']
            if not isinstance(key, str) or not key.strip() or len(key) > 200 or key in keys:
                raise ValidationError(self.env._('Minutes topic keys must be unique.'))
            keys.add(key)
            if not isinstance(topic['title'], str) or len(topic['title']) > 500:
                raise ValidationError(self.env._('Minutes topic titles must be at most 500 characters.'))
            if not isinstance(topic['discussion'], str) or len(topic['discussion']) > 50000:
                raise ValidationError(self.env._('Minutes topic discussion is too long.'))
            total_text += len(topic['title']) + len(topic['discussion'])
            if topic['project_id'] is not None:
                if isinstance(topic['project_id'], bool) or not isinstance(topic['project_id'], int) or topic['project_id'] <= 0:
                    raise ValidationError(self.env._('Minutes topic project is invalid.'))
                self.env['nasq.meeting.links']._nasq_check_topic_project(topic['project_id'])
            ids = topic['resolution_ids']
            if not isinstance(ids, list) or len(ids) > 200 or any(isinstance(item, bool) or not isinstance(item, int) or item <= 0 for item in ids):
                raise ValidationError(self.env._('Minutes topic recommendations are invalid.'))
            resolution_ids.extend(ids)
        if total_text > 50000:
            raise ValidationError(self.env._('The minutes form text is too long.'))
        if len(resolution_ids) != len(set(resolution_ids)):
            raise ValidationError(self.env._('A recommendation may only be assigned to one topic.'))
        if resolution_ids:
            resolutions = self.env['cyan.meeting.resolution'].browse(resolution_ids).exists()
            if len(resolutions) != len(set(resolution_ids)) or any(item.meeting_id != self for item in resolutions):
                raise ValidationError(self.env._('Minutes form contains a recommendation from another meeting.'))
        return form

    def _nasq_set_minutes_form(self, form):
        self.ensure_one()
        self.check_access('read')
        self._nasq_validate_minutes_form(form)
        self._cyan_check_human_write({'minutes_form_data': form})
        # The wire form redacts an unreadable topic project to null. Editing
        # visible minutes must not silently clear that server-owned association.
        # Read only after the ordinary record/content checks above, using the
        # same documented elevation that writes this protected JSON field.
        meeting_sudo = self.sudo()
        previous = meeting_sudo.minutes_form_data or {}
        projects_by_key = {topic['key']: topic.get('project_id') for topic in previous.get('topics', [])}
        form = {**form, 'topics': [dict(topic) for topic in form['topics']]}
        links = self.env['nasq.meeting.links']
        for topic in form['topics']:
            previous_project = projects_by_key.get(topic['key'])
            if topic['project_id'] is None and previous_project and not links._nasq_project_ref_by_id(self, previous_project):
                topic['project_id'] = previous_project
        was_internal = _WORKSPACE_WRITE.get()
        token = _WORKSPACE_WRITE.set(True)
        try:
            result = meeting_sudo.with_context(nasq_workspace_write=True).write({'minutes_form_data': form})
        finally:
            _WORKSPACE_WRITE.reset(token)
        if not was_internal:
            self._nasq_event('minutes_saved', self.env._('Meeting minutes updated.'))
        return result

    def unlink(self):
        version_count = self.env['nasq.meeting.minutes.version'].sudo().search_count([
            ('meeting_id', 'in', self.ids),
        ])
        if version_count:
            raise AccessError(self.env._('Meetings with finalized minutes versions cannot be deleted.'))
        return super().unlink()

    def _nasq_event(self, kind, summary):
        self.ensure_one()
        token = _WORKSPACE_WRITE.set(True)
        try:
            return self.env['nasq.meeting.event'].sudo().create({
                'meeting_id': self.id,
                'occurred_at': fields.Datetime.now(),
                'actor_id': self.env.user.id if self.env.user else False,
                'kind': kind,
                'summary': summary[:500],
            })
        finally:
            _WORKSPACE_WRITE.reset(token)

    def _nasq_build_minutes_snapshot(self, captured_at=None):
        self.ensure_one()
        snapshot = super()._nasq_build_minutes_snapshot(captured_at)
        form = self.sudo().minutes_form_data
        if isinstance(form, dict):
            snapshot['minutes_form'] = form
        return snapshot

    def _nasq_build_workspace_snapshot(self, captured_at=None):
        return self._nasq_build_minutes_snapshot(captured_at)

    def write(self, vals):
        vals = dict(vals)
        if 'minutes_form_data' in vals and not _WORKSPACE_WRITE.get():
            raise AccessError(self.env._('Minutes form is server controlled.'))
        if self.ids:
            self.env.cr.execute(
                'SELECT id FROM %s WHERE id IN %%s ORDER BY id FOR UPDATE' % self._table,
                (tuple(sorted(self.ids)),),
            )
            self.invalidate_recordset()
        previous_state = {record.id: record.state for record in self}
        result = super().write(vals)
        if not _WORKSPACE_WRITE.get():
            for record in self:
                changed = set(vals) - {'state', 'minutes_snapshot_data', 'minutes_snapshot_at'}
                if changed:
                    record._nasq_event('meeting_edited', self.env._('Meeting details updated.'))
                if previous_state.get(record.id) != record.state:
                    kind = {'confirmed': 'meeting_confirmed', 'done': 'meeting_completed', 'draft': 'meeting_reopened', 'cancelled': 'meeting_cancelled'}.get(record.state, 'meeting_state_changed')
                    record._nasq_event(kind, self.env._('Meeting state changed to %s.', record.state))
                if previous_state.get(record.id) == 'confirmed' and record.state == 'done':
                    number = self.env['nasq.meeting.minutes.version'].sudo().search_count([('meeting_id', '=', record.id)]) + 1
                    token = _WORKSPACE_WRITE.set(True)
                    try:
                        self.env['nasq.meeting.minutes.version'].sudo().create({
                            'meeting_id': record.id,
                            'number': number,
                            'captured_at': fields.Datetime.now(),
                            'actor_id': self.env.user.id,
                            'snapshot': record._nasq_build_workspace_snapshot(),
                        })
                    finally:
                        _WORKSPACE_WRITE.reset(token)
        return result


class NasqMeetingResolutionWorkspace(models.Model):
    _inherit = 'cyan.meeting.resolution'

    deadline = fields.Date(required=False, tracking=True, index=True)
    execution_period = fields.Char(size=500)

    _DECISION_FIELDS = frozenset({
        'name', 'description', 'responsible_id', 'deadline', 'priority',
        'meeting_id', 'sequence', 'execution_period',
    })

    @api.constrains('deadline', 'execution_period')
    def _check_deadline_or_execution_period(self):
        for resolution in self:
            if not resolution.deadline and not (resolution.execution_period or '').strip():
                raise ValidationError(self.env._('A deadline or execution period is required.'))

    def write(self, vals):
        result = super().write(vals)
        if not _WORKSPACE_WRITE.get() and vals:
            for resolution in self:
                resolution.meeting_id._nasq_event('recommendation_changed', self.env._('Recommendation updated.'))
        return result

    @api.model_create_multi
    def create(self, vals_list):
        records = super().create(vals_list)
        # Odoo does not invoke a field constraint when both fields are omitted.
        records._check_deadline_or_execution_period()
        if not _WORKSPACE_WRITE.get():
            for resolution in records:
                resolution.meeting_id._nasq_event('recommendation_created', self.env._('Recommendation created.'))
        return records
