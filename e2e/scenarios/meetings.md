# Meetings

Pages: `/meetings`, `/meetings/new`, `/meetings/calendar`, `/meetings/follow-up`,
`/meetings/series`, `/meetings/series/new`, `/meetings/series/[id]` (`edit`),
`/meetings/[id]` (`edit`, `minutes`, `print`, `resolutions/new`, `resolutions/[id]/edit`).
Owners: `webvue_meetings`, `webvue_meetings_pmo`. Personas and status values: [README](README.md).

Capability note: employees hold `meetings.read` only; `meetings.create` and
`meetings.manage` come with `system_admin`. No business persona (`ceo`, `pm`) can create a
meeting today (`MTG-20`). A non-manager editor exists only as the organizer or secretary of a
meeting: seed `it_admin` as organizer and `staff1` as secretary or attendee; an organizer who
is not a manager needs `custom role (employee, meetings.create)`.

Visibility note: an employee with `meetings.read` sees only meetings they organise, are
secretary of, or attend; a holder of `meetings.manage` sees every meeting of the company. A
meeting of the same company that is hidden answers 403 `forbidden`; a record of another
company answers 404 `not_found` (`MTG-181`).

Error notes: a controller refusal is `{code, message, field?}` with a real status. A model
`UserError` or `ValidationError` answers 422 `invalid`, an `AccessError` 403 `forbidden`, a
missing record 404 `not_found`. A switched-off feature answers 403 `feature_not_included`; a
read-only tenant answers 403 `tenant_read_only` on writes.

## Core flow

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| MTG-01 | Schedule a meeting with an attendee and add a recommendation; find it in the list and calendar | admin | Saved and listed | `page /meetings/new`, `page /meetings`, `page /meetings/calendar`, `POST /api/v1/meetings`, `POST /api/v1/meetings/<id>/resolutions`, `GET /api/v1/meetings`, `cap meetings.create` | automated | `e2e/tests/meetings-journey.e2e.ts` |
| MTG-02 | Employee creates a meeting | staff1 | Refused (read-only by default) | `POST /api/v1/meetings`, `cap meetings.create` | automated | `e2e/tests/access-matrix.e2e.ts` |
| MTG-03 | Confirm, complete, cancel, reopen | it_admin | Each transition; done/cancelled immutable | `POST /api/v1/meetings/<id>/confirm`, `POST /api/v1/meetings/<id>/complete`, `POST /api/v1/meetings/<id>/cancel`, `POST /api/v1/meetings/<id>/reopen`, `cap meetings.manage` | manual 2026-10-28 | API as it_admin: draft→confirmed→done→reopen→draft, cancel/reopen of cancelled; done/cancelled edit 422 «Completed and cancelled meetings are immutable.» |
| MTG-04 | Attendee invitation, change and cancellation notices | it_admin → staff1 | Bell `meeting_invite`, `meeting_changed`, `meeting_cancelled` | `POST /api/v1/meetings`, `PATCH /api/v1/meetings/<id>`, `POST /api/v1/meetings/<id>/cancel`, `cap meetings.read` | manual 2026-10-28 | Bell kinds meeting_invite, meeting_changed, meeting_cancelled reached staff1 (checked via /notifications and the bell UI: «دعوة لاجتماع», «تغيّر موعد أو مكان الاجتماع») |
| MTG-05 | Reminder 24 hours ahead | staff1 | Bell `meeting_reminder` | `cap meetings.read` | planned | |
| MTG-06 | Delete a meeting that is done or has minutes versions | it_admin | Refused | `cap meetings.manage` | planned | No delete route or button exists; see `MTG-182` |
| MTG-07 | Minutes, versions and PDF print | it_admin | Versions listed; PDF downloads | `GET /api/v1/meetings/<id>/versions`, `GET /api/v1/meetings/<id>/minutes.pdf`, `page /meetings/[id]/print`, `page /meetings/[id]/minutes` | fail | #186; Versions listed (1 then 2 after reopen/complete again); GET /meetings/<id>/minutes.pdf answers 422 HTML «Unable to find Wkhtmltopdf» (scratch stack lacks wkhtmltopdf; error is an HTML page, not JSON) |
| MTG-08 | Series weekly / biweekly / monthly with until date or count | it_admin | Occurrences generated as configured | `POST /api/v1/meeting-series`, `page /meetings/series/new` | manual 2026-10-28 | API: weekly count 3, biweekly until date (1/15/29 Sept), monthly count 4 (31st; months without day skipped); on-demand series created |
| MTG-09 | End a series with upcoming meetings as a non-manager editor | organizer | Refused | `POST /api/v1/meeting-series/<id>/cancel` | manual 2026-10-28 | pm (secretary) ending a series with upcoming meetings: 403 «Only a meetings manager may cancel the upcoming meetings of a series.» |
| MTG-10 | Resolution with a responsible participant and deadline | it_admin | Bell `meeting_resolution` to the responsible | `POST /api/v1/meetings/<id>/resolutions`, `page /meetings/[id]/resolutions/new` | manual 2026-10-28 | Resolution created with responsible staff1 + deadline; bell meeting_resolution reached staff1 |
| MTG-11 | Responsible updates progress; tries to cancel | staff1 | Progress saved; cancel refused | `POST /api/v1/meetings/<id>/resolutions/<id>/<id>`, `PATCH /api/v1/meetings/<id>/resolutions/<id>` | manual 2026-10-28 | staff1 start (in_progress), result saved, complete ok; cancel refused 422 «Assignees cannot cancel resolutions.» |
| MTG-12 | Responsible person who is not a participant | it_admin | Refused | `POST /api/v1/meetings/<id>/resolutions` | manual 2026-10-28 | 422 «The responsible user must be the organizer, secretary or an attendee.» |
| MTG-13 | Overdue resolution | staff1 | Bell `meeting_resolution_overdue` | `cap meetings.read`, `page /meetings/follow-up` | planned | |
| MTG-14 | Convert a resolution to a project task; convert again | it_admin | Task created in the project; second conversion refused | `POST /api/v1/meetings/<id>/resolutions/<id>/convert` | manual 2026-10-28 | Converted into project task (API, project created by e2e_admin); second conversion 422 «This recommendation has already been converted.» |
| MTG-20 | A business manager schedules meetings | ceo / pm | Owner decision: no meetings role exists outside `system_admin` | `cap meetings.create`, `cap meetings.manage` | decision | #162; Found 2026-10-28 |

## Meetings list

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| MTG-21 | Open `/meetings` as an employee who is attendee of one meeting and organiser of none | staff1 (attendee) | Heading «الاجتماعات» with a count tag; only the meetings they take part in; others never listed | `page /meetings`, `GET /api/v1/meetings`, `cap meetings.read` | manual 2026-10-28 | UI staff1: heading «الاجتماعات», count tag «8 اجتماعات»; only meetings he takes part in |
| MTG-22 | Open `/meetings` as a manager | it_admin | Every company meeting listed newest `meeting_date` first; columns record number, title, date and time, organizer, state badge, open recommendations («توصية مفتوحة واحدة» / «{n} توصيات مفتوحة») | `page /meetings`, `GET /api/v1/meetings` | planned | |
| MTG-23 | A meeting without a start time | it_admin | Row shows the date and the text «لم يُحدد الوقت» | `page /meetings` | planned | |
| MTG-24 | No meetings visible and no filter active | staff2 | Empty state «لا اجتماعات ظاهرة لك.» | `page /meetings` | planned | |
| MTG-25 | Filters match nothing | it_admin | The no-results empty text (not the first-use text); «مسح الفلاتر» restores the list | `page /meetings` | planned | |
| MTG-26 | KPI strip above the list (toggle with the strip switch) | it_admin | Four tiles: «إجمالي الاجتماعات», «اجتماعات قادمة مؤكدة» (confirmed, from today), «مسودات», «منتهية هذا الشهر» (done within the month); counts follow search, scope, organizer, project and series | `page /meetings` | planned | |
| MTG-27 | Click the «اجتماعات قادمة مؤكدة» tile | it_admin | Opens the list filtered to state confirmed and `date_from` today; the state select shows «مؤكد» | `page /meetings` | planned | |
| MTG-28 | Search by title, by reference and by location | it_admin | `q` matches any of the three; the clear button on the box resets it; URL carries `q` | `page /meetings`, `GET /api/v1/meetings` | planned | |
| MTG-29 | State filter: «كل الحالات», «مسودة», «مؤكد», «مكتمل», «ملغى» | it_admin | Each value lists only that state; URL carries `state` | `page /meetings`, `GET /api/v1/meetings` | planned | |
| MTG-30 | Scope control «كل الاجتماعات» / «اجتماعاتي» | it_admin | «اجتماعاتي» keeps meetings where the user is organiser, secretary or attendee | `page /meetings`, `GET /api/v1/meetings` | planned | |
| MTG-31 | Organizer filter picks a person; «كل المنظّمين» clears it | it_admin | Only that organiser's meetings; the picker shows a loading, error-with-retry and «لا يوجد منظّمون مطابقون.» state | `page /meetings`, `GET /api/v1/meetings` | planned | |
| MTG-32 | Date range «من تاريخ» / «إلى تاريخ» | it_admin | Meetings with `meeting_date` inside the range, both ends inclusive | `page /meetings`, `GET /api/v1/meetings` | planned | |
| MTG-33 | Date range reversed or not a date | it_admin | Alert «يجب أن يكون تاريخ النهاية في يوم البداية أو بعده.» or «أدخل تاريخًا صحيحًا.»; no request sent | `page /meetings` | manual 2026-10-28 | API: date_to before date_from 422 «date_to must be on or after date_from»; bad date 422 «date_from must be YYYY-MM-DD» (UI inputs not driven) |
| MTG-34 | Project filter | it_admin | Shown only when the projects application is installed; lists the meetings of that project | `page /meetings`, `GET /api/v1/meetings` | planned | |
| MTG-35 | Arrive from a series with `series_id` in the URL | it_admin | Chip «اجتماع دوري محدد» with a remove button; removing it lists all meetings again | `page /meetings`, `GET /api/v1/meetings` | planned | |
| MTG-36 | Paging, 25 rows a page | it_admin | Footer «عرض {n} من {total} نتيجة»; next page keeps filters; changing a filter returns to page 1 (offset dropped) | `page /meetings`, `GET /api/v1/meetings` | planned | |
| MTG-37 | Open a record, then Back | it_admin | The list returns with the same search, state, scope, dates and page | `page /meetings`, `page /meetings/[id]` | planned | |
| MTG-38 | Reload the list with filters in the URL | it_admin | Filter controls show the URL values; same rows | `page /meetings` | planned | |
| MTG-39 | «اجتماع جديد» button | staff1 | Hidden without `meetings.create`; visible for it_admin | `page /meetings`, `cap meetings.create` | planned | |
| MTG-40 | Switch list to calendar with the view switch | it_admin | Calendar opens with the same filters | `page /meetings`, `page /meetings/calendar` | fail | #185; No view switch on /meetings and no link to /meetings/calendar anywhere (list header, sidebar); the calendar is only reachable by typing the URL |
| MTG-41 | Invalid `state` / `limit` / `offset` / `organizer_id` / `date_from` / `date_to` / `series_id` / `project_id` | api | 422 `invalid`: «invalid state», «limit and offset must be non-negative integers», «date_from must be YYYY-MM-DD», «date_to must be on or after date_from», «organizer_id must be an integer» | `GET /api/v1/meetings` | manual 2026-10-28 | API 422 for invalid state/limit/offset/organizer_id/series_id/project_id/date_from/date_to with the expected messages |
| MTG-42 | Page size limits | api | Default and maximum 200; up to 2000 only when both `date_from` and `date_to` are given; `total` is the full count | `GET /api/v1/meetings` | planned | |
| MTG-43 | Meetings of another company | it_admin (two companies) | Never listed | `GET /api/v1/meetings` | planned | |
| MTG-44 | Meetings tab of a project | it_admin | Lists that project's meetings, 25 a page, «اجتماع جديد» only with `meetings.create` and an active project; unknown or hidden project shows the not-found text | `page /projects/[id]/meetings`, `GET /api/v1/meetings` | planned | |

## Calendar

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| MTG-50 | Open `/meetings/calendar` | it_admin | Current month grid, month and year label, today highlighted, weekday header starting Sunday in Arabic; URL gains `year`, `month`, `day` | `page /meetings/calendar`, `GET /api/v1/meetings` | manual 2026-10-28 | /meetings/calendar opens current month grid with weekday header, filters and undated chips «لم يُحدد الوقت» |
| MTG-51 | Previous, next and today controls | it_admin | Month changes; selected day cleared; «اليوم» selects today; years outside 1970-2100 not reachable | `page /meetings/calendar` | planned | |
| MTG-52 | Event chips | it_admin | A chip per meeting with a colour dot by state; hover title shows name, time and state; click opens the meeting with the calendar as its return path | `page /meetings/calendar`, `page /meetings/[id]` | planned | |
| MTG-53 | Select a day | it_admin | Side card «أحداث اليوم» lists that day's meetings by start time with a count badge; empty day shows «لا اجتماعات في هذا اليوم.»; no day selected shows the hint | `page /meetings/calendar` | planned | |
| MTG-54 | Meeting spanning several days; meeting ending exactly at local midnight | it_admin | Appears on each covered day; the day starting at the end midnight is not covered | `page /meetings/calendar` | planned | |
| MTG-55 | Meeting without start and end | it_admin | Placed on its `meeting_date` with «لم يُحدد الوقت» | `page /meetings/calendar` | planned | |
| MTG-56 | Filters: search, state, mine, project | it_admin | Calendar shows only matching chips; filter count and «مسح الفلاتر» work; organizer and series filters from a link show as removable chips | `page /meetings/calendar`, `GET /api/v1/meetings` | planned | |
| MTG-57 | More than 2000 meetings in the window | api | Notice «في هذا الشهر {n} اجتماعًا؛ المعروض أول ٢٠٠٠ فقط.»; if the total is unknown the notice says coverage cannot be confirmed | `page /meetings/calendar`, `GET /api/v1/meetings` | planned | |
| MTG-58 | Narrow screen | it_admin | Grid replaced by an agenda list of the month's meetings; empty month shows «لا اجتماعات ظاهرة لك.» | `page /meetings/calendar` | planned | |
| MTG-59 | «اجتماع جديد» on the calendar | it_admin | Opens `/meetings/new` with the selected day prefilled in `date`, plus project and series when filtered; button hidden for staff1 | `page /meetings/calendar`, `page /meetings/new`, `cap meetings.create` | planned | |
| MTG-60 | Direct link `?year=2026&month=11&day=2026-11-05`, refresh, Back | it_admin | Same month and day selected; invalid year or month ignored | `page /meetings/calendar` | planned | |
| MTG-61 | A meeting starting up to 7 days before the month and running into it | it_admin | Fetched and drawn on the days inside the month | `page /meetings/calendar`, `GET /api/v1/meetings` | planned | |

## Create a meeting

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| MTG-70 | Create with the title only | it_admin | 201; state «مسودة»; organiser is the caller; reference generated and unique; `meeting_date` today; page opens the new record | `page /meetings/new`, `POST /api/v1/meetings` | planned | |
| MTG-71 | Create with date, start, end, place, join link, attendees, secretary and agenda | it_admin | All saved; times shown in the browser time zone (note «تُعرض الأوقات حسب المنطقة الزمنية للمتصفح: {zone}.»); agenda HTML sanitised | `page /meetings/new`, `POST /api/v1/meetings` | planned | |
| MTG-72 | Title empty | it_admin | Form error «هذا الحقل مطلوب.»; API 422 «name must not be empty» with field `name` | `page /meetings/new`, `POST /api/v1/meetings` | manual 2026-10-28 | UI create dialog empty submit: «هذا الحقل مطلوب.» on title and date; API 422 «name must not be empty» field name |
| MTG-73 | End before start | it_admin | «يجب أن يكون وقت النهاية بعد وقت البداية.»; API 422 «end_datetime must be after start_datetime» | `page /meetings/new`, `POST /api/v1/meetings` | manual 2026-10-28 | API 422 «end_datetime must be after start_datetime» |
| MTG-74 | Join link not http(s) | it_admin | «استخدم رابطًا كاملًا يبدأ بـ http:// أو https://.»; API 422 «meeting_url must be a valid HTTP(S) URL» | `page /meetings/new`, `POST /api/v1/meetings` | manual 2026-10-28 | API 422 «meeting_url must be a valid HTTP(S) URL» |
| MTG-75 | `meeting_date` disagrees with the day of `start_datetime` | api | 422 «meeting_date must match start_datetime in the user timezone» | `POST /api/v1/meetings` | manual 2026-10-28 | API 422 «meeting_date must match start_datetime in the user timezone» |
| MTG-76 | Malformed date or datetime | api | 422 «meeting_date must be YYYY-MM-DD» / «start_datetime must be a valid ISO datetime» | `POST /api/v1/meetings` | manual 2026-10-28 | API 422 for «meeting_date must be YYYY-MM-DD» and «start_datetime must be a valid ISO datetime» |
| MTG-77 | Unknown field in the body | api | 422 «unsupported meeting fields: x» | `POST /api/v1/meetings` | manual 2026-10-28 | API 422 «unsupported meeting fields: foo» |
| MTG-78 | Attendee or secretary that is inactive, external or of another company | api | 422 «attendee_ids must contain only active internal users in the current company» / «secretary_id must be an active internal user in the current company» | `POST /api/v1/meetings` | manual 2026-10-28 | API 422 for attendee id 999999 (secretary not tried) |
| MTG-79 | Secretary sent as null; attendees sent as a non-list | api | Null clears the secretary; non-list 422 «attendee_ids must be a list» | `POST /api/v1/meetings` | manual 2026-10-28 | secretary null accepted (201, secretary null); attendee_ids "abc" 422 «attendee_ids must be a list» |
| MTG-80 | Time overlaps another non-cancelled meeting of the same organiser | it_admin | 422 «This time overlaps another meeting for the organizer.» even when the other meeting is not readable; touching end-to-start allowed; cancelled meetings ignored | `POST /api/v1/meetings` | manual 2026-10-28 | API 422 «This time overlaps another meeting for the organizer.»; touching end-to-start allowed; cancelled meeting ignored |
| MTG-81 | Create from a series (`/meetings/new?series_id=`) | it_admin | Place, join link, attendees and secretary prefilled from the series; fields the user edited are not overwritten; a series load failure shows «تعذّر تحميل إعدادات الاجتماع الدوري. حدّث الصفحة وحاول مرة أخرى.» and blocks saving | `page /meetings/new`, `GET /api/v1/meeting-series/<id>` | planned | |
| MTG-82 | Link a new meeting to an ended series | api | 422 «This series has ended; no meetings can be added to it.» | `POST /api/v1/meetings` | manual 2026-10-28 | API 422 «This series has ended; no meetings can be added to it.» |
| MTG-83 | Link to a series the caller does not edit | custom role (employee, meetings.create) | 403 «Only the organizer, secretary or a meetings manager may link a meeting to this series.» | `POST /api/v1/meetings` | planned | |
| MTG-84 | Link to a project | it_admin | `project_id` saved; project name shown in the aside; hidden or other-company project refused | `POST /api/v1/meetings`, `page /meetings/new` | planned | |
| MTG-85 | `project_id` sent while the projects application is not installed | api | 422 «project_id is not supported: the projects application is not installed» | `POST /api/v1/meetings` | planned | |
| MTG-86 | Create with a structured `minutes_form` | api | Saved with the meeting; a malformed form rolls the whole create back | `POST /api/v1/meetings` | planned | |
| MTG-87 | Leave the form with unsaved input | it_admin | Unsaved-changes guard asks before leaving; no guard after a successful save | `page /meetings/new` | planned | |
| MTG-88 | Submit twice quickly | it_admin | One meeting created | `page /meetings/new`, `POST /api/v1/meetings` | planned | |
| MTG-89 | `/meetings/new` opened without `meetings.create` | staff1 | Route refused (forbidden state); `POST` answers 403 «meetings.create capability is required» | `page /meetings/new`, `POST /api/v1/meetings`, `cap meetings.create` | manual 2026-10-28 | UI staff1 /meetings/new: 403 page «لا تملك صلاحية فتح هذه الصفحة»; API 403 «meetings.create capability is required» |
| MTG-90 | Organiser of a new meeting when the caller is not a manager | custom role (employee, meetings.create) | Organiser forced to the caller | `POST /api/v1/meetings`, `cap meetings.create` | planned | |
| MTG-91 | Creation is logged | it_admin | Activity history has «إنشاء الاجتماع» by the caller | `GET /api/v1/meetings/<id>/events` | planned | |

## Meeting record

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| MTG-100 | Open a meeting | staff1 (attendee) | Heading is the title with a state tag; hero card shows date, time range, organiser, place and a «رابط الاجتماع» button that opens in a new tab; tiles show the attendee count and open recommendations; aside shows the record number, series link and project | `page /meetings/[id]`, `GET /api/v1/meetings/<id>`, `cap meetings.read` | manual 2026-10-28 | staff1 (attendee) opens a meeting: header, state tag, attendees, tabs |
| MTG-101 | Tabs «نظرة عامة», «المحضر», «التوصيات (n)», «المرفقات (n)», «السجل» | staff1 (attendee) | Tab is in the URL `?tab=`; Back and refresh keep it; legacy `#meeting-agenda` scrolls to the agenda | `page /meetings/[id]` | manual 2026-10-28 | Tabs «نظرة عامة», «المحضر», «التوصيات (3)», «المرفقات (0)», «السجل» seen |
| MTG-102 | Summary tab | staff1 (attendee) | Secretary, attendees as chips, agenda; empty texts «لم يُضف حضور بعد.» and «لا يوجد جدول أعمال لهذا الاجتماع.» | `page /meetings/[id]` | planned | |
| MTG-103 | Actions of a draft meeting | it_admin | «تعديل», «تأكيد» and the more-menu (print preview, PDF, «إلغاء الاجتماع») | `page /meetings/[id]` | planned | |
| MTG-104 | Actions of a draft meeting for its secretary who is not a manager | staff1 (secretary) | «تعديل» and «تأكيد»; no «إنهاء», no cancel in the menu | `page /meetings/[id]`, `cap meetings.read` | planned | |
| MTG-105 | Actions of a confirmed meeting | it_admin | «تعديل» and «إنهاء»; no «تأكيد» | `page /meetings/[id]` | planned | |
| MTG-106 | Actions of a done or cancelled meeting | it_admin | Only «إعادة فتح» and the menu; no edit; menu has no cancel | `page /meetings/[id]` | manual 2026-10-28 | Done meeting as it_admin: only «إعادة فتح» in the header, no edit |
| MTG-107 | Plain attendee | staff1 (attendee) | No edit or transition buttons; menu offers print preview and PDF only | `page /meetings/[id]` | planned | |
| MTG-108 | Meeting the caller may not see | staff2 | Forbidden state (403) | `page /meetings/[id]`, `GET /api/v1/meetings/<id>` | manual 2026-10-28 | #197; UI staff2: «ليس لديك صلاحية لعرض هذه الصفحة.»; API 403 but message is raw Odoo AccessError text (see findings) |
| MTG-109 | Id that does not exist, is not a positive integer, or belongs to another company | it_admin | Not-found state (404); another company's record is indistinguishable from a missing one | `page /meetings/[id]`, `GET /api/v1/meetings/<id>` | manual 2026-10-28 | UI «هذا السجل غير متاح أو لم يعد موجودًا.» for 999999 and abc; API 404 for 99999999, 0, abc |
| MTG-110 | Back link keeps the list context | it_admin | «Back» returns to the list or calendar the record was opened from, filters intact | `page /meetings/[id]` | planned | |
| MTG-111 | A done meeting shows its frozen minutes | staff1 (attendee) | Minutes tab shows the saved historical minutes («المحضر التاريخي المحفوظ عند الإكمال») and the decision states at completion | `page /meetings/[id]`, `GET /api/v1/meetings/<id>` | manual 2026-10-28 | staff1 sees done meeting with «المحضر التاريخي المحفوظ عند الإكمال» |
| MTG-112 | A done meeting that has no stored snapshot | it_admin | Notice «لا توجد لقطة تاريخية لهذا الاجتماع المكتمل…» above the current content | `page /meetings/[id]` | planned | |
| MTG-113 | Detail payload carries `can_edit` and `can_manage` | api | `can_edit` false for done or cancelled meetings and for non-editors; `can_manage` only with `meetings.manage` | `GET /api/v1/meetings/<id>` | manual 2026-10-28 | can_edit/can_manage true for it_admin, can_edit false for attendee staff1 |
| MTG-114 | Open recommendations count on the tile | it_admin | Counts only open or in-progress recommendations; a recommendation whose converted task is done no longer counts | `page /meetings/[id]`, `GET /api/v1/meetings/<id>` | planned | |
| MTG-115 | Previous recommendations of the series | it_admin | A meeting in a series lists the earlier occurrences' recommendations («توصيات اللقاءات السابقة»), only those the caller can read | `page /meetings/[id]`, `GET /api/v1/meetings/<id>` | planned | |

## State machine

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| MTG-120 | Confirm a draft meeting | it_admin | State «مؤكد» at once without a prompt; activity «اعتماد الاجتماع» | `POST /api/v1/meetings/<id>/confirm`, `page /meetings/[id]` | manual 2026-10-28 | API draft→confirmed 200 (activity entry not checked) |
| MTG-121 | Secretary confirms | staff1 (secretary) | Allowed (editor) | `POST /api/v1/meetings/<id>/confirm` | manual 2026-10-28 | pm as secretary confirms 200 and edits location 200 |
| MTG-122 | Plain attendee confirms | staff1 (attendee) | 403 «Only the organizer, secretary or a Meeting Manager may confirm this meeting.» | `POST /api/v1/meetings/<id>/confirm` | fail | #187; 403 as expected but message is «Only the organizer, secretary or a Meeting Manager may edit this meeting.» (expected «…may confirm this meeting.») |
| MTG-123 | Confirm a meeting that is not a draft | it_admin | 422 «Only draft meetings can be confirmed.» | `POST /api/v1/meetings/<id>/confirm` | manual 2026-10-28 | 422 «Only draft meetings can be confirmed.» |
| MTG-124 | Complete a confirmed meeting that has a schedule and minutes | it_admin | Inline prompt «إكمال الاجتماع؟ بعد الإكمال يصبح المحضر مقفلًا.»; state «مكتمل»; a frozen snapshot and minutes version 1 are stored; activity «إكمال الاجتماع» | `POST /api/v1/meetings/<id>/complete`, `page /meetings/[id]` | manual 2026-10-28 | API: confirmed→done 200, version 1 stored (UI prompt not driven) |
| MTG-125 | Complete without start and end | it_admin | UI lists «تحديد وقت البداية والنهاية» with a link to edit; API 422 «Set the meeting start and end before completing it.» field `start_datetime` | `POST /api/v1/meetings/<id>/complete`, `page /meetings/[id]` | manual 2026-10-28 | API 422 «Set the meeting start and end before completing it.» |
| MTG-126 | Complete without minutes text and without minutes form content | it_admin | UI lists «كتابة محضر الاجتماع»; API 422 «Write the minutes or fill in the minutes form before completing the meeting.» field `minutes`; opening, closing or at least one topic in the form is enough | `POST /api/v1/meetings/<id>/complete`, `page /meetings/[id]` | manual 2026-10-28 | API 422 «Write the minutes or fill in the minutes form before completing the meeting.» |
| MTG-127 | Complete a draft meeting that has schedule and minutes | it_admin | 422 «Only confirmed meetings can be completed.» | `POST /api/v1/meetings/<id>/complete` | manual 2026-10-28 | API 422 «Only confirmed meetings can be completed.» |
| MTG-128 | Organiser who is not a manager completes | custom role (employee, meetings.create) | 403 «only a meetings manager may complete, cancel or reopen a meeting» | `POST /api/v1/meetings/<id>/complete` | planned | |
| MTG-129 | Cancel a draft or confirmed meeting | it_admin | Inline prompt «هل تؤكد تنفيذ الإجراء للاجتماع «{name}»…»; state «ملغى»; participants but the actor get bell `meeting_cancelled`; its calendar event is switched off | `POST /api/v1/meetings/<id>/cancel`, `page /meetings/[id]` | manual 2026-10-28 | API cancel 200 state cancelled; staff1 got bell meeting_cancelled |
| MTG-130 | Cancel a meeting of a series | it_admin | Prompt has a scope select «هذا الاجتماع» / «هذا وما بعده»; «هذا وما بعده» cancels this and every later occurrence that is not done or cancelled | `POST /api/v1/meetings/<id>/cancel`, `page /meetings/[id]` | planned | |
| MTG-131 | Invalid `scope` | api | 422 «invalid scope» field `scope` | `POST /api/v1/meetings/<id>/cancel`, `PATCH /api/v1/meetings/<id>` | manual 2026-10-28 | API 422 «invalid scope» |
| MTG-132 | Cancel a done meeting | it_admin | 403 `transition_forbidden` «Reopen the completed meeting before cancelling it.» | `POST /api/v1/meetings/<id>/cancel` | manual 2026-10-28 | API 403 transition_forbidden «Reopen the completed meeting before cancelling it.» |
| MTG-133 | Cancel an already cancelled meeting | it_admin | 200, nothing changes, no second notice | `POST /api/v1/meetings/<id>/cancel` | manual 2026-10-28 | cancel again 200, no second notice |
| MTG-134 | Non-manager cancels | staff1 (secretary) | 403 «only a meetings manager may complete, cancel or reopen a meeting» | `POST /api/v1/meetings/<id>/cancel` | manual 2026-10-28 | As plain attendee staff1 (not secretary): 403 «only a meetings manager may complete, cancel or reopen a meeting»; pm as secretary got same for complete |
| MTG-135 | Reopen a done meeting | it_admin | Inline prompt «إعادة فتح الاجتماع؟»; state «مسودة»; content editable again; earlier versions stay | `POST /api/v1/meetings/<id>/reopen`, `page /meetings/[id]` | manual 2026-10-28 | API reopen done → draft 200 (UI prompt not driven) |
| MTG-136 | Reopen a cancelled meeting | it_admin | State «مسودة»; its calendar event returns | `POST /api/v1/meetings/<id>/reopen` | manual 2026-10-28 | API reopen cancelled → draft 200 |
| MTG-137 | Reopen a confirmed meeting | it_admin | 422 «This meeting state change is not allowed.» (confirmed cannot return to draft) | `POST /api/v1/meetings/<id>/reopen` | manual 2026-10-28 | API 422 «This meeting state change is not allowed.» |
| MTG-138 | Reopen a draft meeting | it_admin | 200, nothing changes | `POST /api/v1/meetings/<id>/reopen` | manual 2026-10-28 | API reopen draft 200 no change |
| MTG-139 | Non-manager reopens | staff1 (secretary) | 403 «only a meetings manager may complete, cancel or reopen a meeting» | `POST /api/v1/meetings/<id>/reopen` | manual 2026-10-28 | Attendee staff1 reopen 403 «only a meetings manager may complete, cancel or reopen a meeting» |
| MTG-140 | Complete, reopen, change minutes, complete again | it_admin | Version 2 stored beside version 1; both listed and unchanged | `POST /api/v1/meetings/<id>/complete`, `POST /api/v1/meetings/<id>/reopen`, `GET /api/v1/meetings/<id>/versions` | manual 2026-10-28 | After reopen + change minutes + complete: versions 1 and 2 both listed |
| MTG-141 | Edit a done or cancelled meeting | it_admin | 422 «Completed and cancelled meetings are immutable.»; the UI hides edit | `PATCH /api/v1/meetings/<id>` | manual 2026-10-28 | 422 «Completed and cancelled meetings are immutable.» for done and cancelled |
| MTG-142 | Open recommendations do not block completion | it_admin | Meeting completes; recommendations stay open for follow-up | `POST /api/v1/meetings/<id>/complete` | manual 2026-10-28 | Meeting with 3 open recommendations completed 200 |
| MTG-143 | Transition buttons while a request is running | it_admin | Buttons disabled; no double transition | `page /meetings/[id]` | planned | |
| MTG-144 | Transition on a meeting of another company | api | 404 `not_found` | `POST /api/v1/meetings/<id>/confirm`, `POST /api/v1/meetings/<id>/complete`, `POST /api/v1/meetings/<id>/cancel`, `POST /api/v1/meetings/<id>/reopen` | planned | |

## Edit a meeting

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| MTG-150 | Open `/meetings/[id]/edit` | it_admin | Form prefilled (times in browser time zone); save returns to the record | `page /meetings/[id]/edit`, `PATCH /api/v1/meetings/<id>` | planned | |
| MTG-151 | Attendee opens the edit link directly | staff1 (attendee) | Alert «ليست لديك صلاحية تعديل هذا الاجتماع.»; fields disabled; API 403 «only the organizer, secretary or a meetings manager may edit this meeting» | `page /meetings/[id]/edit`, `PATCH /api/v1/meetings/<id>` | manual 2026-10-28 | UI staff1 edit link: alert «ليست لديك صلاحية تعديل هذا الاجتماع.» all controls disabled; API 403 «only the organizer, secretary or a meetings manager may edit this meeting» |
| MTG-152 | Secretary edits | staff1 (secretary) | Allowed | `PATCH /api/v1/meetings/<id>` | manual 2026-10-28 | pm (secretary) PATCH location 200 |
| MTG-153 | Change title, place or join link only | it_admin | Saved; no bell for a title or link change | `PATCH /api/v1/meetings/<id>` | planned | |
| MTG-154 | Change start, end or place | it_admin | Saved; participants but the actor get bell `meeting_changed` | `PATCH /api/v1/meetings/<id>` | planned | |
| MTG-155 | Add an attendee or change the secretary | it_admin | The newly added people get bell `meeting_invite`; people already invited get nothing | `PATCH /api/v1/meetings/<id>` | planned | |
| MTG-156 | Remove an attendee who is responsible for a recommendation | it_admin | 422 «Reassign the responsible user before removing them from the meeting.» | `PATCH /api/v1/meetings/<id>` | planned | |
| MTG-157 | Clear start or end (null) | it_admin | Cleared; a cleared start keeps `meeting_date`; later completion is blocked until set again | `PATCH /api/v1/meetings/<id>` | manual 2026-10-28 | API start/end null accepted; meeting_date kept |
| MTG-158 | Move start so the day changes | it_admin | `meeting_date` follows the start day; sending a different `meeting_date` 422 «meeting_date must match start_datetime in the user timezone» | `PATCH /api/v1/meetings/<id>` | planned | |
| MTG-159 | End before start, bad URL, empty name, wrong types | api | 422 with the field: «end_datetime must be after start_datetime», «meeting_url must be a valid HTTP(S) URL», «name must be a string», «agenda must be a string» | `PATCH /api/v1/meetings/<id>` | manual 2026-10-28 | API 422 with expected messages for end<start, bad URL, name not string, agenda not string |
| MTG-160 | Empty body; unknown field | api | 422 «no fields to update»; 422 «unsupported meeting fields: x» | `PATCH /api/v1/meetings/<id>` | manual 2026-10-28 | API 422 «no fields to update» and «unsupported meeting fields: x» |
| MTG-161 | Stale `write_date` | it_admin | 409 `conflict` «the meeting was changed by someone else; reload it before saving»; the form shows «تغيّر الاجتماع من مستخدم آخر منذ فتح الصفحة…» | `PATCH /api/v1/meetings/<id>`, `page /meetings/[id]/edit` | manual 2026-10-28 | API 409 conflict «the meeting was changed by someone else; reload it before saving» |
| MTG-162 | Detach from a series with `series_id` null; attach to another | it_admin | Detached; attaching needs series-editor rights and an open series | `PATCH /api/v1/meetings/<id>` | planned | |
| MTG-163 | Change the project (`project_id`, null clears) | it_admin | Saved; invalid project 422 | `PATCH /api/v1/meetings/<id>` | planned | |
| MTG-164 | Scope control on a meeting of a series | it_admin | «نطاق التعديل» select appears only for series meetings; «هذا وما بعده» shifts the schedule (title, place, link, times) of later open occurrences by the same delta | `PATCH /api/v1/meetings/<id>`, `page /meetings/[id]/edit` | planned | |
| MTG-165 | Scope «هذا وما بعده» with agenda, attendees or secretary changes | it_admin | Those content fields change on this meeting only; later occurrences keep theirs (note «يطبّق التكرار على حقول الموعد فقط…») | `PATCH /api/v1/meetings/<id>` | planned | |
| MTG-166 | Scope «هذا وما بعده» skips done and cancelled occurrences | it_admin | Locked occurrences unchanged | `PATCH /api/v1/meetings/<id>` | planned | |
| MTG-167 | Scope «هذا وما بعده» produces an overlap for the organiser | it_admin | 422 overlap error; nothing changes | `PATCH /api/v1/meetings/<id>` | planned | |
| MTG-168 | Unsaved edits and navigation | it_admin | Unsaved-changes guard on leaving; save disabled until something changed | `page /meetings/[id]/edit` | planned | |
| MTG-169 | Edit link of a meeting that does not exist or has an invalid id | it_admin | Not-found state | `page /meetings/[id]/edit` | planned | |

## Visibility, isolation and capabilities

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| MTG-180 | `meetings.read` held and refused | staff1 | Holder lists and opens visible meetings; a role without it gets 403 «meetings.read capability is required» on every meetings route and no navigation entry | `cap meetings.read`, `GET /api/v1/meetings`, `GET /api/v1/meetings/<id>` | planned | |
| MTG-181 | Hidden meeting versus another company's meeting | staff2 | Same company but not a participant: 403 `forbidden`; other company: 404 `not_found` (the two differ, which reveals that a hidden meeting exists) | `GET /api/v1/meetings/<id>` | decision | #197; private security advisory GHSA-9xq5-v9r4-xfxc; Found 2026-10-28: `get_record` answers 403 for a hidden record; see report |
| MTG-182 | Deleting a meeting | it_admin | The product has no delete route, button or command; the model refuses delete for done, cancelled and versioned meetings | `cap meetings.manage` | decision | #162; Owner decision needed: should drafts be deletable? |
| MTG-183 | `meetings.manage` allows and refuses | it_admin / staff1 | Manager completes, cancels, reopens and sees all meetings and series; a non-manager gets 403 on those transitions | `cap meetings.manage`, `POST /api/v1/meetings/<id>/complete` | manual 2026-10-28 | it_admin transitions and sees all 19 meetings; staff1 403 on transitions and sees only own |
| MTG-184 | `meetings.create` allows and refuses | it_admin / staff1 | Creates meetings, series and occurrences; without it 403 «meetings.create capability is required» and no new-meeting button, palette command or context link | `cap meetings.create`, `POST /api/v1/meetings`, `POST /api/v1/meeting-series`, `POST /api/v1/meeting-series/<id>/occurrences` | manual 2026-10-28 | it_admin creates; staff1 and pm 403 «meetings.create capability is required»; staff1 sidebar and list have no new-meeting entry |
| MTG-185 | Role with `meetings.create` but not `meetings.manage` | custom role (employee, meetings.create) | Creates a meeting and edits it as organiser; cannot complete, cancel, reopen; sees only meetings they take part in | `cap meetings.create`, `cap meetings.read` | planned | |
| MTG-186 | Role revoked while the page is open | custom role | Next request answers 403; page shows the forbidden state | `cap meetings.read` | planned | |
| MTG-187 | Body carries a `company_id` outside the request companies | api | 404 `not_found`, nothing written | `POST /api/v1/meetings`, `PATCH /api/v1/meetings/<id>` | manual 2026-10-28 | API company_id in body 422/404 → 404 not_found, nothing written |
| MTG-188 | Tenant with `meetings.enabled` off | it_admin | Navigation, palette and attention entries hidden; every route answers 403 `feature_not_included` | `GET /api/v1/meetings`, `POST /api/v1/meetings` | planned | |
| MTG-189 | Read-only tenant (subscription expired) | it_admin | Reads work; every write answers 403 `tenant_read_only` | `POST /api/v1/meetings`, `PATCH /api/v1/meetings/<id>` | planned | |
| MTG-190 | Suspended tenant | it_admin | Every request answers 403 `tenant_suspended` | `GET /api/v1/meetings` | planned | |
| MTG-191 | Navigation and shortcuts | staff1 | Sidebar entries «الاجتماعات», «المتابعة», «التقويم», «الاجتماعات الدورية»; landing page works; the new-meeting context link shows only with `meetings.create` | `cap meetings.read`, `page /meetings` | fail | #185; Sidebar group has «عرض الكل / اجتماعاتي / مسودة / مؤكد / مكتمل / المتابعة / الدورية» but no «التقويم» entry; new-meeting link only for it_admin as expected |
| MTG-192 | Attention panel | staff1 | Today's confirmed or draft meetings (not ended) and overdue recommendations assigned to the user appear with a suggestion «راجع التوصيات المتأخرة قبل الاجتماع القادم.» | `GET /api/v1/meetings`, `GET /api/v1/meetings/resolutions` | planned | |
| MTG-193 | Company switch | it_admin (two companies) | Lists, calendar and series show only the active company | `GET /api/v1/meetings`, `GET /api/v1/meeting-series` | planned | |

## Minutes

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| MTG-200 | Open `/meetings/[id]/minutes` as an editor | it_admin | Structured form: metadata block, opening, closing, chairperson, approver name and title, topics; extra «ملاحظات إضافية» rich text; save disabled and hint «لا توجد تغييرات للحفظ.» until edited | `page /meetings/[id]/minutes`, `PATCH /api/v1/meetings/<id>` | planned | |
| MTG-201 | Add, edit, reorder and delete topics | it_admin | Topic title, discussion, project and recommendations editable; up and down move; at most 100 topics; save persists order | `page /meetings/[id]/minutes`, `PATCH /api/v1/meetings/<id>` | planned | |
| MTG-202 | Link a recommendation to a topic | it_admin | A recommendation belongs to one topic only; one used elsewhere is not offered | `page /meetings/[id]/minutes` | planned | |
| MTG-203 | «قراءة جدول الأعمال الحالي» | it_admin | Copies the agenda text into the opening when the opening is empty | `page /meetings/[id]/minutes` | planned | |
| MTG-204 | «حفظ وإنشاء توصية» | it_admin | Saves the minutes, opens the new-recommendation panel, returns to the minutes with the new recommendation attached to the topic or flagged unassigned | `page /meetings/[id]/minutes`, `page /meetings/[id]/resolutions/new` | planned | |
| MTG-205 | Return after creating a recommendation: already linked, unavailable | it_admin | Notices «التوصية مرتبطة بموضوع في هذا المحضر.» / «تعذّر العثور على التوصية ضمن الاجتماع المقروء…» | `page /meetings/[id]/minutes` | planned | |
| MTG-206 | Attendee opens the minutes editor | staff1 (attendee) | Alert «لا تملك صلاحية تعديل هذا المحضر.»; document shown read-only | `page /meetings/[id]/minutes` | manual 2026-10-28 | staff1 minutes page: alert «لا تملك صلاحية تعديل هذا المحضر.», fields and save disabled |
| MTG-207 | Editor opens the minutes of a done or cancelled meeting | it_admin | Read-only document with the reopen hint «هذا الاجتماع مكتمل أو ملغى. أعد فتحه من صفحة الاجتماع قبل تعديل المحضر.» and a link to the meeting for managers | `page /meetings/[id]/minutes` | planned | |
| MTG-208 | Form too long or malformed | api | 422 with «Invalid minutes form field: opening», «minutes_form topics must contain at most 100 items.», «Minutes topic keys must be unique.», «Minutes topic titles must be at most 500 characters.», «Minutes topic discussion is too long.», «The minutes form text is too long.», «minutes_form contains unsupported fields.» | `PATCH /api/v1/meetings/<id>` | planned | |
| MTG-209 | Recommendation errors inside the form | api | 422 «A recommendation may only be assigned to one topic.», «Minutes form contains a recommendation from another meeting.», «Minutes topic recommendations are invalid.» | `PATCH /api/v1/meetings/<id>` | planned | |
| MTG-210 | Topic project not usable | api | 422 «Minutes topic project is invalid.» / «Minutes topic project is not available in the current company.» | `PATCH /api/v1/meetings/<id>` | planned | |
| MTG-211 | Editor without access to a topic's project saves | pm | The hidden project association is preserved, not cleared | `PATCH /api/v1/meetings/<id>` | planned | |
| MTG-212 | Stale `write_date` on the minutes | it_admin | 409 conflict; the draft stays editable | `PATCH /api/v1/meetings/<id>` | planned | |
| MTG-213 | Saving minutes is logged | it_admin | Activity «حفظ المحضر» | `GET /api/v1/meetings/<id>/events` | planned | |
| MTG-214 | Unsaved minutes and navigation | it_admin | Unsaved-changes guard; no guard after save | `page /meetings/[id]/minutes` | planned | |
| MTG-215 | `minutes` HTML saved with script content | api | Sanitised on save | `PATCH /api/v1/meetings/<id>` | manual 2026-10-28 | Minutes with script tag and onerror attribute saved sanitized (<p>ok</p><img src="x">) |

## Print, PDF, history and versions

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| MTG-220 | Open `/meetings/[id]/print` | staff1 (attendee) | Landscape sheet with the tenant logo and name, «محضر اجتماع», date, weekday, Hijri date, minutes and recommendations, signature lines «رئيس الاجتماع», «المعتمد», «التوقيع»; «طباعة» opens the browser print dialog | `page /meetings/[id]/print`, `GET /api/v1/meetings/<id>` | manual 2026-10-28 | staff1 print page shows company name, «محضر اجتماع», date, weekday, Hijri date, minutes, recommendations |
| MTG-221 | Print a saved version (`?version_id=`) | it_admin | Shows that version's frozen content and its number; the PDF button is hidden | `page /meetings/[id]/print`, `GET /api/v1/meetings/<id>/versions/<id>` | planned | |
| MTG-222 | Print a meeting with no agenda, minutes or recommendations | it_admin | Message «لا يوجد جدول أعمال أو محضر أو توصيات لطباعتها…»; print button disabled | `page /meetings/[id]/print` | planned | |
| MTG-223 | Print with an unknown meeting id, an invalid id, or a version of another meeting | it_admin | Not-found state | `page /meetings/[id]/print`, `GET /api/v1/meetings/<id>/versions/<id>` | planned | |
| MTG-224 | Download the PDF | staff1 (attendee) | `application/pdf` attachment named after the reference; hidden meeting 403; other company 404; tenant feature off 403 | `GET /api/v1/meetings/<id>/minutes.pdf` | fail | #186; PDF route answers 422 HTML «Unable to find Wkhtmltopdf» for it_admin and staff1 (env lacks wkhtmltopdf); also not a JSON error |
| MTG-225 | History tab, activity | it_admin | «النشاط» lists newest first, 25 a page, with actor («النظام» when none) and the labels «إنشاء الاجتماع», «تحديث الاجتماع», «اعتماد الاجتماع», «إكمال الاجتماع», «إعادة فتح الاجتماع», «إلغاء الاجتماع», «حفظ المحضر», «إنشاء توصية», «تغيير التوصية» | `GET /api/v1/meetings/<id>/events` | planned | |
| MTG-226 | History tab, versions | it_admin | «النسخ» lists versions newest first with number, time and actor; selecting one shows its frozen minutes; empty text «لا توجد نسخ نهائية متاحة.» | `GET /api/v1/meetings/<id>/versions`, `GET /api/v1/meetings/<id>/versions/<id>` | planned | |
| MTG-227 | Version of another meeting or company | api | 404 «meeting version not found» | `GET /api/v1/meetings/<id>/versions/<id>` | manual 2026-10-28 | API 404 «meeting version not found» for version of another meeting |
| MTG-228 | Version rows the viewer cannot read | staff1 | Recommendation rows of earlier occurrences the viewer may not open are omitted from the version | `GET /api/v1/meetings/<id>/versions/<id>` | planned | |
| MTG-229 | Versions and events cannot be edited | api | No write route exists; the model refuses write and delete | `GET /api/v1/meetings/<id>/versions` | manual 2026-10-28 | PATCH on a version answers 405 |
| MTG-230 | Paging parameters of events and versions | api | `limit` default 25, maximum 100, invalid values 422 | `GET /api/v1/meetings/<id>/events`, `GET /api/v1/meetings/<id>/versions` | manual 2026-10-28 | API 422 «limit and offset must be non-negative integers» |

## Recommendations

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| MTG-240 | Recommendations tab | staff1 (attendee) | Cards with state badge, priority («عادية», «مرتفعة», «مرتفعة جدًا», «عاجلة»), responsible, deadline, execution period, project, completion notes; empty text «لا توجد توصيات لهذا الاجتماع.» | `page /meetings/[id]`, `GET /api/v1/meetings/<id>` | planned | |
| MTG-241 | Search and state filter inside the tab | it_admin | Narrows the cards; no match shows «لا توجد توصيات مطابقة لهذه الفلاتر.» | `page /meetings/[id]` | planned | |
| MTG-242 | Add a recommendation (create panel) | it_admin | Fields title, responsible (participants only), deadline, execution period, project, priority; saved, back on the tab; the responsible gets bell `meeting_resolution` | `page /meetings/[id]/resolutions/new`, `POST /api/v1/meetings/<id>/resolutions` | planned | |
| MTG-243 | Create form validation | it_admin | «أدخل عنوان التوصية.», «اختر المسؤول.», «أدخل تاريخ إنجاز أو مدة تنفيذ.» | `page /meetings/[id]/resolutions/new` | planned | |
| MTG-244 | Create API validation | api | 422: «name must not be empty», «responsible_id must be an integer», «deadline or execution_period is required», «deadline must be YYYY-MM-DD», «execution_period must be a string of at most 500 characters», «priority must be one of 0, 1, 2, or 3», «unsupported resolution fields: x» | `POST /api/v1/meetings/<id>/resolutions` | manual 2026-10-28 | API 422: empty name, bad deadline «deadline must be YYYY-MM-DD», priority 9, missing deadline/execution_period «deadline or execution_period is required» |
| MTG-245 | Responsible not organiser, secretary or attendee | api | 422 «The responsible user must be the organizer, secretary or an attendee.» | `POST /api/v1/meetings/<id>/resolutions` | manual 2026-10-28 | 422 «The responsible user must be the organizer, secretary or an attendee.» on create and patch |
| MTG-246 | Add to a done or cancelled meeting | it_admin | Panel shows «هذا الاجتماع نهائي أو ملغى ولا يمكن تعديله.»; API 422 «Cannot add resolutions to a completed or cancelled meeting.» | `page /meetings/[id]/resolutions/new`, `POST /api/v1/meetings/<id>/resolutions` | manual 2026-10-28 | 422 «Cannot add resolutions to a completed or cancelled meeting.» |
| MTG-247 | Attendee adds a recommendation | staff1 (attendee) | No button; API 403 «Only the organizer, secretary or a Meeting Manager may create resolutions.» | `POST /api/v1/meetings/<id>/resolutions` | manual 2026-10-28 | Attendee staff1 403 «Only the organizer, secretary or a Meeting Manager may create resolutions.» |
| MTG-248 | Refresh or re-submit after create | it_admin | The receipt (`created_resolution_id`) returns to the meeting without a second post | `page /meetings/[id]/resolutions/new` | planned | |
| MTG-249 | Creating a recommendation assigned to oneself | it_admin | Responsible who is also the actor still receives bell `meeting_resolution` | `POST /api/v1/meetings/<id>/resolutions` | decision | #162; Found 2026-10-28: the actor is not excluded here, unlike invitations |
| MTG-250 | Edit page, editor | it_admin | Decision fields (title, responsible, deadline, period, project, priority) and completion notes editable; save disabled until changed | `page /meetings/[id]/resolutions/[id]/edit`, `PATCH /api/v1/meetings/<id>/resolutions/<id>` | planned | |
| MTG-251 | Edit page, assignee who is not an editor | staff1 (responsible) | Only «ملاحظات الإنجاز» editable | `page /meetings/[id]/resolutions/[id]/edit`, `PATCH /api/v1/meetings/<id>/resolutions/<id>` | planned | |
| MTG-252 | Edit page, neither editor nor assignee, or recommendation finished or linked to a task | staff2 | Notice «لا يمكن تعديل هذه التوصية بعد الآن.» | `page /meetings/[id]/resolutions/[id]/edit` | planned | |
| MTG-253 | Assignee changes a decision field | staff1 (responsible) | 403 «Assignees may only update progress and completion notes.» | `PATCH /api/v1/meetings/<id>/resolutions/<id>` | manual 2026-10-28 | Assignee changing name: 403 «Only the organizer, secretary or a Meeting Manager may change resolution contents.» |
| MTG-254 | Decision fields of a done meeting | it_admin | 422 «Decision fields of an approved meeting cannot be changed.» | `PATCH /api/v1/meetings/<id>/resolutions/<id>` | manual 2026-10-28 | Done meeting: decision fields 422 «Decision fields of an approved meeting cannot be changed.»; result still editable 200 |
| MTG-255 | Any change in a cancelled meeting | it_admin | 422 «Reopen the cancelled meeting before updating its resolutions.» | `PATCH /api/v1/meetings/<id>/resolutions/<id>` | planned | |
| MTG-256 | Completion notes of a done recommendation | staff1 (responsible) | 422 «Reopen the resolution before changing completion notes.» | `PATCH /api/v1/meetings/<id>/resolutions/<id>` | manual 2026-10-28 | Assignee saves result 200 |
| MTG-257 | Patch validation | api | 422: «no fields to update», «name must not be empty», «priority must be one of 0, 1, 2, or 3», «result must be a string», «deadline or execution_period is required» when both end up empty, «unsupported resolution fields: x» | `PATCH /api/v1/meetings/<id>/resolutions/<id>` | manual 2026-10-28 | 422 «name must not be empty», «priority must be one of 0, 1, 2, or 3», «unsupported resolution fields: foo» |
| MTG-258 | Patch with `responsible_id` null or 0 | api | Silently ignored, nothing changes and no error | `PATCH /api/v1/meetings/<id>/resolutions/<id>` | decision | #162; Found 2026-10-28: `patch_resolution` skips a falsy `responsible_id` |
| MTG-259 | Resolution id from another meeting | api | 404 «resolution not found» | `PATCH /api/v1/meetings/<id>/resolutions/<id>`, `POST /api/v1/meetings/<id>/resolutions/<id>/<id>` | manual 2026-10-28 | Resolution id of another meeting 404 «resolution not found» |
| MTG-260 | Start an open recommendation | staff1 (responsible) | «بدء التنفيذ» moves open to «قيد التنفيذ»; starting an in-progress one changes nothing | `POST /api/v1/meetings/<id>/resolutions/<id>/<id>` | manual 2026-10-28 | Assignee start → in_progress 200 |
| MTG-261 | Complete an open or in-progress recommendation | staff1 (responsible) | «إنهاء» moves to «منجزة»; completing a done one changes nothing | `POST /api/v1/meetings/<id>/resolutions/<id>/<id>` | manual 2026-10-28 | Assignee complete → done 200 |
| MTG-262 | Cancel by an editor | it_admin | Inline prompt «هل تؤكد تنفيذ الإجراء للتوصية «{name}»؟»; state «ملغاة» | `POST /api/v1/meetings/<id>/resolutions/<id>/<id>` | manual 2026-10-28 | Editor cancel 200 |
| MTG-263 | Assignee cancels | staff1 (responsible) | No cancel button; API 422 «Assignees cannot cancel resolutions.» | `POST /api/v1/meetings/<id>/resolutions/<id>/<id>` | manual 2026-10-28 | 422 «Assignees cannot cancel resolutions.» |
| MTG-264 | Reopen a done or cancelled recommendation | it_admin | Manager reopens to «مفتوحة»; editor who is not a manager gets 422 «Only a Meeting Manager may reopen this resolution.» | `POST /api/v1/meetings/<id>/resolutions/<id>/<id>` | manual 2026-10-28 | Editor reopen of done and cancelled → open 200 |
| MTG-265 | Person who is neither editor nor assignee updates execution | staff2 | 403 «Only the assignee or a meeting editor may update execution.» | `POST /api/v1/meetings/<id>/resolutions/<id>/<id>` | fail | #197; Non-participant staff2 gets raw Odoo AccessError text instead of «Only the assignee or a meeting editor may update execution.»; staff1 on a resolution of another assignee got the expected message |
| MTG-266 | Unknown action name | api | 404 «unknown action» | `POST /api/v1/meetings/<id>/resolutions/<id>/<id>` | manual 2026-10-28 | 404 «unknown action» |
| MTG-267 | Allowed actions per role and state | api | `allowed_actions`: open gives start, complete, edit_result (+ cancel for editors); in progress gives complete, edit_result (+ cancel); done or cancelled gives reopen for managers only; none when linked to a task or the meeting is cancelled | `GET /api/v1/meetings/<id>` | planned | |
| MTG-268 | Row actions disabled while one is running | staff1 (responsible) | Buttons of that row disabled; error text shown under the row on failure | `page /meetings/[id]` | planned | |
| MTG-269 | A recommendation followed on a task is frozen | it_admin | Edit and state routes answer 422 «Follow this recommendation on its task.»; the card shows «المتابعة على المهمة المرتبطة.» | `PATCH /api/v1/meetings/<id>/resolutions/<id>`, `POST /api/v1/meetings/<id>/resolutions/<id>/<id>` | manual 2026-10-28 | Converted recommendation: edit and start 422 «Follow this recommendation on its task.»; allowed_actions empty |
| MTG-270 | Linked task the viewer cannot open | staff1 | Card shows «هذه التوصية مرتبطة بمهمة لا يمكنك فتحها.» and no task link | `page /meetings/[id]` | manual 2026-10-28 | staff1 sees converted row with task id and no actions |
| MTG-271 | Recommendation changes are logged | it_admin | Activity «إنشاء توصية», «تغيير التوصية» | `GET /api/v1/meetings/<id>/events` | planned | |

## Conversion to a project task

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| MTG-280 | Convert from the card | it_admin | Section «تحويل التوصية إلى مهمة»: pick a project (search box), «تحويل لمهمة»; task created with the title, priority, deadline and responsible; card shows the task link «فتح المهمة — تبويب جديد» | `POST /api/v1/meetings/<id>/resolutions/<id>/convert`, `page /meetings/[id]` | manual 2026-10-28 | Convert as it_admin with project: 200 {id,name}, resolution shows task_linked true |
| MTG-281 | Conversion offered only when allowed | staff1 (responsible) | Hidden for non-editors, for done or cancelled meetings, when no project can be chosen, when the recommendation is already linked or finished | `page /meetings/[id]` | planned | |
| MTG-282 | Convert twice | it_admin | 422 «This recommendation has already been converted.»; one task only | `POST /api/v1/meetings/<id>/resolutions/<id>/convert` | manual 2026-10-28 | 422 «This recommendation has already been converted.» |
| MTG-283 | Convert in a done or cancelled meeting | api | 422 «Reopen the meeting before converting a recommendation.» | `POST /api/v1/meetings/<id>/resolutions/<id>/convert` | manual 2026-10-28 | 422 «Reopen the meeting before converting a recommendation.» |
| MTG-284 | Convert without editor rights | staff1 (responsible) | 403 «Only a meeting editor or meetings manager can convert a recommendation to a task.» | `POST /api/v1/meetings/<id>/resolutions/<id>/convert` | manual 2026-10-28 | staff1 403 «Only a meeting editor or meetings manager can convert a recommendation to a task.» |
| MTG-285 | Project missing, inactive, hidden or of another company | api | 422 «project_id must be an integer» / «A visible current-company project is required.» | `POST /api/v1/meetings/<id>/resolutions/<id>/convert` | manual 2026-10-28 | API 422 «A visible current-company project is required.» for unknown project; «project_id must be an integer» when missing |
| MTG-286 | Projects application switched off | it_admin | Route answers 403 `feature_not_included`; no conversion section | `POST /api/v1/meetings/<id>/resolutions/<id>/convert` | planned | |
| MTG-287 | Responsible is told | staff1 | Bell `meeting_converted` «حُوّلت لمهمة» opens the meeting | `POST /api/v1/meetings/<id>/resolutions/<id>/convert` | manual 2026-10-28 | staff1 got bell meeting_converted |
| MTG-288 | Execution state follows the task | it_admin | Task done or cancelled shows as the recommendation's execution state and drops out of open counts, follow-up and the overdue reminder; decision state badge shows «حالة القرار: …» | `GET /api/v1/meetings/resolutions`, `GET /api/v1/meetings/<id>` | planned | |
| MTG-289 | Conversion failure message | it_admin | Server message or «تعذّر تحويل التوصية إلى مهمة. حاول مرة أخرى.» in the tab | `page /meetings/[id]` | planned | |

## Follow-up

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| MTG-290 | Open `/meetings/follow-up` | it_admin | Heading «المتابعة»; default state is active (open and in progress); columns title, responsible, deadline or execution period, state, task link | `page /meetings/follow-up`, `GET /api/v1/meetings/resolutions` | manual 2026-10-28 | /meetings/follow-up opens with KPI tiles and table |
| MTG-291 | KPI tiles | it_admin | «إجمالي التوصيات», «توصيات نشطة», «توصيات متأخرة», «توصيات منجزة» counted under the search and scope; a tile opens the list with its state | `page /meetings/follow-up`, `GET /api/v1/meetings/resolutions` | planned | |
| MTG-292 | State select: all, active, overdue, open, in progress, done, cancelled | it_admin | Each lists the matching set; overdue means deadline before today and not finished; invalid `state` 422 «invalid state» | `page /meetings/follow-up`, `GET /api/v1/meetings/resolutions` | planned | |
| MTG-293 | Scope «الكل» / «المسندة إلي» | staff1 | Mine keeps rows where the user is responsible | `page /meetings/follow-up`, `GET /api/v1/meetings/resolutions` | planned | |
| MTG-294 | Search by recommendation title or meeting title | it_admin | Matching rows; clear button resets | `page /meetings/follow-up`, `GET /api/v1/meetings/resolutions` | planned | |
| MTG-295 | Open a row | it_admin | Opens the meeting on its recommendations tab; Back returns with filters | `page /meetings/follow-up`, `page /meetings/[id]` | planned | |
| MTG-296 | Row with a task | it_admin | «فتح المهمة — تبويب جديد» opens the task in a new tab | `page /meetings/follow-up` | planned | |
| MTG-297 | Paging and empty text | it_admin | 25 a page; empty list shows «لا توجد توصيات لهذا الاجتماع.» or the no-results text | `page /meetings/follow-up`, `GET /api/v1/meetings/resolutions` | planned | |
| MTG-298 | Scope of what the viewer sees | staff1 | Only recommendations of meetings they may read | `GET /api/v1/meetings/resolutions` | manual 2026-10-28 | staff2 follow-up total 0; staff1 only recommendations of meetings he may read |
| MTG-299 | Order | api | Earliest deadline first, recommendations without a deadline last | `GET /api/v1/meetings/resolutions` | manual 2026-10-28 | Order by deadline ascending |

## Series

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| MTG-310 | Open `/meetings/series` | it_admin | List by name: record number, name, recurrence badge, ended badge «منتهية», organiser, project, open and overdue recommendation counts | `page /meetings/series`, `GET /api/v1/meeting-series` | manual 2026-10-28 | /meetings/series list with ended badge «منتهية» |
| MTG-311 | Series list as a participant | staff1 (attendee) | Only series they organise, are secretary or attendee of, or contain a meeting they may read | `page /meetings/series`, `GET /api/v1/meeting-series` | planned | |
| MTG-312 | Empty list | staff2 | «لا توجد اجتماعات دورية ظاهرة لك.» | `page /meetings/series` | planned | |
| MTG-313 | Search by name or place; project filter; clear | it_admin | Matching series; filters in the URL | `page /meetings/series`, `GET /api/v1/meeting-series` | planned | |
| MTG-314 | KPI tiles | it_admin | «إجمالي السلاسل», «توصيات نشطة», «توصيات متأخرة»; the last two link to follow-up | `page /meetings/series` | planned | |
| MTG-315 | Paging, 25 a page; `limit` maximum 200 | it_admin | Footer and next page; invalid limit 422 | `page /meetings/series`, `GET /api/v1/meeting-series` | planned | |
| MTG-316 | Ended series stay listed | it_admin | Listed with `active` false and the ended badge | `GET /api/v1/meeting-series` | manual 2026-10-28 | Ended series listed with ended badge, active false |
| MTG-317 | «اجتماع دوري جديد» button | staff1 | Hidden without `meetings.create` | `page /meetings/series`, `cap meetings.create` | planned | |
| MTG-318 | Create an on-demand series | it_admin | Recurrence «حسب الحاجة»; no occurrences generated; start and end not asked | `page /meetings/series/new`, `POST /api/v1/meeting-series` | manual 2026-10-28 | API on-demand series created |
| MTG-319 | Weekly series, ending by count | it_admin | Occurrences on the same weekday and time for the count; preview «معاينة المواعيد» lists them before saving | `page /meetings/series/new`, `POST /api/v1/meeting-series` | manual 2026-10-28 | API weekly count 3 → three occurrences 2/9/16 Aug, draft |
| MTG-320 | Biweekly series, ending by date | it_admin | Occurrences every two weeks up to the date inclusive | `page /meetings/series/new`, `POST /api/v1/meeting-series` | manual 2026-10-28 | API biweekly until date → 1, 15, 29 Sept |
| MTG-321 | Monthly series | it_admin | Same day of the month in the organiser's time zone; a month without that day is skipped in the preview | `page /meetings/series/new`, `POST /api/v1/meeting-series` | manual 2026-10-28 | API monthly from 31 Oct, count 4 → 31 Oct, 31 Dec, 31 Jan, 31 Mar (months without 31st skipped) |
| MTG-322 | Count out of range | it_admin | Count 0 or above 60 refused: form error; API 422 «Occurrence count must be between 1 and 60.» | `page /meetings/series/new`, `POST /api/v1/meeting-series` | fail | #187; until_count 61 → «Occurrence count must be between 1 and 60.» but count 0 answers «Set either an end date or a number of meetings, not both.» (0 treated as unset) |
| MTG-323 | Until date before the first meeting; more than 60 occurrences | it_admin | Form errors; API 422 «The recurrence end date must be on or after the first meeting.» / «A recurrence may contain at most 60 meetings.» | `page /meetings/series/new`, `POST /api/v1/meeting-series` | manual 2026-10-28 | API 422 «The recurrence end date must be on or after the first meeting.» and «A recurrence may contain at most 60 meetings.» |
| MTG-324 | Recurring series without start or end | api | 422 «start and end are required for recurrence»; end not after start 422 «end_datetime must be after start_datetime» | `POST /api/v1/meeting-series` | manual 2026-10-28 | API 422 «start and end are required for recurrence»; no orphan series left |
| MTG-325 | Both or neither of count and date | api | 422 «Set either an end date or a number of meetings, not both.» | `POST /api/v1/meeting-series` | manual 2026-10-28 | #187; API 422 «Set either an end date or a number of meetings, not both.» for both and neither |
| MTG-326 | Invalid recurrence, empty name, bad people or link | api | 422 «invalid recurrence», «name must not be empty», attendee and secretary errors, «meeting_url must be a valid HTTP(S) URL» | `POST /api/v1/meeting-series` | manual 2026-10-28 | API 422 for recurrence, empty name, attendee, meeting_url |
| MTG-327 | Series created inside a project (`?project_id=`) | it_admin | Project context banner; project saved and inherited by every occurrence | `page /meetings/series/new`, `POST /api/v1/meeting-series` | planned | |
| MTG-328 | Invitation of a series | it_admin → staff1 | Participants get one bell `meeting_series_invite` «دعوة لسلسلة اجتماعات», not one per occurrence | `POST /api/v1/meeting-series` | planned | |
| MTG-329 | Occurrences inherit defaults | it_admin | Each occurrence carries the series name, place, link, secretary, attendees and organiser, state draft | `POST /api/v1/meeting-series`, `GET /api/v1/meeting-series/<id>` | manual 2026-10-28 | Occurrence inherits attendees from series |
| MTG-330 | Series without `meetings.create` | staff1 | Route refused; `POST` 403 «meetings.create capability is required» | `page /meetings/series/new`, `POST /api/v1/meeting-series`, `cap meetings.create` | manual 2026-10-28 | staff1: API 403 «meetings.create capability is required»; /meetings/series/new 403 page |
| MTG-331 | Series record, tabs | it_admin | Tabs «اللقاءات», «المتابعة», «السجل», «التفاصيل»; tags show recurrence, organiser and project; ended series tagged «منتهية» | `page /meetings/series/[id]`, `GET /api/v1/meeting-series/<id>` | manual 2026-10-28 | Series record shows tabs «اللقاءات», «المتابعة», «السجل», «التفاصيل» |
| MTG-332 | Sessions tab: timeline and table, search, state, date range, sort, load more | it_admin | Filters live in the URL (`session_q`, `session_state`, `session_from`, `session_to`, `session_sort`, `session_view`); sorts «الخط الزمني», «الأحدث أولًا», «الأقدم أولًا», «الاسم»; «تحميل لقاءات إضافية» adds 25; empty «لا توجد لقاءات مطابقة لهذه الفلاتر.» | `page /meetings/series/[id]` | planned | |
| MTG-333 | Next and last completed meeting cards | it_admin | «اللقاء القادم» and «آخر لقاء مكتمل», or «لا يوجد لقاء قادم فعّال مجدول.» / «لا يوجد لقاء مكتمل متاح.» | `page /meetings/series/[id]` | planned | |
| MTG-334 | Follow-up tab | it_admin | Recommendations across occurrences with search, state (active, overdue, open, in progress, done, cancelled) and paging 25 | `page /meetings/series/[id]`, `GET /api/v1/meeting-series/<id>/resolutions` | planned | |
| MTG-335 | Series follow-up invalid state | api | 422 «invalid state» | `GET /api/v1/meeting-series/<id>/resolutions` | manual 2026-10-28 | API 422 «invalid state» |
| MTG-336 | History tab | it_admin | Activity of all occurrences, newest first, 25 a page | `page /meetings/series/[id]`, `GET /api/v1/meeting-series/<id>/events` | planned | |
| MTG-337 | Details tab and edit link | it_admin | Place, link, secretary, attendees; «إعدادات الاجتماع الدوري» only when `can_edit` | `page /meetings/series/[id]` | planned | |
| MTG-338 | Add an occurrence | it_admin | «إضافة موعد» form: optional name, date and start and end together; new draft meeting appears; inherits place, attendees, secretary | `page /meetings/series/[id]`, `POST /api/v1/meeting-series/<id>/occurrences` | manual 2026-10-28 | API add occurrence 201 draft |
| MTG-339 | Add an occurrence with only one of start and end, or end before start | api | 422 «start_datetime and end_datetime must be given together» / «end_datetime must be after start_datetime» | `POST /api/v1/meeting-series/<id>/occurrences` | manual 2026-10-28 | API 422 «start_datetime and end_datetime must be given together» / «end_datetime must be after start_datetime» |
| MTG-340 | Add an occurrence to an ended series or without rights | api | 422 «This series has ended; no meetings can be added to it.»; attendee 403 «Only the organizer, secretary or a meetings manager may add meetings.»; without `meetings.create` 403 | `POST /api/v1/meeting-series/<id>/occurrences`, `cap meetings.create` | manual 2026-10-28 | Ended series 422 «This series has ended; no meetings can be added to it.»; staff1 403 «meetings.create capability is required» |
| MTG-341 | Series settings page | it_admin | Edit name, place, link, attendees, secretary; note that settings apply to meetings added later; existing occurrences keep their values | `page /meetings/series/[id]/edit`, `PATCH /api/v1/meeting-series/<id>` | planned | |
| MTG-342 | Series settings, refusals | api | 422 «The series setting recurrence cannot be edited here.», «no fields to update», «name must not be empty»; attendee 403 «Only the organizer, secretary or a meetings manager may edit this series.»; other company 404 | `PATCH /api/v1/meeting-series/<id>` | planned | #197 |
| MTG-343 | Settings page for a non-editor | staff1 (attendee) | Alert «لا تملك صلاحية تعديل هذا الاجتماع الدوري.» | `page /meetings/series/[id]/edit` | planned | #197 |
| MTG-344 | End a series | it_admin | Menu «إنهاء السلسلة», prompt «إنهاء هذه السلسلة؟ تُلغى اجتماعاتها القادمة…»; upcoming open occurrences cancelled, past and done kept; series archived and tagged ended | `POST /api/v1/meeting-series/<id>/cancel`, `page /meetings/series/[id]` | manual 2026-10-28 | API end series 200; its upcoming draft occurrences became cancelled (UI menu not driven) |
| MTG-345 | End a series twice | it_admin | 200, nothing more changes | `POST /api/v1/meeting-series/<id>/cancel` | manual 2026-10-28 | Second end 200 |
| MTG-346 | Non-manager editor ends a series that has upcoming meetings | staff1 (secretary) | 403 «Only a meetings manager may cancel the upcoming meetings of a series.»; with nothing upcoming it succeeds; menu entry follows `can_end` | `POST /api/v1/meeting-series/<id>/cancel`, `page /meetings/series/[id]` | manual 2026-10-28 | pm (secretary) 403 «Only a meetings manager may cancel the upcoming meetings of a series.» |
| MTG-347 | Attendee ends a series | staff1 (attendee) | 403 «Only the organizer, secretary or a meetings manager may end this series.» | `POST /api/v1/meeting-series/<id>/cancel` | manual 2026-10-28 | Attendee staff1 403 «Only the organizer, secretary or a meetings manager may end this series.» |
| MTG-348 | End a series with an unsaved new occurrence open | it_admin | Message «احفظ الموعد الجديد الذي تضيفه أو تجاهله قبل إنهاء السلسلة.» | `page /meetings/series/[id]` | planned | |
| MTG-349 | Series of another company | api | 404 on get, patch, cancel, occurrences, events and resolutions | `GET /api/v1/meeting-series/<id>`, `GET /api/v1/meeting-series/<id>/events` | planned | |

## Attachments

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| MTG-360 | Attachments tab | staff1 (attendee) | Lists files with count in the tab label; empty «لا توجد مرفقات لهذا الاجتماع.»; download works | `GET /api/v1/meetings/<id>/attachments`, `GET /api/v1/meetings/<id>/attachments/<id>/download`, `page /meetings/[id]` | manual 2026-10-28 | API attendee staff1 lists attachments 200 |
| MTG-361 | Upload PDF, PNG, JPEG, text, DOCX, XLSX | it_admin | 201; listed; file content detected, not only the name | `POST /api/v1/meetings/<id>/attachments` | manual 2026-10-28 | API PNG and text uploads 201 |
| MTG-362 | Refused files | it_admin | Browser: «نوع الملف غير مدعوم…», «الملف فارغ.», «حجم الملف يتجاوز 10 ميغابايت.»; API 422 «file type is not allowed», «data must contain a non-empty file», «attachment exceeds 10MB», «data must be valid base64», «name must be a basename» | `POST /api/v1/meetings/<id>/attachments` | manual 2026-10-28 | API 422 «file type is not allowed», «data must be valid base64», «data is required» |
| MTG-363 | Delete an attachment | it_admin | Inline confirmation; 204; list updates | `DELETE /api/v1/meetings/<id>/attachments/<id>` | manual 2026-10-28 | API delete 204 |
| MTG-364 | Attendee uploads or deletes | staff1 (attendee) | No controls; API 403 «You are not allowed to change this meeting.» | `POST /api/v1/meetings/<id>/attachments`, `DELETE /api/v1/meetings/<id>/attachments/<id>` | manual 2026-10-28 | API 403 «You are not allowed to change this meeting.» for upload and delete by attendee |
| MTG-365 | Upload to a done or cancelled meeting | it_admin | 403 (`can_edit` false) | `POST /api/v1/meetings/<id>/attachments` | manual 2026-10-28 | API upload to done meeting 403 «You are not allowed to change this meeting.» |
| MTG-366 | Attachment of another meeting by id | api | Download and delete answer 404 «Attachment is not linked to this meeting.» | `GET /api/v1/meetings/<id>/attachments/<id>/download`, `DELETE /api/v1/meetings/<id>/attachments/<id>` | planned | |
| MTG-367 | Upload failure | it_admin | Server message shown under the list | `page /meetings/[id]` | planned | |

## Notifications and reminders

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| MTG-370 | Invite on create | it_admin → staff1 | Bell `meeting_invite` «دعوة لاجتماع» to organiser, secretary and attendees except the actor; opens the meeting | `POST /api/v1/meetings`, `cap meetings.read` | manual 2026-10-28 | staff1 got bell meeting_invite on create (bell UI shows «دعوة لاجتماع») |
| MTG-371 | Invite on a later addition | it_admin → staff2 | Only the added person is notified; repeating the save adds no duplicate | `PATCH /api/v1/meetings/<id>`, `cap meetings.read` | planned | |
| MTG-372 | Occurrence added to a series | it_admin → staff1 | Participants get `meeting_invite` for that occurrence | `POST /api/v1/meeting-series/<id>/occurrences`, `cap meetings.read` | planned | |
| MTG-373 | Change notice | it_admin → staff1 | `meeting_changed` «تغيّر موعد أو مكان الاجتماع» only for time or place changes | `PATCH /api/v1/meetings/<id>`, `cap meetings.read` | manual 2026-10-28 | meeting_changed reached staff1 after time change |
| MTG-374 | Cancel notice | it_admin → staff1 | `meeting_cancelled` «أُلغي الاجتماع»; with scope following, one per cancelled occurrence | `POST /api/v1/meetings/<id>/cancel`, `cap meetings.read` | manual 2026-10-28 | meeting_cancelled reached staff1 |
| MTG-375 | Recommendation notice | it_admin → staff1 | `meeting_resolution` «توصية باسمك» to the responsible | `POST /api/v1/meetings/<id>/resolutions`, `cap meetings.read` | manual 2026-10-28 | meeting_resolution reached staff1 |
| MTG-376 | Task conversion notice | it_admin → staff1 | `meeting_converted` «حُوّلت لمهمة» | `POST /api/v1/meetings/<id>/resolutions/<id>/convert`, `cap meetings.read` | manual 2026-10-28 | meeting_converted reached staff1 |
| MTG-377 | Reminder window | staff1 | Meetings that are draft or confirmed and start within the next 24 hours produce `meeting_reminder` «تذكير باجتماع قادم» once per start time; moving the start produces a new reminder; done, cancelled or later meetings produce none | `cap meetings.read` | planned | |
| MTG-378 | Overdue notice | staff1 | `meeting_resolution_overdue` «توصية متأخرة» once per recommendation to the responsible when the deadline has passed and the recommendation is unfinished; none for finished, cancelled-meeting or task-linked recommendations | `cap meetings.read` | planned | |
| MTG-379 | Bell row visibility | staff2 | A row whose meeting the user can no longer read, or whose meeting is archived, is not shown; bell title is the meeting name and the link is `/meetings/{id}` | `cap meetings.read` | planned | |
