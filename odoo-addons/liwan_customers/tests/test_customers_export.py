# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""GET /api/v1/customers/export: its own capability, the list filters and the custom field columns."""
import csv
import io
from unittest.mock import patch

from odoo.tests import tagged

from odoo.addons.liwan_api.serializers import csv_export
from odoo.addons.liwan_customers.tests.common import (
    EXPORT,
    PHONE_E164,
    PHONE_LOCAL,
    CustomersCase,
)

SEGMENT = {
    'label': '=Segment', 'type': 'selection',
    'options': [{'label': 'Gold'}, {'label': 'Silver'}],
}
TAGS = {'label': 'Topics', 'type': 'tags', 'options': [{'label': 'Alpha'}, {'label': 'Beta'}]}
SCORE = {'label': 'Score', 'type': 'integer'}
NOTE = {'label': 'Note', 'type': 'char'}


@tagged('post_install', '-at_install', 'liwan')
class TestCustomersExport(CustomersCase):

    def rows(self, query=''):
        response = self.api('GET', f'{EXPORT}?{query}' if query else EXPORT)
        self.assertEqual(response.status_code, 200, response.text)
        return list(csv.reader(io.StringIO(response.content.decode('utf-8-sig'))))

    def test_export_is_refused_without_its_capability(self):
        self.created_by('cu_a_staff', {'name': 'Exported'})
        for login in ('cu_a_staff', 'cu_nobody', 'cu_picker', 'cu_a_settings', 'cu_root_settings'):
            with self.subTest(login=login):
                self.sign_in(login)
                response = self.api('GET', EXPORT)
                self.assertEqual((response.status_code, response.json()['code']), (403, 'forbidden'))

    def created_by(self, login, payload):
        self.sign_in(login)
        return self.created(payload)

    def test_a_holder_of_export_downloads_the_directory_with_the_headers_of_a_download(self):
        self.created_by('cu_a_staff', {'name': 'Plain customer', 'phone': PHONE_LOCAL, 'email': 'plain@example.test'})
        self.sign_in('cu_exporter')
        response = self.api('GET', EXPORT)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.headers['Content-Type'], 'text/csv; charset=utf-8')
        self.assertIn('attachment', response.headers['Content-Disposition'])
        self.assertIn('.csv', response.headers['Content-Disposition'])
        self.assertEqual(response.headers['Cache-Control'], 'private, no-store')
        self.assertEqual(response.headers['X-Content-Type-Options'], 'nosniff')
        self.assertTrue(response.content.startswith(b'\xef\xbb\xbf'))
        rows = self.rows()
        self.assertEqual(rows[0], ['name', 'phone', 'email', 'type', 'parent', 'active'])
        self.assertEqual(rows[1], ['Plain customer', f'\t{PHONE_E164}', 'plain@example.test', 'individual', '', 'true'])

    def test_it_applies_the_list_filters_and_has_a_column_per_custom_field(self):
        fields = self.define_fields(SEGMENT, TAGS, SCORE, NOTE)
        segment, tags, score, note = (item['key'] for item in fields)
        gold = fields[0]['options'][0]['key']
        alpha, beta = (option['key'] for option in fields[1]['options'])
        self.created_by('cu_a_staff', {
            'name': '=HYPERLINK("http://x")', 'is_company': True,
            'properties': {segment: gold, tags: [alpha, beta], score: -5, note: '+cmd'},
        })
        self.created({'name': 'Sparse', 'properties': {segment: None}})
        archived = self.created({'name': 'Archived one'})
        self.api('POST', f'/api/v1/customers/{archived["id"]}/archive')
        self.sign_in('cu_exporter')
        rows = self.rows()
        self.assertEqual(rows[0][6:], ["'=Segment", 'Topics', 'Score', 'Note'])
        by_name = {row[0]: row for row in rows[1:]}
        self.assertEqual(set(by_name), {"'=HYPERLINK(\"http://x\")", 'Sparse'})
        self.assertEqual(by_name["'=HYPERLINK(\"http://x\")"][3:], ['company', '', 'true', 'Gold', 'Alpha, Beta', '-5', "'+cmd"])
        self.assertEqual(by_name['Sparse'][6:], ['', '', '', ''])
        self.assertEqual([row[0] for row in self.rows('q=Sparse')[1:]], ['Sparse'])
        self.assertEqual([row[0] for row in self.rows('archived=true')[1:]], ['Archived one'])
        self.assertEqual([row[0] for row in self.rows(f'property.{segment}={gold}')[1:]], ["'=HYPERLINK(\"http://x\")"])
        bad = self.api('GET', f'{EXPORT}?property.unknown=1')
        self.assertEqual(bad.status_code, 422)

    def test_it_exports_only_what_the_caller_sees(self):
        self.settings.sharing = 'branch'
        self.created_by('cu_a_staff', {'name': 'Owned by A'})
        self.created_by('cu_b_staff', {'name': 'Owned by B'})
        self.sign_in('cu_exporter')
        self.assertEqual([row[0] for row in self.rows()[1:]], ['Owned by A'])

    def test_a_contact_row_names_its_parent_and_a_user_partner_is_never_exported(self):
        house = self.created_by('cu_a_staff', {'name': 'House', 'is_company': True})
        self.created({'name': 'Contact', 'parent_id': house['id']})
        self.a_staff.partner_id.phone = PHONE_E164
        self.sign_in('cu_exporter')
        rows = {row[0]: row for row in self.rows()[1:]}
        self.assertEqual(set(rows), {'House', 'Contact'})
        self.assertEqual(rows['Contact'][3:5], ['individual', 'House'])

    def test_it_filters_on_is_company(self):
        self.created_by('cu_a_staff', {'name': 'A company', 'is_company': True})
        self.created({'name': 'A person'})
        self.sign_in('cu_exporter')
        self.assertEqual([row[0] for row in self.rows('is_company=true')[1:]], ['A company'])
        self.assertEqual([row[0] for row in self.rows('is_company=false')[1:]], ['A person'])
        self.assertEqual(self.api('GET', f'{EXPORT}?is_company=maybe').status_code, 422)

    def test_both_commercial_modes(self):
        for mode in ('saas', 'non_saas'):
            with self.subTest(mode=mode), self.undone():
                self.set_mode(mode)
                self.created_by('cu_a_staff', {'name': f'Mode {mode}'})
                self.sign_in('cu_exporter')
                self.assertEqual([row[0] for row in self.rows()[1:]], [f'Mode {mode}'])
                self.sign_in('cu_a_staff')
                self.assertEqual(self.api('GET', EXPORT).status_code, 403)

    def test_more_rows_than_the_limit_are_refused_and_a_filter_under_it_exports(self):
        for name in ('Limit one', 'Limit two', 'Limit three'):
            self.created_by('cu_a_staff', {'name': name})
        self.sign_in('cu_exporter')
        with patch.object(csv_export, 'EXPORT_MAX_ROWS', 2):
            response = self.api('GET', EXPORT)
            self.assertEqual((response.status_code, response.json()['code']), (422, 'export_too_large'))
            self.assertEqual(response.json()['details'], {'rows': 3, 'max_rows': 2})
            self.assertEqual([row[0] for row in self.rows('q=two')[1:]], ['Limit two'])
        with patch.object(csv_export, 'EXPORT_MAX_ROWS', 3):
            self.assertEqual(len(self.rows()) - 1, 3)
