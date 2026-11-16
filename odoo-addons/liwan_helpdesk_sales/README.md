# liwan_helpdesk_sales

A rank-5 bridge (`auto_install`) between the two applications `liwan_helpdesk` and `liwan_sales`. It owns one
column and the quotation routes of a ticket; neither application imports the other (R3).

The column is `sale.order.helpdesk_ticket_id` (`Many2one helpdesk.ticket`, `index='btree_not_null'`,
`ondelete='set null'`, `copy=False`): the ticket a quotation bills for. Archiving or deleting the ticket leaves
the quotation, because it is a commercial document of Sales and stands on its own.

| Method and path | Features | Capabilities |
| --- | --- | --- |
| `GET /api/v1/helpdesk/tickets/{id}/quotations` | `helpdesk.enabled` and `sales.enabled` (read) | `helpdesk.tickets.read` or `sales.read` (`match='any'`) |
| `POST /api/v1/helpdesk/tickets/{id}/quotations` | `helpdesk.enabled` and `sales.enabled` | `helpdesk.tickets.write` and `sales.quotations.manage` |

The list is `{items, total}` of `{id, name, state, amount_total, currency}` for the orders linked to the ticket,
narrowed by `liwan.sales.visibility._liwan_domain` (the route's capability gate already answered, so the ticket
lookup is the desk's visibility alone and a hidden ticket is the same 404). A create takes `lines`,
`validity_date`, `salesperson_id` and `note`, and refuses with 422 a ticket that has no customer
(`customer_id`) or that is closed (`ticket_id`). It calls `liwan.sales.serializers.order.parse_order_body` and
`liwan.sales.service._liwan_create`, so pricing, discount limits and visibility apply unchanged, then writes the
link and answers the sales detail shape. The customer of the quotation is the ticket's own; an agent who may not
quote asks a seller instead. The bridge uses no `sudo()`. `tests/test_ticket_quotations.py` covers both routes.
