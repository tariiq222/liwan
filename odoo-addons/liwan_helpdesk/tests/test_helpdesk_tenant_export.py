# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The Support Desk's contribution to the tenant export."""
from odoo.addons.liwan_api.tests.tenant_export_support import assert_contribution
from odoo.addons.liwan_helpdesk.tests.common import LiwanHelpdeskCase


class HelpdeskTenantExportTest(LiwanHelpdeskCase):
    def test_the_export_carries_the_tickets_and_the_settings(self):
        self.as_user(self.agent)
        created = self.ticket_body()
        datasets = assert_contribution(self, ['helpdesk_tickets', 'helpdesk_settings'], required={
            'helpdesk_tickets': ['number', 'name', 'stage_id', 'team_id'],
            'helpdesk_settings': ['visibility', 'reference_prefix'],
        })
        ticket = datasets['helpdesk_tickets']
        rows = ticket['rows'](0, 1000)[0]
        self.assertIn(created['number'], [row[ticket['header'].index('number')] for row in rows])

    def test_the_customer_page_token_is_never_exported(self):
        """The token is the only authorization of the customer page, so the export must not carry it.

        An export is a file a tenant keeps and shares; a live token inside it would open a ticket's customer page to
        whoever holds the file, long after the export left the system.
        """
        self.as_user(self.agent)
        created = self.ticket_body()
        ticket = self.env['helpdesk.ticket'].browse(created['id'])
        self.env['liwan.helpdesk.portal']._liwan_issue_token(ticket)
        self.assertTrue(ticket.liwan_portal_token, 'the ticket must hold a token for this test to mean anything')
        dataset = {
            item['key']: item for item in self.env['liwan.tenant.export.hooks']._liwan_export_datasets()
        }['helpdesk_tickets']
        self.assertNotIn('liwan_portal_token', dataset['header'])
