# liwan_helpdesk_crm

A rank-5 bridge (`auto_install`) between the two applications `liwan_helpdesk` and `liwan_crm`. It owns one
column and one route; neither application imports the other (R3).

The column is `helpdesk.ticket.liwan_lead_id` (`Many2one crm.lead`, `ondelete='set null'`,
`index='btree_not_null'`, `copy=False`): the opportunity a ticket belongs to, for an after-sales issue of a
sold deal. Archiving the opportunity keeps the link and deleting it clears the field, never the ticket. Only
the bridge's route writes it.

`POST /api/v1/helpdesk/tickets/{id}/opportunity` links, replaces or clears the opportunity and answers the
desk's ticket detail with an `opportunity` object (`{id, name, stage}`, or null when the field is empty).

| Item | Value |
| --- | --- |
| Body | `{opportunity_id}` (a positive id to link, `null`/`false` to clear); any other field is 422 |
| Features | `helpdesk.enabled` and `crm.enabled` |
| Capabilities | `helpdesk.tickets.write` and `crm.leads.read` |
| Ticket lookup | `liwan_helpdesk.controllers.tickets.find` with `helpdesk.tickets.write`, so a ticket outside the desk's visibility is 404 |
| Opportunity lookup | `liwan_crm.controllers.opportunities.find_opportunity`: archived ones included, CRM's own visibility applied, so a hidden, foreign or missing one is 404 |
| Company | an opportunity of another company is 422 `invalid` on `opportunity_id` |

The link is written in the caller's environment under both applications' record rules; the bridge has no
`sudo()`. `tests/test_ticket_opportunity.py` covers it.
