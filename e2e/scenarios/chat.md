# Chat

Pages: `/chat`, `/chat/new`, `/chat/[id]/[[panel]]` (the only panel is `info`). Owner: `liwan_chat`.
Personas and status values: [README](README.md).

Notes: chat has no capability of its own. Any active internal user of the current company
(employee group or any role) may use it; the UI gate is the feature `chat.enabled`. There is no
bell kind for chat: new messages arrive through the live bus (`liwan/chat` events), the unread
badge and a 5-second poll fallback when the socket is down. A non-member of an existing
conversation gets 403 «You are not a member of this conversation.»; a missing id or a
conversation of another type gets 404. A read-only tenant keeps reading; every write answers 403
`tenant_read_only` and the composer is replaced by «الاشتراك للقراءة فقط».

## Core flow

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| CHT-01 | Direct message to a colleague; message survives reload; colleague receives it | admin → employee | Delivered and persisted | `page /chat/new`, `page /chat/[id]/[[id]]`, `POST /api/v1/chat/conversations`, `POST /api/v1/chat/conversations/<id>/messages`, `GET /api/v1/chat/conversations/<id>/messages` | automated | `e2e/tests/chat-journey.e2e.ts` |

## Conversation list

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| CHT-17 | Paging, 50 a page | staff1 | Pager under the list; offset in the URL; a filter change returns to page 1; `limit` 0 returns an empty page with the real `total` | `page /chat`, `GET /api/v1/chat/conversations` | decision | #160; Found 2026-10-28: `limit=0` yields no items (other lists treat 0 as the default) |
| CHT-18 | Direct conversation row | staff1 | Named after the other person; online dot when `im_status` is online | `page /chat`, `GET /api/v1/chat/conversations` | planned | R3: online dot not checked; im_status may not update on scratch; Round 2 partial: direct row shows other person's name; online dot not tested |
| CHT-19 | Group and channel rows | staff1 | Group badge icon; muted conversation shows «· مكتومة» | `page /chat`, `GET /api/v1/chat/conversations` | planned | R3: muted needs a muted conversation, not built; Round 2 partial: group/channel rows show type label; muted «· مكتومة» not tested |
| CHT-22 | Conversations of another company | api | Never listed; opening one answers 404 or 403 | `GET /api/v1/chat/conversations`, `GET /api/v1/chat/conversations/<id>` | planned | R3: unknown id 404; other-company list not compared |

## Create a conversation

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| CHT-40 | Recipient picker | staff1 | Searching lists active internal people of the company except the caller, 50 a page; selected people shown as removable chips | `GET /api/v1/chat/recipients`, `page /chat/new` | planned | R3b: /chat/new and chat pages exceeded compile time on the loaded stack, not reached; R3: /chat/new first compile exceeded 60 s |
| CHT-42 | Leave the create form with input | staff1 | Unsaved-changes guard (list query keys ignored); none after creating | `page /chat/new` | planned | R3b: /chat/new and chat pages exceeded compile time on the loaded stack, not reached; R3: not reached |
| CHT-43 | A channel is visible only to members | staff2 | A second employee does not see a channel created by staff1 until added; no join action exists | `POST /api/v1/chat/conversations`, `GET /api/v1/chat/conversations` | decision | #160; Found 2026-10-28: channels are created for the employee group but listing needs membership |
| CHT-44 | Back and Escape on the create page | staff1 | Return to the list with its filter and search | `page /chat/new` | planned | R3b: /chat/new and chat pages exceeded compile time on the loaded stack, not reached; R3: not reached |
| CHT-45 | Users with no chat access | api | A portal or external user gets 403 «Chat is limited to active internal LiwanOS users.» on every chat route | `GET /api/v1/chat/conversations`, `GET /api/v1/chat/recipients` | planned | R3: no portal user |

## Messages

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| CHT-50 | Open a conversation | staff1 | Header with avatar, name and type («مباشر», «مجموعة», «قناة»); messages oldest to newest grouped by day; author names shown in groups; scrolled to the end | `page /chat/[id]/[[id]]`, `GET /api/v1/chat/conversations/<id>`, `GET /api/v1/chat/conversations/<id>/messages` | planned | R3b: /chat/new and chat pages exceeded compile time on the loaded stack, not reached; R3: not reached |
| CHT-53 | Failed send | staff1 | Toast; the draft stays in the box («لم تُرسل الرسالة. المسودة ما زالت هنا.») | `POST /api/v1/chat/conversations/<id>/messages` | planned | R3b: /chat/new and chat pages exceeded compile time on the loaded stack, not reached; R3: not reached |
| CHT-54 | Draft per conversation | staff1 | Text typed in one conversation returns after switching away and back or reloading; cleared after a successful send | `page /chat/[id]/[[id]]` | planned | R3b: /chat/new and chat pages exceeded compile time on the loaded stack, not reached; R3: not reached |
| CHT-64 | Delete own message | staff1 | «حذف» asks inline «حذف هذه الرسالة؟» then «تأكيد الحذف» and calls `DELETE .../messages/<id>`; an edit can no longer empty a message (422 `invalid`, field `body`) | `PATCH /api/v1/chat/conversations/<id>/messages/<id>` `DELETE /api/v1/chat/conversations/<id>/messages/<id>` | planned | #160; Owner decision 2026-10-29: the company chooses what a delete does (CHT-119). Implemented on the branch `codex/chat-inbox-launch-fixes`; the proposed default is «تبقى عبارة حُذفت هذه الرسالة». Before: the delete was an edit to an empty body and answered 403 for the author (#184) |
| CHT-69 | Search inside a conversation | staff1 | Search button in the header filters the thread by text; closing it restores the thread | `GET /api/v1/chat/conversations/<id>/messages` | planned | R3b: /chat/new and chat pages exceeded compile time on the loaded stack, not reached; R3: not reached |
| CHT-70 | Older messages | staff1 | «تحميل الرسائل الأقدم» prepends one page keeping the scroll position; `before` and `after` together 422 «pass before or after, not both»; non-positive id 422 | `GET /api/v1/chat/conversations/<id>/messages` | planned | R3: API both 422 and non-positive 422 seen; older-messages button not run |
| CHT-72 | Non-member acts in a conversation | staff2 | 403 «You are not a member of this conversation.» on every conversation route | `GET /api/v1/chat/conversations/<id>/messages`, `POST /api/v1/chat/conversations/<id>/messages` | planned | #197; Fixed on the branch `codex/chat-inbox-launch-fixes` (the access check runs before any field of the channel is read; `test_chat_security.py`), to be run again. Before: non-member hr_manager gets 403 with raw Odoo text «Uh-oh! Looks like you have stumbled upon some top-secret records… (discuss.channel)» instead of «You are not a member of this conversation.» |

## Realtime, unread and read receipts

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| CHT-80 | A message arrives while the thread is open | staff1 → staff2 | Appears without reload; at the bottom it follows, scrolled up it shows «رسائل جديدة ({count})» that jumps to the latest | `GET /api/v1/chat/conversations/<id>/messages` | planned | R3: live bus not delivering (#212); Round 2: message from staff1 appeared in staff2 thread in 1.5 s without reload; scrolled-up «رسائل جديدة» pill not observed (scroll container may not have been found); not confirmed |
| CHT-81 | A message arrives in another conversation | staff1 → staff2 | The list row moves to the top with the new preview and an unread badge | `GET /api/v1/chat/conversations` | planned | R3: #212; #212; Round 2: bus websocket on the scratch stack delivers no events (subscribe sent, zero frames); list row did not update within 40 s; the list has no polling fallback |
| CHT-85 | Typing indicator | staff1 → staff2 | Typing sends `is_typing` true (at most every 3 seconds) and false after 3 seconds idle, on send and on leaving; the peer sees «{name} يكتب…» in the header for up to 6 seconds; the typist never sees their own | `POST /api/v1/chat/conversations/<id>/typing` | planned | R3: #212; #212; Round 2: typing POSTs sent (true/false) but peer never saw «يكتب» because the bus websocket delivers nothing on the scratch stack |
| CHT-87 | Socket down | staff2 | Thread polls every 5 seconds for newer messages and catches up page by page | `GET /api/v1/chat/conversations/<id>/messages` | planned | R3: #212; #212 |
| CHT-88 | Bus events | api | Members receive `liwan/chat` events: conversation_created, conversation_updated, message_created, message_updated, reaction_updated, pin_updated, star_updated, read_updated, members_updated, conversation_left, typing | `POST /api/v1/chat/conversations` | planned | R3: bus websocket not deliverable on scratch (#212) |

## Info panel and membership

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| CHT-113 | Leave refusals | api | Direct chat 403 «direct chats cannot be left»; group of two or fewer 422 «a group must keep at least two members» though the UI still offers «مغادرة المحادثة» | `POST /api/v1/chat/conversations/<id>/leave` | decision | #160; Found 2026-10-28: leave button shown for a two-member group |
| CHT-119 | Choose what deleting a message does | it_admin (holder of `chat.settings.manage`) | Settings > Applications > المحادثات shows «حذف الرسائل» with «تبقى عبارة «حُذفت هذه الرسالة»» (default) and «حذف نهائي»; saving sends the revision, a second session that saved first gets 409 and the card shows the saved value with a warning; an employee without the capability gets 403 | `page /settings/apps/chat` `GET /api/v1/chat/settings` `PATCH /api/v1/chat/settings` `cap chat.settings.manage` | planned | #160 CHT-64; Owner decision 2026-10-29: a company setting. Implemented on the branch `codex/chat-inbox-launch-fixes` (`test_chat_messages_delete.py`) |
| CHT-120 | Author deletes a message in both modes | staff1 | With the default, the row stays as «حُذفت هذه الرسالة» for every member, its text and files are gone and its reactions remain hidden; with «حذف نهائي» the message disappears for everyone and a reply to it keeps its text without the quote; only the author may delete (403 for others) and a conversation notice cannot be deleted | `DELETE /api/v1/chat/conversations/<id>/messages/<id>` `page /chat/[id]/[[id]]` | planned | #160 CHT-64; Implemented on the branch `codex/chat-inbox-launch-fixes` (`test_chat_messages_delete.py`) |
