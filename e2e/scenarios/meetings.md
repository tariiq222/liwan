# Meetings

Pages: `/meetings`, `/meetings/new`, `/meetings/calendar`, `/meetings/follow-up`,
`/meetings/series`, `/meetings/series/new`, `/meetings/series/[id]` (`edit`),
`/meetings/[id]` (`edit`, `minutes`, `print`, `resolutions/new`, `resolutions/[id]/edit`).
Owners: `liwan_meetings`, `liwan_meetings_pmo`. Personas and status values: [README](README.md).

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
| MTG-06 | Delete a meeting that is done or has minutes versions | it_admin | Refused | `cap meetings.manage` | planned | R3: still no delete route/button; No delete route or button exists; see `MTG-182` |
| MTG-07 | Minutes, versions and PDF print | it_admin | Versions listed; PDF downloads | `GET /api/v1/meetings/<id>/versions`, `GET /api/v1/meetings/<id>/minutes.pdf`, `page /meetings/[id]/print`, `page /meetings/[id]/minutes` | automated | #186 closed 2026-10-31; versions listed (1 then 2 after reopen/complete again); a failing or missing wkhtmltopdf answers 503 `pdf_unavailable` as JSON (`test_minutes_pdf_engine_failure_is_a_503_pdf_unavailable`); a real PDF download is not proven here (no wkhtmltopdf in the scratch stack), it stays a staging check |
| MTG-20 | A business manager schedules meetings | ceo / pm | Owner decision: no meetings role exists outside `system_admin` | `cap meetings.create`, `cap meetings.manage` | decision | #162; Found 2026-10-28 Decided 2026-10-29: setting + organizer role, see MTG-382 to MTG-384. |

## Meetings list

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| MTG-24 | No meetings visible and no filter active | staff2 | Empty state «لا اجتماعات ظاهرة لك.» | `page /meetings` | planned | R3: staff2 sees 2 meetings; no persona with zero visible meetings was tried |
| MTG-31 | Organizer filter picks a person; «كل المنظّمين» clears it | it_admin | Only that organiser's meetings; the picker shows a loading, error-with-retry and «لا يوجد منظّمون مطابقون.» state | `page /meetings`, `GET /api/v1/meetings` | fail | #239; R3: organizer picker lists people and filters by typing, chosen shows «منظّم محدد»; but a no-match search shows only «كل المنظّمين», no «لا يوجد منظّمون مطابقون.» (findings3/meetings.md) |
| MTG-40 | Switch list to calendar with the view switch | it_admin | Calendar opens with the same filters | `page /meetings`, `page /meetings/calendar` | fail | #185; No view switch on /meetings and no link to /meetings/calendar anywhere (list header, sidebar); the calendar is only reachable by typing the URL |
| MTG-42 | Page size limits | api | Default and maximum 200; up to 2000 only when both `date_from` and `date_to` are given; `total` is the full count | `GET /api/v1/meetings` | planned | R3: only 48 meetings; cap of 2000 not provable |

## Calendar

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| MTG-52 | Event chips | it_admin | A chip per meeting with a colour dot by state; hover title shows name, time and state; click opens the meeting with the calendar as its return path | `page /meetings/calendar`, `page /meetings/[id]` | planned | R3: chip click not verified (selector); chip links include returnTo |
| MTG-57 | More than 2000 meetings in the window | api | Notice «في هذا الشهر {n} اجتماعًا؛ المعروض أول ٢٠٠٠ فقط.»; if the total is unknown the notice says coverage cannot be confirmed | `page /meetings/calendar`, `GET /api/v1/meetings` | planned | R3: needs >2000 meetings, not built |

## Create a meeting

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| MTG-70 | Create with the title only | it_admin | 201; state «مسودة»; organiser is the caller; reference generated and unique; `meeting_date` today; page opens the new record | `page /meetings/new`, `POST /api/v1/meetings` | fail | #211; Round 2: UI blocks title-only create: «هذا الحقل مطلوب» under the date; with date set: draft, organizer caller, MIN/2026/0047, meeting_date set, start null (API itself accepts title only) |
| MTG-83 | Link to a series the caller does not edit | custom role (employee, meetings.create) | A series the caller cannot see: 422 `invalid` «The meeting series does not exist.»; a series the caller sees but does not edit: 403 «Only the organizer, secretary or a meetings manager may link a meeting to this series.» | `POST /api/v1/meetings` | planned | #197; fixed in code: `_liwan_check_series_link` no longer reads a hidden series (`test_http_a_meeting_or_series_the_caller_takes_no_part_in_is_not_found` for the 422, `test_http_creator_participant_cannot_add_to_another_users_series` for the 403); not yet re-run in the UI |
| MTG-84 | Link to a project | it_admin | `project_id` saved; project name shown in the aside; hidden or other-company project refused | `POST /api/v1/meetings`, `page /meetings/new` | fail | private security advisory GHSA-9xq5-v9r4-xfxc; R3 as e2e_admin: project_id 69 saved and returned; invalid project on create 422 raw Odoo FK text with traceback (findings3 P1), see finding; R3: not reached |
| MTG-85 | `project_id` sent while the projects application is not installed | api | 422 «project_id is not supported: the projects application is not installed» | `POST /api/v1/meetings` | planned | final exclusive: the message belongs to a build without the bridge addon `liwan_meetings_pmo` (module state, `meeting_links.py` base hook); the bridge is installed here and uninstalling a module in the shared database was not done; with pmo.enabled off (retained or dropped) POST /meetings with project_id 17 as e2e_admin still answers 201 and saves project_id (see findings3/exclusive.md); R3: projects application is installed; switching it off is an exclusive phase; R3: not reached |

## Meeting record

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| MTG-105 | Actions of a confirmed meeting | it_admin | «تعديل» and «إنهاء»; no «تأكيد» | `page /meetings/[id]` | planned | R3: it_admin cannot confirm (raw 403 Companies), confirmed-state buttons not observed |
| MTG-108 | Meeting the caller may not see | staff2 | Not-found state (404 `not_found`); the page does not tell a hidden meeting from a missing one | `page /meetings/[id]`, `GET /api/v1/meetings/<id>` | planned | #197; fixed in code: a meeting the caller takes no part in answers 404 like another company's (`test_http_a_meeting_or_series_the_caller_takes_no_part_in_is_not_found`); the page itself is not yet re-run as staff2 |
| MTG-112 | A done meeting that has no stored snapshot | it_admin | Notice «لا توجد لقطة تاريخية لهذا الاجتماع المكتمل…» above the current content | `page /meetings/[id]` | planned | R3: cannot build a done meeting without snapshot (complete always creates one) |
| MTG-114 | Open recommendations count on the tile | it_admin | Counts only open or in-progress recommendations; a recommendation whose converted task is done no longer counts | `page /meetings/[id]`, `GET /api/v1/meetings/<id>` | planned | R3: needs converted task done, count not checked in UI |

## State machine

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| MTG-122 | Plain attendee confirms | staff1 (attendee) | 403 «Only the organizer, secretary or a Meeting Manager may confirm this meeting.» | `POST /api/v1/meetings/<id>/confirm` | fail | #187; 403 as expected but message is «Only the organizer, secretary or a Meeting Manager may edit this meeting.» (expected «…may confirm this meeting.») |
| MTG-143 | Transition buttons while a request is running | it_admin | Buttons disabled; no double transition | `page /meetings/[id]` | planned | R3b: UI double-click test not reached (slow stack); R3: not reached |

## Edit a meeting

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| MTG-150 | Open `/meetings/[id]/edit` | it_admin | Form prefilled (times in browser time zone); save returns to the record | `page /meetings/[id]/edit`, `PATCH /api/v1/meetings/<id>` | planned | R3: edit page prefilled with tz note seen; save and return not exercised |
| MTG-153 | Change title, place or join link only | it_admin | Saved; no bell for a title or link change | `PATCH /api/v1/meetings/<id>` | planned | R3: it_admin PATCH is 403 Companies; not run as admin |
| MTG-154 | Change start, end or place | it_admin | Saved; participants but the actor get bell `meeting_changed` | `PATCH /api/v1/meetings/<id>` | planned | R3: same |
| MTG-155 | Add an attendee or change the secretary | it_admin | The newly added people get bell `meeting_invite`; people already invited get nothing | `PATCH /api/v1/meetings/<id>` | planned | R3: same |
| MTG-156 | Remove an attendee who is responsible for a recommendation | it_admin | 422 «Reassign the responsible user before removing them from the meeting.» | `PATCH /api/v1/meetings/<id>` | planned | R3: same |
| MTG-162 | Detach from a series with `series_id` null; attach to another | it_admin | Detached; attaching needs series-editor rights and an open series | `PATCH /api/v1/meetings/<id>` | planned | R3b: detach/attach series not reached; R3: not reached |
| MTG-163 | Change the project (`project_id`, null clears) | it_admin | Saved; invalid project 422 | `PATCH /api/v1/meetings/<id>` | fail | private security advisory GHSA-9xq5-v9r4-xfxc; R3 api as e2e_admin: set and clear project OK; invalid project answers 404 with raw Odoo text instead of 422 (see finding); R3: not reached |
| MTG-168 | Unsaved edits and navigation | it_admin | Unsaved-changes guard on leaving; save disabled until something changed | `page /meetings/[id]/edit` | planned | R3b: unsaved guard on edit page not reached; R3: not reached |

## Visibility, isolation and capabilities

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| MTG-181 | Hidden meeting versus another company's meeting | staff2 | Same company but not a participant, and another company: both 404 `not_found`, so a hidden meeting is not revealed | `GET /api/v1/meetings/<id>` | planned | #197; private security advisory GHSA-9xq5-v9r4-xfxc; decided in code on 2026-10-31: both answer 404 (`test_http_a_meeting_or_series_the_caller_takes_no_part_in_is_not_found`); the owner may still choose otherwise |
| MTG-182 | Deleting a meeting | it_admin | The product has no delete route, button or command; the model refuses delete for done, cancelled and versioned meetings | `cap meetings.manage` | decision | #162; Owner decision needed: should drafts be deletable? Decided 2026-10-29: only a draft is deleted, see MTG-380 and MTG-381. |
| MTG-191 | Navigation and shortcuts | staff1 | Sidebar entries «الاجتماعات», «المتابعة», «التقويم», «الاجتماعات الدورية»; landing page works; the new-meeting context link shows only with `meetings.create` | `cap meetings.read`, `page /meetings` | fail | #185; Sidebar group has «عرض الكل / اجتماعاتي / مسودة / مؤكد / مكتمل / المتابعة / الدورية» but no «التقويم» entry; new-meeting link only for it_admin as expected |
| MTG-193 | Company switch | it_admin (two companies) | Lists, calendar and series show only the active company | `GET /api/v1/meetings`, `GET /api/v1/meeting-series` | planned | R3: no company switcher; No company switcher exists in the UI or API; isolation checked per persona (MTG-43) |

## Minutes

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| MTG-202 | Link a recommendation to a topic | it_admin | A recommendation belongs to one topic only; one used elsewhere is not offered | `page /meetings/[id]/minutes` | planned | R3: link selected in one topic; not-offered-elsewhere not clearly observed |
| MTG-205 | Return after creating a recommendation: already linked, unavailable | it_admin | Notices «التوصية مرتبطة بموضوع في هذا المحضر.» / «تعذّر العثور على التوصية ضمن الاجتماع المقروء…» | `page /meetings/[id]/minutes` | fail | #239; R3: new_resolution_id of a rec already linked to a topic shows «أُنشئت التوصية دون ربط بموضوع...» instead of «التوصية مرتبطة بموضوع في هذا المحضر.»; unknown id not checked (network suspended) |
| MTG-211 | Editor without access to a topic's project saves | pm | The hidden project association is preserved, not cleared | `PATCH /api/v1/meetings/<id>` | planned | R3: needs editor lacking project access, not built |
| MTG-213 | Saving minutes is logged | it_admin | Activity «حفظ المحضر» | `GET /api/v1/meetings/<id>/events` | planned | R3: API event minutes_saved summary English «Meeting minutes updated.»; UI label not checked |

## Print, PDF, history and versions

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| MTG-224 | Download the PDF | staff1 (attendee) | `application/pdf` attachment named after the reference; hidden meeting 403; other company 404; tenant feature off 403 | `GET /api/v1/meetings/<id>/minutes.pdf` | fail | #186; PDF route answers 422 HTML «Unable to find Wkhtmltopdf» for it_admin and staff1 (env lacks wkhtmltopdf); also not a JSON error |

## Recommendations

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| MTG-249 | Creating a recommendation assigned to oneself | it_admin | Responsible who is also the actor still receives bell `meeting_resolution` | `POST /api/v1/meetings/<id>/resolutions` | decision | #162; Found 2026-10-28: the actor is not excluded here, unlike invitations Decided 2026-10-29: fixed, no bell row to oneself; Odoo `test_resolution_self_assignment.py`. |
| MTG-258 | Patch with `responsible_id` null or 0 | api | Silently ignored, nothing changes and no error | `PATCH /api/v1/meetings/<id>/resolutions/<id>` | decision | #162; Found 2026-10-28: `patch_resolution` skips a falsy `responsible_id` Decided 2026-10-29: fixed, 422 on `responsible_id`; Odoo `test_resolution_empty_responsible.py`. |
| MTG-265 | Person who is neither editor nor assignee updates execution | staff2 | A participant who is neither editor nor assignee: 403 «Only the assignee or a meeting editor may update execution.»; a person who takes no part in the meeting: 404 `not_found` | `POST /api/v1/meetings/<id>/resolutions/<id>/<id>` | planned | #197; the documented refusal belongs to a participant, a non-participant gets the uniform not-found (same helper as MTG-181); no raw Odoo text either way; not yet re-run as staff2 |

## Conversion to a project task

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| MTG-289 | Conversion failure message | it_admin | Server message or «تعذّر تحويل التوصية إلى مهمة. حاول مرة أخرى.» in the tab | `page /meetings/[id]` | planned | R3b: conversion failure not reached; R3: not reached |

## Follow-up

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## Series

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| MTG-312 | Empty list | staff2 | «لا توجد اجتماعات دورية ظاهرة لك.» | `page /meetings/series` | planned | R3: staff2 sees 1 series; no zero-series persona tried |
| MTG-322 | Count out of range | it_admin | Count 0 or above 60 refused: form error; API 422 «Occurrence count must be between 1 and 60.» | `page /meetings/series/new`, `POST /api/v1/meeting-series` | fail | #187; until_count 61 → «Occurrence count must be between 1 and 60.» but count 0 answers «Set either an end date or a number of meetings, not both.» (0 treated as unset) |
| MTG-348 | End a series with an unsaved new occurrence open | it_admin | Message «احفظ الموعد الجديد الذي تضيفه أو تجاهله قبل إنهاء السلسلة.» | `page /meetings/series/[id]` | planned | R3b: unsaved occurrence flow not reached; R3: not reached |

## Attachments

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| MTG-366 | Attachment of another meeting by id | api | Download and delete answer 404 «Attachment is not linked to this meeting.» | `GET /api/v1/meetings/<id>/attachments/<id>/download`, `DELETE /api/v1/meetings/<id>/attachments/<id>` | fail | #239; R3 api: delete answers 404 «Attachment is not linked to this meeting.» but download answers «Attachment N is not linked to this record» (see finding); R3: not reached |
| MTG-367 | Upload failure | it_admin | Server message shown under the list | `page /meetings/[id]` | planned | R3b: upload failure not reached; R3: not reached |

## Notifications and reminders

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## Owner decisions of #162 (2026-10-29)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| MTG-380 | Delete a draft meeting | it_admin | A manager deletes a draft from the page menu after an inline confirm; the meeting, its recommendations and its calendar event are gone and the list is shown | `DELETE /api/v1/meetings/<id>`, `cap meetings.manage` | planned | #162 MTG-182; Odoo `test_meeting_delete.py` |
| MTG-381 | Delete a confirmed meeting | it_admin | The page offers no delete for a confirmed, done or cancelled meeting (it is cancelled instead and stays on record); the API answers 409 `conflict` | `DELETE /api/v1/meetings/<id>`, `cap meetings.manage` | planned | #162 MTG-182; Odoo `test_meeting_delete.py` |
| MTG-382 | Choose who schedules meetings | it_admin | Settings > Applications > Meetings shows «من يجدول الاجتماعات» with «كل الموظفين» or «أصحاب دور منظّم الاجتماعات فقط»; the default is the organizers; a stale save answers 409 and reloads | `page /settings/apps/meetings`, `GET /api/v1/meetings/settings`, `PATCH /api/v1/meetings/settings`, `cap meetings.settings.manage` | planned | #162 MTG-20; Odoo `test_meeting_settings.py` |
| MTG-383 | Employee schedules under each mode | staff1 | With organizers only, `POST /api/v1/meetings` and `POST /api/v1/meeting-series` answer 403 and the new-meeting actions are hidden; with every employee they succeed, series occurrences included | `POST /api/v1/meetings`, `POST /api/v1/meeting-series`, `cap meetings.create` | planned | #162 MTG-20; Odoo `test_meeting_settings.py` |
| MTG-384 | Assign the meeting organizer role | it_admin → staff1 | The built-in role «منظّم الاجتماعات» is assignable like the other built-in roles; its holder schedules under the organizers-only mode and manages nothing else | `cap meetings.create`, `cap meetings.read` | planned | #162 MTG-20; Odoo `test_meeting_settings.py` |
