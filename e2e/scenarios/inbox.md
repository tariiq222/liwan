# Customer Inbox

Pages: `/inbox` (conversation list, the empty workspace), `/inbox/[id]` (a conversation with its thread and composer),
`/inbox/[id]/info` (the contact and conversation panel; the file route is `/inbox/[id]/[[panel]]`), settings
`/settings/apps/inbox` (policy, sector presets, departments, tags, canned replies, channels),
`/settings/apps/inbox/channels/new` (connect a WhatsApp number, a create panel over the settings page) and
`/settings/apps/inbox/channels/[id]`. Owner: `liwan_inbox` (contracts in `packages/contracts/src/inbox`). Personas and
status values: [README](README.md).

Role note: the seed has no inbox roles and the base `employee` role holds no inbox capability (customer messages are
sensitive), so every row that needs inbox access uses a custom-role persona built from the built-in inbox roles:
`inbox_agent` = read + reply; `inbox_supervisor` = read + reply + assign + export; `inbox_manager` = those + `inbox.channels.manage`
+ `inbox.settings.manage`. `reply`, `assign` and `export` each depend on `read`. `system_admin` holds no inbox capability by
default, vendor support holds all six. The assign capability also shows every conversation of the company whatever the visibility
policy says. Setup: create the three roles' users through the access API with the built-in role keys; a «read only» or
«settings only» persona is a custom role created in the access settings.

Stack note: the scratch stack has no Meta account. Provider calls (connection test, template sync, send, media download) need
either a stub of the Graph API (`graph.facebook.com`) or fake credentials, which end in the provider-error branches. Channel
secrets are stored encrypted and need the operator master key `LIWAN_INBOX_SECRET_KEY` (urlsafe base64 of 32 bytes) in the
Odoo environment; without it channel create answers 422 (see «Secret storage not configured» under Channels). The three scheduled jobs do not run on the scratch stack:
trigger them with `tools/e2e_cron.py` using `liwan_inbox.ir_cron_inbox_process_events` (webhook events to messages, every
minute), `liwan_inbox.ir_cron_inbox_send_outbox` (queued replies, every minute) and `liwan_inbox.ir_cron_inbox_maintenance`
(auto-close and retention, daily). Inbound traffic is simulated by POSTing a signed Meta payload to the webhook with the
channel's app secret (HMAC-SHA256 of the raw body, header `X-Hub-Signature-256: sha256=<hex>`). Test data: phone number ids are 5 to
32 digits and must be unique in the database, so every run uses a timestamped id.

Token note: the conversation list route is also reached with `assignee=me`, `assignee=unassigned` or `assignee=<user id>`,
`state`, `department_id`, `channel_id`, `q`, `limit` and `offset`; those variants share one Covers token. API errors quoted
below are the server messages; the UI shows the same text in a toast. A feature gate refusal answers 403
`feature_not_included` («this feature is not included») on the JSON routes and plain 403 `forbidden` with the same message on the
CSV, download and webhook routes (they are `http` routes).


## Roles and capabilities

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| INB-11 | Settings-only user sees five cards, no channels | custom role (inbox.settings.manage only) | `/settings/apps/inbox` shows policy, presets, departments, tags and canned replies but not «القنوات»; channels routes answer 403 | `page /settings/apps/inbox` `cap inbox.settings.manage` `GET /api/v1/inbox/channels` | fail | #271; FAIL: cards السياسة العامة:true قوالب القطاعات:true الأقسام:true الوسوم:true الردود الجاهزة:true; channels card shown false; failed API calls on page: ["403 /api/v1/inbox/canned-replies","403 /api/v1/inbox/canned-replies"] |
| INB-12 | Channels-only user sees only the channels card | custom role (inbox.channels.manage only) | `/settings/apps/inbox` shows only «القنوات»; policy and list routes of settings answer 403; the department select on a channel page is empty because `GET /api/v1/inbox/departments` needs read or settings | `page /settings/apps/inbox` `cap inbox.channels.manage` `GET /api/v1/inbox/departments` | fail | #271; FAIL: channels-only role: /settings/apps/inbox shows «القنوات» card; other cards []; API failures on the page ["403 /api/v1/inbox/channels","403 /api/v1/inbox/channels"]; GET /api/v1/inbox/channels answers 403 with the raw Odoo AccessError on 'Customer Inbox department' so no channel can be listed or opened; FAIL: channels-only role (inbox.channels.manage): GET /api/v1/inbox/channels and /channels/<id> answer 403 with the raw Odoo AccessError «You are not allowed to access 'Customer Inbox department' (liwan.inbox.department) records…» because the channel serializer reads the department; settings/departments/tags/canned lists answer 403 as expected; so the user cannot list or open any channel; Department list needs `inbox.conversations.read` or `inbox.settings.manage`; a channels-only user has neither (doubt, see summary) |
| INB-18 | Vendor support role holds all inbox capabilities | it_admin | A vendor support session (support access granted by the control plane) manages the channels and the settings and cannot read the conversations (the conversation routes answer 403); ordinary system_admin holds none of them | `cap inbox.conversations.read` `cap inbox.channels.manage` `cap inbox.settings.manage` | planned | #273; Owner decision 2026-10-29: vendor support runs channels and settings only. Fixed on the branch `codex/chat-inbox-launch-fixes` (the role grants and the group link; `test_vendor_support_access.py`), to be run again |

## Feature switches and limits

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| INB-19 | Inbox application switched off (`inbox.enabled`) | it_admin | The «الصندوق» rail entry and settings card disappear; every `/api/v1/inbox/*` and `/api/v1/settings/inbox` route answers 403 `feature_not_included`; `/inbox` does not render the workspace | `page /inbox` `GET /api/v1/inbox/conversations` `GET /api/v1/settings/inbox` | planned | exclusive phase (switching inbox.enabled off is a tenant-wide state change); Switch with `tools/e2e_tenant_state.py`, restore the baseline afterwards |
| INB-20 | Export and download with the application off | custom role (inbox_supervisor «مشرف رسائل العملاء») | `export.csv` and the attachment download answer 403 `forbidden`, «this feature is not included» | `GET /api/v1/inbox/conversations/export.csv` `GET /api/v1/inbox/messages/<id>/attachments/<id>/download` | planned | exclusive phase (needs inbox.enabled off) |
| INB-21 | Read-only tenant lifecycle keeps the inbox readable | custom role (inbox_agent «موظف رسائل العملاء») | List, conversation detail and messages open (GET); reply, note, patch, mark-read and retry answer the tenant read-only refusal | `GET /api/v1/inbox/conversations` `GET /api/v1/inbox/conversations/<id>` `POST /api/v1/inbox/conversations/<id>/messages` `POST /api/v1/inbox/conversations/<id>/read` | planned | exclusive phase (read-only tenant lifecycle); Tenant in read-only mode; mark-read is a write operation and is refused too (the unread dot stays) |
| INB-22 | WhatsApp sub-feature off (`inbox.whatsapp`) | custom role (inbox_manager «مدير رسائل العملاء») | Channel create answers 403 `feature_not_included`; webhook GET and POST answer 403 (see the two webhook sections); existing conversations stay readable | `POST /api/v1/inbox/channels` `GET /api/v1/inbox/hooks/whatsapp` `POST /api/v1/inbox/hooks/whatsapp` | planned | exclusive phase (inbox.whatsapp off); Webhook answers a plain 403 whose message says the feature is not included, unlike the uniform «webhook request refused»; see summary |
| INB-24 | Monthly outbound limit (`inbox.messages_out`) reached | custom role (inbox.conversations.read + reply) | The next reply answers 403 `feature_not_included`, «this limit has been reached»; notes and retry of an existing failed message are not counted; the composer keeps the draft and shows the toast | `POST /api/v1/inbox/conversations/<id>/messages` `POST /api/v1/inbox/conversations/<id>/notes` `POST /api/v1/inbox/messages/<id>/retry` | planned | exclusive phase (monthly outbound limit needs a tenant limit change; tools/e2e_tenant_state.py refuses this database); Counted per calendar month (UTC) over outbound rows of the whole tenant; retry re-queues the same row |
| INB-25 | Suspended tenant | custom role (inbox_agent «موظف رسائل العملاء») | Login is refused before any inbox route; an open session is closed with 403 `tenant_suspended` | `GET /api/v1/inbox/conversations` | planned | exclusive phase (suspended tenant); See saas.md for the suspension scenarios |

## Conversation list page

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| INB-27 | Open `/inbox` with no conversations at all | custom role (inbox.conversations.read + reply) | Empty state «لا توجد محادثات بعد» with «تظهر هنا رسائل العملاء عند ربط قناة واتساب وبدء استقبال الرسائل.»; the right pane shows the same empty state | `page /inbox` `GET /api/v1/inbox/conversations` | planned | needs a tenant/company with no conversations; this database already holds conversations |
| INB-28 | Unread conversation styling | custom role (inbox.conversations.read + reply) | An unread conversation has a bold name, a coloured time and a dot labelled «غير مقروءة»; opening it clears the dot and the bold | `page /inbox` `POST /api/v1/inbox/conversations/<id>/read` | planned |  |
| INB-29 | Row without messages and without phone | custom role (inbox.conversations.read + reply) | Preview falls back to the phone, then «لا توجد رسائل» | `page /inbox` `GET /api/v1/inbox/conversations` | planned | unreachable: a conversation only exists with a message; A conversation only has a message after ingestion, so this needs a conversation whose messages were purged; may be unreachable |
| INB-30 | Scope «محادثاتي» | custom role (inbox_supervisor «مشرف رسائل العملاء») | URL gets `?assignee=me`; list shows only conversations assigned to the user; Back restores the previous scope | `page /inbox` `GET /api/v1/inbox/conversations` | fail | #272; FAIL: scope change then browser Back: expected previous scope, actual Back goes to http://localhost:44500/ (scope buttons replace the history entry: all -> محادثاتي -> غير مسندة, one Back leaves the inbox) |
| INB-35 | Department select hidden when no department exists | custom role (inbox.conversations.read + reply) | Only the state select is shown | `page /inbox` `GET /api/v1/inbox/departments` | planned | needs a company with no departments; this database has departments |
| INB-40 | Pager in the UI and a stale offset | custom role (inbox.conversations.read + reply) | Pager moves between pages and keeps filters in the URL; an `?offset=` past the end lands on the last page | `page /inbox` `GET /api/v1/inbox/conversations` | fail | #272; FAIL: UI pager: Page 2 sets ?offset=30 and keeps filters (?state=open&offset=30); but a hand-edited ?offset=9999 stays in the URL and the pager reads «صفحة 334 من 3» instead of landing on the last page; Needs more than 30 conversations |
| INB-43 | New message appears without reload | custom role (inbox_agent «موظف رسائل العملاء») | A processed inbound event refreshes the list (new row at the top, unread dot) through the realtime nudge for users who may see that conversation; users who may not see it receive nothing | `page /inbox` `GET /api/v1/inbox/conversations` | planned | Observed: realtime list refresh not observed in 30 s on the scratch stack (new inbound processed by the cron shell; browser subscribed with channels []); inconclusive; FAIL: new conversation row at the top without reload: false (before: عميل جماعي 0); websocket ["ws://localhost:44500/_nuxt/?token=CoFUyP1eXuSE","ws://127.0.0.1:44569/websocket?version=19.0-2"]; Bus channel `liwan/inbox` carries the conversation id only, no content |

## Conversation page and thread

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| INB-49 | Older messages load on demand | custom role (inbox.conversations.read + reply) | With more than one page, a button «تحميل رسائل أقدم» prepends the older page without moving the reading position; the newest message is in view on first load and when a new one arrives | `page /inbox/[id]/[[id]]` `GET /api/v1/inbox/conversations/<id>/messages` | planned | not run: needs a conversation with more than 50 messages; Needs more than 50 messages; API pages newest-first and returns each page oldest-first |
| INB-51 | Empty thread | custom role (inbox.conversations.read + reply) | «لا توجد رسائل في هذه المحادثة» | `page /inbox/[id]/[[id]]` `GET /api/v1/inbox/conversations/<id>/messages` | planned | May be unreachable: a conversation is created together with its first message |
| INB-61 | Realtime refresh of the open thread | custom role (inbox.conversations.read + reply) | A new inbound or status update appears in the open thread without reload and scrolls to the newest message | `page /inbox/[id]/[[id]]` `GET /api/v1/inbox/conversations/<id>/messages` | planned | Observed: realtime thread refresh not observed in 30 s on the scratch stack; inconclusive; FAIL: second inbound appears in the open thread without reload: false |
| INB-64 | Drafts are separate per user | custom role (inbox.conversations.read + reply) | After sign-out and sign-in as another user, no draft of the first user is shown | `page /inbox/[id]/[[id]]` | planned | not run: per-user draft isolation after sign-out not exercised; Sign-out clears the inbox drafts |

## Composer: replies, notes and templates

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| INB-73 | Conversation with no inbound message | custom role (inbox.conversations.read + reply) | Alert «لم يرسل العميل أي رسالة بعد، لذلك لا يمكن إلا إرسال قالب معتمد.»; free-text API reply answers the same 422 window error | `page /inbox/[id]/[[id]]` `POST /api/v1/inbox/conversations/<id>/messages` | planned | Observed: conversation with no inbound message is unreachable (a conversation is created with its first inbound message); free-text reply with closed window covered by INB-72; Needs a conversation that has only outbound messages; may be unreachable until outbound-first conversations exist |
| INB-77 | Channel without approved templates | custom role (inbox.conversations.read + reply) | In template mode the text «لا توجد قوالب معتمدة لهذه القناة. اطلب من المدير مزامنة القوالب من إعدادات القناة.»; no send button | `page /inbox/[id]/[[id]]` `GET /api/v1/inbox/channels/<id>/templates` | planned | not run: needs a channel with no approved templates and a closed-window conversation |
| INB-78 | Template list fails to load | custom role (inbox.conversations.read + reply) | Error alert «تعذّر تحميل القوالب» with a retry button | `page /inbox/[id]/[[id]]` `GET /api/v1/inbox/channels/<id>/templates` | planned | not run: needs the templates request blocked; Stop the backend call for the templates request |
| INB-91 | Outbound attachments | custom role (inbox.conversations.read + reply) | The composer attaches a file, uploads it and sends it (see INB-273) | `page /inbox/[id]/[[id]]` `POST /api/v1/inbox/conversations/<id>/messages` | planned | #273; Owner decision 2026-10-29: the upload exists, so this row is run again together with INB-273. Observed result: ok controls near composer: button\|\|Next Page\|\| ; button\|\|Last Page\|\| ; a\|\|بيانات العميل والمحادثة\|\| ; button\|\|إعادة المحاولة\|\| ; button\|\|رد\|\| ; button\|\|ملاحظة داخلية\|\| ; textarea\|combobox\|اكتب ردًا للعميل\|\| ; button\|\|إرسال\|\|; Inbound media is stored and downloadable but staff cannot send files; confirm whether outbound media is in scope for this phase |

## Contact and conversation panel

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| INB-101 | Priority has no list indicator | custom role (inbox.conversations.read + reply) | A list row shows a badge for a low, high or urgent priority (a normal one shows none) and the list has a priority filter that keeps `?priority=` in the URL and in the CSV export | `page /inbox` `GET /api/v1/inbox/conversations` | planned | #273; Owner decision 2026-10-29: the priority shows in the list with a filter. Fixed on the branch `codex/chat-inbox-launch-fixes`, to be run again |
| INB-107 | Bell row opens the conversation | custom role (inbox_agent «موظف رسائل العملاء») | The assignee sees the bell entry with the customer name; clicking opens `/inbox/<conversation id>`; the bell entry disappears if the assignee can no longer see the conversation | `page /inbox/[id]/[[id]]` `PATCH /api/v1/inbox/conversations/<id>` | fail | #270; FAIL: assignee agent2 has bell rows kind inbox.assigned (API /api/v1/notifications 200 with conversation_id and customer name as title) but the bell panel shows «تعذر تحميل الإشعارات»: the zod contract (packages/contracts/src/pmo/notification.ts UnknownNotificationSchema, kind regex IDENTIFIER_PATTERN /^[a-z][a-z0-9_]*$/ in access/access.ts:8) rejects the dotted kind `inbox.assigned`, so the whole list fails; a user without inbox rows sees «لا توجد إشعارات»; See platform.md for the bell itself |
| INB-113 | Reopen a closed conversation while a newer one is open | custom role (inbox_supervisor «مشرف رسائل العملاء») | Setting a closed conversation to open/pending/resolved while the same customer already has an open one on that channel answers 422 `invalid`, «This customer already has an open conversation on the channel.» | `PATCH /api/v1/inbox/conversations/<id>` | planned | Fixed on the branch `codex/chat-inbox-launch-fixes`: the answer is 422 `invalid` for `state` with the reason `inbox_customer_has_open_conversation`, which the page shows in Arabic. Before the fix: reopening a closed conversation while the customer has a newer open one answers 422 without the `invalid` code and with the raw Odoo constraint text «The operation cannot be completed: A customer has one open conversation per channel.» instead of «This customer already has an open conversation on the channel.» (known #197 raw Odoo errors); Happens after a customer wrote again after the old conversation was closed |
| INB-114 | Two agents edit the same conversation | custom role (inbox_supervisor «مشرف رسائل العملاء») | A PATCH carries the `revision` the editor read; the second saver of the same revision gets 409 `stale_write` (reason `inbox_conversation_stale`, «فيه تعديل أحدث على هذه المحادثة، حدّث الصفحة.»), the page reads the conversation again and the first edit stays | `PATCH /api/v1/inbox/conversations/<id>` | planned | #273; Owner decision 2026-10-29: a revision check. Fixed on the branch `codex/chat-inbox-launch-fixes`, to be run again |

## Visibility policy

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| INB-125 | Visibility applies to the bell and realtime audience | custom role (inbox_agent «موظف رسائل العملاء») | A user who cannot see a conversation gets no bell row and no realtime nudge for it | `PATCH /api/v1/inbox/conversations/<id>` | planned | not run: bell and realtime audience (see INB-43/61 inconclusive realtime, INB-107 bell contract bug); Bus audience = users with read capability who pass the visibility domain |

## CSV export

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| INB-130 | Export size cap | custom role (inbox_supervisor «مشرف رسائل العملاء») | At most 10000 rows are written; there is no paging parameter | `GET /api/v1/inbox/conversations/export.csv` | planned | needs 10001 conversations; EXPORT_LIMIT=10000 read in controllers/conversation_files.py only; Needs 10001 conversations; check by unit test or by reading the cap |

## Conversation state machine

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| INB-139 | Manual transitions | custom role (inbox.conversations.read + reply) | Any state can be set to any other state by an agent with reply (no restriction between states) | `PATCH /api/v1/inbox/conversations/<id>` `cap inbox.conversations.reply` | planned |  |

## Message delivery state machine

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| INB-144 | Queued reply is sent by the outbox job | custom role (inbox.conversations.read + reply) | State «في الانتظار» becomes «أُرسلت» and stores the provider message id; the thread refreshes | `POST /api/v1/inbox/conversations/<id>/messages` `POST /api/v1/inbox/messages/<id>/retry` | planned | needs a Graph API stub: success path (state «أُرسلت» and provider id) not testable; with no stub the provider answers Invalid OAuth token and the message fails (see INB-147); Cron `ir_cron_inbox_send_outbox`; provider stub answers 200 with a message id |
| INB-145 | Temporary provider failure backs off | custom role (inbox.conversations.read + reply) | A 5xx, 429 or network error keeps the message queued, increases `attempts` and schedules the next attempt after 1, 2, 4, 8 minutes | `POST /api/v1/inbox/conversations/<id>/messages` | planned | needs a Graph API stub answering 5xx/429; not testable here; Stub answers 503 |
| INB-146 | Fifth failed attempt marks the message failed | custom role (inbox.conversations.read + reply) | After 5 attempts the state is «فشل الإرسال» with the provider error text (cut to 200 characters) | `POST /api/v1/inbox/conversations/<id>/messages` | planned | needs a Graph API stub answering 5xx for 5 attempts; not testable here |
| INB-147 | Permanent provider failure fails at once | custom role (inbox.conversations.read + reply) | A 4xx (other than 429) or a malformed provider answer marks the message failed on the first attempt | `POST /api/v1/inbox/conversations/<id>/messages` | planned |  |
| INB-153 | Unexpected error in the send job | custom role (inbox.conversations.read + reply) | An unexpected exception counts as one retryable attempt and does not stop other queued messages | `POST /api/v1/inbox/conversations/<id>/messages` | planned | covered by an Odoo unit test only; Covered by an Odoo test (`test_hardening.py`); UI evidence is the retry/failed sequence |
| INB-154 | One bad message does not block the queue | custom role (inbox.conversations.read + reply) | Messages behind a failing one are still sent in the same job run (each item commits separately) | `POST /api/v1/inbox/conversations/<id>/messages` | planned | partial run 2026-10-29, the unchecked part keeps this row planned: 4 queued replies on different conversations, one job run: every message was attempted and ended failed with the provider error, none left queued (each item processed on its own); a failing item blocking the rest could not be separated because every item fails on provider auth; 4 queued replies on different conversations, one job run: every message was attempted and ended failed with the provider error, none left queued (each item processed on its own); a failing item blocking the rest could not be separated because every item fails on provider auth |
| INB-155 | Order and batch size of the outbox | custom role (inbox.conversations.read + reply) | Due messages are sent oldest first, at most 100 per run | `POST /api/v1/inbox/conversations/<id>/messages` | planned | needs more than 100 queued rows; Needs more than 100 queued rows; covered by an Odoo test |

## Inbound ingestion (webhook events job)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| INB-161 | Media message | visitor | The file is fetched from the provider and attached to the message (name from the filename or the kind, mime type from the provider); the thread shows the chip | `POST /api/v1/inbox/hooks/whatsapp` `GET /api/v1/inbox/messages/<id>/attachments/<id>/download` | planned | Observed: media message (sticker, fake id): body [sticker] error "Invalid OAuth access token - Cannot parse access token" attachments 0 (no Graph stub: success path not testable); Needs a Graph API stub |
| INB-162 | Media fetch fails | visitor | The message is kept, without attachment; the failure text is stored in the message `error` field and is returned by the API | `POST /api/v1/inbox/hooks/whatsapp` `GET /api/v1/inbox/conversations/<id>/messages` | gap | #272; Observed result: ok image with caption and fake media id: message kept, attachments 0, error field = "Invalid OAuth access token - Cannot parse access token"; The thread shows `error` only for failed outbound messages, so an inbound media failure is invisible in the UI; the agent sees a bare «[image]» body |
| INB-163 | Media larger than 16 MB | visitor | No attachment is stored and the error «media is too large» is recorded on the message | `POST /api/v1/inbox/hooks/whatsapp` | planned | needs a Graph API stub returning a media file over 16 MB |
| INB-168 | Event batch size | visitor | At most 200 pending events per run; the rest follow in the next run | `POST /api/v1/inbox/hooks/whatsapp` | planned | needs more than 200 pending events; Needs more than 200 events; covered by an Odoo test |

## Webhook: verification handshake (GET)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| INB-176 | Verify with the WhatsApp sub-feature off | visitor | 403 whose message says the feature is not included | `GET /api/v1/inbox/hooks/whatsapp` | planned | exclusive phase (inbox.whatsapp off) |

## Webhook: signed deliveries (POST)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| INB-183 | Channel without an app secret, or master key missing | visitor | Answers 403 like a bad signature (the secret cannot be checked) | `POST /api/v1/inbox/hooks/whatsapp` | planned | not run: needs a channel with no stored secret or the master key removed from the server environment; Needs a channel with no stored secret, or the master key removed from the environment |
| INB-190 | Webhook with the WhatsApp sub-feature off | visitor | 403 (message says the feature is not included) | `POST /api/v1/inbox/hooks/whatsapp` | planned | exclusive phase (inbox.whatsapp off) |
| INB-192 | Odoo's generic endpoints stay closed | visitor | `/json/2`, `/web/dataset` and friends answer 404 for the hook identity and for every user | `POST /api/v1/inbox/hooks/whatsapp` | fail | private security advisory GHSA-9xq5-v9r4-xfxc; FAIL: direct Odoo (no edge guard on this stack): anonymous POST /json/2/... answers 401 (and 401 with a session cookie), POST /web/dataset/call_kw/... answers 200 with a JSON-RPC «Session expired» envelope that includes a server traceback in data.debug, /jsonrpc answers 200 with an embedded 404; only /odoo, /doc, /xmlrpc, /web, /report answer 404. With a manager session /web/dataset/call_kw and /jsonrpc answer a JSON-RPC 404 inside HTTP 200 (no data is reached); Guard owned by `liwan_platform` |

## Policy settings

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| INB-201 | Settings read creates a row in a GET | api | The install creates every company's settings row at the stated defaults, and a GET of the settings writes nothing (the route is read-only) | `GET /api/v1/settings/inbox` | planned | #273; Owner decision 2026-10-29: defaults are created at install. Fixed on the branch `codex/chat-inbox-launch-fixes` (`post_init_hook`, a migration for existing databases, and an unsaved default row for a company without one), to be run again |

## Sector presets

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| INB-207 | Applying twice is idempotent | custom role (inbox.settings.manage only) | The second application adds nothing and creates no duplicates; names renamed by the tenant are not recreated as copies of the old names | `POST /api/v1/settings/inbox/presets/<id>` | fail | #272; FAIL: second application is idempotent (departments 5->5, tags 6->6, replies 4->4) but after renaming a preset department «الحسابات» to another name a new apply re-created «الحسابات» (5->6): renamed preset items are recreated as copies, contrary to the expectation; A renamed preset item is created again because the match is by name (see summary) |

## Departments

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| INB-217 | Duplicate department name | custom role (inbox.settings.manage only) | 422 field `name`, «a department with this name exists»; the form shows the message; names are unique per company (case-sensitive) | `POST /api/v1/inbox/departments` `PATCH /api/v1/inbox/departments/<id>` | fail | #272; FAIL: UI: adding a department with an existing name shows only the generic toast «تعذّر الحفظ لأن بعض البيانات غير صحيحة.»; no field message «a department with this name exists» is shown in the form (API returns 422 field name with that text); dup name 422 invalid «a department with this name exists» f=name; case variant 422 |

## Tags

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## Canned replies

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| INB-231 | Edit a canned reply | custom role (inbox.settings.manage only) | The new body is used by the composer on the next suggestion; messages already sent do not change | `page /settings/apps/inbox` `PATCH /api/v1/inbox/canned-replies/<id>` | planned |  |

## Channels: connect and manage

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| INB-235 | Channels card with no channel | custom role (inbox.channels.manage only) | Text «لم تُربط أي قناة بعد.» and the button «ربط قناة» | `page /settings/apps/inbox` `GET /api/v1/inbox/channels` `cap inbox.channels.manage` | planned | needs a company with no channels; this database has channels |
| INB-240 | Duplicate phone number id | custom role (inbox_manager «مدير رسائل العملاء») | 422 field `phone_number_id`, «this phone number id is already connected» (unique across the database, even in another company); the form shows it under the field | `page /settings/apps/inbox/channels/new` `POST /api/v1/inbox/channels` | fail | #272; FAIL: 422 field phone_number_id is returned and the connect form marks the phone field red with an error under it, but the text under the field is the generic «تعذّر الحفظ لأن بعض البيانات غير صحيحة.» instead of «this phone number id is already connected»; 422 invalid «this phone number id is already connected» f=phone_number_id |
| INB-242 | Secret storage not configured | custom role (inbox_manager «مدير رسائل العملاء») | Without the operator master key, create answers 422 «Secret storage is not configured.» | `POST /api/v1/inbox/channels` | planned | exclusive phase (needs LIWAN_INBOX_SECRET_KEY removed and the server restarted); Remove `LIWAN_INBOX_SECRET_KEY` from the scratch environment for this row only |
| INB-248 | Channel page errors | custom role (inbox_manager «مدير رسائل العملاء») | `/settings/apps/inbox/channels/abc` and `/0` show not found; an unknown or other-company id shows not found (API 404 `not_found`); a network failure shows the retry state | `page /settings/apps/inbox/channels/[id]` `GET /api/v1/inbox/channels/<id>` | planned | not run: channel page error states (abc, 0, other company) not opened in the browser; API 404 covered by INB-269 |
| INB-256 | Enable a channel | custom role (inbox_manager «مدير رسائل العملاء») | «تفعيل القناة» sets «متصلة» without calling the provider, whatever the earlier state (draft or error) | `page /settings/apps/inbox/channels/[id]` `PATCH /api/v1/inbox/channels/<id>` | decision | #273; Observed: PATCH state=connected after a failed test: 200 state=connected (no provider call, no test) ; «تفعيل القناة» sets «متصلة» immediately without a provider test: true; Enabling jumps straight to connected even if the channel never passed a test; confirm or send it back to draft |
| INB-257 | Test connection: success | custom role (inbox_manager «مدير رسائل العملاء») | «اختبار الاتصال» calls the provider; the state becomes «متصلة» and the error is cleared; toast «انتهى اختبار الاتصال» | `page /settings/apps/inbox/channels/[id]` `POST /api/v1/inbox/channels/<id>/test` `cap inbox.channels.manage` | planned | needs a Graph API stub: success path not testable; Needs a Graph API stub |
| INB-261 | Sync templates: success | custom role (inbox_manager «مدير رسائل العملاء») | «مزامنة القوالب» imports every template of the business account (all pages up to 10 pages of 100): name, language, category, status, body, parameter count; toast «تمت مزامنة القوالب»; the API returns `{items,total}` | `page /settings/apps/inbox/channels/[id]` `POST /api/v1/inbox/channels/<id>/templates/sync` `cap inbox.channels.manage` | planned | needs a Graph API stub: successful template sync not testable; Needs a Graph API stub |
| INB-262 | Sync templates: updates and removals | custom role (inbox_manager «مدير رسائل العملاء») | A second sync updates changed templates in place and deletes the ones the provider no longer lists; queued template replies of a removed template fail with «The template was removed by the provider.» | `POST /api/v1/inbox/channels/<id>/templates/sync` `POST /api/v1/inbox/conversations/<id>/messages` | planned | needs a Graph API stub |
| INB-264 | Sync with unusual components | custom role (inbox_manager «مدير رسائل العملاء») | Templates without a body component or with odd components import with an empty body and zero parameters, without a server error; a malformed provider answer (item without name/language) answers 422 «malformed provider response» | `POST /api/v1/inbox/channels/<id>/templates/sync` | planned | needs a Graph API stub |
| INB-265 | Template parameter count | custom role (inbox_manager «مدير رسائل العملاء») | The parameter count is the highest `{{n}}` placeholder in the body | `POST /api/v1/inbox/channels/<id>/templates/sync` | planned | needs a Graph API stub for the sync; placeholder counting was only seen on database-seeded templates (welcome_inb with {{1}} {{2}} needs 2) |
| INB-268 | Delete a channel that has conversations | custom role (inbox_manager «مدير رسائل العملاء») | The API answers 422 «A channel with conversations cannot be deleted; disable it instead.» and the page shows it in a toast | `page /settings/apps/inbox/channels/[id]` `DELETE /api/v1/inbox/channels/<id>` | decision | #273; Observed result: FAIL confirm text "حذف القناة «ch A 282027x79»؟"; DELETE => DELETE /api/v1/inbox/channels/3 ; toast: لا يمكن التراجع عن الحذف، وستُحذف المحادثات والرسائل المرتبطة بالقناة.; The page text says deletion also deletes the conversations and messages («يحذف القناة وكل محادثاتها ورسائلها»), but the server refuses; fix the text or change the rule |

## Composer: file uploads, reactions and typing

The composer uploads an attached file first (`/uploads`, kept on the conversation for a day until a reply uses it),
then sends the reply with `attachment_id`. Reactions and the typing indicator are queued for the outbox, which
delivers them to WhatsApp.

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| INB-273 | Agent attaches and sends a file | custom role (inbox_agent «موظف رسائل العملاء») | «إرفاق ملف» uploads the file («جارٍ الرفع…»); the upload answers 201 with `id`, `name`, `mimetype`, `size`; sending posts the reply with `attachment_id` and the optional caption; the thread shows the file chip | `page /inbox/[id]/[[id]]` `POST /api/v1/inbox/conversations/<id>/uploads` `POST /api/v1/inbox/conversations/<id>/messages` `cap inbox.conversations.reply` | fail | #289; upload 201 and send with attachment_id works, the composer shows the chip and the thread the file; but a caption with the file is refused 422 with a raw tuple message (finding, still open); the list row now names the file («صورة» / «ملف») and the bubble shows the file alone, since `last_message_kind` and the empty caption are served by the branch `codex/chat-inbox-launch-fixes` (to be run again); Inside the 24-hour window; supersedes the premise of INB-91 |
| INB-277 | Upload is tied to its conversation | api | Using an upload's id in a reply to another conversation, or a second time, answers 422 «attachment_id is not an unused upload of this conversation»; an unused upload is deleted after a day | `POST /api/v1/inbox/conversations/<id>/uploads` `POST /api/v1/inbox/conversations/<id>/messages` | planned | partial run 2026-10-29, the unchecked part keeps this row planned: upload id used in another conversation, a second time or nonexistent 422 attachment_id is not an unused upload of this conversation; the one-day purge was not run; Purge runs from the conversation cron; upload id used in another conversation, a second time or nonexistent 422 attachment_id is not an unused upload of this conversation; the one-day purge was not run; Purge runs from the conversation cron |
| INB-278 | React to a customer message | custom role (inbox_agent «موظف رسائل العملاء») | Choosing an emoji under a delivered message answers the message with the agent reaction; the thread shows «تفاعلك: <emoji>»; choosing the same emoji again sends `""` and removes it | `page /inbox/[id]/[[id]]` `POST /api/v1/inbox/messages/<id>/reaction` `cap inbox.conversations.reply` | planned | partial run 2026-10-29, the unchecked part keeps this row planned: picker under a message sets the reaction (API agent emoji, chip with aria label «تفاعلك: 👍»); choosing it again sends an empty emoji and removes it; outbox delivery needs Meta so not run; The outbox delivers it; a reaction that cannot be delivered is withdrawn; picker under a message sets the reaction (API agent emoji, chip with aria label «تفاعلك: 👍»); choosing it again sends an empty emoji and removes it; outbox delivery needs Meta so not run; The outbox delivers it; a reaction that cannot be delivered is withdrawn |
| INB-283 | Uploads, reactions and typing with the application off | custom role (inbox_agent «موظف رسائل العملاء») | All three answer 403 `feature_not_included` | `POST /api/v1/inbox/conversations/<id>/uploads` `POST /api/v1/inbox/messages/<id>/reaction` `POST /api/v1/inbox/conversations/<id>/typing` | planned | exclusive phase (feature off) |
