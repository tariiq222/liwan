# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The structured minutes form of a meeting: validation, protected storage and the wire projection."""
from odoo import api, models
from odoo.exceptions import ValidationError

from .meeting_workspace import _WORKSPACE_WRITE
from odoo.addons.webvue_meetings.serializers.meeting import dump_minutes_form


class WebVueMeetingMinuteForm(models.Model):
    _inherit = 'webvue.meeting.minute'

    @api.model
    def _webvue_validate_minutes_form(self, form):
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
                self.env['webvue.meeting.links']._webvue_check_topic_project(topic['project_id'])
            ids = topic['resolution_ids']
            if not isinstance(ids, list) or len(ids) > 200 or any(isinstance(item, bool) or not isinstance(item, int) or item <= 0 for item in ids):
                raise ValidationError(self.env._('Minutes topic recommendations are invalid.'))
            resolution_ids.extend(ids)
        if total_text > 50000:
            raise ValidationError(self.env._('The minutes form text is too long.'))
        if len(resolution_ids) != len(set(resolution_ids)):
            raise ValidationError(self.env._('A recommendation may only be assigned to one topic.'))
        if resolution_ids:
            resolutions = self.env['webvue.meeting.resolution'].browse(resolution_ids).exists()
            if len(resolutions) != len(set(resolution_ids)) or any(item.meeting_id != self for item in resolutions):
                raise ValidationError(self.env._('Minutes form contains a recommendation from another meeting.'))
        return form

    def _webvue_set_minutes_form(self, form):
        self.ensure_one()
        self.check_access('read')
        self._webvue_validate_minutes_form(form)
        self._webvue_check_human_write({'minutes_form_data': form})
        # The wire form redacts an unreadable topic project to null. Editing
        # visible minutes must not silently clear that server-owned association.
        # Read only after the ordinary record/content checks above, using the
        # same documented elevation that writes this protected JSON field.
        meeting_sudo = self.sudo()
        previous = meeting_sudo.minutes_form_data or {}
        projects_by_key = {topic['key']: topic.get('project_id') for topic in previous.get('topics', [])}
        form = {**form, 'topics': [dict(topic) for topic in form['topics']]}
        links = self.env['webvue.meeting.links']
        for topic in form['topics']:
            previous_project = projects_by_key.get(topic['key'])
            if topic['project_id'] is None and previous_project and not links._webvue_project_ref_by_id(self, previous_project):
                topic['project_id'] = previous_project
        was_internal = _WORKSPACE_WRITE.get()
        token = _WORKSPACE_WRITE.set(True)
        try:
            result = meeting_sudo.with_context(webvue_workspace_write=True).write({'minutes_form_data': form})
        finally:
            _WORKSPACE_WRITE.reset(token)
        if not was_internal:
            self._webvue_event('minutes_saved', self.env._('Meeting minutes updated.'))
        return result

    @api.depends('minutes_form_data')
    @api.depends_context('uid', 'company')
    def _compute_minutes_form(self):
        for meeting in self:
            meeting.check_access('read')
            meeting.minutes_form = dump_minutes_form(
                meeting, meeting.sudo().minutes_form_data,
            )
