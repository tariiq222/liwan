# Platform: sign-in, home, notifications, people picker, assistant, feature switches

Pages: `/login`, home `/`, `/work`, `/apps`, `/apps/[id]`, `/search`, `/notifications`, `/ai`, the bell and the
assistant sheet in the header. Owners: `liwan_notify`, `liwan_directory`, `liwan_ai`, `liwan_pmo_ai`,
`liwan_platform`, and the Nuxt server routes `apps/web/server/api/auth`, `apps/web/server/api/ai/runs`.
Personas and status values: [README](README.md). Rows of the Covers column name what the row exercises; a row with no
token exercises a surface the coverage tool does not list (Nuxt server routes, control-plane routes).

Code checked 2026-10-28. Refusal codes are the ones the code raises; a UI string in «» is quoted from
`apps/web/i18n/locales/ar`.

## Sign-in and session

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PLT-02 | Unauthenticated visitor lands on login | visitor | `/login` | `page /login` | fail | #133; `e2e/tests/smoke.e2e.ts`; 2026-10-28 run failed only because the default agent model is paid-only |
| PLT-22 | `next` points to another site or to a page the user cannot reach | staff1 | Ignored: lands on `/` | `page /login` | fail | #192; next=https://evil.example and //evil.example -> `/` (ok), next=/apps -> /apps (ok), but next=/finance/partners for staff1 (no finance) lands on /account, not `/`; see findings/platform.md; `safeReturnTo` allow-list plus `canReachPath` |
| PLT-31 | Sign out while Odoo is unreachable | staff1 | 502 `logout_failed`; the browser cookie is kept (fail closed), the user is told it failed | `page /login` | planned | round 3: needs Odoo stopped, which the shared stack does not allow |
| PLT-33 | Many wrong passwords in a row | visitor | Expected policy: lockout or delay | `page /login` | decision | private security advisory GHSA-9xq5-v9r4-xfxc; No throttle or lockout found in `apps/web/server` or `liwan_platform`; the edge may enforce one. Owner to decide |
| PLT-35 | Session expires while a form is open | staff1 | Next request 401 `unauthorized`; the user is sent to `/login?next=` the current page and the draft guard still protects unsaved input | `page /login` | fail | round 2: with a task form (/tasks/new) filled and cookies cleared, pressing «إنشاء» stays on the page with «حدث خطأ غير متوقع» and «ليس لديك صلاحية لتنفيذ هذا الإجراء»; no redirect to /login?next (see #177); #177; Partly seen: cookie cleared + navigation goes to /login?next=/work; API after session loss answers 403 session_required (not 401); draft-guard part not run |

## Home `/`

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PLT-47 | Nothing to do but applications exist | staff2 | Empty state «لا شيء لك اليوم. تصفّح التطبيقات لتبدأ.» with button «التطبيقات» | `page /`, `page /` | fail | #240; round 3: jeddah_staff (no work) sees quick actions + «لا شيء عاجل الآن.», never the empty state; it only renders when there are no quick actions and no services, which no employee reaches; see findings3/platform.md |
| PLT-49 | Identity without a capability list | visitor | `/` redirects to the first allowed path instead of rendering | `page /` | planned | round 3: needs an identity without a capability list; not producible from the UI; `navigateTo(postLoginPath(...))` at the top of `index.vue` |

## My work `/work` («مهامي»)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## Applications launcher: cards on `/`, start pages at `/apps/[id]`

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PLT-71 | Search an application | ceo | The home cards carry no search box (searching applications is the command palette's job); the palette finds an application by name | `page /` `page /search` | planned | dropped 2026-11-06: `apps/index.vue` was removed in dbff755ba («put the applications on the home page») and `HomeApps.vue` states «Search is the global palette's job», so the card filter and its «لا يوجد تطبيق بهذا الاسم.» text no longer exist; re-scoped to the palette, not run yet |
| PLT-72 | Nothing available | visitor | «لا توجد تطبيقات متاحة لحسابك حاليًا.» | `page /` | planned | round 3: not producible; every internal user has chat on /apps |

## Global search `/search`

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PLT-84 | Search partners and invoices | cfo | Groups for finance partners (VAT shown as caption) and invoices | `page /search` | fail | #240; round 3: groups «العملاء والموردون» and «الفواتير» appear for cfo but the VAT caption (and invoice partner caption) is never drawn; see findings3/platform.md; `finance-partners`, `finance-invoices` |
| PLT-89 | A provider fails | staff1 | That group shows «تعذّر البحث. اختر للمحاولة مجددًا.»; retry works; other groups still show | `page /search` | fail | #240; round 3: failure simulated on a client navigation; group shows generic «حدث خطأ غير متوقع» + retry (retry works), not «تعذّر البحث. اختر للمحاولة مجددًا.»; see findings3/platform.md |
| PLT-92 | Navigation shortcut key | staff1 | A page shortcut letter typed on an empty field navigates | `page /search` | fail | #191; Z on empty search field types «Z» (q=Z): the field is autofocused and the shortcut ignores editable targets; works only after blur (/projects/dashboard); see findings; `findSearchShortcut` |

## Notification list API (bell)

Kinds registered in `liwan.notify.registry`: `tasks.assigned` (feature `tasks.enabled`); `assignment`, `comment`,
`mention`, `deadline`, `overdue_digest` (live), `charter_review`, `charter_approved`, `charter_returned` (feature
`pmo.enabled`); `meeting_invite`, `meeting_series_invite`, `meeting_resolution`, `meeting_converted`, `meeting_changed`,
`meeting_cancelled`, `meeting_reminder`, `meeting_resolution_overdue` (feature `meetings.enabled`).

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PLT-04 | Bell row of a record that became unreadable or an app switched off | staff1 | Row hidden and cannot be marked read | `GET /api/v1/notifications`, `POST /api/v1/notifications/<id>/read` | fail | #219; exclusive phase, pmo.enabled off with no retained read: staff1 POST /notifications/308/read (a pmo comment row) is refused 403 feature_not_included, but GET /notifications still lists all 58 rows including the 17 pmo rows (assignment, comment, deadline); the rows are not hidden, see findings; Code check: mark-read of a switched-off application is refused 403 `feature_not_included` (`notify_service.py` `_liwan_mark_read`); hiding of a still-readable record is decided by the owners' domains, so confirm the list really hides a row when only the feature is off |
| PLT-107 | Signed out | visitor | 401, no body of rows | `GET /api/v1/notifications` | fail | #177; Signed out GET /api/v1/notifications answers 403 session_required (Nuxt gate), not 401; see findings |
| PLT-114 | Mention in a comment | staff1 | `mention` row «أشار إليك في تعليق»; appears under filter «الإشارات» | `GET /api/v1/notifications` | fail | #241; round 3: mention row «أشار إليك في تعليق» appears under «الإشارات» but its body is «*@يوسف المالكي* راجع هذه المهمة» with markdown asterisks; a comment without the @token yields a plain comment row; see findings3/platform.md |
| PLT-117 | Digest hides once every task in it is done | pm | Row disappears and `total` and `unread_count` drop | `GET /api/v1/notifications` | planned | round 3: not re-run; round 2: digest count drops live when its project is archived (4 to 2); full "all tasks done" case not run; `_liwan_visible_count` re-checks live kinds |
| PLT-119 | Charter review row after the decision | ceo | Row disappears once the charter is no longer `submitted` or the user is not the sponsor | `GET /api/v1/notifications` | planned | round 3: needs a decision on a project of another agent; not run |
| PLT-120 | Charter approved / returned | pm | Project manager gets `charter_approved` «اعتُمد الميثاق» or `charter_returned` «أُعيد الميثاق للتعديل» | `GET /api/v1/notifications` | planned | round 3: pm has 4 «اعتُمد الميثاق» rows (approved seen); «أُعيد الميثاق للتعديل» not observed |
| PLT-121 | Meeting kinds | staff1 | Invite, series invite, changed, cancelled, reminder, resolution, resolution overdue, converted each produce a row opening `/meetings/{id}` | `GET /api/v1/notifications` | planned | round 3: other meeting kinds belong to meetings.md; round 2: invite and reminder rows seen for staff1 and staff2 (plt-r2 meeting) with titles «دعوة لاجتماع» and «تذكير باجتماع قادم»; other kinds belong to meetings.md; One scenario per kind in meetings.md; here only the bell rendering |
| PLT-122 | Meeting row hidden without `meetings.read` or after cancelling the series | staff1 | Row not listed | `GET /api/v1/notifications` | planned | round 3: belongs to meetings data; not run; `readable_active_meeting_ids` |
| PLT-125 | A kind without a serializer | staff1 | Not reachable through the UI: a registered kind with no owner serializer raises a server error | `GET /api/v1/notifications` | decision | #167; `LiwanNotifyRegistry._liwan_notify_dump` raises `ValueError`; confirm a guard test exists for every registered kind |

## Notification actions

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PLT-136 | Read all skips rows whose application is write-blocked | staff1 | Those rows stay unread; no error | `POST /api/v1/notifications/read-all` | planned | round 3: needs a write-blocked application (tenant state), not changed; `_liwan_mark_all_read` swallows `LiwanAccessRule` per row |
| PLT-137 | Read all on a read-only tenant | staff1 | `{updated: 0}` (every row skipped), no error | `POST /api/v1/notifications/read-all` | fail | #221; exclusive phase, expired: POST /notifications/read-all answers 403 tenant_read_only (the write guard stops it) instead of {updated: 0}; Unlike mark-one, which answers 403 `tenant_read_only` |
| PLT-138 | Read all does not touch hidden rows | staff1 | A hidden unread row is still unread when it becomes visible again | `POST /api/v1/notifications/read-all` | planned | round 3: read-all would consume shared persona rows; no dedicated recipient |

## Notifications page `/notifications`

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PLT-148 | Load failure and next-page failure | staff1 | «تعذر تحميل الإشعارات» with «إعادة المحاولة»; list kept when only the next page failed | `page /notifications` | fail | #241; round 3: first-page failure shows «حدث خطأ غير متوقع» + retry (retry works); next-page failure keeps the list but shows the raw English ofetch text with the API path; see findings3/platform.md |
| PLT-150 | Unknown kind from a future application | staff1 | Generic row «إشعار» with title and body only | `page /notifications` | planned | round 3: no future kind can be produced from the stack; client injection did not render; `notifications.preview.other` |

## People picker

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PLT-165 | Vendor support accounts | it_admin | Expected: a vendor support user is not offered as a colleague | `GET /api/v1/people` | decision | private security advisory GHSA-9xq5-v9r4-xfxc; The domain does not exclude `liwan_core.group_vendor_support` users, although user counting does (`liwan_directory/models/directory.py:27`, `entitlement_service.py` `_liwan_excluded_user_ids`). Owner to confirm |
| PLT-169 | Suspended tenant or signed out | visitor | 403 `tenant_suspended` / 401 | `GET /api/v1/people` | fail | exclusive phase: suspended tenant with a live session answers 403 tenant_suspended (ok), but a signed-out caller gets 403 session_required (Nuxt layer, same with the tenant active), not the 401 the row expects; #177 |

## Assistant: catalog, limits, audit

Tools registered today: one agent per application bridge (`liwan_pmo_ai` with six `pmo.*` tools, and read tools in
`liwan_hr_ai`, `liwan_crm_ai`, `liwan_meetings_ai`, `liwan_tasks_ai`, `liwan_operations_ai`, `liwan_finance_ai`); one
conversation routes each request to the agent that owns it. Capability `ai.use` is granted by the built-in
employee role (`liwan_ai/models/access_service.py`); entitlements `ai.enabled` (flag), `ai.messages.monthly` and
`ai.tool_calls.per_run` (limits).

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PLT-06 | Assistant lists my tasks and summarizes a project | staff1 | Answers from the user's own data only | `page /ai` | planned | needs AI model key (service not configured) |
| PLT-07 | Assistant changes a task state: approve the confirmation card / reject it | staff1 | Approve applies, reject leaves the task unchanged; audit shows proposed / approved / rejected | `page /ai` | planned | needs AI model key (service not configured) |
| PLT-08 | Assistant drafts a project; leave the page without saving | ceo | Draft card opens `/projects/new`; leaving counts as rejection | `page /ai` | planned | needs AI model key (service not configured) |
| PLT-179 | Monthly message limit reached | staff1 | 403 `feature_not_included`, `details.limit_key=ai.messages.monthly`; page shows «وصلت شركتك إلى حد رسائل LiwanOS AI لهذا الشهر.» and the AI service is not called | `POST /api/v1/ai/audit`, `page /ai` | planned | round 3: needs the monthly limit set (tenant state); `AiLimitNotice` |
| PLT-180 | Usage meter | staff1 | «{used} من {limit} رسالة هذا الشهر» matches the audit count | `page /ai` | planned | round 3: needs the monthly limit set (tenant state) |
| PLT-181 | No monthly limit set | staff1 | Unlimited: no fence is taken and no meter is shown | `POST /api/v1/ai/audit` | planned | round 3: needs AI model key; `_liwan_limit_value` is `None` |
| PLT-192 | Tool audit without the tool's capability or feature | staff1 | 403 «You do not have access to the tool ...» / «The feature of the tool ... is not available.» | `POST /api/v1/ai/audit` | fail | #221; exclusive phase, pmo.enabled off: staff1 POST /ai/audit for pmo.list_projects answers 403 feature_not_included details.feature pmo.enabled from the route gate; the expected text «The feature of the tool ... is not available.» is only in the ORM path and is unreachable over HTTP, see findings; round 2: capability variant confirmed again; feature variant needs an app switched off (exclusive phase); staff1 draft audit for pmo.draft_project: 403 «You do not have access to the tool pmo.draft_project.»; feature message not run |
| PLT-193 | Audit rows are private | staff2 | A user only sees their own audit rows; access auditors see their company's | `POST /api/v1/ai/audit` | planned | round 3: no read route for audit rows in the UI/API; Record rules on `liwan.ai.audit` |
| PLT-194 | Usage rows: happy path | staff1 | 1 to 64 items; each returns its stored row; `total` equals the count | `POST /api/v1/ai/usage` | planned | /api/v1/ai/usage is server-only (SERVER_ONLY_API_PATHS in api/v1/[...path].ts): browser gets 404, not testable from the UI |
| PLT-195 | Usage body shape | staff1 | Missing or empty `items`, more than 64 items, non-object item: 422 `invalid`; extra top-level key: 422 `unknown_field` | `POST /api/v1/ai/usage` | planned | server-only route, browser 404 |
| PLT-196 | Usage field rules | staff1 | `kind` plan or title; `provider` matches `[a-z][a-z0-9_-]{0,31}`; `model` 1 to 128 chars without control characters; `outcome` ok, failed, retried, aborted; every field required; error field is `items.N.field` | `POST /api/v1/ai/usage` | planned | server-only route, browser 404 |
| PLT-197 | Token counts | staff1 | Both or neither of input and output tokens; each 0 to 100 000 000; unreported stored as 0 with `tokens_reported=false` | `POST /api/v1/ai/usage` | planned | server-only route, browser 404 |
| PLT-198 | `called_at` | staff1 | RFC 3339 with an offset; more than 5 minutes in the future: 422 | `POST /api/v1/ai/usage` | planned | server-only route, browser 404 |
| PLT-199 | Usage is never limited | staff1 | Writes succeed even when the monthly message limit is reached (the calls already happened) | `POST /api/v1/ai/usage` | planned | server-only route, browser 404 |

## Assistant: runs, tools, cards (Nuxt `/api/ai/runs`)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PLT-210 | Empty conversation page | staff1 | Greeting «أهلًا {name}», «كيف أساعدك في عملك اليوم؟», starter chips «أسئلة للبدء», note «يقترح ويوضّح فقط، ولا يعتمد أو يرسل أي شيء عنك.» | `page /ai` | planned | AI service not configured: /ai shows only the unavailable message |
| PLT-211 | «صباحك باختصار» | pm | Attention rows, urgent ones tagged «عاجل» | `page /ai` | planned | round 3: AI model key absent (service answers 503 ai_unavailable) |
| PLT-212 | Start a run | staff1 | POST body validated (`message` required); a new run id `r_...` is created, the message is audited, then the service streams the answer | `page /ai` | planned | round 3: AI model key absent (service answers 503 ai_unavailable); Invalid body: 422 invalid field message; real run answers 503 ai_unavailable (no AI service/model key), so run start not testable; `index.post.ts`; invalid body: 422 `invalid` with the failing field |
| PLT-214 | Read tool call | staff1 | Question «ما مهامي المتأخرة؟» runs `pmo.list_my_tasks`; trace shows the tool; the answer lists only the user's tasks; audit `read / ok` | `page /ai` | planned | round 3: AI model key absent (service answers 503 ai_unavailable) |
| PLT-215 | Read tool result is whitelisted | staff1 | Only the `result_summary` fields reach the model; larger than 200 000 bytes becomes `result_too_large` | `page /ai` | planned | round 3: AI model key absent (service answers 503 ai_unavailable); `summarizeResult` |
| PLT-216 | `pmo.list_projects` with `q` | pm | At most 50 rows, only projects the user can read | `page /ai` | planned | round 3: AI model key absent (service answers 503 ai_unavailable) |
| PLT-217 | `pmo.get_project` for a project the user cannot read | staff2 | Tool result is an error, audit row `denied` (403) or `failed`, the model says it cannot show it | `page /ai` | planned | round 3: AI model key absent (service answers 503 ai_unavailable); Result is `denied` when the status is 403 |
| PLT-218 | `pmo.get_project_finance_summary` | cfo | Budget, spent, remaining as the server computes them; the model never recalculates | `page /ai` | planned | round 3: AI model key absent (service answers 503 ai_unavailable) |
| PLT-219 | Tool input validation | staff1 | A tool call with an extra or wrong-typed argument is refused before Odoo is called | `page /ai` | planned | round 3: AI model key absent (service answers 503 ai_unavailable); `additionalProperties: false` in every schema |
| PLT-220 | Unknown tool or wrong kind from the model | staff1 | Answered as `unknown_tool` («... is not in the catalog» / «is not a ... tool of the catalog») without calling Odoo | `page /ai` | planned | round 3: AI model key absent (service answers 503 ai_unavailable) |
| PLT-221 | Tool outside the user's catalog | staff1 | A model request for `pmo.draft_project` (no `pmo.projects.create`) is `unknown_tool` | `page /ai` | planned | round 3: AI model key absent (service answers 503 ai_unavailable) |
| PLT-222 | Confirm card for `pmo.update_task_state` | staff1 | Card «يحتاج تأكيدك» with «نفّذ» / «لا تنفّذ»; nothing changes before a decision | `page /ai` | planned | round 3: AI model key absent (service answers 503 ai_unavailable); `AiConfirmCard` |
| PLT-223 | Approve | staff1 | Run is claimed once, the task transition runs as the user, card shows «نُفّذ بعد تأكيدك», the model continues, audit `write_light / ok` | `page /ai` | planned | round 3: AI model key absent (service answers 503 ai_unavailable) |
| PLT-224 | Reject | staff1 | Card shows «أُلغي»; the task is unchanged; no write audit row (Odoo accepts `rejected` for drafts only) | `page /ai` | planned | round 3: AI model key absent (service answers 503 ai_unavailable) |
| PLT-225 | Approve twice (two tabs) | staff1 | Second approval: 409 «this call was already claimed»; executes nothing | `page /ai` | planned | round 3: AI model key absent (service answers 503 ai_unavailable) |
| PLT-226 | Approve a transition the task state forbids | staff1 | Upstream 422/409 becomes a tool error; the model reports it; audit `failed` | `page /ai` | planned | round 3: AI model key absent (service answers 503 ai_unavailable) |
| PLT-227 | Approve without `pmo.tasks.write` | staff1 | Tool not in the catalog; if forced, upstream 403 gives audit `denied` | `page /ai` | planned | round 3: AI model key absent (service answers 503 ai_unavailable) |
| PLT-228 | Page closed while a write is claimed | staff1 | The claimed write still executes and resumes; card text «بدأ تنفيذه من طلب سابق. حدّث الصفحة بعد قليل لتعرف نتيجته.» | `page /ai` | planned | round 3: AI model key absent (service answers 503 ai_unavailable); `shield = null` in `resume.post.ts` |
| PLT-229 | Resume validation | staff1 | Missing `call_id` or invalid `decision`: 422; `data` not an object: 422 field `data`; unknown run: 404 `not_found`; `call_id` different from the service's pending call: 409; run executing a claimed call: 409 | `page /ai` | planned | round 3: 422 verified for missing call_id, invalid decision and non-object data; unknown run and 409 cases need the AI service (503 ai_unavailable) |
| PLT-230 | Retry a stalled read | staff1 | `approved` re-runs the read; `rejected` is 409 «a read tool can only be retried» | `page /ai` | planned | round 3: AI model key absent (service answers 503 ai_unavailable) |
| PLT-231 | Write executed but resume to the service fails | staff1 | Stream shows `resume_failed` «نُفّذ الإجراء لكن تعذّر على المساعد إكمال الرد.» then `done: failed` | `page /ai` | planned | round 3: AI model key absent (service answers 503 ai_unavailable) |
| PLT-232 | Write executed but audit save fails | staff1 | `audit_failed` «نُفّذ الإجراء لكن تعذّر حفظ سجل التدقيق.» | `page /ai` | planned | round 3: AI model key absent (service answers 503 ai_unavailable) |
| PLT-233 | Draft card | ceo | «جهّزتُ مسودة» with hint, «افتح المسودة» opens `/projects/new` prefilled (name, dates, charter fields); «تجاهل المسودة» rejects; audit `proposed` on show | `page /ai` | planned | round 3: AI model key absent (service answers 503 ai_unavailable) |
| PLT-234 | Draft submitted after review | ceo | Saving the real form audits `approved` with `attested=true` and the approved payload | `page /ai` | planned | round 3: AI model key absent (service answers 503 ai_unavailable) |
| PLT-235 | Draft ignored | ceo | Audit `rejected`; nothing created | `page /ai` | planned | round 3: AI model key absent (service answers 503 ai_unavailable) |
| PLT-236 | Draft input limits | ceo | `name` 1 to 255, text fields up to 4000, up to 10 objectives of 500 chars, dates `YYYY-MM-DD` | `page /ai` | planned | round 3: AI model key absent (service answers 503 ai_unavailable); `PMO_AI_TOOLS` schema |
| PLT-237 | Step limit | staff1 | After 12 steps: «توقف هذا الطلب لأنه تجاوز عدد الخطوات المسموح.» | `page /ai` | planned | round 3: AI model key absent (service answers 503 ai_unavailable) |
| PLT-238 | Tool-call budget | staff1 | Default 8 calls per run, the `ai.tool_calls.per_run` limit otherwise, never above 50 | `page /ai` | planned | round 3: AI model key absent (service answers 503 ai_unavailable); `toolCallBudget` |
| PLT-239 | Run timeout | staff1 | After 120 s: «استغرق الطلب وقتًا أطول من المسموح.» | `page /ai` | planned | round 3: AI model key absent (service answers 503 ai_unavailable) |
| PLT-240 | AI service down | staff1 | 503 `ai_unavailable`; page shows «LiwanOS AI غير متاح الآن. حاول لاحقًا.» | `page /ai` | planned | round 3: AI model key absent (service answers 503 ai_unavailable); No AI service configured: POST /api/ai/runs 503 ai_unavailable; /ai shows «LiwanOS AI غير متاح الآن. حاول لاحقًا.» |
| PLT-241 | Model provider error | staff1 | «تعذّر الاتصال بنموذج الذكاء. حاول لاحقًا.» | `page /ai` | planned | round 3: AI model key absent (service answers 503 ai_unavailable) |
| PLT-242 | Decision could not be saved | staff1 | «تعذّر حفظ قرارك. حاول مرة أخرى.» | `page /ai` | planned | round 3: AI model key absent (service answers 503 ai_unavailable) |
| PLT-243 | History list | staff1 | Groups «اليوم» «آخر 7 أيام» «أقدم»; search «ابحث في المحادثات»; no match «لا محادثات مطابقة»; empty «لا محادثات بعد»; privacy line «محادثاتك خاصة بك. المساعد يرى فقط ما تملك صلاحية رؤيته.» | `page /ai` | planned | round 3: AI model key absent (service answers 503 ai_unavailable) |
| PLT-244 | Status badges in history | staff1 | «بانتظار قرارك» for a pending card, «تعذّر إكمالها» for a failed run, «محادثة بلا عنوان» when unnamed | `page /ai` | planned | round 3: AI model key absent (service answers 503 ai_unavailable) |
| PLT-245 | Rename | staff1 | «تغيير الاسم» accepts 1 to the maximum characters without newlines, else «الاسم من حرف واحد إلى {max} حرفًا وبلا أسطر جديدة.»; announces «تم تغيير اسم المحادثة» | `page /ai` | planned | round 3: AI model key absent (service answers 503 ai_unavailable); PATCH `/api/ai/runs/{id}` 422 `invalid` on bad body |
| PLT-246 | Archive and restore | staff1 | «أرشفة» removes it from «المحادثات», it appears under «المؤرشفة» (empty text «لا محادثات مؤرشفة»); «إلغاء الأرشفة» brings it back | `page /ai` | planned | round 3: AI model key absent (service answers 503 ai_unavailable); `?archived=true`; other value: 422 |
| PLT-247 | Runs are private | staff2 | Another user's run id: 404 `not_found` on GET, PATCH and resume | `page /ai` | planned | round 3: AI model key absent (service answers 503 ai_unavailable); Owner is `(tenant, user)` |
| PLT-248 | Run API errors | staff1 | Service 404: 404 `not_found`; other upstream failure: 502 `ai_upstream`; run answered for another run id: 502 | `page /ai` | planned | round 3: without the AI service every run route answers 503 ai_unavailable, not 404/502 |
| PLT-249 | Arabic and English answers | staff1 | The run uses the `liwan-locale` cookie (`runLocale`) | `page /ai` | planned | round 3: AI model key absent (service answers 503 ai_unavailable) |
| PLT-250 | Assistant sheet in the header | staff1 | Same conversation, block «في هذه الصفحة الآن» (hide/show), empty text «لا شيء يحتاج انتباهك في هذه الصفحة.»; context chip names the current page | `page /ai` | planned | AI service not configured: sheet opens with the unavailable message only; One of the four overlay exceptions in DESIGN.md |
| PLT-251 | Starter «ما اجتماعاتي القادمة؟» | staff1 | Expected: the assistant can answer from meetings | `page /ai` | gap | #157; The starter is static (`utils/aiSuggestions.ts`) but no meetings tool is registered; only `pmo.*` tools exist, so tasks personal, HR, finance and meetings have none |
| PLT-252 | Assistant never acts without confirmation | staff1 | No write tool runs without an approved card; drafts write nothing | `page /ai` | planned | round 3: AI model key absent (service answers 503 ai_unavailable); Note on the page: «يقترح ويوضّح فقط...» |

## Feature switches, locale and layout

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PLT-10 | Switch an application off in the plan | vendor / it_admin | Its menu, pages, routes and bell rows disappear; data kept and back when switched on | `page /` | planned | round 3: feature switch; tenant state not changed |
| PLT-261 | Direct URL of a switched-off application | staff1 | 403 page «لا تملك صلاحية فتح هذه الصفحة» | `page /apps/[id]` | planned | round 3: feature switch; tenant state not changed; `canReachPath` |
| PLT-262 | API call to a switched-off application | staff1 | 403 `feature_not_included` with `details.feature` | `GET /api/v1/notifications` | planned | round 3: feature switch; tenant state not changed |
| PLT-263 | Retained (read-only) application after a downgrade | staff1 | Existing data readable, every write refused 403 `feature_not_included`; the home and `/apps` still show it | `page /` | planned | round 3: tenant downgrade state; not changed; `_liwan_feature_read` is true for `retained` keys, `_liwan_feature_write` is not; see SAAS-19 |
| PLT-264 | Application not installed at all | staff1 | Treated as off: never offered, no error page for the rest | `page /` | planned | round 3: needs an uninstalled application; not changeable here; `_liwan_owner_installed` |
| PLT-269 | Keyboard use | staff1 | Row navigation in `/notifications` and `/search` works with the arrow keys; focus visible; dialogs trap focus | `page /notifications` | fail | #240; round 3: arrows do nothing; j/k move focus between /notifications rows (3px outline) and Enter opens; /search has no row navigation; Ctrl+K dialog traps Tab; see findings3/platform.md; `useRowNavigation` |
| PLT-271 | Rail link accessible names match their visible labels | staff1 | Screen readers and voice control announce the same name the rail shows | `page /` | fail | #137; Found 2026-10-28 by `e2e/tests/access-matrix.e2e.ts`: «الموظفين» is announced «الموارد البشرية» and «المساعد» «LiwanOS AI» (`packages/ui/app/components/shell/ModuleRail.vue:43` uses `labelKey` for `aria-label`); WCAG 2.5.3 label in name |
| PLT-272 | Odoo's own web client stays closed while the session route stays open | visitor | The Odoo session route answers 200 and sets a session; /web/login, /web/dataset/call_kw, /json/2 and /doc answer 404 | `page /login` | planned | The contract lives in `liwan_platform/models/ir_http.py` (`OPEN_ROUTES`/`OPEN_PREFIXES`): the Nuxt login posts to the session route, every other Odoo client path is a 404. Found while auditing the inbox (F-QA-23) |
