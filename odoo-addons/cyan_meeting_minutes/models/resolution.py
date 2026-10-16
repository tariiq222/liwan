# Part of Odoo. See LICENSE file for full copyright and licensing details.
# Original author: Cyan (vendor 19.0.1.3.0). WebVue hardening 19.0.1.3.1.
# SPDX-License-Identifier: LGPL-3
from datetime import timedelta

from markupsafe import Markup

from odoo import _, api, fields, models
from odoo.exceptions import AccessError, UserError, ValidationError
from odoo.tools import is_html_empty


class CyanMeetingResolution(models.Model):
    _name = "cyan.meeting.resolution"
    _description = "Meeting Resolution"
    _inherit = ["mail.thread", "mail.activity.mixin"]
    _order = "deadline asc, priority desc, sequence, id"
    _check_company_auto = True
    _mail_post_access = "read"

    _ESCALATION_DAYS_BY_PRIORITY = {
        "0": 3,
        "1": 2,
        "2": 1,
        "3": 1,
    }
    _INTERNAL_FIELDS = frozenset({
        "completion_date", "activity_id", "is_escalated", "escalated_on",
        "escalated_to_id", "company_id", "days_overdue", "is_due_soon",
        "deadline_status", "can_update_execution", "can_edit_decision",
    })
    _DECISION_FIELDS = frozenset({
        "name", "description", "responsible_id", "deadline", "priority",
        "meeting_id", "sequence",
    })
    _EXECUTION_FIELDS = frozenset({"state", "result"})
    _SYSTEM_FIELDS = frozenset({
        "activity_id", "completion_date", "is_escalated", "escalated_on", "escalated_to_id",
    })

    sequence = fields.Integer(default=10)
    meeting_id = fields.Many2one(
        "cyan.meeting.minute", required=True, ondelete="cascade", index=True,
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
    deadline = fields.Date(required=True, tracking=True, index=True)
    priority = fields.Selection(
        [("0", "Normal"), ("1", "Important"), ("2", "Very Important"), ("3", "Urgent")],
        default="0", required=True, index=True, tracking=True,
    )
    state = fields.Selection(
        [("open", "Open"), ("in_progress", "In Progress"), ("done", "Done"), ("cancelled", "Cancelled")],
        default="open", required=True, index=True, tracking=True, copy=False,
    )
    completion_date = fields.Date(readonly=True, tracking=True, copy=False)
    result = fields.Html(string="Completion Notes", sanitize=True)
    activity_id = fields.Many2one("mail.activity", readonly=True, copy=False, ondelete="set null")
    days_overdue = fields.Integer(compute="_compute_deadline_metrics", string="Days Late")
    is_due_soon = fields.Boolean(compute="_compute_deadline_metrics", search="_search_is_due_soon")
    is_escalated = fields.Boolean(readonly=True, copy=False, index=True, tracking=True)
    escalated_on = fields.Datetime(readonly=True, copy=False, tracking=True)
    escalated_to_id = fields.Many2one(
        "res.users", string="Escalated To", readonly=True, copy=False,
        check_company=True, index=True, tracking=True,
    )
    deadline_status = fields.Selection(
        [("overdue", "Overdue"), ("today", "Due Today"), ("upcoming", "Upcoming"), ("completed", "Completed")],
        compute="_compute_deadline_status", search="_search_deadline_status",
    )
    can_update_execution = fields.Boolean(compute="_compute_can_update_execution")
    can_edit_decision = fields.Boolean(compute="_compute_can_update_execution")

    @api.model
    def default_get(self, fields_list):
        values = super().default_get(fields_list)
        for name in self._INTERNAL_FIELDS:
            values.pop(name, None)
        return values

    def _cyan_is_manager(self):
        return bool(self.env.su or self.env.user.has_group("cyan_meeting_minutes.group_meeting_manager"))

    def _cyan_is_meeting_editor(self, meeting):
        return self._cyan_is_manager() or self.env.user in (meeting.organizer_id | meeting.secretary_id)

    def _cyan_is_assignee(self):
        self.ensure_one()
        return self.env.user == self.responsible_id

    def _cyan_allowed_follower_partners(self):
        self.ensure_one()
        return self.meeting_id._cyan_allowed_follower_partners()

    def message_subscribe(self, partner_ids=None, subtype_ids=None):
        if partner_ids and not self.env.su:
            allowed = set()
            for record in self:
                allowed.update(record._cyan_allowed_follower_partners().ids)
            if set(partner_ids) - allowed:
                raise AccessError(_("You cannot add followers who cannot access this record."))
        return super().message_subscribe(partner_ids=partner_ids, subtype_ids=subtype_ids)

    def _cyan_assert_mail_post_kwargs(self, kwargs):
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
                allowed.update(record._cyan_allowed_follower_partners().ids)
            if set(partner_ids) - allowed:
                raise AccessError(_("You cannot notify partners who cannot access this record."))
        self._cyan_assert_mail_post_kwargs(kwargs)
        return super().message_post(**kwargs)

    def _notify_get_recipients(self, message, msg_vals=False, **kwargs):
        recipients = super()._notify_get_recipients(message, msg_vals=msg_vals, **kwargs)
        allowed = set()
        for record in self:
            allowed.update(record._cyan_allowed_follower_partners().ids)
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
                meeting = self.env["cyan.meeting.minute"].browse(vals.get("meeting_id"))
                if not meeting:
                    raise UserError(_("A meeting is required."))
                meeting.check_access("read")
                if meeting.state in ("done", "cancelled"):
                    raise UserError(_("Cannot add resolutions to a completed or cancelled meeting."))
                if not self._cyan_is_meeting_editor(meeting):
                    raise AccessError(_("Only the organizer, secretary or a Meeting Manager may create resolutions."))
            prepared.append(vals)
        records = super().create(prepared)
        records._sync_activity()
        for record in records:
            record.meeting_id.message_post(
                body=Markup(_("Resolution created: <strong>%s</strong>")) % record.name,
                subtype_xmlid="mail.mt_note",
            )
        return records

    def write(self, vals):
        vals = dict(vals)
        if not self.env.su:
            illicit = self._INTERNAL_FIELDS.intersection(vals)
            if illicit:
                raise AccessError(_("You cannot set internal resolution fields."))
            self._cyan_check_human_write(vals)
            if "state" in vals:
                if vals["state"] == "done":
                    vals["completion_date"] = fields.Date.context_today(self)
                elif vals["state"] != "done":
                    vals["completion_date"] = False
        result = super().write(vals)
        if {"responsible_id", "deadline", "name", "meeting_id", "state"}.intersection(vals):
            self._sync_activity()
        return result

    def _cyan_check_human_write(self, vals):
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
            editor = self._cyan_is_meeting_editor(meeting)
            assignee = resolution.env.user == resolution.responsible_id
            if "meeting_id" in vals:
                new_meeting = self.env["cyan.meeting.minute"].browse(vals["meeting_id"])
                if meeting.state in ("done", "cancelled") or new_meeting.state in ("done", "cancelled"):
                    raise UserError(_("Resolutions cannot be moved to or from a completed or cancelled meeting."))
                if not editor or not self._cyan_is_meeting_editor(new_meeting):
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
                    if not self._cyan_is_manager():
                        raise UserError(_("Only a Meeting Manager may reopen this resolution."))
                    extra = set(vals) - {"state", "completion_date"}
                    if extra:
                        raise UserError(_("Reopen the resolution before changing other fields."))
                    continue
                if new_state == "cancelled" and not editor:
                    raise UserError(_("Assignees cannot cancel resolutions."))
            if not editor and not assignee:
                raise AccessError(_("Only the assignee or a meeting editor may update execution."))
            if not editor and assignee and decision:
                raise AccessError(_("Assignees may only update progress and completion notes."))

    @api.private
    def _cyan_system_write(self, vals):
        if set(vals) - self._SYSTEM_FIELDS:
            raise AccessError(_("System write is limited to maintenance fields."))
        return super().write(vals)

    def unlink(self):
        if not self.env.su:
            if any(resolution.meeting_id.state in ("done", "cancelled") for resolution in self):
                raise UserError(_("Resolutions of a completed or cancelled meeting cannot be deleted."))
            if not self._cyan_is_manager():
                raise AccessError(_("Only a Meeting Manager may delete resolutions."))
        self.mapped("activity_id").exists().unlink()
        return super().unlink()

    def copy(self, default=None):
        if not self.env.su and any(resolution.meeting_id.state in ("done", "cancelled") for resolution in self):
            raise UserError(_("Cannot copy a resolution from a completed or cancelled meeting."))
        default = dict(default or {})
        default["state"] = "open"
        for name in self._INTERNAL_FIELDS | {"activity_id", "is_escalated", "escalated_on", "escalated_to_id", "completion_date"}:
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
            if resolution.responsible_id not in meeting._cyan_participant_users():
                raise ValidationError(_("The responsible user must be the organizer, secretary or an attendee."))

    @api.constrains("state", "result", "is_escalated")
    def _check_escalated_completion_notes(self):
        for resolution in self:
            if resolution.is_escalated and resolution.state == "done" and is_html_empty(resolution.result):
                raise ValidationError(_("Completion Notes are required to complete an escalated resolution."))

    @api.depends("deadline", "state")
    def _compute_deadline_metrics(self):
        today = fields.Date.context_today(self)
        due_soon_limit = today + timedelta(days=2)
        for resolution in self:
            is_active = resolution.state not in ("done", "cancelled")
            resolution.days_overdue = (
                (today - resolution.deadline).days
                if is_active and resolution.deadline and resolution.deadline < today
                else 0
            )
            resolution.is_due_soon = bool(
                is_active and resolution.deadline
                and today < resolution.deadline <= due_soon_limit,
            )

    @api.depends("state", "responsible_id", "meeting_id.state", "meeting_id.organizer_id", "meeting_id.secretary_id")
    def _compute_can_update_execution(self):
        is_manager = self._cyan_is_manager()
        user = self.env.user
        for resolution in self:
            meeting = resolution.meeting_id
            editor = is_manager or user in (meeting.organizer_id | meeting.secretary_id)
            resolution.can_update_execution = meeting.state != "cancelled" and (
                editor or user == resolution.responsible_id
            )
            resolution.can_edit_decision = editor and meeting.state not in ("done", "cancelled")

    @api.model
    def _search_is_due_soon(self, operator, value):
        if operator not in ("=", "!="):
            raise UserError(_("Due Soon only supports equality searches."))
        today = fields.Date.context_today(self)
        due_soon_limit = today + timedelta(days=2)
        domain = [
            ("deadline", ">", today),
            ("deadline", "<=", due_soon_limit),
            ("state", "not in", ("done", "cancelled")),
        ]
        matches = bool(value) if operator == "=" else not bool(value)
        return domain if matches else ["!"] + domain

    @api.depends("deadline", "state")
    def _compute_deadline_status(self):
        today = fields.Date.context_today(self)
        for resolution in self:
            if resolution.state in ("done", "cancelled"):
                resolution.deadline_status = "completed"
            elif resolution.deadline and resolution.deadline < today:
                resolution.deadline_status = "overdue"
            elif resolution.deadline == today:
                resolution.deadline_status = "today"
            else:
                resolution.deadline_status = "upcoming"

    @api.model
    def _search_deadline_status(self, operator, value):
        if operator not in ("=", "!="):
            raise UserError(_("Deadline status only supports equality searches."))
        today = fields.Date.context_today(self)
        domains = {
            "overdue": [("deadline", "<", today), ("state", "not in", ("done", "cancelled"))],
            "today": [("deadline", "=", today), ("state", "not in", ("done", "cancelled"))],
            "upcoming": [("deadline", ">", today), ("state", "not in", ("done", "cancelled"))],
            "completed": [("state", "in", ("done", "cancelled"))],
        }
        domain = domains.get(value, [("id", "=", 0)])
        return domain if operator == "=" else ["!"] + domain

    @api.model
    def _cron_check_overdue_escalations(self, additional_domain=None):
        today = fields.Date.context_today(self)
        domain = [
            ("state", "not in", ("done", "cancelled")),
            ("deadline", "<", today),
            ("is_escalated", "=", False),
            ("meeting_id.state", "!=", "cancelled"),
        ]
        if additional_domain:
            domain += additional_domain
        candidates = self.search(domain)
        for resolution in candidates:
            days_overdue = (today - resolution.deadline).days
            threshold = self._ESCALATION_DAYS_BY_PRIORITY[resolution.priority]
            if days_overdue < threshold:
                continue
            organizer = resolution.meeting_id.organizer_id
            resolution._cyan_system_write({
                "is_escalated": True,
                "escalated_on": fields.Datetime.now(),
                "escalated_to_id": organizer.id,
            })
            resolution.message_post(
                body=Markup(
                    "<p><strong>%s</strong></p>"
                    "<p>%s: %s<br/>%s: %s<br/>%s: %s<br/>%s: %s</p>",
                ) % (
                    _("Resolution escalated"),
                    _("Days overdue"), days_overdue,
                    _("Responsible"), resolution.responsible_id.display_name,
                    _("Deadline"), resolution.deadline,
                    _("Escalated to"), organizer.display_name,
                ),
                subtype_xmlid="mail.mt_note",
            )
        return True

    def _activity_values(self):
        self.ensure_one()
        return {
            "user_id": self.responsible_id.id,
            "date_deadline": self.deadline,
            "summary": _("Meeting %(reference)s — %(resolution)s", reference=self.meeting_id.reference, resolution=self.name),
            "note": Markup("<p><strong>%s</strong></p>") % self.meeting_id.name,
        }

    def _sync_activity(self):
        for resolution in self:
            activity = resolution.activity_id.exists()
            should_exist = bool(
                resolution.responsible_id and resolution.deadline
                and resolution.state not in ("done", "cancelled"),
            )
            if should_exist:
                values = resolution._activity_values()
                if activity:
                    activity.write(values)
                else:
                    activity = resolution.activity_schedule(
                        "mail.mail_activity_data_todo",
                        date_deadline=resolution.deadline,
                        summary=values["summary"],
                        note=values["note"],
                        user_id=resolution.responsible_id.id,
                    )
                    resolution._cyan_system_write({"activity_id": activity.id})
            elif activity:
                if resolution.state == "done":
                    activity.action_feedback(feedback=_("Resolution completed."))
                else:
                    activity.unlink()
                resolution._cyan_system_write({"activity_id": False})
        return True

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
