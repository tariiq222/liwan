# Chat

Pages: `/chat`, `/chat/new`, `/chat/[id]/[[panel]]` (the only panel is `info`). Owner: `webvue_chat`.
Personas and status values: [README](README.md).

Notes: chat has no capability of its own. Any active internal user of the current company
(employee group or any role) may use it; the UI gate is the feature `chat.enabled`. There is no
bell kind for chat: new messages arrive through the live bus (`webvue/chat` events), the unread
badge and a 5-second poll fallback when the socket is down. A non-member of an existing
conversation gets 403 «You are not a member of this conversation.»; a missing id or a
conversation of another type gets 404. A read-only tenant keeps reading; every write answers 403
`tenant_read_only` and the composer is replaced by «الاشتراك للقراءة فقط».

## Core flow

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| CHT-01 | Direct message to a colleague; message survives reload; colleague receives it | admin → employee | Delivered and persisted | `page /chat/new`, `page /chat/[id]/[[id]]`, `POST /api/v1/chat/conversations`, `POST /api/v1/chat/conversations/<id>/messages`, `GET /api/v1/chat/conversations/<id>/messages` | automated | `e2e/tests/chat-journey.e2e.ts` |
| CHT-02 | Group with at least two others; channel with a name | staff1 | Created; group without two others refused; channel without name refused | `POST /api/v1/chat/conversations`, `page /chat/new` | planned | |
| CHT-03 | Reply, mention, react, pin, star, mark read | staff1, staff2 | Each action visible to members; mention limited to members | `POST /api/v1/chat/conversations/<id>/messages`, `POST /api/v1/chat/conversations/<id>/messages/<id>/reactions`, `POST /api/v1/chat/conversations/<id>/messages/<id>/pin`, `POST /api/v1/chat/conversations/<id>/messages/<id>/star`, `POST /api/v1/chat/conversations/<id>/read` | planned | |
| CHT-04 | Attachments and search | staff1 | File downloadable; search finds the message | `GET /api/v1/chat/conversations/<id>/attachments`, `GET /api/v1/chat/conversations/<id>/attachments/<id>/download` | planned | |
| CHT-05 | Filters all / unread / groups / channels / starred | staff1 | Lists match | `GET /api/v1/chat/conversations`, `page /chat` | planned | |
| CHT-06 | Edit own message; edit someone else's | staff1 | Own allowed, other refused | `PATCH /api/v1/chat/conversations/<id>/messages/<id>` | planned | |
| CHT-07 | Rename or add members to a direct conversation | staff1 | Refused | `PATCH /api/v1/chat/conversations/<id>`, `POST /api/v1/chat/conversations/<id>/members` | planned | |
| CHT-08 | Remove a member as non-creator; remove self; group under two members | staff2 | Refused; leave instead | `DELETE /api/v1/chat/conversations/<id>/members/<id>`, `POST /api/v1/chat/conversations/<id>/leave` | planned | |
| CHT-09 | Non-member opens a conversation by link | staff2 | Refused | `GET /api/v1/chat/conversations/<id>`, `page /chat/[id]/[[id]]` | planned | |

## Conversation list

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| CHT-10 | Open `/chat` with conversations | staff1 | Heading «المحادثة»; list of the user's conversations newest activity first with avatar, name, last message preview, time («أمس» for yesterday) and an unread badge; right pane says «اختر محادثة» | `page /chat`, `GET /api/v1/chat/conversations` | planned | |
| CHT-11 | Open `/chat` with no conversation at all | staff2 | Empty state «لا محادثات بعد.» with «بدء محادثة» | `page /chat`, `GET /api/v1/chat/conversations` | planned | |
| CHT-12 | Search the list | staff1 | Enter applies `q` (matches the conversation name or a member's name); clearing the box resets; no match shows «لا محادثات تطابق هذا البحث.» | `page /chat`, `GET /api/v1/chat/conversations` | planned | |
| CHT-13 | Filter «غير مقروء» | staff1 | Only conversations with unread messages, filtered before paging | `page /chat`, `GET /api/v1/chat/conversations` | planned | |
| CHT-14 | Filter «المجموعات» and «القنوات» | staff1 | Groups only / channels only; «الكل» lists direct, group and channel | `page /chat`, `GET /api/v1/chat/conversations` | planned | |
| CHT-15 | Filter «المميّزة» | staff1 | Conversations that hold a message the user starred | `page /chat`, `GET /api/v1/chat/conversations` | planned | |
| CHT-16 | Invalid `filter` | api | 422 «filter must be all, unread, groups, channels, or starred» | `GET /api/v1/chat/conversations` | planned | |
| CHT-17 | Paging, 50 a page | staff1 | Pager under the list; offset in the URL; a filter change returns to page 1; `limit` 0 returns an empty page with the real `total` | `page /chat`, `GET /api/v1/chat/conversations` | decision | Found 2026-10-28: `limit=0` yields no items (other lists treat 0 as the default) |
| CHT-18 | Direct conversation row | staff1 | Named after the other person; online dot when `im_status` is online | `page /chat`, `GET /api/v1/chat/conversations` | planned | |
| CHT-19 | Group and channel rows | staff1 | Group badge icon; muted conversation shows «· مكتومة» | `page /chat`, `GET /api/v1/chat/conversations` | planned | |
| CHT-20 | Open a conversation, Back, refresh | staff1 | URL `/chat/{id}` keeps `q`, `filter`, `offset`; selection highlighted; Back returns to the list state | `page /chat/[id]/[[id]]`, `page /chat` | planned | |
| CHT-21 | Narrow screen | staff1 | List, thread and info replace one another; thread has a back arrow | `page /chat/[id]/[[id]]` | planned | |
| CHT-22 | Conversations of another company | api | Never listed; opening one answers 404 or 403 | `GET /api/v1/chat/conversations`, `GET /api/v1/chat/conversations/<id>` | planned | |
| CHT-23 | The new-conversation menu | staff1 | «جديد» menu offers «محادثة», «مجموعة», «قناة» | `page /chat` | planned | |

## Create a conversation

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| CHT-30 | Direct chat from `/chat/new` | staff1 | Pick one person; created and opened; a second attempt with the same person reopens the same conversation | `page /chat/new`, `POST /api/v1/chat/conversations` | planned | |
| CHT-31 | Direct chat with nobody or with two people | staff1 | Form: «اختر شخصًا واحدًا لبدء المحادثة.»; API (type direct) 422 «a direct chat needs one other user» | `page /chat/new`, `POST /api/v1/chat/conversations` | planned | |
| CHT-32 | Direct chat with yourself | api | 422 «cannot chat with yourself» | `POST /api/v1/chat/conversations` | planned | |
| CHT-33 | Direct chat with a name | api | 422 «direct chats do not take a name» | `POST /api/v1/chat/conversations` | planned | |
| CHT-34 | Group with two or more people and an optional name | staff1 | Created with the caller added; name optional (placeholder «اسم المجموعة اختياري») | `page /chat/new`, `POST /api/v1/chat/conversations` | planned | |
| CHT-35 | Group with one person | staff1 | Form: «اختر شخصين على الأقل لإنشاء مجموعة.»; API 422 «a group needs at least two other users» | `page /chat/new`, `POST /api/v1/chat/conversations` | planned | |
| CHT-36 | Channel with a name | staff1 | Created and opened as «قناة»; no recipients asked | `page /chat/new`, `POST /api/v1/chat/conversations` | planned | |
| CHT-37 | Channel without a name | staff1 | Form: «أدخل اسم القناة.»; API 422 «name must not be empty» | `page /chat/new`, `POST /api/v1/chat/conversations` | planned | |
| CHT-38 | Recipient inactive, external or of another company; empty or non-list `user_ids`; unknown `type` | api | 422 «recipient must be an active internal user in the current company», «user_ids must be a non-empty list», «type must be direct, group, or channel» | `POST /api/v1/chat/conversations` | planned | |
| CHT-39 | Unknown field in the body | api | 422 «field 'x' is not writable» | `POST /api/v1/chat/conversations` | planned | |
| CHT-40 | Recipient picker | staff1 | Searching lists active internal people of the company except the caller, 50 a page; selected people shown as removable chips | `GET /api/v1/chat/recipients`, `page /chat/new` | planned | |
| CHT-41 | `kind` in the URL | staff1 | `?kind=group` and `?kind=channel` open the matching form; any other value opens the direct form; switching kind clears the choices | `page /chat/new` | planned | |
| CHT-42 | Leave the create form with input | staff1 | Unsaved-changes guard (list query keys ignored); none after creating | `page /chat/new` | planned | |
| CHT-43 | A channel is visible only to members | staff2 | A second employee does not see a channel created by staff1 until added; no join action exists | `POST /api/v1/chat/conversations`, `GET /api/v1/chat/conversations` | decision | Found 2026-10-28: channels are created for the employee group but listing needs membership |
| CHT-44 | Back and Escape on the create page | staff1 | Return to the list with its filter and search | `page /chat/new` | planned | |
| CHT-45 | Users with no chat access | api | A portal or external user gets 403 «Chat is limited to active internal WebVue users.» on every chat route | `GET /api/v1/chat/conversations`, `GET /api/v1/chat/recipients` | planned | |

## Messages

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| CHT-50 | Open a conversation | staff1 | Header with avatar, name and type («مباشر», «مجموعة», «قناة»); messages oldest to newest grouped by day; author names shown in groups; scrolled to the end | `page /chat/[id]/[[id]]`, `GET /api/v1/chat/conversations/<id>`, `GET /api/v1/chat/conversations/<id>/messages` | planned | |
| CHT-51 | Send with Enter; Shift+Enter | staff1 | Enter sends; Shift+Enter inserts a new line; empty text not sent; pending bubble «جارٍ الإرسال» then «أُرسلت» | `POST /api/v1/chat/conversations/<id>/messages` | planned | |
| CHT-52 | Send an empty body without an attachment | api | 422 «body must not be empty» | `POST /api/v1/chat/conversations/<id>/messages` | planned | |
| CHT-53 | Failed send | staff1 | Toast; the draft stays in the box («لم تُرسل الرسالة. المسودة ما زالت هنا.») | `POST /api/v1/chat/conversations/<id>/messages` | planned | |
| CHT-54 | Draft per conversation | staff1 | Text typed in one conversation returns after switching away and back or reloading; cleared after a successful send | `page /chat/[id]/[[id]]` | planned | |
| CHT-55 | Reply to a message | staff1 | «رد على {name}» banner; the reply shows the quoted author and text; cancel clears it; a reply parent from another conversation 404 | `POST /api/v1/chat/conversations/<id>/messages` | planned | |
| CHT-56 | Mention a member | staff1 | Typing @ opens the suggestions; arrows, Enter or Tab pick, Escape closes; only names still in the text are sent as `mention_user_ids` | `POST /api/v1/chat/conversations/<id>/messages` | planned | |
| CHT-57 | Mention someone who is not a member | api | 422 «mentions must be conversation members» | `POST /api/v1/chat/conversations/<id>/messages` | planned | |
| CHT-58 | Attach a file | staff1 | Paperclip picks PDF, image, text, DOCX or XLSX up to 10 MB; chip with remove; sent with the message; download link on the bubble | `POST /api/v1/chat/conversations/<id>/messages`, `GET /api/v1/chat/conversations/<id>/attachments/<id>/download` | planned | |
| CHT-59 | Refused files | staff1 | Browser: «نوع الملف غير مدعوم…», «الملف فارغ.», «حجم الملف يتجاوز 10 ميغابايت.»; API 422 for type, base64, size and extra fields; `attachment` that is not an object 422 | `POST /api/v1/chat/conversations/<id>/messages` | planned | |
| CHT-60 | Unknown field in the message body | api | 422 «field 'x' is not writable» | `POST /api/v1/chat/conversations/<id>/messages` | planned | |
| CHT-61 | Edit own message | staff1 | Inline editor, «حفظ»; bubble shows «معدّلة» | `PATCH /api/v1/chat/conversations/<id>/messages/<id>` | planned | |
| CHT-62 | Edit someone else's message | staff2 | 403 «only the message author can edit it» | `PATCH /api/v1/chat/conversations/<id>/messages/<id>` | planned | |
| CHT-63 | Edit with a non-string body; edit a member-removed notice | api | 422 «body must be a string»; 422 «a conversation notice cannot be edited» | `PATCH /api/v1/chat/conversations/<id>/messages/<id>` | planned | |
| CHT-64 | Delete own message | staff1 | «حذف» asks inline «حذف هذه الرسالة؟» then «تأكيد الحذف»; implemented as an edit to an empty body (no delete route exists) | `PATCH /api/v1/chat/conversations/<id>/messages/<id>` | decision | Owner decision needed: real delete or edit-to-empty |
| CHT-65 | React with an emoji | staff1 | Six emojis allowed; a count chip with highlight for the user's own; clicking own chip removes it | `POST /api/v1/chat/conversations/<id>/messages/<id>/reactions` | planned | |
| CHT-66 | Invalid reaction | api | 422 «content is not an allowed reaction» / «action must be add or remove» | `POST /api/v1/chat/conversations/<id>/messages/<id>/reactions` | planned | |
| CHT-67 | Pin and unpin a message | staff1 | Bubble shows «مثبّتة»; toggle label «إلغاء التثبيت»; `pinned` must be a boolean (422 «pinned must be a boolean») | `POST /api/v1/chat/conversations/<id>/messages/<id>/pin` | planned | |
| CHT-68 | Star a message | staff1 | Toggles for the caller only; shows in the «المميّزة» conversation filter; other members do not see it as starred | `POST /api/v1/chat/conversations/<id>/messages/<id>/star` | planned | |
| CHT-69 | Search inside a conversation | staff1 | Search button in the header filters the thread by text; closing it restores the thread | `GET /api/v1/chat/conversations/<id>/messages` | planned | |
| CHT-70 | Older messages | staff1 | «تحميل الرسائل الأقدم» prepends one page keeping the scroll position; `before` and `after` together 422 «pass before or after, not both»; non-positive id 422 | `GET /api/v1/chat/conversations/<id>/messages` | planned | |
| CHT-71 | Message of another conversation by id | api | 404 «Message {id} does not exist» on edit, react, pin, star and read | `PATCH /api/v1/chat/conversations/<id>/messages/<id>`, `POST /api/v1/chat/conversations/<id>/read` | planned | |
| CHT-72 | Non-member acts in a conversation | staff2 | 403 «You are not a member of this conversation.» on every conversation route | `GET /api/v1/chat/conversations/<id>/messages`, `POST /api/v1/chat/conversations/<id>/messages` | planned | |
| CHT-73 | Read-only tenant | staff1 | Messages readable; composer replaced by «الاشتراك للقراءة فقط»; no reply, reaction, pin, star, edit; nothing marked read | `page /chat/[id]/[[id]]` | planned | |
| CHT-74 | Chat switched off for the tenant | staff1 | Entry hidden; every chat route 403 `feature_not_included` | `GET /api/v1/chat/conversations` | planned | |

## Realtime, unread and read receipts

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| CHT-80 | A message arrives while the thread is open | staff1 → staff2 | Appears without reload; at the bottom it follows, scrolled up it shows «رسائل جديدة ({count})» that jumps to the latest | `GET /api/v1/chat/conversations/<id>/messages` | planned | |
| CHT-81 | A message arrives in another conversation | staff1 → staff2 | The list row moves to the top with the new preview and an unread badge | `GET /api/v1/chat/conversations` | planned | |
| CHT-82 | Unread count clears when read | staff2 | Viewing the newest message in a focused, visible tab calls read; badge goes to zero and the «غير مقروء» filter drops it | `POST /api/v1/chat/conversations/<id>/read` | planned | |
| CHT-83 | Read in a hidden or unfocused tab | staff2 | Nothing is marked read until the tab is visible and focused again | `POST /api/v1/chat/conversations/<id>/read` | planned | |
| CHT-84 | Read receipt in a direct chat | staff1 → staff2 | Own message shows «أُرسلت» then «قُرئت» once the peer has seen it; groups show no receipt | `GET /api/v1/chat/conversations/<id>` | planned | |
| CHT-85 | Typing indicator | staff1 → staff2 | Typing sends `is_typing` true (at most every 3 seconds) and false after 3 seconds idle, on send and on leaving; the peer sees «{name} يكتب…» in the header for up to 6 seconds; the typist never sees their own | `POST /api/v1/chat/conversations/<id>/typing` | planned | |
| CHT-86 | Typing payload | api | `is_typing` must be a boolean (422), extra field 422 | `POST /api/v1/chat/conversations/<id>/typing` | planned | |
| CHT-87 | Socket down | staff2 | Thread polls every 5 seconds for newer messages and catches up page by page | `GET /api/v1/chat/conversations/<id>/messages` | planned | |
| CHT-88 | Bus events | api | Members receive `webvue/chat` events: conversation_created, conversation_updated, message_created, message_updated, reaction_updated, pin_updated, star_updated, read_updated, members_updated, conversation_left, typing | `POST /api/v1/chat/conversations` | planned | |
| CHT-89 | Mark read validation | api | `message_id` missing 422 «message_id must be an integer»; unknown message 404; extra field 422 | `POST /api/v1/chat/conversations/<id>/read` | planned | |
| CHT-90 | Reaction and edit appear live for the other member | staff1 → staff2 | Chip count and «معدّلة» update without reload | `POST /api/v1/chat/conversations/<id>/messages/<id>/reactions` | planned | |

## Info panel and membership

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| CHT-100 | Open `/chat/{id}/info` | staff1 | Info panel beside the thread (own screen on narrow); direct link, refresh and Back work; any other panel segment is a 404 page | `page /chat/[id]/[[id]]`, `GET /api/v1/chat/conversations/<id>` | planned | |
| CHT-101 | Invalid conversation id in the URL | staff1 | «غير متاحة» not-found page with a link back | `page /chat/[id]/[[id]]` | planned | |
| CHT-102 | Conversation the user is not a member of | staff2 | Forbidden state «هذه المحادثة غير متاحة.»; thread and composer hidden | `page /chat/[id]/[[id]]`, `GET /api/v1/chat/conversations/<id>` | planned | |
| CHT-103 | Rename a group or channel | staff1 | Name field «الاسم» and «حفظ» shown when `can_manage`; header and list update | `PATCH /api/v1/chat/conversations/<id>` | planned | |
| CHT-104 | Rename refusals | api | Direct chat 403 «you cannot rename this conversation»; empty name 422 «name must not be empty»; extra field 422 | `PATCH /api/v1/chat/conversations/<id>` | planned | |
| CHT-105 | Mute a conversation | staff1 | «مكتومة» in the segmented control; list row marked; `muted` must be boolean | `PATCH /api/v1/chat/conversations/<id>` | planned | |
| CHT-106 | Notification level | staff1 | «كل الرسائل», «الإشارات فقط», «بدون إشعارات»; unmuting restores the level; other values 422 «notifications is invalid» | `PATCH /api/v1/chat/conversations/<id>` | planned | |
| CHT-107 | Member list | staff1 | Paged list with online marker; total equals member count | `GET /api/v1/chat/conversations/<id>/members` | planned | |
| CHT-108 | Add a member | staff1 | Search people not already in the conversation, click adds; all members get `members_updated` | `POST /api/v1/chat/conversations/<id>/members` | planned | |
| CHT-109 | Add members to a direct chat; bad ids | staff1 | 403 «you cannot add members»; invalid or external ids 422 | `POST /api/v1/chat/conversations/<id>/members` | planned | |
| CHT-110 | Creator removes a member | staff1 (group creator) | «إزالة» asks «إزالة {name} من المجموعة؟» then «تأكيد الإزالة»; a notice «تمت إزالة {name} من المجموعة بواسطة {actor}» is posted; the removed person loses access | `DELETE /api/v1/chat/conversations/<id>/members/<id>` | planned | |
| CHT-111 | Removal refusals | staff2 | Non-creator, channel or direct: 403 «only the group creator can remove members»; self: 422 «leave the conversation instead of removing yourself»; unknown member 404; group of two 422 «a group must keep at least two members» | `DELETE /api/v1/chat/conversations/<id>/members/<id>` | planned | |
| CHT-112 | Leave a group or channel | staff2 | «مغادرة المحادثة» asks inline then returns to the list; remaining members get the update | `POST /api/v1/chat/conversations/<id>/leave` | planned | |
| CHT-113 | Leave refusals | api | Direct chat 403 «direct chats cannot be left»; group of two or fewer 422 «a group must keep at least two members» though the UI still offers «مغادرة المحادثة» | `POST /api/v1/chat/conversations/<id>/leave` | decision | Found 2026-10-28: leave button shown for a two-member group |
| CHT-114 | Files list | staff1 | «المرفقات» lists the conversation's files newest first with download; empty text «لا ملفات في هذه المحادثة.»; paged | `GET /api/v1/chat/conversations/<id>/attachments` | planned | |
| CHT-115 | Download an attachment id from another conversation | api | 404 | `GET /api/v1/chat/conversations/<id>/attachments/<id>/download` | planned | |
| CHT-116 | Info panel in a read-only tenant | staff1 | Rename, add, remove, leave and notification changes disabled or hidden | `page /chat/[id]/[[id]]` | planned | |
| CHT-117 | Listing members and attachments for a non-member | staff2 | 403 on both | `GET /api/v1/chat/conversations/<id>/members`, `GET /api/v1/chat/conversations/<id>/attachments` | planned | |
| CHT-118 | Conversation payload flags | api | `can_manage` true for group and channel members who may write; `can_remove_members` only for a group's creator | `GET /api/v1/chat/conversations/<id>` | planned | |
