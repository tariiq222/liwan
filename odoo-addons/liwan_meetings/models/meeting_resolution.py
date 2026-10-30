# Part of Odoo. See LICENSE file for full copyright and licensing details.
# Original author: Cyan (cyan_meeting_minutes 19.0.1.3.0, LGPL-3), absorbed into liwan_meetings.
# See PROVENANCE.md.
# SPDX-License-Identifier: LGPL-3

from markupsafe import Markup

from odoo import _, api, fields, models
from odoo.exceptions import AccessError, UserError, ValidationError

from .meeting_workspace import _WORKSPACE_WRITE


class LiwanMeetingResolution(models.Model):
    _name = "liwan.meeting.resolution"
    _description = "Meeting Resolution"
    _inherit = ["mail.thread"]
    _order = "deadline asc, priority desc, sequence, id"
    _liwan_scope = "company"
    _check_company_auto = True
    _mail_post_access = "read"

    _INTERNAL_FIELDS = frozenset({"company_id", "can_update_execution", "can_edit_decision"})
    _DECISION_FIELDS = frozenset({
        "name", "description", "responsible_id", "deadline", "priority",
        "meeting_id", "sequence", "execution_period",
    })
    _EXECUTION_FIELDS = frozenset({"state", "result"})

    sequence = fields.Integer(default=10)
    meeting_id = fields.Many2one(
        "liwan.meeting.minute", required=True, ondelete="cascade", index=True,
        check_company=True, tracking=True,
    )
    company_id = fields.Many2one(
        "res.company", related="meeting_id.company_id", store=True, readonly=True, index=True,
    )
    name = fields.Char(string="Resolution", required=True, tracking=True)
    description = fields.Html(sanitize=True)
    responsible_id = fields.Many2one(
        "res.users", required=True, domain="[('share', '=', False)]",
        check_company=True, tracking=True, index=True,
    )
    deadline = fields.Date(tracking=True, index=True)
    execution_period = fields.Char(size=500)
    priority = fields.Selection(
        [("0", "Normal"), ("1", "Important"), ("2", "Very Important"), ("3", "Urgent")],
        default="0", required=True, index=True, tracking=True,
    )
    state = fields.Selection(
        [("open", "Open"), ("in_progress", "In Progress"), ("done", "Done"), ("cancelled", "Cancelled")],
        default="open", required=True, index=True, tracking=True, copy=False,
    )
    result = fields.Html(string="Completion Notes", sanitize=True)
    can_update_execution = fields.Boolean(compute="_compute_can_update_execution")
    can_edit_decision = fields.Boolean(compute="_compute_can_update_execution")

    @api.model
    def default_get(self, fields_list):
        values = super().default_get(fields_list)
        for name in self._INTERNAL_FIELDS:
            values.pop(name, None)
        return values

    def _liwan_is_manager(self):
        self.ensure_one()
        if not self.env.su and not self.has_access('read'):
            return False
        return self.meeting_id._liwan_is_manager()

    def _liwan_is_meeting_editor(self, meeting):
        return meeting._liwan_is_editor()

    def _liwan_allowed_follower_partners(self):
        self.ensure_one()
        return self.meeting_id._liwan_allowed_follower_partners()

    def message_subscribe(self, partner_ids=None, subtype_ids=None):
        if partner_ids and not self.env.su:
            allowed = set()
            for record in self:
                allowed.update(record._liwan_allowed_follower_partners().ids)
            if set(partner_ids) - allowed:
                raise AccessError(_("You cannot add followers who cannot access this record."))
        return super().message_subscribe(partner_ids=partner_ids, subtype_ids=subtype_ids)

    def _liwan_assert_mail_post_kwargs(self, kwargs):
        if self.env.su:
            return
        allowed_docs = {(self._name, record.id) for record in self}
        attachment_ids = kwargs.get("attachment_ids") or []
        if attachment_ids:
            attachments = self.env["ir.attachment"].browse(attachment_ids).exists()
            attachments.check_access("read")
            allowed_unbound = {False, "", "mail.compose.message", "mail.scheduled.message"}
            for attachment in attachments:
                bound = (attachment.res_model, attachment.res_id) in allowed_docs
                own_unbound = (
                    not attachment.res_id
                    and attachment.create_uid == self.env.user
                    and (attachment.res_model or False) in allowed_unbound
                )
                if not bound and not own_unbound:
                    raise AccessError(_("You cannot attach files from another record."))
        parent_id = kwargs.get("parent_id")
        if parent_id:
            parent = self.env["mail.message"].browse(parent_id)
            if parent.exists() and (parent.model, parent.res_id) not in allowed_docs:
                raise AccessError(_("You cannot reply to a message from another record."))
        kwargs.pop("author_id", None)

    def message_post(self, **kwargs):
        partner_ids = kwargs.get("partner_ids") or []
        if partner_ids and not self.env.su:
            allowed = set()
            for record in self:
                allowed.update(record._liwan_allowed_follower_partners().ids)
            if set(partner_ids) - allowed:
                raise AccessError(_("You cannot notify partners who cannot access this record."))
        self._liwan_assert_mail_post_kwargs(kwargs)
        return super().message_post(**kwargs)

    def _notify_get_recipients(self, message, msg_vals=False, **kwargs):
        recipients = super()._notify_get_recipients(message, msg_vals=msg_vals, **kwargs)
        allowed = set()
        for record in self:
            allowed.update(record._liwan_allowed_follower_partners().ids)
        return [recipient for recipient in recipients if recipient.get("id") in allowed]

    @api.model_create_multi
    def create(self, vals_list):
        prepared = []
        for vals in vals_list:
            vals = self._add_missing_default_values(dict(vals))
            if not self.env.su:
                illicit = {name for name in self._INTERNAL_FIELDS if vals.get(name)}
                if illicit:
                    raise AccessError(_("You cannot set internal resolution fields."))
                for name in self._INTERNAL_FIELDS:
                    vals.pop(name, None)
                if vals.get("state", "open") != "open":
                    raise UserError(_("New resolutions must start open."))
                vals["state"] = "open"
                meeting = self.env["liwan.meeting.minute"].browse(vals.get("meeting_id"))
                if not meeting:
                    raise UserError(_("A meeting is required."))
                meeting.check_access("read")
                if meeting.state in ("done", "cancelled"):
                    raise UserError(_("Cannot add resolutions to a completed or cancelled meeting."))
                if not self._liwan_is_meeting_editor(meeting):
                    raise AccessError(_("Only the organizer, secretary or a Meeting Manager may create resolutions."))
            prepared.append(vals)
        records = super().create(prepared)
        # Odoo does not invoke a field constraint when both fields are omitted.
        records._check_deadline_or_execution_period()
        for record in records:
            record.meeting_id.message_post(
                body=Markup(_("Resolution created: <strong>%s</strong>")) % record.name,
                subtype_xmlid="mail.mt_note",
            )
        if not _WORKSPACE_WRITE.get():
            for resolution in records:
                resolution.meeting_id._liwan_event('recommendation_created', self.env._('Recommendation created.'))
        return records

    def write(self, vals):
        vals = dict(vals)
        if not self.env.su and (self._DECISION_FIELDS | {"state", "result"}) & set(vals):
            # A recommendation followed on a linked record (a converted task) is frozen here.
            if self.env['liwan.meeting.links']._liwan_linked_resolution_ids(self):
                raise UserError(_("Follow this recommendation on its task."))
        if not self.env.su:
            illicit = self._INTERNAL_FIELDS.intersection(vals)
            if illicit:
                raise AccessError(_("You cannot set internal resolution fields."))
            self._liwan_check_human_write(vals)
        result = super().write(vals)
        if not _WORKSPACE_WRITE.get() and vals:
            for resolution in self:
                resolution.meeting_id._liwan_event('recommendation_changed', self.env._('Recommendation updated.'))
        return result

    def _liwan_check_human_write(self, vals):
        decision = self._DECISION_FIELDS.intersection(vals)
        execution = self._EXECUTION_FIELDS.intersection(vals)
        other = set(vals) - self._DECISION_FIELDS - self._EXECUTION_FIELDS - self._INTERNAL_FIELDS
        new_state = vals.get("state")
        allowed = {
            "open": {"in_progress", "done", "cancelled"},
            "in_progress": {"done", "cancelled"},
            "done": {"open"},
            "cancelled": {"open"},
        }
        for resolution in self:
            meeting = resolution.meeting_id
            editor = self._liwan_is_meeting_editor(meeting)
            assignee = resolution.env.user == resolution.responsible_id
            if "meeting_id" in vals:
                new_meeting = self.env["liwan.meeting.minute"].browse(vals["meeting_id"])
                if meeting.state in ("done", "cancelled") or new_meeting.state in ("done", "cancelled"):
                    raise UserError(_("Resolutions cannot be moved to or from a completed or cancelled meeting."))
                if not editor or not self._liwan_is_meeting_editor(new_meeting):
                    raise AccessError(_("Only the organizer, secretary or a Meeting Manager may move a resolution."))
                new_meeting.check_access("read")
            if meeting.state == "cancelled":
                raise UserError(_("Reopen the cancelled meeting before updating its resolutions."))
            if decision and meeting.state == "done":
                raise UserError(_("Decision fields of an approved meeting cannot be changed."))
            if decision and not editor:
                raise AccessError(_("Only the organizer, secretary or a Meeting Manager may change resolution contents."))
            if other:
                raise AccessError(_("You cannot set internal resolution fields."))
            if resolution.state == "done" and "result" in vals and new_state != "open":
                raise UserError(_("Reopen the resolution before changing completion notes."))
            if not execution:
                continue
            if new_state and new_state != resolution.state:
                if new_state not in allowed.get(resolution.state, ()):
                    raise UserError(_("This resolution state change is not allowed."))
                if resolution.state in {"done", "cancelled"}:
                    if not resolution._liwan_is_manager():
                        raise UserError(_("Only a Meeting Manager may reopen this resolution."))
                    extra = set(vals) - {"state"}
                    if extra:
                        raise UserError(_("Reopen the resolution before changing other fields."))
                    continue
                if new_state == "cancelled" and not editor:
                    raise UserError(_("Assignees cannot cancel resolutions."))
            if not editor and not assignee:
                raise AccessError(_("Only the assignee or a meeting editor may update execution."))
            if not editor and assignee and decision:
                raise AccessError(_("Assignees may only update progress and completion notes."))

    def unlink(self):
        if not self.env.su:
            if any(resolution.meeting_id.state in ("done", "cancelled") for resolution in self):
                raise UserError(_("Resolutions of a completed or cancelled meeting cannot be deleted."))
            if any(not resolution._liwan_is_manager() for resolution in self):
                raise AccessError(_("Only a Meeting Manager may delete resolutions."))
        return super().unlink()

    def copy(self, default=None):
        if not self.env.su and any(resolution.meeting_id.state in ("done", "cancelled") for resolution in self):
            raise UserError(_("Cannot copy a resolution from a completed or cancelled meeting."))
        default = dict(default or {})
        default["state"] = "open"
        for name in self._INTERNAL_FIELDS:
            default.pop(name, None)
        return super().copy(default)

    @api.constrains("responsible_id", "meeting_id")
    def _check_responsible_participant(self):
        for resolution in self:
            meeting = resolution.meeting_id
            if not meeting or not resolution.responsible_id:
                continue
            if meeting.company_id not in resolution.responsible_id.company_ids:
                raise ValidationError(_("The responsible user must have access to the meeting company."))
            if resolution.responsible_id.share or not resolution.responsible_id.active:
                raise ValidationError(_("The responsible user must be an active internal user."))
            if resolution.responsible_id not in meeting._liwan_participant_users():
                raise ValidationError(_("The responsible user must be the organizer, secretary or an attendee."))

    @api.constrains("deadline", "execution_period")
    def _check_deadline_or_execution_period(self):
        for resolution in self:
            if not resolution.deadline and not (resolution.execution_period or "").strip():
                raise ValidationError(_("A deadline or execution period is required."))

    @api.depends("state", "company_id", "responsible_id", "meeting_id.state", "meeting_id.organizer_id", "meeting_id.secretary_id")
    @api.depends_context("uid", "allowed_company_ids")
    def _compute_can_update_execution(self):
        user = self.env.user
        for resolution in self:
            meeting = resolution.meeting_id
            editor = meeting._liwan_is_editor()
            resolution.can_update_execution = meeting.state != "cancelled" and (
                editor or user == resolution.responsible_id
            )
            resolution.can_edit_decision = editor and meeting.state not in ("done", "cancelled")

    def action_start(self):
        self.filtered(lambda item: item.state == "open").write({"state": "in_progress"})
        return True

    def action_done(self):
        self.filtered(lambda item: item.state not in ("done", "cancelled")).write({"state": "done"})
        return True

    def action_cancel(self):
        self.filtered(lambda item: item.state != "cancelled").write({"state": "cancelled"})
        return True

    def action_reopen(self):
        self.write({"state": "open"})
        return True
