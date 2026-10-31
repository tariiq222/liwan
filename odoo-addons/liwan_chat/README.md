# liwan_chat

LiwanOS chat is a member-private workspace over native Odoo Discuss. It does not
add a second messaging store.

## Boundary

The current product is a **single company**. Native `discuss.channel` records
are **not company-scoped**. LiwanOS therefore does not invent multi-company
isolation. Authorization is:

1. The caller is active, internal (`share=False`), and belongs to the current
   company. LiwanOS access comes from the legacy employee group, capability keys,
   or an explicit current-company role assignment (including an empty role).
2. The caller is an **explicit channel member**. LiwanOS administrators and
   `base.group_system` users are not exempt. Current code uses `sudo()` in the
   reaction paths (mutation after checking channel and message membership, and
   aggregation for an already-authorized message), in the removal of a group member
   and in the deletion of a message after the author check. The documented cases
   are in `tools/arch_documented_sudo.json`; this README does not authorize more.

Recipient user ids from the client are resolved server-side to partners of
users who pass the same internal current-company check. Portal, public,
inactive, and other-company users are rejected.

## Native reuse

- Direct conversations: `discuss.channel._get_or_create_chat`.
- Groups: `discuss.channel._create_group` with the creator included in
  `partners_to`.
- Send: `message_post` with escaped plain text and at most one inlined file.
- Read: the current member's `_mark_as_read` only.
- Downloads: `GET /api/v1/chat/conversations/<id>/attachments/<attachment_id>/download`.
  Membership of the conversation is enforced, and only its message attachments are served.

GET never marks a conversation read. Unread filtering happens before paging.

## Deleting a message

`DELETE /api/v1/chat/conversations/<id>/messages/<id>` is for the author only; an edit
cannot empty a message. What a delete does is a company setting (`GET`/`PATCH
/api/v1/chat/settings`, capability `chat.settings.manage`, with a revision): `placeholder`
(the default) clears the text and the files and keeps the row, which the API serializes as
`deleted: true`, so replies, pins and the reading order stay intact; `permanent` removes the
message and its files for everyone. A company without a settings row works at the defaults.
