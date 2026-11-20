# liwan_helpdesk_crm

A rank-5 bridge (`auto_install`) between the two applications `liwan_helpdesk` and `liwan_crm`. It owns one
column and one URL with three methods; neither application imports the other (R3).

The column is `helpdesk.ticket.liwan_lead_id` (`Many2one crm.lead`, `ondelete='set null'`,
`index='btree_not_null'`, `copy=False`): the opportunity a ticket belongs to, for an after-sales issue of a
sold deal. Archiving the opportunity keeps the link and deleting it clears the field, never the ticket. Only
the bridge's routes write it.

## Policy (owner decision D1, 2026-11-20)

The support agent who sees the opportunity may link it. Linking needs `helpdesk.tickets.write` on a ticket
inside the desk's visibility, `crm.leads.read` and CRM's visibility of the opportunity. Nothing is checked on
the opportunity's write side: the link is a ticket column and the opportunity does not change. Unlinking needs
only the ticket's write right and clears whatever was linked, visible or not. An opportunity the caller may not
read is never named.

## Routes

All three are on `/api/v1/helpdesk/tickets/{id}/opportunity`.

| Method | Features | Capabilities | Behaviour |
| --- | --- | --- | --- |
| `GET` | `helpdesk.enabled`, `crm.enabled` (read) | `helpdesk.tickets.read`, `crm.leads.read` | `{opportunity, hidden}`: the ref when the caller sees the opportunity (archived included), `{null, true}` when a link exists that the caller may not read, `{null, false}` when none |
| `PUT` | both (write) | `helpdesk.tickets.write`, `crm.leads.read` | Body exactly `{opportunity_id}` (a positive id, any other body is 422). Links or replaces; answers like `GET` |
| `DELETE` | both (write) | `helpdesk.tickets.write` | Clears the link; 204 |

The ref is `liwan_crm.serializers.opportunity.dump_opportunity_ref`: `{id, contact_name, stage, status, active}`.

| Item | Value |
| --- | --- |
| Ticket lookup | `liwan_helpdesk.controllers.tickets.find` (with `helpdesk.tickets.write` for `PUT` and `DELETE`): a ticket outside the desk's visibility is 404 |
| Opportunity lookup | `liwan_crm.controllers.opportunities.find_opportunity`: archived ones included, CRM's own visibility applied, so a hidden, foreign or missing one is 404 |
| Company | the request is pinned to the working company, so another company's opportunity is 404, like a missing one |
| Requester | a user with only `helpdesk.requests.read` gets 403 on all three |

The link is written in the caller's environment under both applications' record rules; the bridge has no
`sudo()`. `tests/test_ticket_opportunity.py` covers it.
