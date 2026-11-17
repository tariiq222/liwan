# liwan_helpdesk_inbox

A rank-5 bridge (`auto_install`) between the two applications `liwan_inbox` and `liwan_helpdesk`. It owns one
column and one route; neither application imports the other (R3).

The column is `liwan.inbox.conversation.helpdesk_ticket_id` (`Many2one helpdesk.ticket`,
`index='btree_not_null'`, `ondelete='set null'`, `copy=False`): the ticket raised from that conversation. The
conversation stays the customer's channel — closing or deleting the ticket leaves it — and only the bridge's
route writes the link.

| Item | Value |
| --- | --- |
| Route | `POST /api/v1/inbox/conversations/{id}/ticket` |
| Features | `inbox.enabled` and `helpdesk.enabled` |
| Capabilities | `inbox.conversations.read` and `helpdesk.tickets.write` |
| Conversation lookup | `liwan_inbox.controllers.helpers.visible_conversation`, the inbox's own visibility (404) |
| Already linked | 409 `conflict` on `conversation_id` |
| Body | `subject`, `description`, `team_id`, `priority`, `category_id`, `type_id`; any other field is 422 |

The subject defaults to the contact's name and the description to the last five inbound messages as plain-text
bullets, else the contact's name; nothing else of the thread travels and it stays in the inbox. The ticket is
created through `liwan.helpdesk.service._liwan_create`, so the desk's visibility, numbering and assignment bell
apply, and the conversation's customer is passed as `customer_id` only when the contact is linked to one (the
desk resolves it through the one customer directory, so nothing is copied between the two applications). The
answer is the desk's ticket detail plus a `ticket` summary (`{id, number, subject, stage, closed}`). The bridge
uses no `sudo()`. `tests/test_conversation_ticket.py` covers it.
