# Platform: sign-in, home, notifications, people picker, assistant, feature switches

Pages: `/login`, home `/`, `/work`, `/apps`, `/apps/[id]`, `/search`, `/notifications`, `/ai`, the bell and the
assistant sheet in the header. Owners: `webvue_notify`, `webvue_directory`, `webvue_ai`, `webvue_pmo_ai`,
`webvue_platform`, and the Nuxt server routes `apps/web/server/api/auth`, `apps/web/server/api/ai/runs`.
Personas and status values: [README](README.md). Rows of the Covers column name what the row exercises; a row with no
token exercises a surface the coverage tool does not list (Nuxt server routes, control-plane routes).

Code checked 2026-10-28. Refusal codes are the ones the code raises; a UI string in «» is quoted from
`apps/web/i18n/locales/ar`.

## Sign-in and session

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PLT-01 | Login page shows the company name and logo | visitor | Company branding | `page /login` | manual 2026-10-28 | Title «شركة نخبة الأعمال للتقنية» |
| PLT-02 | Unauthenticated visitor lands on login | visitor | `/login` | `page /login` | fail | #133; `e2e/tests/smoke.e2e.ts`; 2026-10-28 run failed only because the default agent model is paid-only |
| PLT-13 | Correct username and password | staff1 | Session cookie set, lands on `/` (first reachable page when the identity has no capability list) | `page /login`, `page /` | planned | `postLoginPath` in `app/utils/accessPolicy.ts` |
| PLT-14 | Wrong password for an existing user | staff1 | Alert «بيانات الدخول غير صحيحة» (Nuxt POST /api/auth/login answers 401 `invalid_credentials`), still on `/login`, no session cookie | `page /login` | planned | |
| PLT-15 | Unknown username | visitor | Same alert and same 401 as a wrong password; nothing tells the two apart | `page /login` | planned | `server/api/auth/login.post.ts` |
| PLT-16 | Archived (inactive) user with the right password | visitor | Same alert «بيانات الدخول غير صحيحة» | `page /login` | planned | Odoo authenticate fails for `active=False` |
| PLT-17 | Submit with an empty username, then an empty password | visitor | Inline «أدخل اسم المستخدم» / «أدخل كلمة المرور» under the field; no request is sent | `page /login` | planned | The server also answers 400 `missing_credentials`, shown as «تعذّر تسجيل الدخول» |
| PLT-18 | Correct password on a suspended tenant | visitor | 403 `tenant_suspended`; alert «اشتراك شركتك موقوف حاليًا، لذلك لا يمكن تسجيل الدخول. تواصل مع مسؤول شركتك.» | `page /login` | planned | Needs a suspended tenant profile (see SAAS-14, gap in how it is set) |
| PLT-19 | Wrong password on a suspended tenant | visitor | Still «بيانات الدخول غير صحيحة», never the suspension message | `page /login` | planned | `WebVueTenantSuspended` is raised only after the password checked out (comment in `login.post.ts`) |
| PLT-20 | Tenant suspended while a tab is open | staff1 | Next API call answers 403 `tenant_suspended`, Odoo ends the session, the app goes to `/login?reason=tenant_suspended` and shows «اشتراك شركتك موقوف حاليًا…» | `page /login` | planned | `entitlement_service.py` `_webvue_guard_api`; the toast text is `errors.codes.tenant_suspended` |
| PLT-21 | Visit a protected page signed out, then sign in | accountant | `/login?next=/finance/partners`; after login the user lands on `/finance/partners` | `page /login` | planned | |
| PLT-22 | `next` points to another site or to a page the user cannot reach | staff1 | Ignored: lands on `/` | `page /login` | planned | `safeReturnTo` allow-list plus `canReachPath` |
| PLT-23 | Signed-in user opens `/login` | staff1 | Redirected to `/` | `page /login` | planned | `auth.global.ts` |
| PLT-24 | `/login?login=staff1` | visitor | Username prefilled only; control characters removed; cut at 128 characters; password never prefilled | `page /login` | planned | The invitation page links here after success |
| PLT-25 | Account with TOTP: right password | it_admin | Password form is replaced by «رمز التحقق» with the hint about the 6-digit authenticator code; the cookie holds a pre-login only | `page /login` | planned | Needs TOTP enrolled for the account first |
| PLT-26 | TOTP step: correct code | it_admin | Signed in, lands on `/` | `page /login` | planned | |
| PLT-27 | TOTP step: wrong code | it_admin | «رمز التحقق غير صحيح»; stays on the TOTP form | `page /login` | planned | |
| PLT-28 | TOTP step: empty code | it_admin | Inline «أدخل رمز التحقق» | `page /login` | planned | |
| PLT-29 | TOTP step on a tenant suspended meanwhile | it_admin | «اشتراك شركتك موقوف حاليًا…» instead of the invalid-code text | `page /login` | planned | `submitTotp` maps `tenant_suspended` |
| PLT-30 | Sign out from the account settings (button «تسجيل الخروج») | staff1 | Odoo session destroyed, cookie dropped (204); protected pages send the user to `/login` | `page /login` | planned | `server/api/auth/logout.post.ts` |
| PLT-31 | Sign out while Odoo is unreachable | staff1 | 502 `logout_failed`; the browser cookie is kept (fail closed), the user is told it failed | `page /login` | planned | |
| PLT-32 | Login or logout POST that is cross-site or not JSON | visitor | 403 `cross_site_request` / 415 `unsupported_media_type`; no cookie set | `page /login` | planned | `server/utils/same-site.ts`; API-level check |
| PLT-33 | Many wrong passwords in a row | visitor | Expected policy: lockout or delay | `page /login` | decision | private security advisory GHSA-9xq5-v9r4-xfxc; No throttle or lockout found in `apps/web/server` or `webvue_platform`; the edge may enforce one. Owner to decide |
| PLT-34 | Signed-out visit to `/invite/accept` | visitor | Opens without a session (the middleware skips it) | `page /invite/accept` | planned | Detail in SAAS-60 to SAAS-70 |
| PLT-35 | Session expires while a form is open | staff1 | Next request 401 `unauthorized`; the user is sent to `/login?next=` the current page and the draft guard still protects unsaved input | `page /login` | planned | |

## Home `/`

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PLT-40 | Greeting and date | staff1 | «أهلًا {first name}» followed by today's date in the browser locale (drawn after mount, no hydration mismatch) | `page /` | planned | |
| PLT-41 | Work indicators «مؤشراتي» | staff1 | Counts «للتنفيذ» «للقرار» «للمتابعة» match `/work` | `page /`, `page /work` | planned | `HomeIndicators` |
| PLT-42 | «ابدأ بالأهم» lists the most urgent items | pm | Urgent rows first, each opens its record; «عرض الكل» opens `/work` | `page /`, `page /work` | planned | `HomeFocus` |
| PLT-43 | «ابدأ بالأهم» with nothing urgent | staff2 | «لا شيء عاجل الآن.» | `page /` | planned | |
| PLT-44 | «الوصول السريع» create buttons depend on capability | ceo | One pill per create command the user may run (project, task, ...), each opens its `/new` panel with `returnTo=/` | `page /` | planned | `visibleCommands`; compare ceo, staff1, accountant |
| PLT-45 | Self-service button «الخدمة الذاتية» | staff1 | Shown only when the user has personal services (leave, custody, ...); opens `/account` | `page /`, `page /account` | planned | `personalEntries` |
| PLT-46 | Assistant suggestions block | staff1 | Shown when `ai.enabled` and `ai.use` allow it; hidden otherwise | `page /`, `cap ai.use` | planned | `HomeAssistantSuggestions` |
| PLT-47 | Nothing to do but applications exist | staff2 | Empty state «لا شيء لك اليوم. تصفّح التطبيقات لتبدأ.» with button «التطبيقات» | `page /`, `page /apps` | planned | |
| PLT-48 | No application reachable at all | visitor | Empty state «لا توجد مساحات عمل متاحة لحسابك حاليًا.» with button «الخدمة الذاتية» | `page /` | planned | Custom role with no application capability |
| PLT-49 | Identity without a capability list | visitor | `/` redirects to the first allowed path instead of rendering | `page /` | planned | `navigateTo(postLoginPath(...))` at the top of `index.vue` |
| PLT-50 | Persona differences on one day | ceo | ceo, it_admin, cfo, staff1 see different quick actions and indicators on the same data | `page /` | planned | Persona matrix |

## My work `/work` («مهامي»)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PLT-55 | Default tab and counts | staff1 | Tab «للتنفيذ» selected; each tab label carries its count, «n+» when the source list was capped | `page /work` | planned | `useAttention('all')`, `WORK_ROWS_LIMIT` |
| PLT-56 | Switch tab to «للقرار» then «للمتابعة» | pm | URL gets `?tab=decide` / `?tab=follow`; refresh and back keep the tab; «للتنفيذ» removes the parameter | `page /work` | planned | |
| PLT-57 | Rows come from every application the user can reach | pm | Tasks, approvals, leave, meetings, operations rows appear with their source application label | `page /work` | planned | Attention providers in `app/modules/*/attention.ts` |
| PLT-58 | Filter by application | pm | Select «كل التطبيقات» or one source; a source that disappears after a refresh falls back to all | `page /work` | planned | |
| PLT-59 | Search «ابحث في أعمالك» | pm | Filters rows by text; no match shows «لا توجد نتائج مطابقة للبحث أو التصفية.» | `page /work` | planned | |
| PLT-60 | Empty tab text | staff2 | «لا شيء للتنفيذ الآن.» / «لا شيء ينتظر قرارك الآن.» / «لا شيء للمتابعة الآن.» | `page /work` | planned | |
| PLT-61 | Urgent row | pm | Row marked «عاجل» | `page /work` | planned | |
| PLT-62 | Row opens its record and back returns to the same tab and filters | pm | Back keeps `?tab=` | `page /work` | planned | |
| PLT-63 | Header buttons | staff1 | «قائمة مهامي» opens `/my-tasks`; «مهمة جديدة» only with `tasks.tasks.create` | `page /work` | planned | |
| PLT-64 | Load failure | staff1 | Error state with retry; retry reloads | `page /work` | planned | `data-testid=work-error` |
| PLT-65 | Rows of an application switched off | staff1 | Row and source option disappear | `page /work` | planned | See PLT-120 |

## Applications launcher `/apps`

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PLT-70 | Cards depend on persona | ceo | One card per application the user can reach; accountant sees finance, staff1 does not | `page /apps` | planned | `launcherEntries` |
| PLT-71 | Search a card | ceo | Typing filters cards; no match «لا يوجد تطبيق بهذا الاسم.»; clear restores | `page /apps` | planned | |
| PLT-72 | Nothing available | visitor | «لا توجد تطبيقات متاحة لحسابك حاليًا.» | `page /apps` | planned | |
| PLT-73 | Application start page | pm | `/apps/pmo`-style page: header with «فتح التطبيق», block «يحتاج انتباهك» (up to 10 attention rows), block «ابدأ من هنا» with page cards and create actions | `page /apps/[id]` | planned | `appStartFor(id, me)` |
| PLT-74 | Start page of an application the user may not use | staff1 | Forbidden state (403 look), no data | `page /apps/[id]` | planned | |
| PLT-75 | Start page with an unknown id | staff1 | Not-found state with «التطبيقات» back link | `page /apps/[id]` | planned | |
| PLT-76 | Create action on the start page is filtered by capability | staff1 | Only creates the user may run | `page /apps/[id]` | planned | |

## Global search `/search`

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PLT-80 | Open search with no term | staff1 | Input focused; sections «الانتقال إلى» (pages the user can reach) and «الإجراءات» (create commands); no record results | `page /search` | planned | |
| PLT-81 | Page list is a shortcut list | staff1 | Five pages, then «عرض كل الصفحات (n)» / «عرض أقل»; typing filters pages by label | `page /search` | planned | `NAV_LIMIT = 5` |
| PLT-82 | Search projects | pm | With a term, group «المشاريع» lists matching projects the user can read; row opens the project with `returnTo` | `page /search` | planned | Provider `pmo-projects`, capability `pmo.projects.read` |
| PLT-83 | Search tasks | staff1 | Group «المهام» lists the user's own tasks (`filter=mine`) matching the term | `page /search` | planned | `pmo-tasks`, `pmo.tasks.read` |
| PLT-84 | Search partners and invoices | cfo | Groups for finance partners (VAT shown as caption) and invoices | `page /search` | planned | `finance-partners`, `finance-invoices` |
| PLT-85 | Finance groups hidden without the capability | staff1 | Same term returns no finance group and the provider filter has no finance option | `page /search` | planned | |
| PLT-86 | Provider filter | cfo | Segmented control «جميع نطاقات البحث» plus one option per provider the user may use; `?provider=` narrows; a provider the user lacks is ignored | `page /search` | planned | |
| PLT-87 | Load more and truncation note | pm | «تحميل المزيد» loads the next page; capped providers show their truncation text | `page /search` | planned | |
| PLT-88 | No results anywhere | staff1 | Empty state | `page /search` | planned | |
| PLT-89 | A provider fails | staff1 | That group shows «تعذّر البحث. اختر للمحاولة مجددًا.»; retry works; other groups still show | `page /search` | planned | |
| PLT-90 | Term and provider live in the URL | staff1 | `?q=` updates while typing; refresh keeps it; back button leaves search | `page /search` | planned | |
| PLT-91 | `returnTo` back link is restricted | staff1 | Foreign `returnTo` falls back to `/`; known application prefixes accepted | `page /search` | planned | `safeReturnTo` |
| PLT-92 | Navigation shortcut key | staff1 | A page shortcut letter typed on an empty field navigates | `page /search` | planned | `findSearchShortcut` |
| PLT-93 | Search never returns another company's or an unreadable record | staff2 | Record rules decide: a project the user cannot read never appears | `page /search` | planned | |

## Notification list API (bell)

Kinds registered in `webvue.notify.registry`: `tasks.assigned` (feature `tasks.enabled`); `assignment`, `comment`,
`mention`, `deadline`, `overdue_digest` (live), `charter_review`, `charter_approved`, `charter_returned` (feature
`pmo.enabled`); `meeting_invite`, `meeting_series_invite`, `meeting_resolution`, `meeting_converted`, `meeting_changed`,
`meeting_cancelled`, `meeting_reminder`, `meeting_resolution_overdue` (feature `meetings.enabled`).

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PLT-03 | Bell row opens its record; mark read; read all | staff1 | Counter updates | `GET /api/v1/notifications`, `POST /api/v1/notifications/<id>/read`, `POST /api/v1/notifications/read-all` | planned | |
| PLT-04 | Bell row of a record that became unreadable or an app switched off | staff1 | Row hidden and cannot be marked read | `GET /api/v1/notifications`, `POST /api/v1/notifications/<id>/read` | planned | Code check: mark-read of a switched-off application is refused 403 `feature_not_included` (`notify_service.py` `_webvue_mark_read`); hiding of a still-readable record is decided by the owners' domains, so confirm the list really hides a row when only the feature is off |
| PLT-100 | List envelope | staff1 | `{items, total, unread_count}`; newest first; default 50 per page, maximum 200 | `GET /api/v1/notifications` | planned | `limit=0` falls back to 50 |
| PLT-101 | Paging with `limit` and `offset` | staff1 | Second page continues without repeating or skipping rows; `total` stays the same | `GET /api/v1/notifications` | planned | |
| PLT-102 | `unread=1`, `true`, `0`, `false` | staff1 | Only unread / only read rows; `unread_count` still counts all unread | `GET /api/v1/notifications` | planned | |
| PLT-103 | `unread=maybe` | staff1 | 422 `invalid` «unread must be a boolean», field `unread` | `GET /api/v1/notifications` | planned | |
| PLT-104 | Unknown query parameter | staff1 | 422 `invalid` «unsupported query parameter 'x'», field `x` | `GET /api/v1/notifications` | planned | |
| PLT-105 | `limit=-1` or `offset=abc` | staff1 | 422 `invalid` «limit and offset must be non-negative integers» | `GET /api/v1/notifications` | planned | |
| PLT-106 | Rows belong to the caller only | staff2 | staff2 never sees staff1's rows, counts or ids | `GET /api/v1/notifications` | planned | Domain pins `res_partner_id` to the caller's partner |
| PLT-107 | Signed out | visitor | 401, no body of rows | `GET /api/v1/notifications` | planned | |
| PLT-108 | No notification-producing application is entitled | staff1 | 403 `feature_not_included` (nothing registered is readable) | `GET /api/v1/notifications` | planned | `requires_registered_feature(... match='any')` |
| PLT-109 | Read-only tenant (expired) | staff1 | List works; marking read answers 403 `tenant_read_only` | `GET /api/v1/notifications`, `POST /api/v1/notifications/<id>/read` | planned | |
| PLT-110 | Suspended tenant | staff1 | Every call 403 `tenant_suspended` | `GET /api/v1/notifications` | planned | |
| PLT-111 | Personal task assigned by someone else | staff1 | `tasks.assigned` row: «تم إسنادك إلى المهمة «{task}»»; click opens `/tasks/{id}` | `GET /api/v1/notifications` | planned | Hidden once the task is archived or no longer assigned to the caller |
| PLT-112 | PMO task assignment | staff1 | `assignment` row «تم إسناد مهمة إليك» | `GET /api/v1/notifications` | planned | |
| PLT-113 | Comment on my task | staff1 | `comment` row «تعليق جديد على المهمة» with the comment body | `GET /api/v1/notifications` | planned | |
| PLT-114 | Mention in a comment | staff1 | `mention` row «أشار إليك في تعليق»; appears under filter «الإشارات» | `GET /api/v1/notifications` | planned | |
| PLT-115 | Deadline reminder | staff1 | `deadline` row «موعد المهمة قريب «{task}»» | `GET /api/v1/notifications` | planned | Produced by the deadline cron |
| PLT-116 | Overdue digest | pm | `overdue_digest` row with the count of still-overdue tasks; opens `/notification-digests/{id}` | `GET /api/v1/notifications` | planned | A live kind: re-checked row by row |
| PLT-117 | Digest hides once every task in it is done | pm | Row disappears and `total` and `unread_count` drop | `GET /api/v1/notifications` | planned | `_webvue_visible_count` re-checks live kinds |
| PLT-118 | Charter submitted for approval | ceo | Sponsor gets `charter_review` «ميثاق بانتظار اعتمادك»; opens `/projects/{id}/charter` | `GET /api/v1/notifications` | planned | |
| PLT-119 | Charter review row after the decision | ceo | Row disappears once the charter is no longer `submitted` or the user is not the sponsor | `GET /api/v1/notifications` | planned | |
| PLT-120 | Charter approved / returned | pm | Project manager gets `charter_approved` «اعتُمد الميثاق» or `charter_returned` «أُعيد الميثاق للتعديل» | `GET /api/v1/notifications` | planned | |
| PLT-121 | Meeting kinds | staff1 | Invite, series invite, changed, cancelled, reminder, resolution, resolution overdue, converted each produce a row opening `/meetings/{id}` | `GET /api/v1/notifications` | planned | One scenario per kind in meetings.md; here only the bell rendering |
| PLT-122 | Meeting row hidden without `meetings.read` or after cancelling the series | staff1 | Row not listed | `GET /api/v1/notifications` | planned | `readable_active_meeting_ids` |
| PLT-123 | PMO task row hidden when the project is archived or the user lost read | staff1 | Row not listed, not counted | `GET /api/v1/notifications` | planned | `readable_active_task_ids` |
| PLT-124 | Same event delivered twice | staff1 | One row (idempotent delivery key) | `GET /api/v1/notifications` | planned | Unique index on `webvue_notification_key` |
| PLT-125 | A kind without a serializer | staff1 | Not reachable through the UI: a registered kind with no owner serializer raises a server error | `GET /api/v1/notifications` | decision | #167; `WebVueNotifyRegistry._webvue_notify_dump` raises `ValueError`; confirm a guard test exists for every registered kind |

## Notification actions

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PLT-130 | Mark one unread row read | staff1 | `{updated: 1}`; `unread_count` drops by one | `POST /api/v1/notifications/<id>/read` | planned | |
| PLT-131 | Mark an already-read row | staff1 | `{updated: 0}`, no error | `POST /api/v1/notifications/<id>/read` | planned | |
| PLT-132 | Someone else's or a missing id | staff2 | 404 «Notification does not exist» | `POST /api/v1/notifications/<id>/read` | planned | Same answer for both, no id oracle |
| PLT-133 | A hidden row (record no longer readable) | staff1 | 404 as above | `POST /api/v1/notifications/<id>/read` | planned | `_webvue_find` runs the visibility check |
| PLT-134 | Owner application switched off | staff1 | 403 `feature_not_included` | `POST /api/v1/notifications/<id>/read` | planned | See PLT-04 |
| PLT-135 | Read all | staff1 | `{updated: n}` counts the visible unread rows; second call `{updated: 0}` | `POST /api/v1/notifications/read-all` | planned | |
| PLT-136 | Read all skips rows whose application is write-blocked | staff1 | Those rows stay unread; no error | `POST /api/v1/notifications/read-all` | planned | `_webvue_mark_all_read` swallows `WebVueAccessRule` per row |
| PLT-137 | Read all on a read-only tenant | staff1 | `{updated: 0}` (every row skipped), no error | `POST /api/v1/notifications/read-all` | planned | Unlike mark-one, which answers 403 `tenant_read_only` |
| PLT-138 | Read all does not touch hidden rows | staff1 | A hidden unread row is still unread when it becomes visible again | `POST /api/v1/notifications/read-all` | planned | |

## Notifications page `/notifications`

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PLT-140 | Open the page | staff1 | Title «الإشعارات»; rows newest first; unread rows show a dot and the word «غير مقروءة»; time in the user's time zone | `page /notifications` | planned | |
| PLT-141 | Filters «الكل» «غير المقروءة» «الإشارات» | staff1 | Filter lives in `?filter=`; refresh and back keep it | `page /notifications` | planned | |
| PLT-142 | Empty list | staff2 | «لا توجد إشعارات» | `page /notifications` | planned | |
| PLT-143 | Empty filter | staff1 | «لا توجد إشعارات في هذا التصنيف» when other rows exist | `page /notifications` | planned | |
| PLT-144 | Open a row | staff1 | Row is marked read first, then the record opens (`/tasks/{id}`, `/meetings/{id}`, `/projects/{id}/charter` or `/notification-digests/{id}`) | `page /notifications` | planned | |
| PLT-145 | Open a row whose mark-read fails | staff1 | Toast with the API message (or generic error); no navigation | `page /notifications` | planned | |
| PLT-146 | Button «تحديد الكل كمقروء» | staff1 | Visible only when unread rows exist and the page is hydrated; clears the dots and the bell counter | `page /notifications` | planned | |
| PLT-147 | Load more | staff1 | Footer shows the count text; «تحميل المزيد» appends the next page | `page /notifications` | planned | |
| PLT-148 | Load failure and next-page failure | staff1 | «تعذر تحميل الإشعارات» with «إعادة المحاولة»; list kept when only the next page failed | `page /notifications` | planned | |
| PLT-149 | Bell in the header | staff1 | Shows the unread count; shows the latest five («آخر 5 إشعارات»); one overlay exception per DESIGN.md | `page /notifications` | planned | |
| PLT-150 | Unknown kind from a future application | staff1 | Generic row «إشعار» with title and body only | `page /notifications` | planned | `notifications.preview.other` |
| PLT-151 | Rows disable while an action is pending | staff1 | Second click during mark-read is ignored | `page /notifications` | planned | |

## People picker

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PLT-05 | People picker | any | Active internal users of the current company only | `GET /api/v1/people` | planned | |
| PLT-160 | Shape and order | staff1 | `[{id, name, user_id}]`, `id == user_id` (a `res.users` id, never an HR employee id), sorted by name then id | `GET /api/v1/people` | planned | `PersonRef` contract |
| PLT-161 | Default and maximum page | staff1 | 20 rows by default; `limit` above 50 is cut to 50; `limit=0` returns 1 row | `GET /api/v1/people` | planned | |
| PLT-162 | `q` filter | staff1 | Case-insensitive match on the name; empty `q` returns everyone | `GET /api/v1/people` | planned | Arabic names too |
| PLT-163 | Invalid `limit` | staff1 | 422 `invalid` «limit and offset must be non-negative integers», field `limit` | `GET /api/v1/people` | planned | |
| PLT-164 | Excluded people | staff1 | Archived users, portal or public users and users of another company are never listed | `GET /api/v1/people` | planned | `_webvue_people_domain` |
| PLT-165 | Vendor support accounts | it_admin | Expected: a vendor support user is not offered as a colleague | `GET /api/v1/people` | decision | private security advisory GHSA-9xq5-v9r4-xfxc; The domain does not exclude `webvue_core.group_vendor_support` users, although user counting does (`webvue_directory/models/directory.py:27`, `entitlement_service.py` `_webvue_excluded_user_ids`). Owner to confirm |
| PLT-166 | Used by an assignee field | staff1 | Typing in the assignee field of a task, project or meeting shows the same list; choosing sends the user id | `GET /api/v1/people` | planned | |
| PLT-167 | No application that picks people is entitled | staff1 | 403 `feature_not_included` | `GET /api/v1/people` | planned | `_webvue_directory_feature_keys` is empty until applications register |
| PLT-168 | Read-only tenant | staff1 | Still works (read gate) | `GET /api/v1/people` | planned | |
| PLT-169 | Suspended tenant or signed out | visitor | 403 `tenant_suspended` / 401 | `GET /api/v1/people` | planned | |

## Assistant: catalog, limits, audit

Tools registered today: only the six `pmo.*` tools of `webvue_pmo_ai`. Capability `ai.use` is granted by the built-in
employee role (`webvue_ai/models/access_service.py`); entitlements `ai.enabled` (flag), `ai.messages.monthly` and
`ai.tool_calls.per_run` (limits).

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PLT-06 | Assistant lists my tasks and summarizes a project | staff1 | Answers from the user's own data only | `page /ai` | planned | |
| PLT-07 | Assistant changes a task state: approve the confirmation card / reject it | staff1 | Approve applies, reject leaves the task unchanged; audit shows proposed / approved / rejected | `page /ai` | planned | |
| PLT-08 | Assistant drafts a project; leave the page without saving | ceo | Draft card opens `/projects/new`; leaving counts as rejection | `page /ai` | planned | |
| PLT-09 | Assistant without `ai.use` | custom role | No tools | `cap ai.use`, `GET /api/v1/ai/tools` | planned | |
| PLT-170 | Tool catalog for an ordinary employee | staff1 | `items` hold `pmo.list_my_tasks`, `pmo.list_projects`, `pmo.get_project`, `pmo.get_project_finance_summary`, `pmo.update_task_state` (each only if its capability is held); `total` equals the count; `limits` block present | `GET /api/v1/ai/tools` | planned | `_webvue_ai_tools_for_user` filters by feature read and capability |
| PLT-171 | Tool catalog for a project creator | ceo | Also lists `pmo.draft_project` (needs `pmo.projects.create`) | `GET /api/v1/ai/tools` | planned | |
| PLT-172 | Limits block | staff1 | `tool_calls_per_run`, `messages_monthly`, `messages_used` (messages since the start of the UTC month, whole tenant) | `GET /api/v1/ai/tools` | planned | |
| PLT-173 | Catalog without `ai.use` | custom role | 403 forbidden (capability) | `GET /api/v1/ai/tools`, `cap ai.use` | planned | |
| PLT-174 | Plan without the assistant (`ai.enabled` off) | staff1 | 403 `feature_not_included`; `/ai`, the header sheet and the home suggestions disappear | `GET /api/v1/ai/tools`, `page /ai` | planned | Entitlement `require_read('ai.enabled')` |
| PLT-175 | Pmo application switched off | staff1 | The pmo tools leave the catalog; with no tool registered the route answers 403 `feature_not_included` | `GET /api/v1/ai/tools` | planned | |
| PLT-176 | Read-only tenant | staff1 | Catalog works (read), but a new message is refused (audit is a write) | `GET /api/v1/ai/tools`, `POST /api/v1/ai/audit` | planned | |
| PLT-177 | Suspended tenant | staff1 | 403 `tenant_suspended` | `GET /api/v1/ai/tools` | planned | |
| PLT-178 | Message audit row | staff1 | Starting a run first records `kind=message, result=ok` with no tool fields; the receipt returns the new `messages_used` and `messages_limit` | `POST /api/v1/ai/audit` | planned | The message is counted before the AI service is reached |
| PLT-179 | Monthly message limit reached | staff1 | 403 `feature_not_included`, `details.limit_key=ai.messages.monthly`; page shows «وصلت شركتك إلى حد رسائل WebVue AI لهذا الشهر.» and the AI service is not called | `POST /api/v1/ai/audit`, `page /ai` | planned | `AiLimitNotice` |
| PLT-180 | Usage meter | staff1 | «{used} من {limit} رسالة هذا الشهر» matches the audit count | `page /ai` | planned | |
| PLT-181 | No monthly limit set | staff1 | Unlimited: no fence is taken and no meter is shown | `POST /api/v1/ai/audit` | planned | `_webvue_limit_value` is `None` |
| PLT-182 | Audit refuses an unknown field | staff1 | 422 `unknown_field` for any key outside `conversation_id, kind, tool_name, input, result, http_status, draft, approved, attested` | `POST /api/v1/ai/audit` | planned | |
| PLT-183 | Audit `conversation_id` rules | staff1 | Empty, longer than 64 characters, non-string or containing NUL: 422 `invalid`, field `conversation_id` | `POST /api/v1/ai/audit` | planned | |
| PLT-184 | Audit `kind` and `result` enums | staff1 | `kind` in message, read, write_light, draft; `result` in ok, denied, failed, proposed, approved, rejected; otherwise 422 | `POST /api/v1/ai/audit` | planned | |
| PLT-185 | Message audit carries no tool data | staff1 | tool_name, input, draft, approved or http_status on a message row: 422; `attested=true`: 422; `result` other than `ok`: 422 | `POST /api/v1/ai/audit` | planned | |
| PLT-186 | Tool audit names a registered tool of the same kind | staff1 | Unknown tool: 422 field `tool_name`; kind different from the tool's kind: 422 field `kind` | `POST /api/v1/ai/audit` | planned | |
| PLT-187 | Draft result rules | staff1 | A draft row accepts proposed, approved, rejected only; those results are refused on other kinds | `POST /api/v1/ai/audit` | planned | |
| PLT-188 | Approved draft needs attestation and payload | staff1 | `approved` without `attested=true` or without an `approved` object: 422 | `POST /api/v1/ai/audit` | planned | |
| PLT-189 | Secrets scrubbed | staff1 | Keys such as password, token, secret, apikey, authorization, credential or `key` are removed from `input`, `draft`, `approved` before storing | `POST /api/v1/ai/audit` | planned | |
| PLT-190 | JSON limits | staff1 | Nesting deeper than 8, more than 32 KiB, NUL characters, non-finite numbers or non-object payload: 422 | `POST /api/v1/ai/audit` | planned | |
| PLT-191 | `http_status` range | staff1 | Outside 100 to 599 or boolean: 422 | `POST /api/v1/ai/audit` | planned | |
| PLT-192 | Tool audit without the tool's capability or feature | staff1 | 403 «You do not have access to the tool ...» / «The feature of the tool ... is not available.» | `POST /api/v1/ai/audit` | planned | |
| PLT-193 | Audit rows are private | staff2 | A user only sees their own audit rows; access auditors see their company's | `POST /api/v1/ai/audit` | planned | Record rules on `webvue.ai.audit` |
| PLT-194 | Usage rows: happy path | staff1 | 1 to 64 items; each returns its stored row; `total` equals the count | `POST /api/v1/ai/usage` | planned | |
| PLT-195 | Usage body shape | staff1 | Missing or empty `items`, more than 64 items, non-object item: 422 `invalid`; extra top-level key: 422 `unknown_field` | `POST /api/v1/ai/usage` | planned | |
| PLT-196 | Usage field rules | staff1 | `kind` plan or title; `provider` matches `[a-z][a-z0-9_-]{0,31}`; `model` 1 to 128 chars without control characters; `outcome` ok, failed, retried, aborted; every field required; error field is `items.N.field` | `POST /api/v1/ai/usage` | planned | |
| PLT-197 | Token counts | staff1 | Both or neither of input and output tokens; each 0 to 100 000 000; unreported stored as 0 with `tokens_reported=false` | `POST /api/v1/ai/usage` | planned | |
| PLT-198 | `called_at` | staff1 | RFC 3339 with an offset; more than 5 minutes in the future: 422 | `POST /api/v1/ai/usage` | planned | |
| PLT-199 | Usage is never limited | staff1 | Writes succeed even when the monthly message limit is reached (the calls already happened) | `POST /api/v1/ai/usage` | planned | |
| PLT-200 | Usage without `ai.use` or `ai.enabled` | staff1 | 403 | `POST /api/v1/ai/usage`, `cap ai.use` | planned | |

## Assistant: runs, tools, cards (Nuxt `/api/ai/runs`)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PLT-210 | Empty conversation page | staff1 | Greeting «أهلًا {name}», «كيف أساعدك في عملك اليوم؟», starter chips «أسئلة للبدء», note «يقترح ويوضّح فقط، ولا يعتمد أو يرسل أي شيء عنك.» | `page /ai` | planned | |
| PLT-211 | «صباحك باختصار» | pm | Attention rows, urgent ones tagged «عاجل» | `page /ai` | planned | |
| PLT-212 | Start a run | staff1 | POST body validated (`message` required); a new run id `r_...` is created, the message is audited, then the service streams the answer | `page /ai` | planned | `index.post.ts`; invalid body: 422 `invalid` with the failing field |
| PLT-213 | Cross-site or non-JSON run request | visitor | 403 `cross_site_request` / 415 | `page /ai` | planned | `assertSameSiteJson` |
| PLT-214 | Read tool call | staff1 | Question «ما مهامي المتأخرة؟» runs `pmo.list_my_tasks`; trace shows the tool; the answer lists only the user's tasks; audit `read / ok` | `page /ai` | planned | |
| PLT-215 | Read tool result is whitelisted | staff1 | Only the `result_summary` fields reach the model; larger than 200 000 bytes becomes `result_too_large` | `page /ai` | planned | `summarizeResult` |
| PLT-216 | `pmo.list_projects` with `q` | pm | At most 50 rows, only projects the user can read | `page /ai` | planned | |
| PLT-217 | `pmo.get_project` for a project the user cannot read | staff2 | Tool result is an error, audit row `denied` (403) or `failed`, the model says it cannot show it | `page /ai` | planned | Result is `denied` when the status is 403 |
| PLT-218 | `pmo.get_project_finance_summary` | cfo | Budget, spent, remaining as the server computes them; the model never recalculates | `page /ai` | planned | |
| PLT-219 | Tool input validation | staff1 | A tool call with an extra or wrong-typed argument is refused before Odoo is called | `page /ai` | planned | `additionalProperties: false` in every schema |
| PLT-220 | Unknown tool or wrong kind from the model | staff1 | Answered as `unknown_tool` («... is not in the catalog» / «is not a ... tool of the catalog») without calling Odoo | `page /ai` | planned | |
| PLT-221 | Tool outside the user's catalog | staff1 | A model request for `pmo.draft_project` (no `pmo.projects.create`) is `unknown_tool` | `page /ai` | planned | |
| PLT-222 | Confirm card for `pmo.update_task_state` | staff1 | Card «يحتاج تأكيدك» with «نفّذ» / «لا تنفّذ»; nothing changes before a decision | `page /ai` | planned | `AiConfirmCard` |
| PLT-223 | Approve | staff1 | Run is claimed once, the task transition runs as the user, card shows «نُفّذ بعد تأكيدك», the model continues, audit `write_light / ok` | `page /ai` | planned | |
| PLT-224 | Reject | staff1 | Card shows «أُلغي»; the task is unchanged; no write audit row (Odoo accepts `rejected` for drafts only) | `page /ai` | planned | |
| PLT-225 | Approve twice (two tabs) | staff1 | Second approval: 409 «this call was already claimed»; executes nothing | `page /ai` | planned | |
| PLT-226 | Approve a transition the task state forbids | staff1 | Upstream 422/409 becomes a tool error; the model reports it; audit `failed` | `page /ai` | planned | |
| PLT-227 | Approve without `pmo.tasks.write` | staff1 | Tool not in the catalog; if forced, upstream 403 gives audit `denied` | `page /ai` | planned | |
| PLT-228 | Page closed while a write is claimed | staff1 | The claimed write still executes and resumes; card text «بدأ تنفيذه من طلب سابق. حدّث الصفحة بعد قليل لتعرف نتيجته.» | `page /ai` | planned | `shield = null` in `resume.post.ts` |
| PLT-229 | Resume validation | staff1 | Missing `call_id` or invalid `decision`: 422; `data` not an object: 422 field `data`; unknown run: 404 `not_found`; `call_id` different from the service's pending call: 409; run executing a claimed call: 409 | `page /ai` | planned | |
| PLT-230 | Retry a stalled read | staff1 | `approved` re-runs the read; `rejected` is 409 «a read tool can only be retried» | `page /ai` | planned | |
| PLT-231 | Write executed but resume to the service fails | staff1 | Stream shows `resume_failed` «نُفّذ الإجراء لكن تعذّر على المساعد إكمال الرد.» then `done: failed` | `page /ai` | planned | |
| PLT-232 | Write executed but audit save fails | staff1 | `audit_failed` «نُفّذ الإجراء لكن تعذّر حفظ سجل التدقيق.» | `page /ai` | planned | |
| PLT-233 | Draft card | ceo | «جهّزتُ مسودة» with hint, «افتح المسودة» opens `/projects/new` prefilled (name, dates, charter fields); «تجاهل المسودة» rejects; audit `proposed` on show | `page /ai` | planned | |
| PLT-234 | Draft submitted after review | ceo | Saving the real form audits `approved` with `attested=true` and the approved payload | `page /ai` | planned | |
| PLT-235 | Draft ignored | ceo | Audit `rejected`; nothing created | `page /ai` | planned | |
| PLT-236 | Draft input limits | ceo | `name` 1 to 255, text fields up to 4000, up to 10 objectives of 500 chars, dates `YYYY-MM-DD` | `page /ai` | planned | `PMO_AI_TOOLS` schema |
| PLT-237 | Step limit | staff1 | After 12 steps: «توقف هذا الطلب لأنه تجاوز عدد الخطوات المسموح.» | `page /ai` | planned | |
| PLT-238 | Tool-call budget | staff1 | Default 8 calls per run, the `ai.tool_calls.per_run` limit otherwise, never above 50 | `page /ai` | planned | `toolCallBudget` |
| PLT-239 | Run timeout | staff1 | After 120 s: «استغرق الطلب وقتًا أطول من المسموح.» | `page /ai` | planned | |
| PLT-240 | AI service down | staff1 | 503 `ai_unavailable`; page shows «WebVue AI غير متاح الآن. حاول لاحقًا.» | `page /ai` | planned | |
| PLT-241 | Model provider error | staff1 | «تعذّر الاتصال بنموذج الذكاء. حاول لاحقًا.» | `page /ai` | planned | |
| PLT-242 | Decision could not be saved | staff1 | «تعذّر حفظ قرارك. حاول مرة أخرى.» | `page /ai` | planned | |
| PLT-243 | History list | staff1 | Groups «اليوم» «آخر 7 أيام» «أقدم»; search «ابحث في المحادثات»; no match «لا محادثات مطابقة»; empty «لا محادثات بعد»; privacy line «محادثاتك خاصة بك. المساعد يرى فقط ما تملك صلاحية رؤيته.» | `page /ai` | planned | |
| PLT-244 | Status badges in history | staff1 | «بانتظار قرارك» for a pending card, «تعذّر إكمالها» for a failed run, «محادثة بلا عنوان» when unnamed | `page /ai` | planned | |
| PLT-245 | Rename | staff1 | «تغيير الاسم» accepts 1 to the maximum characters without newlines, else «الاسم من حرف واحد إلى {max} حرفًا وبلا أسطر جديدة.»; announces «تم تغيير اسم المحادثة» | `page /ai` | planned | PATCH `/api/ai/runs/{id}` 422 `invalid` on bad body |
| PLT-246 | Archive and restore | staff1 | «أرشفة» removes it from «المحادثات», it appears under «المؤرشفة» (empty text «لا محادثات مؤرشفة»); «إلغاء الأرشفة» brings it back | `page /ai` | planned | `?archived=true`; other value: 422 |
| PLT-247 | Runs are private | staff2 | Another user's run id: 404 `not_found` on GET, PATCH and resume | `page /ai` | planned | Owner is `(tenant, user)` |
| PLT-248 | Run API errors | staff1 | Service 404: 404 `not_found`; other upstream failure: 502 `ai_upstream`; run answered for another run id: 502 | `page /ai` | planned | |
| PLT-249 | Arabic and English answers | staff1 | The run uses the `webvue-locale` cookie (`runLocale`) | `page /ai` | planned | |
| PLT-250 | Assistant sheet in the header | staff1 | Same conversation, block «في هذه الصفحة الآن» (hide/show), empty text «لا شيء يحتاج انتباهك في هذه الصفحة.»; context chip names the current page | `page /ai` | planned | One of the four overlay exceptions in DESIGN.md |
| PLT-251 | Starter «ما اجتماعاتي القادمة؟» | staff1 | Expected: the assistant can answer from meetings | `page /ai` | gap | #157; The starter is static (`utils/aiSuggestions.ts`) but no meetings tool is registered; only `pmo.*` tools exist, so tasks personal, HR, finance and meetings have none |
| PLT-252 | Assistant never acts without confirmation | staff1 | No write tool runs without an approved card; drafts write nothing | `page /ai` | planned | Note on the page: «يقترح ويوضّح فقط...» |

## Feature switches, locale and layout

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PLT-10 | Switch an application off in the plan | vendor / it_admin | Its menu, pages, routes and bell rows disappear; data kept and back when switched on | `page /apps` | planned | |
| PLT-11 | Arabic RTL and light/dark theme on every page visited | every persona | No clipped or mirrored layout, no English strings | `page /` | planned | Checked on each scenario's pages |
| PLT-12 | Phone width on the main daily pages | staff1 | Usable without horizontal scroll | `page /`, `page /work`, `page /notifications` | planned | |
| PLT-260 | Each application has its own switch | it_admin | `pmo.enabled`, `tasks.enabled`, `meetings.enabled`, `hr.enabled`, `finance.enabled`, `documents.enabled`, `chat.enabled`, `operations.enabled`, `ai.enabled` each hide only their own menu, `/apps` card, search group, work rows and attention rows | `page /apps`, `page /search`, `page /work` | planned | One scenario per application in its own file; the shared behaviour is checked here |
| PLT-261 | Direct URL of a switched-off application | staff1 | 403 page «لا تملك صلاحية فتح هذه الصفحة» | `page /apps/[id]` | planned | `canReachPath` |
| PLT-262 | API call to a switched-off application | staff1 | 403 `feature_not_included` with `details.feature` | `GET /api/v1/notifications` | planned | |
| PLT-263 | Retained (read-only) application after a downgrade | staff1 | Existing data readable, every write refused 403 `feature_not_included`; the home and `/apps` still show it | `page /apps` | planned | `_webvue_feature_read` is true for `retained` keys, `_webvue_feature_write` is not; see SAAS-19 |
| PLT-264 | Application not installed at all | staff1 | Treated as off: never offered, no error page for the rest | `page /apps` | planned | `_webvue_owner_installed` |
| PLT-265 | Language switch to English | staff1 | Whole UI in English and left-to-right, no Arabic strings left on the visited pages; choice survives refresh (cookie `webvue-locale`) | `page /` | planned | |
| PLT-266 | Default locale for a new browser | visitor | Arabic, right-to-left | `page /login` | planned | |
| PLT-267 | Dark theme | staff1 | Contrast and borders hold on `/`, `/work`, `/notifications`, `/ai`, `/search` | `page /ai`, `page /search` | planned | |
| PLT-268 | Phone width on search, apps and assistant | staff1 | No horizontal scroll; filters collapse | `page /search`, `page /apps`, `page /ai` | planned | |
| PLT-269 | Keyboard use | staff1 | Row navigation in `/notifications` and `/search` works with the arrow keys; focus visible; dialogs trap focus | `page /notifications` | planned | `useRowNavigation` |
| PLT-270 | Unknown page | staff1 | «الصفحة غير موجودة» with «العودة إلى الصفحة الرئيسية» | `page /` | planned | `errors.pageNotFoundTitle` |
| PLT-271 | Rail link accessible names match their visible labels | staff1 | Screen readers and voice control announce the same name the rail shows | `page /` | fail | #137; Found 2026-10-28 by `e2e/tests/access-matrix.e2e.ts`: «الموظفين» is announced «الموارد البشرية» and «المساعد» «WebVue AI» (`packages/ui/app/components/shell/ModuleRail.vue:43` uses `labelKey` for `aria-label`); WCAG 2.5.3 label in name |
