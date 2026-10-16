# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields
from odoo.tests import TransactionCase, new_test_user, tagged

from odoo.addons.webvue_api.tests.common import WebVueApiCase


class WebVueMeetingsCase(WebVueApiCase):
    """The shared webvue_api fixture plus a second internal user; no project records."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.manager = new_test_user(cls.env, login='api_mgr', password='api_mgr_pass_123',
                                    name='Mona', groups='webvue_core.group_employee')


@tagged('webvue')
class WebVueMeetingEngineCase(TransactionCase):
    """Model-level fixture of the meeting engine: capability roles, no HTTP and no projects."""

    @classmethod
    def _grant(cls, user, company, keys):
        permissions = cls.env['webvue.access.permission'].search([('key', 'in', keys)])
        role = cls.env['webvue.access.role'].create({
            'name_ar': 'دور اختبار الاجتماعات', 'company_id': company.id,
            'permission_ids': [(6, 0, permissions.ids)],
        })
        cls.env['webvue.access.assignment'].create({'user_id': user.id, 'role_id': role.id, 'company_id': company.id})

    @classmethod
    def _user(cls, login, keys, company=None, groups='webvue_core.group_employee'):
        company = company or cls.company
        user = new_test_user(cls.env, login=login, groups=groups, company_id=company.id, company_ids=[company.id])
        if keys:
            cls._grant(user, company, keys)
        return user

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls.env.company
        cls.company_other = cls.env['res.company'].create({'name': 'Engine Other Co'})
        participant = ['meetings.read', 'meetings.create']
        cls.organizer = cls._user('engine_org', participant)
        cls.secretary = cls._user('engine_sec', participant)
        cls.attendee = cls._user('engine_att', participant)
        cls.outsider = cls._user('engine_out', participant)
        cls.event_owner = cls._user('engine_event', participant)
        cls.manager = cls._user('engine_mgr', ['meetings.read', 'meetings.create', 'meetings.manage'])
        cls.settings_admin = cls._user('engine_settings', [], groups='base.group_system')
        # Assignments exist only in the root company; this administrator holds the legacy group in another one.
        cls.other_user = cls._user('engine_other', [], company=cls.company_other, groups='webvue_core.group_access_admin')
        cls.Meeting = cls.env['webvue.meeting.minute']
        cls.Resolution = cls.env['webvue.meeting.resolution']

    def _meeting_vals(self, **extra):
        vals = {
            'name': 'Ops Review',
            'organizer_id': self.organizer.id,
            'secretary_id': self.secretary.id,
            'attendee_ids': [(6, 0, [self.attendee.id])],
            'meeting_date': fields.Date.today(),
            'start_datetime': fields.Datetime.now(),
            'end_datetime': fields.Datetime.now(),
            'agenda': '<p>Agenda</p>',
            'minutes': '<p>Notes</p>',
        }
        vals.update(extra)
        return vals

    def _create_meeting(self, user=None, **extra):
        env = self.Meeting.with_user(user or self.organizer)
        return env.create(self._meeting_vals(**extra))

    def _create_resolution(self, meeting, user=None, **extra):
        vals = {
            'meeting_id': meeting.id,
            'name': 'Follow up',
            'responsible_id': self.attendee.id,
            'deadline': fields.Date.today(),
        }
        vals.update(extra)
        return self.Resolution.with_user(user or self.organizer).create(vals)
