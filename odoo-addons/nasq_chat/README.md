# nasq_chat

Nasq chat is a member-private workspace over native Odoo Discuss. It does not
add a second messaging store.

## Boundary

The current product is a **single company**. Native `discuss.channel` records
are **not company-scoped**. Nasq therefore does not invent multi-company
isolation. Authorization is:

1. The caller is active, internal (`share=False`), and belongs to the current
   company. Nasq access comes from the legacy employee group, capability keys,
   or an explicit current-company role assignment (including an empty role).
2. The caller is an **explicit channel member**. Nasq administrators and
   `base.group_system` users are not exempt. There is no Nasq `sudo()` path.

Recipient user ids from the client are resolved server-side to partners of
users who pass the same internal current-company check. Portal, public,
inactive, and other-company users are rejected.

## Native reuse

- Direct conversations: `discuss.channel._get_or_create_chat`.
- Groups: `discuss.channel._create_group` with the creator included in
  `partners_to`.
- Send: `message_post` with escaped plain text and at most one inlined file.
- Read: the current member's `_mark_as_read` only.
- Downloads: stock `/web/content/<id>?download=true`. Membership is enforced
  by native attachment ACLs. Stock superuser privileges are not revoked.

GET never marks a conversation read. Unread filtering happens before paging.
