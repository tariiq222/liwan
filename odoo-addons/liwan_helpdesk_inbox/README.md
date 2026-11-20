# liwan_helpdesk_inbox

A rank-5 bridge (`auto_install`) between the two applications `liwan_inbox` and `liwan_helpdesk`. It owns one
column and two routes; neither application imports the other (R3).

The column is `helpdesk.ticket.liwan_conversation_id` (`Many2one liwan.inbox.conversation`,
`index='btree_not_null'`, `ondelete='set null'`, `copy=False`): the conversation a ticket was raised from. The fact
belongs to the ticket, so deleting a conversation (24-month retention) leaves the ticket, and only the bridge's
route writes the link.

Owner decision 2026-11-20 (D2): one conversation has **one open ticket at a time**. While any ticket of the
conversation is not closed, no second one is raised; once it closes a new one may be, and the conversation keeps all
its tickets.

| Item | Value |
| --- | --- |
| Routes | `GET` and `POST /api/v1/inbox/conversations/{id}/tickets` |
| Features | `inbox.enabled` and `helpdesk.enabled` |
| Capabilities | `GET`: `inbox.conversations.read` and `helpdesk.tickets.read`; `POST`: `inbox.conversations.read` and `helpdesk.tickets.write` |
| Conversation lookup | `liwan_inbox.controllers.helpers.visible_conversation`, the inbox's own visibility (404); a conversation of another company than the working one is 404 too |
| `GET` | `{items, total}` of ticket refs, newest first, paged with `limit` and `offset`, only the tickets the desk's visibility shows the caller |
| `POST` body | `subject`, `description`, `team_id`, `priority`, `category_id`, `type_id`; any other field is 422 |
| `POST` answer | the ticket ref only |
| Open ticket exists | 409 `conflict` with `details.reason = 'open_ticket_exists'`; the hidden ticket is never named |

A ticket ref is `{id, number, subject, stage: {id, name, closed}, created_at}`.

The subject defaults to the contact's name and the description to the last five inbound messages as plain-text
bullets, else the contact's name; nothing else of the thread travels and it stays in the inbox. The ticket is
created through `liwan.helpdesk.service._liwan_create`, so the desk's visibility, numbering and assignment bell
apply, and the conversation's customer is passed as `customer_id` only when the contact is linked to one.

`POST` first rewrites the conversation row without changing a value (one SQL `UPDATE ... SET write_date =
write_date`, because the caller has no ORM write right on the conversation). A concurrent raise waits on that row
lock; when the first commits, the waiting one fails with a serialization error under REPEATABLE READ, Odoo replays
it, and the replay sees the first ticket and answers 409 `open_ticket_exists`. A lock that writes nothing would let a
request whose snapshot predates the first commit pass. The open-ticket check must count a ticket of another team
or assignee that the desk's record rules hide from the caller, so it is the bridge's one `sudo()`: a count-only
`search_count` that returns a boolean, documented in `tools/arch_documented_sudo.json`.

`migrations/19.0.1.1.0` carries each link from the conversation's former `helpdesk_ticket_id` column to the ticket's
new column and drops the old one. `tests/test_conversation_ticket.py` covers the routes and
`tests/test_tenant_export.py` pins that no bridge column reaches a tenant export.
