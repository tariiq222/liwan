# Part of Odoo. See LICENSE file for full copyright and licensing details.
# Original author: Cyan (vendor 19.0.1.3.0). WebVue hardening 19.0.1.3.1.
# SPDX-License-Identifier: LGPL-3
from odoo import _, api, fields, models
from odoo.exceptions import AccessError, UserError, ValidationError


class CyanMeetingMinute(models.Model):
    _name = "cyan.meeting.minute"
    _description = "Internal Meeting Minutes"
    _inherit = ["mail.thread", "mail.activity.mixin"]
    _rec_name = "reference"
    _order = "meeting_date desc, id desc"
    _check_company_auto = True
    _mail_post_access = "read"

    _INTERNAL_FIELDS = frozenset({
        "calendar_event_id", "resolution_count",
        "open_resolution_count", "overdue_resolution_count", "can_edit", "can_manage",
        "reference",
    })
    _CONTENT_FIELDS = frozenset({
        "name", "company_id", "meeting_date", "start_datetime", "end_datetime",
        "location", "organizer_id", "secretary_id", "attendee_ids", "agenda", "minutes",
    })
    _LOCKED_STATES = frozenset({"done", "cancelled"})

    reference = fields.Char(
        string="Reference", required=True, readonly=True, copy=False,
        default=lambda self: _("New"), index="btree", tracking=True,
    )
    name = fields.Char(string="Meeting Title", required=True, tracking=True)
    company_id = fields.Many2one(
        "res.company", required=True, index=True, default=lambda self: self.env.company,
        tracking=True,
    )
    meeting_date = fields.Date(required=True, default=fields.Date.context_today, tracking=True, index=True)
    start_datetime = fields.Datetime(string="Start", tracking=True)
    end_datetime = fields.Datetime(string="End", tracking=True)
    location = fields.Char(tracking=True)
    organizer_id = fields.Many2one(
        "res.users", string="Organizer", required=True, default=lambda self: self.env.user,
        domain="[('share', '=', False)]", check_company=True, tracking=True,
    )
    secretary_id = fields.Many2one(
        "res.users", string="Secretary", domain="[('share', '=', False)]",
        check_company=True, tracking=True,
    )
    attendee_ids = fields.Many2many(
        "res.users", "cyan_meeting_attendee_rel", "meeting_id", "user_id",
        string="Attendees", domain="[('share', '=', False)]", check_company=True,
        tracking=True,
    )
    calendar_event_id = fields.Many2one(
        "calendar.event", string="Calendar Event", copy=False, readonly=True,
        ondelete="restrict", index=True, tracking=True,
    )
    agenda = fields.Html(sanitize=True)
    minutes = fields.Html(string="Meeting Minutes", sanitize=True)
    resolution_ids = fields.One2many("cyan.meeting.resolution", "meeting_id", string="Resolutions")
    state = fields.Selection(
        [("draft", "Draft"), ("confirmed", "Confirmed"), ("done", "Completed"), ("cancelled", "Cancelled")],
        default="draft", required=True, index=True, tracking=True, copy=False,
    )
    active = fields.Boolean(default=True)
    resolution_count = fields.Integer(compute="_compute_resolution_counts", string="Total Resolutions")
    open_resolution_count = fields.Integer(compute="_compute_resolution_counts", string="Open Resolutions")
    overdue_resolution_count = fields.Integer(compute="_compute_resolution_counts", string="Overdue Resolutions")
    can_edit = fields.Boolean(compute="_compute_can_flags")
    can_manage = fields.Boolean(compute="_compute_can_flags")

    _reference_unique = models.Constraint("unique(reference)", "Meeting reference must be unique.")
    _calendar_event_unique = models.Constraint(
        "unique(calendar_event_id)",
        "A Calendar Event can only be linked to one Meeting Minutes record.",
    )

    def _cyan_is_manager(self):
        return bool(self.env.su or self.env.user.has_group("cyan_meeting_minutes.group_meeting_manager"))

    def _cyan_participant_users(self):
        self.ensure_one()
        return self.organizer_id | self.secretary_id | self.attendee_ids

    def _cyan_is_editor(self):
        self.ensure_one()
        if self._cyan_is_manager():
            return True
        return self.env.user in (self.organizer_id | self.secretary_id)

    def _cyan_assert_internal_user(self, user, company):
        if not user:
            return
        if user.share or not user.active:
            raise ValidationError(_("Meeting participants must be active internal users."))
        if company and company not in user.company_ids:
            raise ValidationError(_("Organizer, secretary and attendees must have access to the meeting company."))

    @api.model
    def default_get(self, fields_list):
        values = super().default_get(fields_list)
        for name in self._INTERNAL_FIELDS | {"state"}:
            values.pop(name, None)
        return values

    @api.model_create_multi
    def create(self, vals_list):
        sequence = self.env["ir.sequence"]
        prepared = []
        for vals in vals_list:
            vals = dict(vals)
            if not self.env.su:
                if "state" in vals and vals["state"] != "draft":
                    raise UserError(_("New meetings must start in draft."))
                if vals.get("reference") and vals["reference"] != _("New"):
                    raise AccessError(_("You cannot set internal meeting fields."))
                if vals.get("calendar_event_id"):
                    raise AccessError(_("You cannot set internal meeting fields."))
                for name in self._INTERNAL_FIELDS:
                    vals.pop(name, None)
                vals["state"] = "draft"
                if not self._cyan_is_manager():
                    vals["organizer_id"] = self.env.user.id
            if vals.get("reference", _("New")) == _("New"):
                vals["reference"] = sequence.next_by_code("cyan.meeting.minute") or _("New")
            prepared.append(vals)
        records = super().create(prepared)
        records._cyan_sync_followers()
        return records

    def write(self, vals):
        vals = dict(vals)
        if not self.env.su:
            illicit = self._INTERNAL_FIELDS.intersection(vals)
            if illicit:
                raise AccessError(_("You cannot set internal meeting fields."))
            self._cyan_check_human_write(vals)
        previous = {meeting.id: meeting._cyan_follower_partners() for meeting in self} if not self.env.su else {}
        result = super().write(vals)
        if not self.env.su:
            self._cyan_sync_followers(previous)
        return result

    def _cyan_check_human_write(self, vals):
        if not self:
            return
        if not self._cyan_is_manager() and any(not meeting._cyan_is_editor() for meeting in self):
            raise AccessError(_("Only the organizer, secretary or a Meeting Manager may edit this meeting."))
        new_state = vals.get("state")
        content_keys = self._CONTENT_FIELDS.intersection(vals) | ({"active"} & set(vals))
        extra = set(vals) - {"state"} - self._INTERNAL_FIELDS
        for meeting in self:
            if meeting.state in self._LOCKED_STATES:
                if new_state == "draft":
                    if extra or content_keys:
                        raise UserError(_("Reopen a completed or cancelled meeting before changing its content."))
                    if not self._cyan_is_manager():
                        raise UserError(_("Only a Meeting Manager may reopen completed or cancelled meetings."))
                    continue
                if new_state and new_state != meeting.state:
                    raise UserError(_("Only a Meeting Manager may reopen completed or cancelled meetings."))
                if content_keys or (set(vals) - {"state"}):
                    raise UserError(_("Completed and cancelled meetings are immutable."))
            elif new_state:
                self._cyan_check_transition(meeting, new_state)
            elif content_keys and not meeting._cyan_is_editor() and not self._cyan_is_manager():
                raise AccessError(_("Only the organizer, secretary or a Meeting Manager may edit this meeting."))

    def _cyan_check_transition(self, meeting, new_state):
        if new_state == meeting.state:
            return
        allowed = {
            "draft": {"confirmed", "cancelled"},
            "confirmed": {"done", "cancelled"},
            "done": {"draft"},
            "cancelled": {"draft"},
        }
        if new_state not in allowed.get(meeting.state, ()):
            raise UserError(_("This meeting state change is not allowed."))
        if new_state in {"done", "cancelled"} and not self._cyan_is_manager():
            raise UserError(_("Only a Meeting Manager may complete or cancel meetings."))
        if new_state == "confirmed" and not (self._cyan_is_manager() or meeting._cyan_is_editor()):
            raise AccessError(_("Only the organizer, secretary or a Meeting Manager may confirm this meeting."))

    def copy(self, default=None):
        default = dict(default or {})
        default["state"] = "draft"
        default["calendar_event_id"] = False
        default["reference"] = _("New")
        return super().copy(default)

    def unlink(self):
        if not self.env.su:
            if any(meeting.state in self._LOCKED_STATES for meeting in self):
                raise UserError(_("Completed and cancelled meetings cannot be deleted."))
            if not self._cyan_is_manager():
                raise AccessError(_("Only a Meeting Manager may delete meetings."))
        return super().unlink()

    @api.private
    def _cyan_link_calendar_event(self, event):
        self.ensure_one()
        if not self.env.su:
            if self.state in self._LOCKED_STATES:
                raise UserError(_("Completed and cancelled meetings are immutable."))
            if not self._cyan_is_editor() and not self._cyan_is_manager():
                raise AccessError(_("Only the organizer, secretary or a Meeting Manager may link a calendar event."))
            event.check_access("read")
        return super().write({"calendar_event_id": event.id})

    @api.private
    def _cyan_write_calendar_schedule(self, values):
        self.ensure_one()
        if self.state in self._LOCKED_STATES:
            raise UserError(_("Completed and cancelled meetings are immutable."))
        if not self._cyan_is_manager() and not self._cyan_is_editor():
            raise AccessError(_("Updating the calendar event cannot change meeting minutes you cannot edit."))
        previous = {self.id: self._cyan_follower_partners()}
        result = super().write(values)
        self._cyan_sync_followers(previous)
        return result

    @api.constrains("start_datetime", "end_datetime")
    def _check_datetime_order(self):
        for meeting in self:
            if meeting.start_datetime and meeting.end_datetime and meeting.end_datetime < meeting.start_datetime:
                raise ValidationError(_("The meeting end time cannot be earlier than its start time."))

    @api.constrains("organizer_id", "secretary_id", "attendee_ids", "company_id")
    def _check_user_companies(self):
        for meeting in self:
            users = meeting._cyan_participant_users()
            for user in users:
                meeting._cyan_assert_internal_user(user, meeting.company_id)
            for resolution in meeting.resolution_ids:
                if resolution.responsible_id and resolution.responsible_id not in meeting._cyan_participant_users():
                    raise ValidationError(_("Reassign the responsible user before removing them from the meeting."))

    @api.depends("resolution_ids.state", "resolution_ids.deadline")
    def _compute_resolution_counts(self):
        for meeting in self:
            meeting.resolution_count = 0
            meeting.open_resolution_count = 0
            meeting.overdue_resolution_count = 0

        origin_meetings = self._origin
        if not origin_meetings:
            return

        values = {meeting.id: [0, 0, 0] for meeting in origin_meetings}
        meeting_domain = [("meeting_id", "in", origin_meetings.ids)]
        today = fields.Date.context_today(self)
        Resolution = self.env["cyan.meeting.resolution"]
        for meeting, count in Resolution._read_group(
            meeting_domain, ["meeting_id"], ["__count"],
        ):
            values[meeting.id][0] = count
        for meeting, count in Resolution._read_group(
            meeting_domain + [("state", "not in", ("done", "cancelled"))],
            ["meeting_id"], ["__count"],
        ):
            values[meeting.id][1] = count
        for meeting, count in Resolution._read_group(
            meeting_domain + [
                ("state", "not in", ("done", "cancelled")),
                ("deadline", "<", today),
            ],
            ["meeting_id"], ["__count"],
        ):
            values[meeting.id][2] = count
        for meeting in self:
            if meeting._origin:
                meeting.resolution_count, meeting.open_resolution_count, meeting.overdue_resolution_count = values[meeting._origin.id]

    @api.depends("state", "organizer_id", "secretary_id")
    def _compute_can_flags(self):
        is_manager = self._cyan_is_manager()
        user = self.env.user
        for meeting in self:
            meeting.can_manage = is_manager
            meeting.can_edit = meeting.state not in self._LOCKED_STATES and (
                is_manager or user in (meeting.organizer_id | meeting.secretary_id)
            )

    def action_confirm(self):
        for meeting in self:
            if meeting.state != "draft":
                raise UserError(_("Only draft meetings can be confirmed."))
        self.write({"state": "confirmed"})
        return True

    def action_done(self):
        for meeting in self:
            if meeting.state != "confirmed":
                raise UserError(_("Only confirmed meetings can be completed."))
        self.write({"state": "done"})
        return True

    def action_cancel(self):
        self.filtered(lambda meeting: meeting.state != "cancelled").write({"state": "cancelled"})
        return True

    def action_reset_draft(self):
        self.write({"state": "draft"})
        return True

    def action_view_resolutions(self):
        self.ensure_one()
        action = self.env["ir.actions.actions"]._for_xml_id("cyan_meeting_minutes.action_meeting_resolution")
        action["domain"] = [("meeting_id", "=", self.id)]
        action["context"] = {"default_meeting_id": self.id}
        return action

    def action_open_calendar_event(self):
        self.ensure_one()
        if not self.calendar_event_id:
            raise UserError(_("This meeting is not linked to a Calendar Event."))
        self.calendar_event_id.check_access("read")
        return {
            "type": "ir.actions.act_window",
            "name": _("Calendar Event"),
            "res_model": "calendar.event",
            "res_id": self.calendar_event_id.id,
            "view_mode": "form",
            "target": "current",
        }

    def action_schedule_calendar_event(self):
        self.ensure_one()
        if self.calendar_event_id:
            return self.action_open_calendar_event()
        if self.state in self._LOCKED_STATES:
            raise UserError(_("Completed and cancelled meetings are immutable."))
        if not self._cyan_is_editor() and not self._cyan_is_manager():
            raise AccessError(_("Only the organizer, secretary or a Meeting Manager may schedule this meeting."))
        if not self.start_datetime or not self.end_datetime:
            raise UserError(_("Set Start and End before scheduling this meeting in Calendar."))
        partners = self._cyan_participant_users().mapped("partner_id")
        event = self.env["calendar.event"].create({
            "name": self.name,
            "start": self.start_datetime,
            "stop": self.end_datetime,
            "location": self.location,
            "user_id": self.organizer_id.id,
            "partner_ids": [(6, 0, partners.ids)],
            "privacy": "confidential",
        })
        self._cyan_link_calendar_event(event)
        self.message_post(
            body=_("Linked to Calendar event: %s", event.name),
            subtype_xmlid="mail.mt_note",
        )
        return self.action_open_calendar_event()

    def _cyan_allowed_follower_partners(self):
        self.ensure_one()
        users = self._cyan_participant_users()
        # sudo READ: meeting-manager group members for this company; no meeting fields.
        managers = self.env.ref("cyan_meeting_minutes.group_meeting_manager").sudo().user_ids.filtered(
            lambda user: user.active and not user.share and self.company_id in user.company_ids,
        )
        return (users | managers).mapped("partner_id")

    def _cyan_follower_partners(self):
        return self._cyan_allowed_follower_partners()

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

    def _cyan_sync_followers(self, previous=None):
        previous = previous or {}
        for meeting in self:
            allowed = meeting._cyan_follower_partners()
            extra = meeting.message_partner_ids - allowed
            extra = extra.filtered(lambda partner: partner.user_ids)
            if extra:
                meeting.message_unsubscribe(partner_ids=extra.ids)
            stale = previous.get(meeting.id)
            if stale:
                removed = stale - allowed
                if removed:
                    meeting.message_unsubscribe(partner_ids=removed.ids)
