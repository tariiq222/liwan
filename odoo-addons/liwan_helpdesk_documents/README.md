# liwan_helpdesk_documents

A rank-5 bridge (`auto_install`) between the two applications `liwan_documents` and `liwan_helpdesk`. It owns
one column and one document-library context; neither application imports the other (R3).

The column is `liwan.document.helpdesk_ticket_id` (`Many2one helpdesk.ticket`, `index=True`,
`ondelete='restrict'`, `copy=False`, `check_company=True`), declared a context field through
`liwan.document._liwan_context_fields()`. The document service allows one context per document, and its
existing routes carry the ticket as one more context: `GET /api/v1/documents?context_kind=helpdesk.ticket&context_id=<id>`,
`GET /api/v1/documents/contexts`, `GET /api/v1/documents/contexts/helpdesk.ticket/options` and the
`/api/v1/document-contexts/helpdesk.ticket/<ticket id>/...` family of `liwan_document_service`. The bridge
adds no route of its own.

| Item | Value |
| --- | --- |
| Context kind | `helpdesk.ticket`, field `helpdesk_ticket_id`, label `Support ticket` / `تذكرة الدعم` |
| Offered when | `helpdesk.enabled` reads and the caller holds `helpdesk.tickets.read` |
| Registered feature | `helpdesk.enabled`, through `_liwan_managed_context_features()`; the `liwan_document_service` context routes gate on the keys that method returns |
| Access scope | `liwan.helpdesk.visibility._liwan_domain()`, so a document filed against a ticket is readable by whoever reads that ticket and no wider |
| Capabilities | `helpdesk.tickets.read` to see a ticket's reachable documents; `helpdesk.tickets.write` for the picker (`_liwan_context_options`, which asks for the write side) and for every managed-context lookup |

`_liwan_ticket_document_scope` ORs that ticket predicate into the library's own scope predicate, so the
library policy and the desk's visibility both hold. `_liwan_managed_context('helpdesk', ticket_id)` re-checks
the feature (write or read), then always requires `helpdesk.tickets.write`, then returns
`('helpdesk.ticket', [('helpdesk_ticket_id', '=', id)])`; an unreachable ticket is 404 `not_found`. The context
dump gives the ticket's `{kind, id, label}` with `href /helpdesk/{id}`. `create` validates the link through
`liwan.document.links._liwan_managed_context` for every non-superuser caller, and `_liwan_context_options`
searches by `number` and `name` (200 characters) with `{items, total}`. There is no `sudo()`.
`tests/test_ticket_documents.py` covers the context, the scope and the refusals.
