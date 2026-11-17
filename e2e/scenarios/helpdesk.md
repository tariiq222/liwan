# Support Desk (الدعم الفني)

Pages: `/helpdesk` (the queue, its filters and the pager), `/helpdesk/new` (the create panel over the list),
`/helpdesk/[id]` (the record: details, description, merge and the thread), `/helpdesk/[id]/edit`,
`/helpdesk/reports` (first response, resolution, compliance and each agent's load),
`/settings/apps/helpdesk` (policy, teams, stages, value lists, service levels) and `/support/[id]` (the
customer's page, no account). Owner: `liwan_helpdesk` (rank-4 application on the OCA engine `helpdesk_mgmt`
+ `helpdesk_mgmt_sla` + `helpdesk_type`; contracts in `packages/contracts/src/helpdesk`). Routes sit under
`/api/v1/helpdesk`, and the customer's page under `/api/v1/public/helpdesk`. Personas and status values:
[README](README.md).

Capability note: ten keys. «وكيل الدعم الفني» (`helpdesk_agent`) holds `helpdesk.tickets.read`,
`helpdesk.requests.read`, `helpdesk.requests.create` and `helpdesk.tickets.write`; «مشرف الدعم الفني»
(`helpdesk_supervisor`) adds `helpdesk.tickets.assign`, `helpdesk.tickets.close`, `helpdesk.tickets.merge`,
`helpdesk.reports.read` and `helpdesk.settings.read`; «مدير الدعم الفني» (`helpdesk_manager`) holds all ten.
The base «موظف» (`employee`) role holds `helpdesk.requests.read` and `helpdesk.requests.create`, so every
employee opens and follows a request of their own with no desk role at all. Dependencies are added
automatically: `tickets.write`, `tickets.assign`, `tickets.close`, `tickets.merge` and `reports.read` each
need `tickets.read`; `requests.create` needs `requests.read`; `settings.manage` needs `settings.read`.
`tickets.assign`, `tickets.merge` and `settings.manage` are sensitive keys. `system_admin` holds no desk key,
and vendor support is stripped of every desk key. Features: `helpdesk.enabled` for the application, and the
sub-features `helpdesk.merge` (the merge route), `helpdesk.reports` (the page and its route),
`helpdesk.portal` (the customer's page) and `helpdesk.auto_close` (the inactivity job).

Seed note: no seeded persona holds a desk role. A persona cell that says `custom role (<built-in role>)`
means the run grants that built-in role to a seeded employee through
`PATCH /api/v1/admin/users/<id>/access` as `it_admin` (who holds `system_admin`: `access.roles.read` and
`access.users.assign_roles`, and no desk key). `e2e/tests/helpdesk.e2e.ts` does exactly that, reading the
role by its `key` and the user by its login, then proves the grant from `/api/v1/me`. The install hook
creates, for every company, the team «الدعم الفني» with the four stages «جديد», «قيد المعالجة»,
«بانتظار العميل» (unattended) and «مغلق» (closed), and a settings row whose only stated value is the prefix
`HD`. A ticket number is that prefix and a five-digit sequence, so no row asserts the number; every test
puts a timestamp in its subjects instead.

Error note: API errors quoted below are the server messages. A missing capability answers 403 `forbidden`
«<key> capability is required» (a route that accepts either key answers «one of <keys> capability is
required»); a closed feature answers 403 `feature_not_included` «this feature is not included». A hidden,
foreign (another company) or missing ticket answers the same 404 `not_found` «Ticket does not exist».
Closing a closed ticket and reopening an open one answer 409 `conflict`; a merge into a closed target answers
409 «a closed ticket cannot absorb others». A ticket whose team has no open or closed stage answers 422
`invalid` on `stage_id`; a stage of another team answers «the stage does not belong to the ticket team»; an
assignee who is not an internal user of the company answers «the assignee is not an internal user of the
company». Reopening past the policy's window answers 422 «the ticket can no longer be reopened». Paging is
`limit` (default 50, at most 200) and `offset`; an unknown `state` or `priority` answers 422 `invalid` on
that field. An unknown ticket action answers 404 `not_found` «Unknown ticket action.».

Policy note: `liwan.helpdesk.settings` holds one row per company. The defaults, when no row states a value,
are preset `general`, visibility `team`, priority `medium` (`1`), prefix `HD`, a seven-day reopen window, an
eight-hour first-response target, a 72-hour resolution target, the customer's page on, and automatic closing
off. The seven presets are `general`, `it`, `maintenance`, `public_sector`, `retail`, `care` and `education`,
and each writes only the five values it documents (visibility, reopen days, first response, resolution,
default priority), leaving every other key and every list alone. Visibility works as the setting says: `own`
shows the tickets assigned to me and the unassigned ones of my teams; `team` adds my teams' tickets and the
tickets no team has routed; `all` shows the whole company. Holding `helpdesk.tickets.assign` opens the whole
company whatever the setting, and every holder of `helpdesk.requests.read` also reads the requests they
opened themselves. A zero target disables its measure instead of reporting a perfect score.

## الجولات الآلية (the three journeys the test runs)

### ١. موظف يفتح طلبًا ويتابعه — HD-24

- **الهدف:** أن يفتح الموظف طلب دعم لنفسه، ويقرأ حالته ويردّ عليه، دون أي زر من أزرار فريق الدعم.
- **الشروط المسبقة:** شخص من النمط `staff2` («سارة العمري») بدور «موظف» وحده؛ لا دور دعم ولا حاجة إلى أي إعداد.
- **الخطوات:** يُفتح الطلب، ثم تُفتح القائمة ويُكتب ختم الجولة في مربع البحث، ثم يُفتح سطر التذكرة، ثم تُقرأ
  التفاصيل والمحادثة، ثم يُرسَل الردّ ويُعاد تحميل الصفحة.
- **النتيجة المتوقعة:** مقدّم الطلب هو الموظف نفسه، والمسند «غير مسندة»، ولا يظهر منتقي المرحلة ولا
  «إسنادها إليّ» ولا «إغلاق التذكرة» ولا «تعديل التذكرة»، ولا مفتاح «ملاحظة داخلية»؛ والردّ يظهر في المحادثة
  بلا شارة داخلية، بينما يرفض الخادم الملاحظة الداخلية بـ403.

### ٢. وكيل يستلم تذكرة ويعالجها ويغلقها ثم يعيد فتحها — HD-30

- **الهدف:** أن يمرّ الطلب على مسار الفريق كاملًا: الإسناد ثم المرحلة ثم الردّ والملاحظة ثم الإغلاق وإعادة الفتح.
- **الشروط المسبقة:** طلب فتحه `staff2`؛ ودور «مدير الدعم الفني» ممنوح لـ`crm_manager` («أحمد السهلي») خلال
  الجولة نفسها عبر مسار الوصول.
- **الخطوات:** يُسند الطلب إلى الوكيل ثم يُلغى الإسناد ثم يُسند ثانية، ثم يُنقل إلى «قيد المعالجة»، ثم يُرسَل
  ردّ عام وملاحظة داخلية، ثم يُغلق الطلب ويُعاد فتحه؛ وبعد كل كتابة تُعاد الصفحة وتُقرأ.
- **النتيجة المتوقعة:** «المسند إلى» يصير اسم الوكيل ثم «غير مسندة» ثم الاسم ثانية، وزر «إسنادها إليّ» يتبدّل
  إلى «إلغاء الإسناد»، ومنتقي المرحلة يعرض «قيد المعالجة»، والمحادثة تعرض الردّ والملاحظة مع شارة «ملاحظة
  داخلية» على الملاحظة وحدها، و«أول ردّ» يتوقف عن قول «بانتظار أول ردّ»، والإغلاق يخفي منتقي المرحلة
  و«إغلاق التذكرة» ويُظهر «إعادة الفتح» و«تاريخ الإغلاق»، وإعادة الفتح تعيد «جديد» و«إغلاق التذكرة».

### ٣. مشرف يدمج مكرّرة ويقرأ الطابور والتقارير والإعدادات — HD-50

- **الهدف:** أن ينهي المشرف تذكرة مكرّرة، وأن يجد التذاكر في الطابور بالفلاتر، وأن يقرأ التقارير وسياسة الدعم.
- **الشروط المسبقة:** دور «مشرف الدعم الفني» ممنوح لـ`pm` («ماجد الغامدي»)، وتذكرتان بنفس الختم في الموضوع.
- **الخطوات:** تُدمج المكرّرة في التذكرة الباقية، ثم تُقرأ صفحة المكرّرة، ثم تُفتح القائمة ويُختار «الكل» ويُكتب
  الختم في البحث، ثم يُفتح سطر ويُرجَع بزر الرجوع، ثم تُفتح «تقارير الدعم» ويُغيّر طول الفترة، ثم تُفتح
  «الإعدادات ← التطبيقات ← الدعم الفني».
- **النتيجة المتوقعة:** المكرّرة مغلقة ولا تعرض «دمج المكرّرة»، والطابور يعرض التذكرتين مع بقاء `state=all`
  و`q` في العنوان بعد الرجوع، والتقرير يعرض المؤشرات الأربعة ويحوّل الفترة إلى `?period=7`، والإعدادات تعرض
  الفرق والمراحل والوسوم واتفاقيات الخدمة وسياسة الدعم للقراءة فقط: لا زر «فريق جديد» ولا حفظ.
  كل قسم في الإعدادات يرسم عنوانه (فرق الدعم، المراحل، اتفاقيات مستوى الخدمة) إلى جانب شارة «عرض فقط»؛
  غياب العنوان كان عطلًا حقيقيًا في البطاقات، لا مجرد غياب زر.

## Access and features

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| HD-01 | الموظف يفتح «الدعم الفني» من الشريط ويرى طلباته وحده | staff2 («سارة العمري», base «موظف» role) | The rail item opens `/helpdesk`; the list holds the requests this employee opened and no other ticket, and «تذكرة جديدة» is offered | `page /helpdesk` `GET /api/v1/helpdesk/tickets` `cap helpdesk.requests.read` | planned | The employee role holds the two request keys, so no desk role is needed; the own-list half is exercised by HD-24 |
| HD-02 | الوكيل يقرأ الطابور والسجل | custom role (`helpdesk_agent` «وكيل الدعم الفني») | The list opens with its queue chips and a ticket of the team opens with its thread; `/settings/apps/helpdesk` shows the forbidden state and the settings route answers 403 | `page /helpdesk` `page /helpdesk/[id]` `cap helpdesk.tickets.read` `cap helpdesk.settings.read` | planned | |
| HD-03 | شخص بلا أي مفتاح دعم يفتح القائمة | a user without the `employee` role (for example `no_roles`) | `/helpdesk` shows the forbidden state and the list route answers 403 `forbidden` | `page /helpdesk` `cap helpdesk.tickets.read` | planned | `no_roles` holds no role at all; `staff2` would pass, because «موظف» already grants the request keys |
| HD-04 | مسار الدمج يحتاج ميزته الفرعية | custom role (`helpdesk_manager` «مدير الدعم الفني») | With `helpdesk.merge` off the record draws no «دمج المكرّرة» and the route answers 403 `feature_not_included`; with it on the section is offered for an open ticket | `POST /api/v1/helpdesk/tickets/<id>/merge` `cap helpdesk.tickets.merge` | planned | exclusive phase (feature off); restore the baseline afterwards |
| HD-05 | صفحة التقارير تحتاج مفتاحها وميزتها | custom role (`helpdesk_supervisor` «مشرف الدعم الفني») | The page opens for `helpdesk.reports.read` while `helpdesk.reports` is on; without the key it shows the forbidden state and the route answers 403 | `page /helpdesk/reports` `GET /api/v1/helpdesk/reports` `cap helpdesk.reports.read` | planned | |
| HD-06 | التطبيق مغلق | it_admin | The rail item disappears and every `/api/v1/helpdesk/*` route answers 403 `feature_not_included`; `/helpdesk` does not render the list | `page /helpdesk` `GET /api/v1/helpdesk/tickets` | planned | exclusive phase (`helpdesk.enabled` off); switch and restore with `tools/e2e_tenant_state.py` |
| HD-07 | تذكرة شركة أخرى | jeddah_staff with a desk role, dammam_manager | The record answers 404 `not_found` and the list does not count it | `GET /api/v1/helpdesk/tickets/<id>` | planned | The branches are child companies of the root; the ticket's own company bounds the read |

## Opening a ticket for a customer

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| HD-10 | الوكيل يفتح تذكرة عن عميل من اللوحة | custom role (`helpdesk_manager` «مدير الدعم الفني») | «تذكرة جديدة» opens the panel over the list from a direct link and after a refresh; the customer picker lists `/api/v1/customers/pick`; saving lands on the record, which names the customer as the requester and the agent as the assignee | `page /helpdesk/new` `POST /api/v1/helpdesk/tickets` `cap helpdesk.tickets.write` | planned | The create answer now carries the detail shape (HD-100 fixed), so the panel can be driven. Needs a seeded customer: the e2e seed holds none, and the picker lists `/api/v1/customers/pick` |
| HD-11 | الموظف يترك العميل فارغًا | staff2 («سارة العمري», base «موظف» role) | The form offers no customer field to an employee; the requester is the employee and nobody is assigned | `page /helpdesk/new` `POST /api/v1/helpdesk/tickets` `cap helpdesk.requests.create` | automated | `e2e/tests/helpdesk.e2e.ts` [HD-20] (the same journey): the employee's panel has no customer picker, and the saved request names the employee as requester with nobody assigned; run 2026-11-17, passed |
| HD-12 | تحقق النموذج ثم تحقق الخادم | custom role (`helpdesk_agent` «وكيل الدعم الفني») | Empty subject, empty description and no team are refused before sending with «اكتب موضوعًا واضحًا للطلب.», «اكتب وصفًا لما تحتاجه.» and «اختر الفريق الذي يستقبل الطلب.»; the server repeats them as 422 on `subject` and `description`, and an unknown priority answers 422 on `priority` | `POST /api/v1/helpdesk/tickets` | planned | The client half sends nothing, so it is not blocked by HD-100; `liwan_helpdesk` `test_helpdesk_tickets.py` proves the server half |
| HD-13 | اللوحة تحفظ القائمة خلفها | custom role (`helpdesk_agent` «وكيل الدعم الفني») | The panel's `returnTo` carries the list's filters; closing it or pressing Escape returns to the same filtered page, and a refresh reopens the panel | `page /helpdesk/new` | planned | |

## An employee's own request

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| HD-20 | الموظف يفتح طلبًا لنفسه | staff2 | The panel accepts a subject and a description and opens the record, whose requester is the employee and whose aside says «غير مسندة» | `page /helpdesk/new` `page /helpdesk/[id]` `POST /api/v1/helpdesk/tickets` `cap helpdesk.requests.create` | automated | `e2e/tests/helpdesk.e2e.ts` [HD-20]: «تذكرة جديدة» opens the panel over the list, the form takes its default team from the reference already loaded by the list, saving lands on the record («غير مسندة», the first open stage «جديد»); run 2026-11-17, passed |
| HD-21 | الموظف يردّ على طلبه من المحادثة | staff2 | The composer is offered without the internal-note switch; the reply joins the thread and survives a reload | `POST /api/v1/helpdesk/tickets/<id>/messages` `cap helpdesk.requests.read` | automated | `e2e/tests/helpdesk.e2e.ts` [HD-24] (the same journey): the comment mutation reads the message list and then the ticket; run 2026-11-17, passed |
| HD-22 | الموظف لا يقرأ تذكرة غيره | staff2 | A ticket this employee did not open answers 404 `not_found`, and the list shows only their own requests | `GET /api/v1/helpdesk/tickets/<id>` `GET /api/v1/helpdesk/tickets` | planned | `liwan_helpdesk` `test_helpdesk_visibility.py` proves the rule; HD-24 covers the own-list half |
| HD-24 | الموظف يقرأ طلبه ويتابعه بلا أزرار الفريق | staff2 («سارة العمري») | The stamped request opens from the searched list: requester is the employee, «المسند إلى» says «غير مسندة», and no stage select, «إسنادها إليّ», «إغلاق التذكرة», «تعديل التذكرة» or «ملاحظة داخلية» is drawn; the thread shows the posted reply and the server refuses an internal note with 403 | `page /helpdesk` `page /helpdesk/[id]` `POST /api/v1/helpdesk/tickets` `POST /api/v1/helpdesk/tickets/<id>/messages` `cap helpdesk.requests.read` `cap helpdesk.requests.create` | automated | `e2e/tests/helpdesk.e2e.ts` [HD-24]; run 2026-11-17, passed on the isolated Odoo stack (the ticket is opened through the route the form calls; the form itself is HD-20, planned) |
| HD-25 | الموظف يعيد فتح الطلب من رابطه | staff2 | The record opens from its address after signing in again, the aside and the thread render, and Back returns to the list | `page /helpdesk/[id]` | planned | |

## Assignment, stage and closing

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| HD-30 | الوكيل يستلم الطلب ويعيد إسناده | custom role (`helpdesk_manager` «مدير الدعم الفني»), request opened by staff2 | The assignment makes the agent the assignee (the aside names them) and the page offers «إلغاء الإسناد» instead of «إسنادها إليّ»; releasing clears it and the aside returns to «غير مسندة» | `POST /api/v1/helpdesk/tickets/<id>/<id>` `cap helpdesk.tickets.assign` | automated | `e2e/tests/helpdesk.e2e.ts` [HD-30]; run 2026-11-17, passed. The ticket writes go through the page's own session; the stage select and the buttons are not clicked by this journey |
| HD-31 | الوكيل ينقل المرحلة | custom role (`helpdesk_manager` «مدير الدعم الفني») | The «المرحلة» select offers the open stages only; choosing «قيد المعالجة» saves it and the select reads it after a reload | `POST /api/v1/helpdesk/tickets/<id>/<id>` `cap helpdesk.tickets.write` | automated | `e2e/tests/helpdesk.e2e.ts` [HD-30] (same journey); run 2026-11-17, passed |
| HD-32 | الإغلاق وإعادة الفتح | custom role (`helpdesk_manager` «مدير الدعم الفني») | «إغلاق التذكرة» moves the ticket to «مغلق», hides the stage select, «تعديل التذكرة» and «إغلاق التذكرة», shows «تاريخ الإغلاق», and offers «إعادة الفتح»; reopening returns it to «جديد» | `POST /api/v1/helpdesk/tickets/<id>/<id>` `cap helpdesk.tickets.close` | automated | `e2e/tests/helpdesk.e2e.ts` [HD-30] (same journey); a second close answers 409 «the ticket is already closed»; run 2026-11-17, passed |
| HD-33 | الوكيل يعدّل بيانات التذكرة | custom role (`helpdesk_agent` «وكيل الدعم الفني») | `/helpdesk/[id]/edit` changes the subject, the priority and the classification; the record shows the saved values, and a closed ticket offers no edit page | `page /helpdesk/[id]/edit` `PATCH /api/v1/helpdesk/tickets/<id>` | automated | `e2e/tests/helpdesk.e2e.ts` [HD-33]: an agent without `tickets.assign` renames a ticket and raises its priority from `/helpdesk/[id]/edit`, and the page returns to the record; run 2026-11-17, passed. The same team is no move: `test_an_agent_without_assign_saves_the_form_with_the_same_team_but_cannot_move_it` |
| HD-34 | نقل التذكرة إلى فريق آخر | custom role (`helpdesk_agent` «وكيل الدعم الفني») | A write-only agent is refused (403 «moving the ticket to another team needs the assign capability»); a supervisor may move it and the aside names the new team | `PATCH /api/v1/helpdesk/tickets/<id>` `cap helpdesk.tickets.assign` | planned | |
| HD-35 | إسناد إلى مستخدم ليس داخليًا في الشركة | custom role (`helpdesk_supervisor` «مشرف الدعم الفني») | 422 «the assignee is not an internal user of the company» on `assignee_id` | `POST /api/v1/helpdesk/tickets/<id>/<id>` | planned | |
| HD-36 | مرحلة لا تخص فريق التذكرة | custom role (`helpdesk_supervisor` «مشرف الدعم الفني») | 422 «the stage does not belong to the ticket team» on `stage_id` | `POST /api/v1/helpdesk/tickets/<id>/<id>` | planned | |

## Replies, internal notes and attachments

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| HD-40 | الردّ العام يسجّل أول ردّ | custom role (`helpdesk_manager` «مدير الدعم الفني») | The reply joins the thread with no internal badge and the aside's «أول ردّ» stops saying «بانتظار أول ردّ»; the metric is set once | `POST /api/v1/helpdesk/tickets/<id>/messages` `GET /api/v1/helpdesk/tickets/<id>/messages` | automated | `e2e/tests/helpdesk.e2e.ts` [HD-30] (same journey); the reply and the internal note are sent from the composer; run 2026-11-17, passed |
| HD-41 | الملاحظة الداخلية تبقى للفريق | custom role (`helpdesk_manager` «مدير الدعم الفني») | The switch «ملاحظة داخلية لا تظهر لمقدّم الطلب» posts a message the thread badges «ملاحظة داخلية»; the customer's page never shows it | `POST /api/v1/helpdesk/tickets/<id>/messages` `cap helpdesk.tickets.write` | automated | `e2e/tests/helpdesk.e2e.ts` [HD-30] (same journey); the customer page filters internal subtypes; run 2026-11-17, passed |
| HD-42 | تحقق نص الردّ | custom role (`helpdesk_agent` «وكيل الدعم الفني») | An empty body and a body over 5000 characters answer 422 on `body`; `internal` must be a boolean and only an agent writes a note (403 otherwise) | `POST /api/v1/helpdesk/tickets/<id>/messages` | planned | The requester's refusal is asserted by HD-24 |
| HD-43 | إرفاق ملف بالتذكرة | custom role (`helpdesk_agent` «وكيل الدعم الفني») | «إرفاق ملف» uploads, the attachment is listed with its name, the download link answers its bytes and the delete button removes it | `POST /api/v1/helpdesk/tickets/<id>/attachments` `GET /api/v1/helpdesk/tickets/<id>/attachments` `GET /api/v1/helpdesk/tickets/<id>/attachments/<id>/download` `DELETE /api/v1/helpdesk/tickets/<id>/attachments/<id>` | planned | The upload is a client mutation of the same shape as HD-100's, so a run should confirm it first; `liwan_helpdesk` `test_helpdesk_tickets.py` proves the four routes |

## Merging duplicates

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| HD-50 | دمج مكرّرة في التذكرة الباقية | custom role (`helpdesk_supervisor` «مشرف الدعم الفني») | The duplicate closes (its stage is «مغلق»), its attachments and tags move to the target, and both tickets carry the merge note; the duplicate's record draws no «دمج المكرّرة» | `POST /api/v1/helpdesk/tickets/<id>/merge` `cap helpdesk.tickets.merge` | automated | `e2e/tests/helpdesk.e2e.ts` [HD-50]; the merge is the route through the page's session, the section's own button is not clicked; run 2026-11-17, passed |
| HD-51 | الدمج في تذكرة مغلقة | custom role (`helpdesk_manager` «مدير الدعم الفني») | 409 «a closed ticket cannot absorb others», and a closed ticket draws no merge section | `POST /api/v1/helpdesk/tickets/<id>/merge` | planned | |
| HD-52 | دمج تذكرة خارج المتناول | custom role (`helpdesk_manager` «مدير الدعم الفني») | 422 «a ticket to merge does not exist or is out of reach» on `source_ids`; an empty list answers «name at least one ticket to merge» | `POST /api/v1/helpdesk/tickets/<id>/merge` | planned | |

## The queue, the filters and the list

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| HD-60 | شرائح الطابور والفلاتر تسكن العنوان | custom role (`helpdesk_supervisor` «مشرف الدعم الفني») | «المفتوحة»/«المغلقة»/«الكل» set `state`, the assignee filter sets `assignee`, and the search box sets `q`; opening a record and pressing Back returns to the same filtered list with the same rows | `page /helpdesk` `GET /api/v1/helpdesk/tickets` | automated | `e2e/tests/helpdesk.e2e.ts` [HD-50] (the queue step: «الكل», the search, the ticket and Back keep `state` and `q` in the address); run 2026-11-17, passed |
| HD-61 | لا تذكرة في الطابور | custom role (`helpdesk_agent` «وكيل الدعم الفني») | The empty state says «لا توجد تذاكر في هذا الطابور.» and, under a filter, offers «إزالة الفلاتر» | `page /helpdesk` | planned | |
| HD-62 | الترقيم و`?page=` مكتوب يدويًا | custom role (`helpdesk_agent` «وكيل الدعم الفني») | The footer reads «{shown} من {total} تذكرة»; a page past the last is replaced by the last page instead of an empty list | `page /helpdesk` | planned | |
| HD-63 | قوائم المرجع تملأ الفلاتر والنموذج والمراحل | custom role (`helpdesk_agent` «وكيل الدعم الفني») | «كل الفرق» lists the company's teams, «كل المراحل» the four shared stages with «مغلق» last, and the create form's team, category, type and channel selects offer the same records; the record's stage select offers the open stages only | `page /helpdesk` `page /helpdesk/new` `page /helpdesk/[id]` `GET /api/v1/helpdesk/reference` | automated | `e2e/tests/helpdesk.e2e.ts` [HD-30] reads the same lists to move the stage; the reference carries the tenant's own stages only (HD-103, archived engine set); run 2026-11-17, passed |

## The reports page

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| HD-70 | فتح التقارير وتغيير الفترة | custom role (`helpdesk_supervisor` «مشرف الدعم الفني») | The page names «أول ردّ», «الحل», «الالتزام بالمهل» and «تذاكر مفتوحة» with their hints, the agent load and the tickets by stage; the period select reads «آخر ٣٠ يومًا», and choosing «آخر ٧ أيام» puts `?period=7` in the address | `page /helpdesk/reports` `GET /api/v1/helpdesk/reports` `cap helpdesk.reports.read` | automated | `e2e/tests/helpdesk.e2e.ts` [HD-50] (the reports step: four figures, the agent load, the tickets by stage, the period in the address); run 2026-11-17, passed |
| HD-71 | هدف صفري لا يُعلن نتيجة كاملة | custom role (`helpdesk_manager` «مدير الدعم الفني») | With the first-response target at 0 the tile reads «بلا هدف مضبوط» and keeps the neutral tone, whatever the measured hours are | `GET /api/v1/helpdesk/reports` | planned | |
| HD-72 | عدّادات الطابور | custom role (`helpdesk_agent` «وكيل الدعم الفني») | The counter route answers the four figures of what the caller reads (open, unassigned, mine, overdue) and counts nothing outside their visibility | `GET /api/v1/helpdesk/summary` | gap | The route is implemented and tested on the server (`liwan_helpdesk` `test_helpdesk_tickets.py`), but no page draws it: `useHelpdeskSummary` in `apps/web/app/composables/helpdesk/useHelpdesk.ts` has no consumer, so the queue shows no counters and the row cannot be exercised through the UI. Either draw the counters on `/helpdesk` or delete the composable |

## The settings page

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| HD-80 | بطاقة السياسة تقول من يرى أي تذكرة | custom role (`helpdesk_manager` «مدير الدعم الفني») | «سياسة الدعم» offers «تذاكري»/«فريقي»/«الشركة» with their hint, the default team and priority, the prefix, the reopen window, the two targets, the customer's page switch and automatic closing; saving writes with the revision, and a stale revision answers 409 «the Support Desk settings changed; reload before saving» | `page /settings/apps/helpdesk` `GET /api/v1/helpdesk/settings` `PATCH /api/v1/helpdesk/settings` `cap helpdesk.settings.manage` | automated | `e2e/tests/helpdesk-settings.e2e.ts` [HD-80]: the policy is saved from the page's one save bar, the bar leaves after the save, a stale revision answers 409, and the policy is put back; run 2026-11-17, passed |
| HD-81 | نمط قطاع يضبط خمس قيم معًا | custom role (`helpdesk_manager` «مدير الدعم الفني») | Choosing «دعم تقني», «صيانة ومرافق», «خدمات المستفيدين», «دعم ما بعد البيع», «رعاية وعيادات» or «تعليم» writes that preset's visibility, reopen window, first response, resolution and default priority, and leaves every other key and every list untouched | `page /settings/apps/helpdesk` `PATCH /api/v1/helpdesk/settings` | planned | The preset select is a form write on the same card as HD-80; the blocker (HD-100) is fixed, no journey drives it yet |
| HD-82 | فريق جديد بأعضائه وقائده | custom role (`helpdesk_manager` «مدير الدعم الفني») | «فريق جديد» saves a name and its members; the leader must be a member (422 otherwise); the default team cannot be archived, and a team whose tickets are still open answers 422 «the team still has open tickets» | `page /settings/apps/helpdesk` `GET /api/v1/helpdesk/settings/resources` `POST /api/v1/helpdesk/settings/teams` | automated | `e2e/tests/helpdesk-settings.e2e.ts` [HD-82]: a team is saved from the form, the default team refuses to be archived (422), the row's switch archives another and shows «مؤرشف»; run 2026-11-17, passed |
| HD-83 | المراحل والقوائم الأربع | custom role (`helpdesk_manager` «مدير الدعم الفني») | «مرحلة جديدة» saves its name, order, the closed/unattended/folded flags and its teams; a stage holding open tickets is not archived; categories keep a parent and refuse a cycle; tags, channels and types are renamed and archived inline | `page /settings/apps/helpdesk` `POST /api/v1/helpdesk/settings/stages` `POST /api/v1/helpdesk/settings/categories` `POST /api/v1/helpdesk/settings/tags` `POST /api/v1/helpdesk/settings/channels` `POST /api/v1/helpdesk/settings/types` | automated | `e2e/tests/helpdesk-settings.e2e.ts` [HD-83]: a stage and the value lists are saved, an archived row stays listed, a category refuses a cycle; `liwan_helpdesk` `test_helpdesk_resources.py` proves each server guard; run 2026-11-17, passed |
| HD-84 | اتفاقيات مستوى الخدمة | custom role (`helpdesk_manager` «مدير الدعم الفني») | «اتفاقية جديدة» saves a name, a target of whole days and hours (never zero), its target stage and optionally its teams, categories, tags and the stages that pause the clock; the row reads «X يوم Y ساعة · حتى <stage>» with its ticket count; archiving the policy clears its deadlines | `page /settings/apps/helpdesk` `GET /api/v1/helpdesk/sla` `POST /api/v1/helpdesk/sla` `POST /api/v1/helpdesk/sla/<id>/active` | automated | `e2e/tests/helpdesk-settings.e2e.ts` [HD-84]: a service level is saved over the rows of a retired one and archived from its row; `test_helpdesk_sla.py` `test_a_policy_is_saved_over_rows_of_a_retired_policy` proves the server half; run 2026-11-17, passed |
| HD-85 | حامل المفتاح بلا حق الإعدادات | custom role (`helpdesk_agent` «وكيل الدعم الفني») | Both settings routes answer 403 `forbidden` and `/settings/apps/helpdesk` shows the forbidden state | `page /settings/apps/helpdesk` `GET /api/v1/helpdesk/settings` `cap helpdesk.settings.read` | automated | `e2e/tests/helpdesk.e2e.ts` [HD-85] (the settings, resources and service-level routes, and the forbidden heading); run 2026-11-17, passed |

## The customer's page

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| HD-90 | العميل يردّ ويغلق الطلب | anonymous visitor holding the ticket's link | The record's «صفحة العميل» card copies `/support/<id>?token=<token>`; the page reads with no account, shows the request and the public thread (never an internal note), the reply joins the thread, and «إغلاق الطلب» asks first («هل تريد إغلاق هذا الطلب؟») and then closes it | `page /support/[id]` `GET /api/v1/public/helpdesk/tickets/<id>` `POST /api/v1/public/helpdesk/tickets/<id>/messages` `POST /api/v1/public/helpdesk/tickets/<id>/close` | planned | The token is the whole credential; never share a copied link beyond test data |
| HD-91 | رابط خاطئ وصفحة مغلقة يعطيان الجواب نفسه | anonymous visitor | A wrong or expired token, another tenant's ticket, a missing ticket and `helpdesk.portal` off all answer 404, and the page shows «الرابط غير صالح» with «انتهت صلاحية هذا الرابط أو أنه لا يخصّ طلبًا قائمًا.» | `GET /api/v1/public/helpdesk/tickets/<id>` | planned | `liwan_helpdesk` `test_helpdesk_portal.py` proves the constant answer |
| HD-92 | التذكرة المغلقة ترفض الردّ | anonymous visitor | Replying to a closed ticket answers 422 «the ticket is closed», and the composer and the close button are not drawn | `POST /api/v1/public/helpdesk/tickets/<id>/messages` | planned | |

## Bridges with other applications

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| HD-95 | تحويل محادثة إلى تذكرة | custom role (`helpdesk_agent` + `inbox.conversations.read`) | The agent raises a ticket from the conversation: it names the conversation's customer as the requester and copies the last messages into the description; a second attempt answers 409 «this conversation already has a ticket» | `POST /api/v1/inbox/conversations/<id>/ticket` | planned | `liwan_helpdesk_inbox` `test_conversation_ticket.py`; needs both applications' features on |
| HD-96 | ربط التذكرة بفرصة في العملاء | custom role (`helpdesk_agent` + `crm.leads.read`) | The record links one opportunity the agent may see; a hidden one answers 404 and another company's answers 422 «the opportunity belongs to another company» | `POST /api/v1/helpdesk/tickets/<id>/opportunity` | planned | `liwan_helpdesk_crm` `test_ticket_opportunity.py` |
| HD-97 | حفظ مستند على التذكرة | custom role (`helpdesk_agent` + `documents.items.read`) | The ticket is offered as a documents context to its holder only, and a document filed against it opens from the ticket | `cap helpdesk.tickets.read` | planned | `liwan_helpdesk_documents` `test_ticket_documents.py`; the bridge adds no route of its own |
| HD-98 | فتح عرض سعر على عميل التذكرة | custom role (`helpdesk_agent` + `sales.read`, `sales.quotations.manage`) | The ticket lists its quotations; opening one needs the ticket's customer, and a ticket without a customer or a closed one is refused | `GET /api/v1/helpdesk/tickets/<id>/quotations` `POST /api/v1/helpdesk/tickets/<id>/quotations` | planned | `liwan_helpdesk_sales` `test_ticket_quotations.py` |
| HD-99 | مهمة متابعة على التذكرة | custom role (`helpdesk_agent` + `tasks.tasks.create`) | The agent creates a follow-up task with a due date and the ticket lists its tasks; a closed or foreign ticket is refused | `GET /api/v1/helpdesk/tickets/<id>/tasks` `POST /api/v1/helpdesk/tickets/<id>/tasks` | planned | `liwan_helpdesk_tasks` `test_ticket_tasks.py` |

## Defects found by reading the code (2026-11-16, not yet run)

Both rows were found by reading the source on the branch `codex/helpdesk`, not by a test run. They are
recorded here so no row above claims a behaviour the product does not have; neither is fixed by the test
change that added this register (the fix belongs to `apps/web/app/composables/helpdesk/useHelpdesk.ts` and
`odoo-addons/liwan_helpdesk/serializers/ticket.py`, outside that change's file ownership).

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| HD-100 | كل كتابة من الواجهة تُرفض عند التحقق من العقد | custom role (`helpdesk_manager` «مدير الدعم الفني») | Creating, editing, assigning, moving the stage, closing, reopening and merging must accept the record the server answers | `POST /api/v1/helpdesk/tickets` `PATCH /api/v1/helpdesk/tickets/<id>` `POST /api/v1/helpdesk/tickets/<id>/<id>` `POST /api/v1/helpdesk/tickets/<id>/merge` | automated | `liwan_helpdesk` `test_helpdesk_tickets.py` `test_every_write_answers_the_detail_shape`: every write answers the detail shape (`attachments` included) that the strict client schema parses. Fixed in `controllers/tickets.py` (commit 222d8f109); the create and edit screens now run it end to end in `e2e/tests/helpdesk.e2e.ts` [HD-20] and [HD-33] (the stage select, assign and merge buttons are still not clicked) |
| HD-101 | عنوان حقل الرؤية في بطاقة السياسة ليس نصًا | custom role (`helpdesk_manager` «مدير الدعم الفني») | The field is labelled with a sentence, like its hint | `page /settings/apps/helpdesk` | automated | `e2e/tests/helpdesk-settings.e2e.ts` [HD-102] asserts the visibility field is labelled «من يرى التذاكر»; fixed with the key `helpdesk.settings.visibilityLabel` |
| HD-102 | بطاقة السياسة تترك حقولها مفتوحة لمن لا يملك الحفظ | custom role (`helpdesk_supervisor` «مشرف الدعم الفني») | A viewer sees the fields closed and the card marked «عرض فقط», so no draft can be started | `page /settings/apps/helpdesk` `cap helpdesk.settings.manage` | automated | `e2e/tests/helpdesk-settings.e2e.ts` [HD-102]: a supervisor with only `settings.read` sees «عرض فقط» and every control of the policy card disabled; the card's controls are locked without the manage key and before hydration |
| HD-103 | مراحل المحرك الإنجليزية تظهر في كل فريق | custom role (`helpdesk_manager` «مدير الدعم الفني») | The stage select offers the tenant's own Arabic stages, and a new ticket lands on «جديد» | `page /helpdesk` `GET /api/v1/helpdesk/reference` `POST /api/v1/helpdesk/tickets` | automated | `liwan_helpdesk` `test_helpdesk_tickets.py` `test_the_engine_english_stages_are_archived_and_never_offered`: the install hook archives the engine's six stages (they carry no company, so the old binding never matched), `/reference` and the settings list leave them out, and a ticket closes in the tenant's own «مغلق» |
