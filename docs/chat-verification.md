# Chat workspace verification

Task branch: `codex/chat-workspace`. Isolated runtime only. Never `odoo19`.

## Boundary

Nasq chat reuses native `discuss.channel` (`_get_or_create_chat`, `_create_group`
with the creator included, `message_post`, member `_mark_as_read`). There is no
duplicate messaging model and no Nasq `sudo()` path.

The product is a single company. Native channels are not company-scoped.
Authorization is active internal Nasq access plus explicit membership, including
for Nasq administrators. Recipient user ids are resolved server-side to partners
of active internal current-company users.

GET never marks read. Unread filtering happens before paging. Uploads are one
file inlined during `message_post` (10 MiB, existing MIME allow-list). Downloads
use stock `/web/content`. Stock superuser privileges are not claimed revoked.

Mark-read in the UI is the newest message whose bubble intersects the scroller
while the document is visible and the window is focused. Polling uses `after`
the last known id and continues while a page is full so a burst larger than 50
is not skipped. 403/404 stop the 5s poll, cancel/remove the user chat query
cache, hide the composer, and clear rendered messages.

## Isolated runtime

Use a unique unused HTTP pair (example `9769` / `3769`) and a fresh database
`nasq_chat_scratch_20260907_<suffix>`. Logs stay under the approved temp parent.
Confirm the destination database is not `odoo19` before `-i`/`--test-tags`.

English 390 screenshot depends on runtime `setLocale('en')` if the Nuxt app
exposes `$i18n`; otherwise the file may still be Arabic. That is recorded as a
gap, not as a locale switch proof.
