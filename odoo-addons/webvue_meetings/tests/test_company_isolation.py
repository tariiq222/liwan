# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Request-scoped company isolation for the webvue_meetings /api/v1 record routes.

Phase 1 of the isolation work: every GET record route must answer from the
request's pinned company set only (the session's current company plus its own
branches). On main, without the pin, a forged cids cookie, query or body
context leaks records of any company the caller is a member of, so the hidden
cases here must fail there and pass once the pin runs on every route.
"""
from unittest.mock import patch

from odoo.tests import tagged
from odoo.tests.common import HOST

from odoo.addons.webvue_api.tests.common import (
    CompanyIsolationCase,
    cover_isolation_routes,
)

# Every GET /api/v1 route of this addon carrying an <int:...> record id. The
# list routes (/api/v1/meetings, /api/v1/meeting-series, /api/v1/meetings/
# resolutions) carry no record id; /api/v1/meetings is exercised by the list
# test below.
COVERED = (
    '/api/v1/meetings/<int:meeting_id>',
    '/api/v1/meetings/<int:meeting_id>/attachments',
    '/api/v1/meetings/<int:meeting_id>/attachments/<int:attachment_id>/download',
    '/api/v1/meetings/<int:meeting_id>/events',
    '/api/v1/meetings/<int:meeting_id>/versions',
    '/api/v1/meetings/<int:meeting_id>/versions/<int:version_id>',
    '/api/v1/meetings/<int:meeting_id>/minutes.pdf',
    '/api/v1/meeting-series/<int:series_id>',
    '/api/v1/meeting-series/<int:series_id>/events',
    '/api/v1/meeting-series/<int:series_id>/resolutions',
)


@tagged('post_install', '-at_install', 'webvue')
class MeetingsCompanyIsolationCase(CompanyIsolationCase):
    """One completed meeting, one series and one attachment per company.

    iso_user organizes every record and holds the employee role (with its
    meetings.read grant) in all four companies, so the meetings record rule
    (capability + strict current company + participation) grants exactly the
    own-company reads and the matrix measures only the pinned company set.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.all_companies = (cls.company_p, cls.company_p1, cls.company_p2, cls.company_c)
        cls.meetings = {}
        cls.versions = {}
        cls.series = {}
        cls.attachments = {}
        for company in cls.all_companies:
            meeting = cls.env['webvue.meeting.minute'].with_company(company).create({
                'name': f'Iso meeting {company.name}',
                'organizer_id': cls.iso_user.id,
                'meeting_date': '2026-01-12',
                'start_datetime': '2026-01-12 07:00:00',
                'end_datetime': '2026-01-12 08:00:00',
                'agenda': '<p>Isolation agenda</p>',
                'minutes': '<p>Isolation minutes</p>',
            })
            # Completing captures the immutable minutes version the version
            # routes read and logs the events the events route lists.
            meeting.action_confirm()
            meeting.action_done()
            cls.meetings[company.id] = meeting
            cls.versions[company.id] = cls.env['webvue.meeting.minutes.version'].search(
                [('meeting_id', '=', meeting.id)], limit=1,
            )
            cls.series[company.id] = cls.env['webvue.meeting.series'].with_company(company).create({
                'name': f'Iso series {company.name}',
                'organizer_id': cls.iso_user.id,
            })
            cls.attachments[company.id] = cls.env['ir.attachment'].create({
                'name': 'iso-notes.txt', 'raw': b'isolation attachment', 'type': 'binary',
                'res_model': 'webvue.meeting.minute', 'res_id': meeting.id,
            })
        if not all(version.id for version in cls.versions.values()):
            msg = 'completing a fixture meeting must capture one minutes version'
            raise AssertionError(msg)

    def assert_status_every_way(self, path, hidden_company_id, status):
        """The plain call and the three cids forgeries all answer `status`."""
        for response in self.api_forged('GET', path, hidden_company_id):
            self.assertEqual(
                response.status_code, status,
                f'{path} must answer {status} under forgery: {response.text[:200]}',
            )

    def assert_record_matrix(self, route):
        """current=P: own and member-branch records 200, C 404; current=P1: own 200, rest 404.

        A branch of the current company stays inside the pinned set, so
        get_record lets it through and the strict current-company record rule
        answers 200 (member branch); a company outside the pinned set is not-found (404). The
        404 bodies of these routes name the requested id, so unlike the shared
        assertHidden they are pinned by status only.
        """
        for current in (self.company_p, self.company_p1):
            self.env_in(current)
            self.assertVisible(route(current))
            for company in self.all_companies:
                if company == current:
                    continue
                branch = current == self.company_p and company.parent_id == current
                self.assert_status_every_way(route(company), company.id, 200 if branch else 404)

    def test_meeting_record_is_company_scoped(self):
        self.assert_record_matrix(lambda company: f'/api/v1/meetings/{self.meetings[company.id].id}')

    def test_meeting_attachments_are_company_scoped(self):
        self.assert_record_matrix(
            lambda company: f'/api/v1/meetings/{self.meetings[company.id].id}/attachments')

    def test_meeting_attachment_download_is_company_scoped(self):
        self.assert_record_matrix(lambda company: (
            f'/api/v1/meetings/{self.meetings[company.id].id}'
            f'/attachments/{self.attachments[company.id].id}/download'
        ))

    def test_meeting_events_are_company_scoped(self):
        self.assert_record_matrix(
            lambda company: f'/api/v1/meetings/{self.meetings[company.id].id}/events')

    def test_meeting_versions_are_company_scoped(self):
        self.assert_record_matrix(
            lambda company: f'/api/v1/meetings/{self.meetings[company.id].id}/versions')

    def test_meeting_version_record_is_company_scoped(self):
        self.assert_record_matrix(lambda company: (
            f'/api/v1/meetings/{self.meetings[company.id].id}'
            f'/versions/{self.versions[company.id].id}'
        ))

    def test_meeting_minutes_pdf_is_company_scoped(self):
        """type='http' without api_handler: the pin still runs before any read.

        The http response shape differs from the json2 not-found body, so only
        the status is asserted, and the PDF render is patched like the access
        test does.
        """
        report_model = self.env['ir.actions.report']
        with patch.object(type(report_model), '_render_qweb_pdf', return_value=(b'%PDF-test', 'pdf')):
            for current in (self.company_p, self.company_p1):
                self.env_in(current)
                self.assertVisible(f'/api/v1/meetings/{self.meetings[current.id].id}/minutes.pdf')
            self.env_in(self.company_p)
            self.assert_status_every_way(
                f'/api/v1/meetings/{self.meetings[self.company_c.id].id}/minutes.pdf',
                self.company_c.id, 404,
            )

    def test_series_record_is_company_scoped(self):
        self.assert_record_matrix(lambda company: f'/api/v1/meeting-series/{self.series[company.id].id}')

    def test_series_events_are_company_scoped(self):
        self.assert_record_matrix(
            lambda company: f'/api/v1/meeting-series/{self.series[company.id].id}/events')

    def test_series_resolutions_are_company_scoped(self):
        self.assert_record_matrix(
            lambda company: f'/api/v1/meeting-series/{self.series[company.id].id}/resolutions')

    def test_meetings_list_is_company_scoped(self):
        """The list follows the pinned company set: P reads its branches, P1 only itself."""
        for current, visible in (
            (self.company_p, (self.company_p, self.company_p1, self.company_p2)),
            (self.company_p1, (self.company_p1,)),
        ):
            self.env_in(current)
            listed = self.assertVisible('/api/v1/meetings')
            ids = [item['id'] for item in listed.json()['items']]
            for company in visible:
                self.assertIn(self.meetings[company.id].id, ids)
            for company in self.all_companies:
                if company not in visible:
                    self.assertNotIn(self.meetings[company.id].id, ids)
        # A forged cids cookie must not widen the list either.
        self.opener.cookies.set('cids', f'{self.company_c.id}-{self.company_p.id}', domain=HOST, path='/')
        try:
            forged = self.api('GET', '/api/v1/meetings')
        finally:
            self.opener.cookies.clear(domain=HOST, path='/', name='cids')
        self.assertEqual(forged.status_code, 200)
        self.assertNotIn(
            self.meetings[self.company_c.id].id,
            [item['id'] for item in forged.json()['items']],
        )


cover_isolation_routes(COVERED, 'webvue_meetings/tests/test_company_isolation.py')
