# Inbox TikTok Channel: one complete phase

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan sub-task by sub-task. Steps use checkbox (`- [ ]`) syntax. Implementation is delegated through `opencode-executor` by default (AGENTS.md "Agent execution"); the coordinator reviews every patch and reruns the checks.

**Goal:** Ship TikTok Business Messaging as a complete channel of the customer inbox in one phase: one-click connect, inbound and outbound messages, automation (welcome, away, rules, satisfaction survey, suggested questions, chat prompts), history import, and the shared SaaS relay that serves every tenant database from one platform TikTok app.

**Architecture:** TikTok is `kind='tiktok'` on `liwan.inbox.channel` and reuses contacts, conversations, cycles, assignment, automation, events and the outbox. An env-free adapter `adapters/tiktok.py` (logic ported from Chatwoot, MIT) talks to `https://business-api.tiktok.com/open_api/v1.3`. The TikTok app key and secret are operator configuration. In `saas`, a small relay in `deploy/shared` receives the platform app's single webhook and OAuth redirect and forwards each to the owning tenant; in `non_saas` the customer's own app points straight at its server and no relay runs.

**Tech Stack:** Odoo 19 Community (`liwan_inbox`), `requests`, `cryptography` (`secret_box`), zod (`packages/contracts`), Nuxt 4 / Nuxt UI (`apps/web`), Node 24 without runtime dependencies (`deploy/shared`).

**Spec:** The decisions below (owner, 2026-11-05) are the spec. References: `chatwoot/chatwoot@develop` `app/services/tiktok/*`, `app/controllers/{webhooks,tiktok}/*`, `app/jobs/webhooks/tiktok_events_job.rb`, `spec/**/tiktok*` (MIT outside `enterprise/`); `justomat/skills` `skills/tiktok-business-messaging/references/*.md` (MIT) for conversations, messages, auto messages, webhooks and event payloads.

## Delivery shape

One phase, eleven epics (E0–E10), each split into sub-tasks. A sub-task is one reviewable unit with its own tests and commit. One task branch `inbox-tiktok`; three pull requests in order, each green before the next opens:

| PR | Epics | Why separate |
| --- | --- | --- |
| PR 1 `feat(inbox): TikTok channel` | E1–E7 | Odoo addon and contracts: one layer, one review |
| PR 2 `feat(deploy): TikTok relay for shared SaaS` | E8 | Deployment layer, different reviewers and checks |
| PR 3 `feat(web): TikTok inbox channel` | E9 | Nuxt UI, screenshots |
| (closes the phase) | E10 | Isolation, live sandbox evidence |

## Decisions

- **D1 App credentials.** Environment only: `LIWAN_TIKTOK_CLIENT_KEY`, `LIWAN_TIKTOK_CLIENT_SECRET`, `LIWAN_TIKTOK_REDIRECT_URI`. No channel stores an app key or secret.
- **D2 Channel identity.** Keyed by the business account's `open_id` (`tiktok_business_id`, unique). Events route by the envelope's `user_openid`.
- **D3 Outbound.** Text (≤ 6000 chars, optional quoted reply); one JPEG/PNG image ≤ 3 MB without caption when the conversation reports `IMAGE_SEND`; a button card (`QA_BUTTON_CARD`: title ≤ 40, 1–3 reply buttons, title ≤ 20, id ≤ 40); sender actions `TYPING` and `MARK_READ`. Refused with 422 on TikTok: templates, flows, campaigns, location, commerce, lists, link buttons, video, documents, outbound reactions.
- **D4 Window.** 48 h after the customer's last inbound message, and at most 10 outbound messages in a row since it.
- **D5 Inbound kinds.** `text`→`text`; `image`→`image` (downloaded); `video`→`video` (downloaded); `share_post`→`text` (body = embed URL); `emoji`/`sticker`→`sticker` (URL kept as body, no download: URLs expire); `template` (an auto-message card) → `interactive`; `reaction` → customer reaction on the target message; a text with `reply_source_payload` → `selected_option_id` = `reply_source_unique_id`; anything else → `unsupported`.
- **D6 Echo.** `im_send_msg`: dropped if its `message_id` is stored; otherwise stored as an outbound message with no author (sent from the TikTok app or a TikTok auto message). Events younger than 30 s wait for the next cron run so the outbox has written its provider id.
- **D7 Read.** `im_mark_read_msg` marks earlier outbound messages of the conversation `read`. Agents opening a conversation send `MARK_READ` through the existing read-receipt queue.
- **D8 EU senders.** `im_receive_msg_eu` carries no content; it queues a sync job (E6) for the channel.
- **D9 Referral.** `im_referral_msg` stores the ad or short-link referral on the conversation (`referral_source`, `referral_ref`) and creates nothing else.
- **D10 Automation.** Welcome on a TikTok channel is TikTok's own `WELCOME_MESSAGE` (text ≤ 250), pushed from the channel's existing welcome record; LiwanOS never sends it itself there. Away and rule replies are sent by LiwanOS as text or a button card. The satisfaction survey is a button card with the channel's three CSAT labels (already 1–20 chars). Suggested questions (≤ 3; question ≤ 80, answer ≤ 200) and chat prompts (≤ 6; title ≤ 18, content ≤ 150) are a new model mirrored to TikTok with its audit status.
- **D11 History import.** On first connect and on demand: conversations of the last 90 days (TikTok caps the list at 100 conversations), the 20 newest messages of each. Imported messages never trigger automation, notifications, unread or reopening.
- **D12 Sub-feature.** `inbox.tiktok` (boolean) gates every TikTok route, the channel create, the relay registration and the cron work; channels count against `inbox.channels`.
- **D13 Relay.** `deploy/shared/tiktok-relay.mjs`: verifies the signature, maps `user_openid` → tenant, forwards unchanged. The mapping is registered by the tenant's Odoo after a connect and removed on delete, over the internal network with the shared proxy token. Odoo registers only when `LIWAN_TIKTOK_RELAY_URL` is set (operator config, not a customer-type condition: R6). Tokens never leave the tenant database.
- **D14 Webhook subscription.** One per app, set by the operator script `deploy/tiktok_webhook.py` (`register`, `show`, `delete`), in both modes.

## Owner decisions

- **O1 App name: decided 2026-11-05.** The inbox application is named "رسائل العملاء" / "Customer Messages" (replaces "WhatsApp" from PR #383; "محادثات" stays the staff chat). Each channel keeps its own brand icon. Applied in E9.0.
- **O2 Government packages: decided 2026-11-05.** `inbox.tiktok` stays available in every package, government included. The customer chooses to connect TikTok; the channel settings state that TikTok processes message data outside the Kingdom (E9.1 shows this note before the connect button).

## Global Constraints

- No `sudo()` (R7). Webhook and relay calls run as the `inbox_hook` identity; OAuth, sync buttons and settings as the signed-in user; crons as the existing inbox cron user.
- No SQL on Odoo tables (R9). Row locks on `liwan_inbox_channel` are allowed (LiwanOS table).
- Nothing in `odoo-addons` imports the control plane (R5). The relay is shared-deployment code, not the control plane.
- Every route checks `inbox.tiktok` (R10) and `MANAGE_CHANNELS` (or the existing conversation capabilities for agent actions). Lists stay `{items, total}`.
- Errors: 403 `forbidden`, 404 `not_found`, 422 `invalid` with `details.reason`. New reasons: `inbox_tiktok_unsupported_kind`, `inbox_tiktok_reply_limit`, `inbox_channel_kind_unsupported`, `inbox_tiktok_not_configured`, `inbox_tiktok_scopes_missing`, `inbox_tiktok_account_taken`, `inbox_tiktok_auto_message_reviewing`, `inbox_tiktok_auto_message_limit`, `inbox_tiktok_sync_running`.
- Tokens only encrypted (`secret_box`, `LIWAN_INBOX_SECRET_KEY`); never in a response, log line or URL after the exchange.
- Replace, do not layer. `whatsapp.ProviderError` moves to `adapters/errors.py`; `REPLY_WINDOW` becomes `REPLY_WINDOWS`; WhatsApp-only assumptions are generalized in place.
- OAuth scopes (exact): `user.info.basic,user.info.username,user.info.stats,user.info.profile,user.account.type,user.insights,message.list.read,message.list.send,message.list.manage`.
- Signature: header `Tiktok-Signature: t=<unix s>,s=<hex>`, `s == HMAC_SHA256(client_secret, f"{t}.{raw}")`, reject when `now - t > 5`.
- Version `19.0.1.12.0` → `19.0.1.14.0` as shipped (`19.0.1.13.0` went to the verify-token encryption; the current version is in the `liwan_inbox` manifest); no migration script (new nullable columns, widened selections, a dropped NOT NULL, new models).
- UI strings through `$t()` in the `inbox` namespace, ar and en together; components from Storybook only.
- Heavy checks through `tools/test_slot.py`; never `odoo19`.
- `adapters/tiktok.py` and `deploy/shared/tiktok-relay.mjs` start with an attribution comment: logic ported from Chatwoot (MIT), with its copyright line.

## Review Focus

- **Clock skew and the relay hop:** a delivery signed 6 s ago is 403; 4 s is accepted, at the relay and at Odoo. Tests in E3.2 and E8.1.
- **Echo racing the outbox:** one outbound message, never two. Test in E4.2.
- **Expired refresh token:** channel `error`, queued messages fail non-retryable, sync job `failed`, no retry loop. Test in E2.3.
- **Enabling suggested questions wipes TikTok's items:** after enable, LiwanOS recreates every stored item; a reviewing item cannot be edited (422). Tests in E5.4.
- **Relay with a stale mapping:** an `open_id` moved to another tenant, or a tenant removed from the registry. Expected: the old binding is refused or dropped, no event reaches the wrong tenant. Test in E8.2.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `odoo-addons/liwan_inbox/adapters/errors.py` (new) | `ProviderError` for both adapters |
| `odoo-addons/liwan_inbox/adapters/tiktok.py` (new) | Env-free TikTok client |
| `models/channel.py` | `kind` gains `tiktok`; conditional constraints; feature by kind |
| `models/channel_tiktok.py` (new) | TikTok fields, tokens, refresh, credentials, relay binding, welcome push |
| `models/inbound_tiktok.py` (new) | Ingest TikTok items |
| `models/tiktok_shortcut.py` (new) | Suggested questions and chat prompts mirrored to TikTok |
| `models/tiktok_sync.py` (new) | History import job and its cron step |
| `models/event.py`, `conversation.py`, `contact.py`, `message.py`, `message_outbox.py`, `automation.py`, `constants.py`, `feature_registry.py` | Kind-aware changes listed per sub-task |
| `controllers/tiktok_oauth.py`, `tiktok_hooks.py`, `tiktok_settings.py` (new) | Connect/callback, webhook, shortcuts and sync routes |
| `controllers/helpers.py` + WhatsApp-only controllers | `require_kind` guards |
| `serializers/settings.py`, `serializers/tiktok.py` (new) | Dumps |
| `data/inbox_crons.xml`, `security/ir.model.access.csv`, `security/inbox_rules.xml` | Cron and access for the two new models |
| `packages/contracts/src/inbox/index.ts`, `tiktok.ts` (new) | zod contracts |
| `deploy/shared/tiktok-relay.mjs`, `tiktok-relay.test.mjs` (new), `deploy/docker-compose.shared.yml`, `deploy/shared/Caddyfile`, `deploy/shared/README.md` | Relay |
| `deploy/tiktok_webhook.py` (new) | Operator webhook subscription script |
| `apps/web/app/components/inbox/*`, `apps/web/app/pages/settings/apps/inbox/**`, `apps/web/i18n/locales/{ar,en}/inbox.json`, `apps/web/app/assets/icons/tiktok.svg` | UI |
| `tools/route_gate_allowlist.json` | Webhook and relay-facing routes with reasons |

---

## E0 Prerequisites (no code)

- [x] **E0.1** Owner decisions O1 and O2 recorded (2026-11-05).
- [ ] **E0.2** Create the TikTok developer app, request Business Messaging access, add a sandbox business account. Record redirect URI and webhook URL (no secrets) in `docs/WORKSPACE.md`.
- [ ] **E0.3** `npm run wt -- new inbox-tiktok --owner claude --task "TikTok channel phase" --scope odoo-addons/liwan_inbox --scope packages/contracts/src/inbox --scope apps/web/app/components/inbox --scope apps/web/app/pages/settings/apps/inbox --scope deploy/shared`; agree any overlap (`inbox-fixes`, `web-full-width`) with its owner and pass `--allow-overlap "<reason>"`.

E1–E7 and E8 run on recorded fixtures; only E10.3 needs the sandbox.

## E1 Adapter

**Interfaces (produced, all in `adapters/tiktok.py` unless stated):**
- `errors.ProviderError(message: str, retryable: bool, code: str | int | None = None)`; HTTP 429/5xx retryable; TikTok `code != 0` carried as `code`.
- Config: `AppConfig(client_key, client_secret, redirect_uri)`; `app_config(environ: Mapping[str, str]) -> AppConfig | None`.
- Types: `Credentials(business_id, access_token)`; `TokenGrant(open_id, scopes: frozenset[str], access_token, refresh_token, expires_at: datetime, refresh_expires_at: datetime)`; `Profile(username, display_name)`; `Media(content: bytes, mimetype: str)`; `Button(id: str, title: str)`.
- Parsed items: `InboundMessage(provider_id, conversation_id, sender_id, sender_name, sent_at, kind, body, media_id, media_type, context_id, option_id, echo: bool, auto: bool)`; `Reaction(conversation_id, target_id, emoji: str | None)`; `ReadUpTo(conversation_id, read_at)`; `Referral(conversation_id, sender_id, sender_name, source: str, ref: str | None)`; `EuNotice(received_at)`; `AutoMessageChanged()`.
- Constants: `API_BASE`, `AUTHORIZE_URL = 'https://www.tiktok.com/v2/auth/authorize'`, `SCOPES`, `SIGNATURE_HEADER = 'Tiktok-Signature'`, `SIGNATURE_MAX_AGE = 5`, `IMAGE_MIMETYPES`, `IMAGE_MAX_BYTES = 3 * 1024 * 1024`, `TEXT_MAX = 6000`, `CARD_TITLE_MAX = 40`, `BUTTON_TITLE_MAX = 20`, `BUTTON_ID_MAX = 40`, `MAX_BUTTONS = 3`, `WELCOME_MAX = 250`, `QUESTION_MAX = 80`, `ANSWER_MAX = 200`, `PROMPT_TITLE_MAX = 18`, `PROMPT_CONTENT_MAX = 150`, `MAX_QUESTIONS = 3`, `MAX_PROMPTS = 6`, `HISTORY_MESSAGES = 20`.
- Functions: `verify_signature(secret, raw: bytes, header: str, now: int) -> bool`; `authorize_url(config, state) -> str`; `exchange_code(config, code) -> TokenGrant`; `refresh_tokens(config, refresh_token) -> TokenGrant`; `business_profile(credentials) -> Profile`; `event_business_id(payload) -> str | None`; `parse_event(payload, business_id) -> list`; `image_send_capable(credentials, conversation_id) -> bool`; `fetch_media(credentials, conversation_id, message_id, media_id, media_type) -> Media`; `send_text(credentials, conversation_id, body, context_id=None) -> str`; `upload_image(credentials, filename, mimetype, data) -> str`; `send_image(credentials, conversation_id, media_id) -> str`; `send_buttons(credentials, conversation_id, title, buttons: Sequence[Button]) -> str`; `send_action(credentials, conversation_id, action: Literal['TYPING', 'MARK_READ']) -> None`; `list_conversations(credentials, conversation_type: Literal['SINGLE', 'STRANGER'], cursor: int) -> tuple[list[dict], int | None]` (next cursor or None); `list_messages(credentials, conversation_id) -> tuple[list[dict], list[InboundMessage]]` (participants, parsed messages; `+` encoded as `%2B`); `get_auto_messages(credentials, auto_type) -> tuple[str, list[dict]]` (operation status, items); `create_auto_message(credentials, auto_type, content: dict) -> str`; `update_auto_message(credentials, auto_type, auto_id, content) -> None`; `delete_auto_message(credentials, auto_type, auto_id) -> None`; `set_auto_message_status(credentials, auto_type, enabled: bool) -> None`; `webhook_show(config) -> str | None`, `webhook_register(config, callback_url) -> None`, `webhook_delete(config) -> None`.

- [ ] **E1.1 Shared error type.** Move `ProviderError` to `adapters/errors.py`; update every `whatsapp.ProviderError` reference (`rg -l "whatsapp.ProviderError" odoo-addons`). Run `test_outbox`, `test_webhook`, `test_processing`: PASS. Commit `refactor(inbox): share ProviderError between channel adapters`.
- [ ] **E1.2 Fixtures.** `tests/tiktok_payloads.py`: one full envelope per event (`im_receive_msg` text/image/video/share_post/sticker/template/reaction/button-click, `im_send_msg` echo and auto welcome, `im_mark_read_msg` by customer and by business, `im_receive_msg_eu`, `im_referral_msg`, `im_auto_message_audit_update`), API answers for conversation/content lists and auto messages, and `signed(body, secret, t)`. Field names exactly as in the references (lowercase `type` in webhooks, uppercase `message_type` in REST).
- [ ] **E1.3 Auth, signature, parsing.** Tests `test_tiktok_adapter.py`: `test_signature_window` (t+5 ok, t+6 refused, tampered refused, missing part refused), `test_parse_every_event` (one assertion per fixture, D5 mapping, D8 `EuNotice`, D9 `Referral`, button click → `option_id`), `test_business_read_is_ignored`, `test_exchange_and_refresh_payloads`, `test_error_classification`, `test_app_config_requires_all_three`. Red, implement, green. Commit `feat(inbox): parse and verify TikTok webhook events`.
- [ ] **E1.4 Send and media.** Tests: `test_send_text_with_quote`, `test_send_buttons_validates_limits` (4 buttons or a 21-char title raise `ValueError` before any HTTP), `test_upload_then_send_image`, `test_send_action`, `test_fetch_media_uses_x_user_header`. Commit `feat(inbox): send TikTok messages and fetch media`.
- [ ] **E1.5 History and auto-message APIs.** Tests: `test_list_conversations_paginates`, `test_list_messages_encodes_plus`, `test_auto_message_crud_payloads`, `test_webhook_admin_calls`. Commit `feat(inbox): read TikTok history and manage auto messages`.

## E2 Channel, tokens, connect

**Interfaces:**
- Constants (`constants.py`): `TIKTOK_FEATURE = 'inbox.tiktok'`; `CHANNEL_FEATURES = {'whatsapp': WHATSAPP_FEATURE, 'tiktok': TIKTOK_FEATURE}`; `REPLY_WINDOWS = {'whatsapp': timedelta(hours=24), 'tiktok': timedelta(hours=48)}` (replaces `REPLY_WINDOW`); `TIKTOK_MAX_REPLIES = 10`; `TIKTOK_ECHO_SETTLE = timedelta(seconds=30)`; `TIKTOK_STATE_TTL = timedelta(minutes=10)`; `TIKTOK_TOKEN_MARGIN = timedelta(minutes=5)`.
- Channel: `kind` adds `('tiktok', 'TikTok')`; `phone_number_id`, `business_account_id` not required, checked for WhatsApp only. New fields: `tiktok_business_id` (Char, unique), `tiktok_username`, `refresh_token_enc` (secret groups), `token_expires_at`, `refresh_expires_at`, `tiktok_welcome_id` (Char), `tiktok_welcome_audit` (Selection `reviewing|approved|rejected`), `tiktok_bound` (Boolean: relay registration done).
- Identity `channel_kind` adds `tiktok`.
- Methods: `_liwan_tiktok_config() -> AppConfig` (422 `inbox_tiktok_not_configured`); `_liwan_tiktok_store(grant, profile)`; `_liwan_tiktok_credentials() -> Credentials` (row lock, one refresh, `error` state on failure); `_liwan_credentials()` dispatches by kind.
- Routes: `POST /api/v1/inbox/channels/tiktok/connect` → `{authorize_url}`; `GET /api/v1/inbox/tiktok/callback` → 302 to `/settings/apps/inbox/channels/<id>` or `/settings/apps/inbox?tiktok_error=<reason>`. State = base64url JSON `{c, u, ch, n, d, h, x}` (company, user, channel to reconnect or 0, name, department or 0, tenant host, expiry) + `.` + HMAC-SHA256 hex with `client_secret`.

- [ ] **E2.1 Kind and feature.** Tests `test_tiktok_channel.py`: WhatsApp still needs provider ids; TikTok needs `tiktok_business_id` only; create needs `inbox.tiktok`; `tiktok_business_id` unique; counts against `inbox.channels`. Registry entry `inbox.tiktok`; version bump. Commit `feat(inbox): add the TikTok channel kind`.
- [ ] **E2.2 Connect and callback.** Tests `test_tiktok_oauth.py`: signed authorize URL; capability and feature 403; missing config 422; callback creates a connected channel with encrypted tokens; tampered, expired or other-user state refused; missing scope redirects with `inbox_tiktok_scopes_missing`; the same account twice redirects with `inbox_tiktok_account_taken`; reconnect updates the same channel. Commit `feat(inbox): connect a TikTok account with OAuth`.
- [ ] **E2.3 Token refresh.** Tests: refresh once near expiry; concurrent callers refresh once (lock); expired refresh token → `state='error'`, `last_error` asks to reconnect, `UserError` raised. Commit `feat(inbox): refresh TikTok tokens`.

## E3 Webhook

- [ ] **E3.1 Route.** `controllers/tiktok_hooks.py`: `POST /api/v1/inbox/hooks/tiktok`, `type='http'`, `auth='inbox_hook'`, `csrf=False`, `save_session=False`, `@requires_feature(TIKTOK_FEATURE)`. Imports `read_body`, `parse_payload`, `reject_webhook` from `controllers/hooks.py`. Verifies with the app secret; channel `kind='tiktok'`, not disabled, `tiktok_business_id = user_openid`; unknown and bad signature answer the same 403; creates one `liwan.inbox.event`. Allowlist entry in `tools/route_gate_allowlist.json` with the reason "TikTok webhook (machine to machine): TikTok signs every POST with HMAC-SHA256 over the timestamp and raw body using the app secret; the route runs as the inactive inbox hook identity that may only read channels and create raw events."
- [ ] **E3.2 Tests** `test_tiktok_webhook.py`: stored; bad signature 403; unknown business 403 with the same body; 6 s old 403 and 4 s ok; disabled channel 403; feature off 403; body > 1 MB 413. Commit `feat(inbox): receive TikTok webhook events`.

## E4 Inbound

**Interfaces:** conversation fields `provider_conversation_id` (Char, index), `image_send_capable` (Boolean), `referral_source` (Selection `ad|short_link`), `referral_ref` (Char); `_compute_last_inbound` uses `REPLY_WINDOWS[kind]`. `liwan.inbox.event._liwan_process()` dispatches by kind; `_liwan_run_events` leaves TikTok events younger than `TIKTOK_ECHO_SETTLE` pending. `liwan.inbox.inbound._liwan_ingest_tiktok(channel, items, historical=False) -> conversations` in `inbound_tiktok.py`, reusing `_liwan_conversation`, the cycle, CSAT recording and `automation._liwan_run`.

- [ ] **E4.1 Messages.** Identity `address=sender_id`, contact name from `sender_name`, no phone; conversation gets `provider_conversation_id` and, on create, `image_send_capable` (failure → False, logged). Dedupe on `provider_message_id`; media for image/video downloaded in a savepoint (failure on `message.error`); button click fills `selected_option_id`; reactions set `customer_reaction`. Tests `test_tiktok_inbound.py`: text, duplicate, image, media failure, share post, sticker, button click → CSAT score recorded, reaction add and remove. Commit `feat(inbox): ingest TikTok messages`.
- [ ] **E4.2 Echo, read, referral, EU.** Tests: echo of a LiwanOS reply is not duplicated (Review Focus 2); echo from the TikTok app is stored outbound with no author; TikTok auto-welcome echo stored with note; young events wait; customer read marks earlier outbound `read`; referral stored on the conversation; EU notice queues a sync job (needs E6.1: write this test last in E6.2). Commit `feat(inbox): handle TikTok echoes, reads and referrals`.

## E5 Outbound and automation

**Interfaces:**
- `message._liwan_require_window(conversation)`: kind-specific hours in the message; TikTok also enforces `TIKTOK_MAX_REPLIES` (`inbox_tiktok_reply_limit`).
- `message._liwan_check_tiktok_content(conversation, values, attachment)`: allows D3 only, else `inbox_tiktok_unsupported_kind`. Called from `_liwan_queue_free_form` and `_liwan_queue_automated`; `_liwan_queue_template` refuses TikTok.
- `_liwan_provider_send()` TikTok branch: text, image, or `interactive_type == 'button'` with ≤ 3 options → `send_buttons` (card title = body); returns `whatsapp.SendResult(provider_id, held=False)`.
- Typing and read receipts on TikTok use `send_action`; outbound reactions are refused.
- `automation`: on TikTok the welcome is skipped (D10); the CSAT survey goes out as a button card.
- New model `liwan.inbox.tiktok.shortcut` (`_liwan_scope = 'company'`): `channel_id` (required, cascade), `company_id` (related, stored), `kind` (`question|prompt`), `sequence`, `question`, `answer`, `title`, `content`, `provider_id`, `audit` (`draft|reviewing|approved|rejected`), `sync_error`. Channel fields `tiktok_questions_enabled`, `tiktok_prompts_enabled`. Constraints from D10 limits; counts ≤ `MAX_QUESTIONS` / `MAX_PROMPTS` (`inbox_tiktok_auto_message_limit`).
- `channel._liwan_tiktok_push_welcome()`, `shortcut._liwan_push()`, `channel._liwan_tiktok_set_enabled(kind, enabled)` (after enabling, recreates every stored item of that kind), `channel._liwan_tiktok_refresh_audit()`; the `im_auto_message_audit_update` and `im_auto_message_config_update` events call the refresh.
- Routes (`controllers/tiktok_settings.py`, `MANAGE_CHANNELS`): `GET/POST /api/v1/inbox/channels/<id>/tiktok/shortcuts`, `PATCH/DELETE /api/v1/inbox/channels/<id>/tiktok/shortcuts/<sid>`, `POST /api/v1/inbox/channels/<id>/tiktok/shortcuts/enable` `{kind, enabled}`.

- [ ] **E5.1 Free-form replies.** Tests `test_tiktok_send.py`: text to the conversation id with quote; image upload then send; caption or PDF 422; image refused when not capable; template 422; window closed after 48 h; 11th reply 422; retryable error backs off; reconnect needed fails non-retryable. Commit `feat(inbox): send TikTok replies within the window`.
- [ ] **E5.2 Cards, typing, receipts.** Tests: rule reply with 3 buttons goes out as a card; 4 buttons refused when the rule is saved for a TikTok channel; typing and mark-read call `send_action`; outbound reaction 422. Commit `feat(inbox): TikTok button cards, typing and read receipts`.
- [ ] **E5.3 Welcome, away, survey.** Tests: welcome record on a TikTok channel is pushed (≤ 250 chars, text only, else 422) and never sent by LiwanOS; away is sent by LiwanOS; CSAT goes out as a card and a click records the score. Commit `feat(inbox): TikTok automation messages`.
- [ ] **E5.4 Suggested questions and chat prompts.** Tests `test_tiktok_shortcuts.py`: create pushes and stores `provider_id` with `reviewing`; limits 3/6 and lengths 422; editing a `reviewing` item 422 (`inbox_tiktok_auto_message_reviewing`); enabling recreates every stored item; audit event sets `approved`/`rejected`; delete removes at TikTok; another company's manager gets 404. Access rows and record rule for the model. Commit `feat(inbox): manage TikTok suggested questions and chat prompts`.

## E6 History import

**Interfaces:** model `liwan.inbox.tiktok.sync` (`_liwan_scope = 'tenant'` with `owner_company_id`, like events): `channel_id`, `state` (`queued|running|done|failed`), `phase` (`single|stranger|messages`), `cursor` (Integer), `pending_conversation_ids` (Text, JSON list), `conversations_count`, `messages_count`, `error`, `started_at`, `finished_at`. `channel._liwan_tiktok_queue_sync()` (one active job per channel; a second request answers 422 `inbox_tiktok_sync_running`). Cron `ir_cron_inbox_tiktok_sync` every 5 min runs `_liwan_run_step()` on each active job: one page of conversations or up to 10 conversations' messages per step, committing after each step. Messages go through `_liwan_ingest_tiktok(..., historical=True)`; participants' `display_name` fills contact names. Routes: `POST /api/v1/inbox/channels/<id>/tiktok/sync`, `GET /api/v1/inbox/channels/<id>/tiktok/sync` (latest job).

- [ ] **E6.1 Job and cron.** Tests `test_tiktok_sync.py`: connect queues a job; steps walk SINGLE then STRANGER pages then messages; rerun imports nothing twice; imported messages leave conversations closed-or-as-is, unread False, no automation, no bell; provider error marks `failed` with the message; second queue while running 422. Commit `feat(inbox): import TikTok conversation history`.
- [ ] **E6.2 EU notice.** The E4.2 EU test now passes. Commit with E6.1 or `test(inbox): EU TikTok messages trigger an import`.

## E7 API surface and guards

- [ ] **E7.1 Guards.** `helpers.require_kind(channel, kind)` (422 `inbox_channel_kind_unsupported`) in templates, flows, campaigns, business profile, health and catalog-connect routes owned by `liwan_inbox`; `POST /api/v1/inbox/channels` stays WhatsApp only; `/channels/<id>/test` on TikTok calls `business_profile`. WhatsApp-only routes in `liwan_inbox_payments` are listed in the result, not edited. Test `test_tiktok_channel_api.py::test_whatsapp_only_routes_refuse_tiktok` (each 422, no outbound HTTP). 
- [ ] **E7.2 Dumps and contracts.** `dump_channel`: `tiktok_username`, `token_expires_at`, `needs_reconnect`, `tiktok_welcome_audit`, `tiktok_questions_enabled`, `tiktok_prompts_enabled`; WhatsApp-only fields nullable and `null` for TikTok. `serializers/tiktok.py`: `dump_shortcut`, `dump_sync`. Contracts: `InboxChannelKindSchema` adds `tiktok`; `InboxChannelCreateSchema.kind = z.literal('whatsapp')`; new `tiktok.ts` with connect request/response, shortcut, shortcut create/patch, enable, sync schemas. Parity tests against the dumps; `npm test` green.
- [ ] **E7.3 PR 1.** Full `liwan_inbox` tests on a fresh scratch database, `ruff`, `tools/arch_policy.py`, `tools/sudo_gate.py`, `npm test`. Commit `feat(inbox): expose TikTok channels in the inbox API`; open draft PR 1.

## E8 Shared SaaS relay

**Interfaces:**
- `deploy/shared/tiktok-relay.mjs` (Node 24, no dependencies), port `LIWAN_TIKTOK_RELAY_PORT` (default 8090), env `LIWAN_TIKTOK_CLIENT_SECRET`, `LIWAN_TENANT_REGISTRY_PATH`, `LIWAN_SHARED_PROXY_TOKEN`, `LIWAN_TIKTOK_BINDINGS_PATH` (JSON file on a volume, written atomically).
  - Public `POST /tiktok/webhook`: verify signature and age; look up `user_openid`; forward body and `Tiktok-Signature` unchanged to `https://<tenant host>/api/v1/inbox/hooks/tiktok` through the guard; unknown id → 200 and drop (TikTok must not retry forever). Responds after the tenant answers; tenant 5xx → 502 so TikTok retries.
  - Public `GET /tiktok/oauth/callback`: verify the state signature with the client secret; the state's host must be an active registry target; 302 to `https://<host>/api/v1/inbox/tiktok/callback?<same query>`. Anything else → 400 page without echoing input.
  - Internal `PUT /internal/tiktok/bindings/<open_id>` `{tenant_id}` and `DELETE` (header `X-Liwan-Proxy-Token`): `tenant_id` must be an active registry target; an `open_id` bound to another active tenant → 409.
- Odoo side (`channel_tiktok.py`): `_liwan_tiktok_bind()` / `_liwan_tiktok_unbind()` call the relay when `LIWAN_TIKTOK_RELAY_URL` is set (`tiktok_bound` tracks success; a cron retries unbound channels); `redirect_uri` comes from `LIWAN_TIKTOK_REDIRECT_URI` (relay URL in saas, tenant URL in non_saas).
- `deploy/tiktok_webhook.py register|show|delete` uses the three `LIWAN_TIKTOK_*` variables.

- [ ] **E8.1 Relay core.** Tests `tiktok-relay.test.mjs` (node:test): valid event forwarded with unchanged body and header; 6 s old refused; unknown id 200 and nothing forwarded; tenant 500 → 502; OAuth bounce to a registry host; tampered state or unknown host 400. Commit `feat(deploy): relay TikTok events to tenants`.
- [ ] **E8.2 Bindings.** Tests: bind, rebind same tenant idempotent, other tenant 409, tenant removed from registry → its bindings ignored, wrong token 403, file survives restart. Odoo tests: connect binds when the URL is set and not otherwise; delete unbinds; failed bind retried by cron. Commit `feat(inbox): register TikTok accounts with the relay`.
- [ ] **E8.3 Deployment.** Service in `docker-compose.shared.yml` (read-only registry mount, bindings volume), Caddy routes `/tiktok/*` on the platform hooks host to the relay with the existing rate zones, README section, `deploy/tiktok_webhook.py`. Checks: `node --test deploy/shared`, `caddy adapt` test in `deploy/test_*`. Commit `build(deploy): run the TikTok relay in shared hosting`; open draft PR 2.

## E9 Web UI

- [ ] **E9.0 App name.** Rename the inbox application to "رسائل العملاء" / "Customer Messages" in `apps/web/app/modules/inbox/manifest.ts`, `apps/web/app/modules/types.ts`, `i18n/locales/{ar,en}/{inbox,access}.json`, `InboxSidebarPanel.vue`, `InboxWorkspace.vue`, `InboxConversationList.vue`, `packages/ui/app/components/shared/layout/LinkCard.vue` and `DESIGN.md` (the files PR #383 touched); the app icon becomes a neutral messages icon, and `whatsapp.svg` stays as the WhatsApp channel icon. Update `apps/web/app/modules/inbox/__tests__/manifest.test.ts`. Commit `feat(web): name the inbox application Customer Messages`.
- [ ] **E9.1 Connect.** Channels section: "ربط TikTok" (only with `inbox.tiktok`), inline form (name, department), post to connect, `window.location.assign(authorize_url)`; `?tiktok_error=` shows a translated inline error. Unit tests for the call and the error mapping.
- [ ] **E9.2 Channel page.** TikTok tabs: details (username, state, token expiry, "إعادة الربط" when `needs_reconnect`, welcome audit badge), automation (welcome, away, survey: existing form with TikTok limits), shortcuts (questions and prompts list with audit badges, enable switches, create/edit/delete inline), import (latest job state, counts, "استيراد المحادثات"). No health, profile or templates tabs. Unit test: TikTok tab list.
- [ ] **E9.3 Workspace.** Brand icon per kind in the list and header; composer on TikTok offers text, one image and button replies; template, list, link, location, product and reaction controls hidden; window banner says 48 h; the 422 reasons map to translated messages; referral chip on the conversation. Unit tests for the composer action list.
- [ ] **E9.4 Proof and PR 3.** `npm test`, `cd apps/web && npm run lint`, RTL/dark/mobile screenshots on the isolated mock stack (`liwan-design-page` flow), stories updated for every changed component that has one. Commit per sub-task (`feat(web): ...`); open draft PR 3.

## E10 Phase close

- [ ] **E10.1 Isolation.** `test_company_isolation.py::test_tiktok_records_isolated`: channel, conversations, shortcuts, sync jobs and events of company B are 404 and invisible to company A's manager; a webhook for B never lands on A.
- [ ] **E10.2 Reviews.** `tools/jev_review.mjs --base main --task "TikTok channel phase"` if present, plus `odoo-reviewer` on PR 1 and a reviewer on PRs 2–3; fix blocking findings.
- [ ] **E10.3 Live sandbox.** Non-saas topology first (one database, direct webhook), then saas topology with the relay: connect, import history, receive text and image, reply with text, image and a card, survey click, welcome and a suggested question approved by TikTok, read status. Evidence (no tokens) linked from `docs/WORKSPACE.md`.
- [ ] **E10.4** Mark PRs ready in order; merge each only when its `ci-result` is green.
