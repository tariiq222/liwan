# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from odoo.addons.liwan_api.tests.common import set_probe_feature
from odoo.addons.liwan_crm.tests.common import LiwanCrmCase

BASE = '/api/v1/crm/opportunities/{}/meetings'
BOTH = ['crm.leads.read', 'crm.leads.work', 'meetings.read', 'meetings.create']
SHAPE_KEYS = {'id', 'name', 'meeting_date', 'state', 'location', 'project'}


@tagged('post_install', '-at_install', 'liwan')
class TestOpportunityMeetings(LiwanCrmCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.rep = cls.custom_user('crm_meet_rep', BOTH)
        cls.rep2 = cls.custom_user('crm_meet_rep2', BOTH)
        cls.lead = cls.make_lead(cls.rep)
        cls.other_lead = cls.make_lead(cls.rep)

    def as_rep(self):
        return self.as_user(self.rep)

    def create(self, lead, **body):
        return self.api('POST', BASE.format(lead.id), {'name': 'Demo', 'meeting_date': '2026-11-20', **body})

    def test_create_then_list_the_meetings_of_one_opportunity(self):
        self.as_rep()
        created = self.create(self.lead, location='Riyadh', attendee_ids=[self.rep2.id])
        self.assertEqual(created.status_code, 201, created.text)
        body = created.json()
        self.assertLessEqual(SHAPE_KEYS, set(body))
        self.assertEqual((body['name'], body['meeting_date'], body['location']), ('Demo', '2026-11-20', 'Riyadh'))
        meeting = self.env['liwan.meeting.minute'].browse(body['id'])
        self.assertEqual((meeting.lead_id, meeting.organizer_id, meeting.attendee_ids), (self.lead, self.rep, self.rep2))
        self.assertEqual(self.create(self.other_lead, name='Other').status_code, 201)
        self.env['liwan.meeting.minute'].with_user(self.rep).create({'name': 'Unlinked', 'meeting_date': '2026-11-21'})
        listed = self.api('GET', BASE.format(self.lead.id))
        self.assertEqual(listed.status_code, 200, listed.text)
        self.assertEqual(set(listed.json()), {'items', 'total'})
        self.assertEqual([item['id'] for item in listed.json()['items']], [body['id']])
        self.assertEqual(listed.json()['total'], 1)
        self.assertEqual(self.api('GET', BASE.format(self.lead.id) + '?limit=1&offset=1').json()['items'], [])

    def test_the_link_cannot_be_forged_through_the_body(self):
        self.as_rep()
        for field in ('lead_id', 'project_id', 'series_id', 'minutes_form'):
            response = self.create(self.lead, **{field: self.other_lead.id})
            self.assertEqual((response.status_code, response.json()['code']), (422, 'invalid'), field)

    def test_the_same_validation_as_the_meetings_route_applies(self):
        self.as_rep()
        blank = self.create(self.lead, name=' ')
        self.assertEqual((blank.status_code, blank.json()['field']), (422, 'name'))
        outsider_attendee = self.create(self.lead, attendee_ids=[999999999])
        self.assertEqual(outsider_attendee.status_code, 422, outsider_attendee.text)

    def test_each_closed_feature_refuses_both_routes(self):
        for key in ('crm.enabled', 'meetings.enabled'):
            with self.subTest(feature=key):
                set_probe_feature(self, key=key, enabled=False)
                self.as_rep()
                for method in ('GET', 'POST'):
                    response = self.api(method, BASE.format(self.lead.id), {'name': 'x'} if method == 'POST' else None)
                    self.assertEqual(response.status_code, 403, (key, method))
                    self.assertEqual(response.json()['code'], 'feature_not_included', (key, method))
                set_probe_feature(self, key=key, enabled=True)
        self.assertEqual(self.as_rep().api('GET', BASE.format(self.lead.id)).status_code, 200)

    def test_both_applications_capabilities_are_needed(self):
        self.set_visibility('all')
        cases = {
            'crm_meet_only_crm': ['crm.leads.read', 'crm.leads.work'],
            'crm_meet_only_meetings': ['meetings.read', 'meetings.create'],
            'crm_meet_read_only': ['crm.leads.read', 'meetings.read'],
            'crm_meet_crm_read_meet_create': ['crm.leads.read', 'meetings.read', 'meetings.create'],
        }
        for login, keys in cases.items():
            user = self.custom_user(login, keys)
            self.as_user(user)
            listed = self.api('GET', BASE.format(self.lead.id))
            created = self.create(self.lead)
            for response, method in ((listed, 'GET'), (created, 'POST')):
                allowed = method == 'GET' and login in ('crm_meet_read_only', 'crm_meet_crm_read_meet_create')
                self.assertEqual(response.status_code, 200 if allowed else 403, (login, method, response.text))
                if not allowed:
                    self.assertEqual(response.json()['code'], 'forbidden', (login, method))
        self.assertEqual(self.env['liwan.meeting.minute'].search_count([('lead_id', '=', self.lead.id)]), 0)

    def test_an_agent_cannot_add_a_meeting_to_another_agents_opportunity(self):
        self.set_visibility('all')
        self.as_user(self.rep2)
        self.assertEqual(self.api('GET', BASE.format(self.lead.id)).status_code, 200)
        refused = self.create(self.lead)
        self.assertEqual((refused.status_code, refused.json()['code']), (403, 'forbidden'), refused.text)
        self.assertEqual(self.env['liwan.meeting.minute'].search_count([('lead_id', '=', self.lead.id)]), 0)

    def test_an_archived_opportunity_takes_no_new_meeting(self):
        lead = self.make_lead(self.rep)
        lead.active = False
        self.as_rep()
        refused = self.create(lead)
        self.assertEqual((refused.status_code, refused.json()['field']), (422, 'lead_id'), refused.text)

    def test_an_opportunity_the_caller_cannot_see_is_not_found(self):
        self.as_user(self.rep2)
        hidden = self.api('GET', BASE.format(self.lead.id))
        missing = self.api('GET', BASE.format(999999999))
        self.assertEqual((hidden.status_code, hidden.content), (404, missing.content))
        refused = self.create(self.lead)
        self.assertEqual(refused.status_code, 404, refused.text)
        self.assertEqual(self.env['liwan.meeting.minute'].search_count([('lead_id', '=', self.lead.id)]), 0)

    def test_a_meeting_stays_private_to_its_participants(self):
        self.as_rep()
        body = self.create(self.lead).json()
        self.as_user(self.rep2)
        self.set_visibility('all')
        listed = self.api('GET', BASE.format(self.lead.id))
        self.assertEqual((listed.status_code, listed.json()['items'], listed.json()['total']), (200, [], 0))
        self.assertTrue(self.env['liwan.meeting.minute'].browse(body['id']).exists())

    def test_deleting_the_opportunity_keeps_the_meeting_and_clears_the_link(self):
        lead = self.make_lead(self.rep)
        self.as_rep()
        meeting_id = self.create(lead).json()['id']
        lead.unlink()
        meeting = self.env['liwan.meeting.minute'].browse(meeting_id)
        self.assertTrue(meeting.exists())
        self.assertFalse(meeting.lead_id)
