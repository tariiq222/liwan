# Documents

Pages: `/documents` (`new`, `[documentId]`, `edit`, `access`), `/documents/self` (served at
`/account/documents`), `/hr/departments/[id]/documents`. Owners: `webvue_documents`,
`webvue_documents_hr`. Personas and status values: [README](README.md).

The department document pages under `/hr/departments/[id]/documents` are scenarios of
[hr.md](hr.md); this file covers the library itself, its API and the redirects into it.

Capabilities: every employee holds `documents.items.read`; `documents_manager` holds all five
(`read`, `manage`, `archive`, `access.manage`, `library.manage`); the HR manager role also gets
`read` and `manage` through the HR bridge. Dependencies: `manage` needs `read`; `archive` and
`access.manage` need `manage`; `library.manage` needs `read`. Access to one document is a
second layer: `visibility` (`company` or `restricted`) plus per-user grants (`reader`, `editor`).
Every write needs an editor grant in addition to the capability, even on a `company` document.
API errors quoted below are the server messages; the UI shows its own Arabic text for them.

## Capabilities and access to the library

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| DOC-12 | Employee opens `/documents` | staff1 | Sees only documents they may read; no «مستند جديد», no archived toggle, no context filter; nav shows «المستندات» | `page /documents` `cap documents.items.read` | planned | |
| DOC-13 | User without `documents.items.read` | custom role (no documents capability) | `/documents` shows the forbidden state; every documents route answers 403 `forbidden` | `GET /api/v1/documents` `cap documents.items.read` | planned | |
| DOC-14 | Employee tries to create a document | staff1 | `/documents/new` forbidden; POST answers 403 `forbidden` | `page /documents/new` `POST /api/v1/documents` `cap documents.items.manage` | automated | `e2e/tests/access-matrix.e2e.ts`: page refusal |
| DOC-15 | Archiver sees archived documents and the archive toggle | hr_manager | «المؤرشفة» toggle, KPI tile «المستندات المؤرشفة»; `archived=true` works | `GET /api/v1/documents` `cap documents.items.archive` | planned | A user without `archive` asking `archived=true` gets 403 |
| DOC-16 | Access management is separate from editing | custom role (documents.items.manage without access.manage) | «إدارة الوصول» is hidden; `/documents/<id>/access` forbidden; GET and PUT access answer 403 | `GET /api/v1/documents/<id>/access` `PUT /api/v1/documents/<id>/access` `cap documents.access.manage` | planned | |
| DOC-17 | Tag creation needs `documents.library.manage` | hr_manager, custom role (documents.items.manage only) | Holder sees «اسم وسم جديد» and «إضافة وسم»; others do not and POST answers 403 | `POST /api/v1/documents/tags` `cap documents.library.manage` | planned | |
| DOC-18 | Capability dependencies | custom role (documents.items.archive) | Granting `archive` also grants `manage` and `read` | `cap documents.items.archive` `cap documents.items.manage` | planned | |
| DOC-19 | Revoked capability takes effect on the next request | hr_manager | After `documents.items.manage` is removed the open page loses its buttons and writes answer 403 | `PATCH /api/v1/documents/<id>` | planned | Policy fence per company, see Odoo test `test_document_access.py` |
| DOC-20 | System administrator has no implicit document rights | it_admin | Sees no documents unless a role or grant allows it | `cap documents.items.read` | planned | The legacy admin role list still names `documents_manager` (`models/access_service.py:58`); confirm this does not give a system admin the capability |
| DOC-21 | Vendor support login | custom role (vendor support) | Outside an active support session every call is refused; during one, only the allowed operations work | `GET /api/v1/documents` | planned | See SaaS scenarios |

## Document list page

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| DOC-22 | Open the list with data | hr_manager | Heading «المستندات» with count tag («n مستند»); columns «العنوان», «السياق المرتبط», «الملفات», «نطاق الوصول»; newest change first | `page /documents` `GET /api/v1/documents` | planned | |
| DOC-23 | KPI strip | hr_manager | Tiles «المستندات», «مقيّدة», «تنتهي خلال 30 يومًا», «المستندات المنتهية» and, for archivers, «المستندات المؤرشفة»; figures ignore the current filters; tiles link to the matching filter | `page /documents` | planned | |
| DOC-24 | Empty library | hr_manager | «لا توجد مستندات» with «إنشاء أول مستند» | `page /documents` | planned | Fresh company |
| DOC-25 | Empty library for a reader | staff1 | «لا توجد مستندات» without a create action | `page /documents` | planned | |
| DOC-26 | Search by title | staff1 | Typing in «بحث المستندات» filters after a short delay; `q` is kept in the URL; «مسح البحث» clears | `page /documents` `GET /api/v1/documents` | planned | |
| DOC-27 | No match | staff1 | «لا توجد مستندات تطابق البحث» with «مسح الفلاتر» | `page /documents` | planned | |
| DOC-28 | Visibility filter | hr_manager | «المؤسسة» / «مقيّد» / «كل النطاقات» narrow the list and the URL | `page /documents` `GET /api/v1/documents` | planned | |
| DOC-29 | Expiry filter | hr_manager | «تنتهي خلال 30 يومًا» and «المستندات المنتهية» narrow the list; both tiles link to them | `page /documents` | planned | |
| DOC-30 | Context filter | hr_manager | Kind select (القسم / الموظف) then a record select; list narrows to documents linked to that record; reader without `manage` does not see the selects | `page /documents` `GET /api/v1/documents/contexts` `GET /api/v1/documents/contexts/<id>/options` | planned | |
| DOC-31 | Archived toggle | hr_manager | «المؤرشفة» shows archived documents; «المستندات النشطة» returns; empty archive shows «لا توجد مستندات مؤرشفة» | `page /documents` | planned | |
| DOC-32 | Pagination | hr_manager | 25 per page; `offset` in the URL; refresh stays on the page; footer «عرض n من total نتيجة» | `page /documents` | planned | Needs more than 25 documents |
| DOC-33 | Open a document and go back | hr_manager | Row opens `/documents/<id>` with `returnTo`; back «العودة إلى المستندات» keeps search, filters and page | `page /documents/[id]` `page /documents` | planned | |
| DOC-34 | Create button keeps list state | hr_manager | «مستند جديد» opens `/documents/new` carrying the current context; cancel returns to the same list | `page /documents/new` | planned | |
| DOC-35 | List API paging errors | staff1 | `limit=0` or `limit=abc` answers 422 `positive integer is required`; limit above 200 is capped; `offset` above 2147483647 answers 422 field `offset` | `GET /api/v1/documents` | planned | |
| DOC-36 | List API filter errors | staff1 | `visibility=x` 422 field `visibility`; `expiring_within=0` or `400` 422; `expired=maybe` or `archived=maybe` 422 `must be boolean` | `GET /api/v1/documents` | planned | |
| DOC-37 | Context filter errors | staff1 | `context_kind` without `context_id` (or reverse) 422 field `context`; unknown kind 422 `unknown document context` | `GET /api/v1/documents` | planned | |
| DOC-38 | Archived list without the archive capability | staff1 | `archived=true` answers 403 | `GET /api/v1/documents` | planned | |
| DOC-39 | Old HR document links redirect | hr_manager | `/hr/documents`, `/hr/documents/new`, `/hr/departments/<id>/documents[/new\|<doc>[/edit]]` open the matching `/documents` page with the department as context | `page /documents` | planned | `modules/documents/entryRedirect.ts`; department pages themselves belong to hr.md |

## Creating and editing documents

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| DOC-01 | Create a document and upload a file | hr_manager | Saved; default visibility `restricted`, creator is editor | `page /documents/new` `POST /api/v1/documents` `POST /api/v1/documents/<id>/files` `cap documents.items.manage` | planned | |
| DOC-40 | Create panel | hr_manager | `/documents/new` over the list; blue notice «المستندات الجديدة مقيّدة افتراضيًا»; fields title, content, expiry, context, tags; hint that files are uploaded after creation | `page /documents/new` | planned | |
| DOC-41 | Create with only a title | hr_manager | Saved without body, files or details; redirect to the document with toast «تم إنشاء المستند» | `POST /api/v1/documents` | planned | Content is optional by design |
| DOC-42 | Create without a title | hr_manager | «عنوان المستند مطلوب.» and focus on the title; API 422 `name must not be empty` | `page /documents/new` `POST /api/v1/documents` | planned | |
| DOC-43 | Rich text content | hr_manager | Bold, italic, bullet list, numbered list and link («إضافة رابط») are saved; unsafe HTML is stripped when shown | `page /documents/new` `GET /api/v1/documents/<id>` | planned | |
| DOC-44 | Expiry date on create | hr_manager | Date saved; invalid API value (`2026-13-40`, not a string) answers 422 field `expiry_date` | `POST /api/v1/documents` | planned | |
| DOC-45 | Tags on create | hr_manager | Search and pick tags; list paged by 50; API 422 for duplicate, non-positive or unknown tag ids | `GET /api/v1/documents/tags` `POST /api/v1/documents` | planned | |
| DOC-46 | New tag | hr_manager | «إضافة وسم» creates and selects it; blank name is disabled; API blank name 422 | `POST /api/v1/documents/tags` | planned | |
| DOC-47 | Tag search | staff1 | `q` filters tags by name; list ordered by name | `GET /api/v1/documents/tags` | planned | |
| DOC-48 | Link a context on create | hr_manager | Context kind then record; saved document shows the context in the details and list | `GET /api/v1/documents/contexts` `GET /api/v1/documents/contexts/<id>/options` | planned | |
| DOC-49 | Create from a department list | hr_manager | `context_kind` and `context_id` in the URL preselect the context | `page /documents/new` | planned | |
| DOC-50 | Create with unknown or internal fields | hr_manager | 422 `field is not writable` for `visibility`, `revision`, `active`, `company_id`, `grants` | `POST /api/v1/documents` | planned | |
| DOC-51 | Create with a malformed context | hr_manager | 422 field `context` for a missing id, a non-positive id, a blank kind or extra keys | `POST /api/v1/documents` | planned | |
| DOC-52 | Context options errors | hr_manager | Unknown kind answers 422 `unknown document context`; paging and `q` work; a user without `manage` gets 403 | `GET /api/v1/documents/contexts/<id>/options` | planned | |
| DOC-53 | Contexts list | staff1 | Only available kinds, labelled «القسم» and «الموظف» for HR holders; empty for an employee without HR rights | `GET /api/v1/documents/contexts` | planned | |
| DOC-54 | Library not initialised | hr_manager | 403 `library_unavailable`, `document library requires operator initialization` | `POST /api/v1/documents` | planned | Operator step; test only on a company without a library |
| DOC-55 | Unsaved changes guard | hr_manager | Leaving the create form with input asks to confirm; saving clears the guard | `page /documents/new` | planned | |
| DOC-56 | Double click on «إنشاء المستند» | hr_manager | One document is created | `page /documents/new` | planned | |
| DOC-02 | Edit, lock and unlock a file | hr_manager | Locked file cannot be replaced | `page /documents/[id]/edit` `POST /api/v1/documents/<id>/files/<id>/lock` `POST /api/v1/documents/<id>/files/<id>/unlock` | planned | The product has no replace-file action; the lock only blocks another user from locking, unlocking, archiving or restoring that file (see DOC-83 to DOC-90) |
| DOC-57 | Edit title, body, expiry, context and tags | hr_manager | Form pre-filled; save disabled until something changes; revision +1; returns to the document | `page /documents/[id]/edit` `PATCH /api/v1/documents/<id>` | planned | |
| DOC-58 | Clear the expiry date | hr_manager | `expiry_date: null` saves; document leaves the expiring filters | `PATCH /api/v1/documents/<id>` | planned | |
| DOC-59 | Change or clear the context | hr_manager | `context: null` removes the link; a new kind replaces the old one | `PATCH /api/v1/documents/<id>` | planned | |
| DOC-60 | Edit by a reader | staff1 | `/documents/<id>/edit` shows the forbidden state; no «تعديل المستند» button; PATCH answers 403 `document access is forbidden` | `page /documents/[id]/edit` `PATCH /api/v1/documents/<id>` | planned | |
| DOC-61 | Edit page for an unknown or non-numeric id | hr_manager | Not found state | `page /documents/[id]/edit` | planned | |
| DOC-62 | Patch without expected revision | hr_manager | 422 field `expected_revision` | `PATCH /api/v1/documents/<id>` | planned | |
| DOC-63 | Patch with an empty body or only the revision | hr_manager | 422 `at least one changed field is required` | `PATCH /api/v1/documents/<id>` | planned | |
| DOC-64 | Patch visibility, revision or active | hr_manager | 422 `field is not writable`; visibility changes only through the access route | `PATCH /api/v1/documents/<id>` | planned | |
| DOC-08 | Two editors save the same revision | hr_manager, it_admin | Second save refused as stale | `PATCH /api/v1/documents/<id>` | planned | 409 `conflict`, details `current_revision`; edit page shows «تغيّر هذا المستند في جلسة أخرى» and «تجاهل المسودة وأعد التحميل» |
| DOC-65 | Reload after a conflict | hr_manager | Draft is replaced by the latest saved version only after the explicit reload; save stays disabled until then | `page /documents/[id]/edit` | planned | |
| DOC-66 | Patch an archived document | hr_manager | 403; restore it first | `PATCH /api/v1/documents/<id>` | planned | |
| DOC-67 | Cancel the edit | hr_manager | Content changes are discarded; files are unaffected | `page /documents/[id]/edit` | planned | «إلغاء هذا النموذج يتجاهل تعديلات المحتوى فقط» |

## Document page and files

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| DOC-68 | Open a document | hr_manager | Heading, visibility tag, number `#id`, body, files list, aside with expiry, context link and tags | `page /documents/[id]` `GET /api/v1/documents/<id>` | planned | |
| DOC-69 | Buttons depend on permissions | staff1, hr_manager | Reader sees no edit, access, archive or upload; editor with capabilities sees «إدارة الوصول», «تعديل المستند», the actions menu and «رفع ملف» | `page /documents/[id]` | planned | `allowed_actions` from the API decides |
| DOC-70 | Upload a file | hr_manager | Listed with name and size in MB; document revision +1; toast «تم حفظ التغييرات» | `POST /api/v1/documents/<id>/files` `page /documents/[id]` | planned | |
| DOC-71 | Upload validation in the browser | hr_manager | Over 10 MB shows «يتجاوز حجم الملف 10 ميبيبايت.»; empty file shows «اختر ملفًا غير فارغ.»; nothing is sent | `page /documents/[id]` | planned | |
| DOC-72 | Upload validation on the server | hr_manager | 422 for a name with `/` or `\`, invalid base64, empty data, over 10 MB, disallowed type (`file type is not allowed`; only text, pdf, png, jpeg, docx, xlsx are accepted by content), unknown field | `POST /api/v1/documents/<id>/files` | planned | The sniffed content decides the type |
| DOC-73 | Upload without expected revision or with a stale one | hr_manager | 422 field `expected_revision`; stale answers 409 and the page reloads with «تغيّر المستند وتم تحميل آخر نسخة…» | `POST /api/v1/documents/<id>/files` | planned | |
| DOC-74 | Upload by a reader or to an archived document | staff1, hr_manager | 403 | `POST /api/v1/documents/<id>/files` | planned | |
| DOC-75 | Upload a file with a name that already exists | hr_manager | Verify the outcome (reject or rename); expected to be refused with a clear error rather than overwrite | `POST /api/v1/documents/<id>/files` | decision | #161; Not decided in code; the DMS layer may reject a duplicate name |
| DOC-76 | List files | staff1 | Files ordered by name; `q` filters; paging 50; response carries the current revision | `GET /api/v1/documents/<id>/files` | planned | |
| DOC-77 | Files list with a stale `revision` query | hr_manager | 409 `conflict` | `GET /api/v1/documents/<id>/files` | planned | |
| DOC-78 | Archived files are hidden from non-archivers | staff1 | Archived file is absent for readers and visible with the badge «المؤرشفة» for archivers | `GET /api/v1/documents/<id>/files` | planned | |
| DOC-79 | Download a file | staff1 | File downloads as an attachment with the original name; response is private, not cached, `nosniff` | `GET /api/v1/documents/<id>/files/<id>/download` | planned | Odoo test `test_document_downloads.py` |
| DOC-80 | Head request on a download | staff1 | Same status and headers without a body | `HEAD /api/v1/documents/<id>/files/<id>/download` | planned | |
| DOC-81 | Download refusals | staff2 | 404 for a document the user cannot read or a file of another document; archived file 404 for non-archivers | `GET /api/v1/documents/<id>/files/<id>/download` | planned | |
| DOC-82 | Download from another company | staff1 | 404 | `GET /api/v1/documents/<id>/files/<id>/download` | planned | |
| DOC-83 | Lock a file | hr_manager | Badge «مقفل»; menu now offers «إلغاء القفل»; document revision +1 | `POST /api/v1/documents/<id>/files/<id>/lock` | planned | |
| DOC-84 | Unlock a file | hr_manager | Badge removed | `POST /api/v1/documents/<id>/files/<id>/unlock` | planned | |
| DOC-85 | Another editor acts on a locked file | it_admin as editor | 403 `file is archived or locked by another editor` for lock and unlock; no lock actions in the menu | `POST /api/v1/documents/<id>/files/<id>/lock` | planned | |
| DOC-86 | Lock an archived file | hr_manager | 403 | `POST /api/v1/documents/<id>/files/<id>/lock` | planned | |
| DOC-87 | Lock by a reader | staff1 | 403 `document access is forbidden` | `POST /api/v1/documents/<id>/files/<id>/lock` | planned | |
| DOC-88 | Archive a file | hr_manager | Inline «هل تريد أرشفة هذا الملف؟»; confirm with «تأكيد الأرشفة»; file shows «المؤرشفة» | `POST /api/v1/documents/<id>/files/<id>/archive` | planned | |
| DOC-89 | Archive a file locked by someone else | hr_manager | 403 `file is locked by another editor`; the lock owner can archive it | `POST /api/v1/documents/<id>/files/<id>/archive` | planned | |
| DOC-90 | Restore a file | hr_manager | Back in the active list; restoring a file locked by another user is refused | `POST /api/v1/documents/<id>/files/<id>/restore` | planned | |
| DOC-91 | File action on a file of another document | hr_manager | 404 `file does not belong to this document` | `POST /api/v1/documents/<id>/files/<id>/archive` | planned | |
| DOC-92 | File actions without the right capability | custom role (documents.items.manage without archive) | Lock and unlock allowed; archive and restore refused 403 | `POST /api/v1/documents/<id>/files/<id>/restore` | planned | |
| DOC-93 | File action with unknown body fields | hr_manager | 422 `field is not writable` | `POST /api/v1/documents/<id>/files/<id>/unlock` | planned | |
| DOC-94 | Concurrent file actions | hr_manager, it_admin | Second action with the old revision receives 409 and the page reloads document and files | `POST /api/v1/documents/<id>/files/<id>/lock` | planned | Odoo tests `test_file_concurrency.py` |
| DOC-95 | File list pagination | hr_manager | More than 50 files page by 50 on the document page | `page /documents/[id]` | planned | |
| DOC-96 | Open an unknown, non-numeric or hidden document | staff2 | Not found state with retry | `page /documents/[id]` | planned | |

## Archive and restore a document

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| DOC-03 | Archive and restore a document and a file | hr_manager | Archived hidden from readers, back on restore | `POST /api/v1/documents/<id>/archive` `POST /api/v1/documents/<id>/restore` `cap documents.items.archive` | planned | |
| DOC-97 | Archive confirmation | hr_manager | Actions menu «أرشفة» shows «هل تريد أرشفة هذا المستند؟»; cancel keeps it; confirm archives; alert «المؤرشفة» appears | `page /documents/[id]` | planned | |
| DOC-98 | Restore | hr_manager | Menu offers «استعادة» on an archived document; it returns to the active list | `POST /api/v1/documents/<id>/restore` | planned | |
| DOC-99 | Archived document for a reader | staff1 | Direct link answers 404; absent from the list even with a grant | `GET /api/v1/documents/<id>` | planned | Archive holders still read it |
| DOC-100 | Archive without archive capability or editor grant | custom role (documents.items.manage) | 403 | `POST /api/v1/documents/<id>/archive` | planned | |
| DOC-101 | Archive or restore with a stale or missing revision | hr_manager | 409 `conflict` / 422 field `expected_revision` | `POST /api/v1/documents/<id>/restore` | planned | |
| DOC-102 | Archive an already archived document through the API | hr_manager | Doubtful: accepted again and the revision grows; the UI offers only the valid action | `POST /api/v1/documents/<id>/archive` | decision | #161; `models/document.py:_webvue_set_active` does not compare with the current state |
| DOC-103 | Archived documents keep their files and grants | hr_manager | After restore files and grants are unchanged | `POST /api/v1/documents/<id>/restore` | planned | |

## Visibility and grants

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| DOC-04 | Visibility `company`: every employee reads it | staff1 | Visible, read-only | `GET /api/v1/documents/<id>` | planned | |
| DOC-05 | Restricted document with a reader grant | staff1 | Reads; cannot edit | `GET /api/v1/documents/<id>` | planned | |
| DOC-06 | Restricted document with no grant | staff2 | Not listed; direct link 404 | `page /documents/[id]` `GET /api/v1/documents/<id>` | planned | |
| DOC-07 | Editor grant to a user without `documents.items.manage` as the only editor | hr_manager | Refused (one active editor with manage needed) | `PUT /api/v1/documents/<id>/access` | planned | 422 `at least one active capable editor is required` |
| DOC-104 | Open «إدارة الوصول» | hr_manager | Visibility select (مقيّد / المؤسسة) with its help text, people picker, one row per grant | `page /documents/[id]/access` `GET /api/v1/documents/<id>/access` | planned | |
| DOC-105 | Make a document visible to the company | hr_manager | Every employee with read capability sees it; editing still needs an editor grant | `PUT /api/v1/documents/<id>/access` | planned | |
| DOC-106 | Return a company document to restricted | hr_manager | Only granted users keep access; grants are retained | `PUT /api/v1/documents/<id>/access` | planned | |
| DOC-107 | Add a reader | hr_manager | Person added as «قارئ»; the person now lists and opens the document | `PUT /api/v1/documents/<id>/access` | planned | |
| DOC-108 | Add an editor | hr_manager | Person added and changed to «محرّر»; can edit if they hold `documents.items.manage` | `PUT /api/v1/documents/<id>/access` | planned | A grant without the capability gives no extra right |
| DOC-109 | Remove a person | hr_manager | Document disappears from their list at once | `PUT /api/v1/documents/<id>/access` | planned | |
| DOC-110 | Cannot remove or demote the last editor in the form | hr_manager | Remove button and the «قارئ» option are disabled for the only editor; message «أبقِ محرّرًا واحدًا على الأقل يملك صلاحية إدارة المستندات.» | `page /documents/[id]/access` | planned | |
| DOC-111 | Revoke own access | hr_manager | Allowed when another capable editor remains; response returns the saved proposal without rereading; afterwards the document is no longer visible to the caller | `PUT /api/v1/documents/<id>/access` | planned | |
| DOC-112 | Access payload errors | hr_manager | 422 for visibility other than `company` or `restricted`, grants not a list, grant keys other than `user_id` and `access`, access other than `reader` or `editor`, duplicate user, non-integer id | `PUT /api/v1/documents/<id>/access` | planned | |
| DOC-113 | Grant to an inactive, portal or other-company user | hr_manager | 422 `grant users must be active internal users of this company` | `PUT /api/v1/documents/<id>/access` | planned | |
| DOC-114 | Stale access save | hr_manager, it_admin | 409 `conflict`; form shows the conflict alert and reload | `PUT /api/v1/documents/<id>/access` | planned | |
| DOC-115 | Access page for a reader or a non-editor | staff1 | Forbidden state; GET access answers 403 | `page /documents/[id]/access` `GET /api/v1/documents/<id>/access` | planned | |
| DOC-116 | Names of users who left | hr_manager | A grant to a user no longer in the directory shows «Unavailable user» | `GET /api/v1/documents/<id>/access` | planned | |
| DOC-117 | Unsaved changes guard on access | hr_manager | Leaving with an unsaved grant asks to confirm | `page /documents/[id]/access` | planned | |
| DOC-118 | Grant to a user without `documents.items.read` | hr_manager | The user still cannot read; no data is exposed | `PUT /api/v1/documents/<id>/access` | planned | |
| DOC-119 | Company isolation | staff1 | A document of another company answers 404 on detail, files, download and access | `GET /api/v1/documents/<id>` | planned | Odoo test `test_company_isolation.py` |

## Employee and department links (webvue_documents_hr)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| DOC-09 | Link a document to an employee and to a department | hr_manager | Listed on the employee and the department | `page /documents` `GET /api/v1/documents/contexts` | planned | |
| DOC-10 | Employee self-service documents | staff1 | Own employee documents only | `page /documents/self` `GET /api/v1/documents/employee/me` | planned | |
| DOC-120 | Employee link needs HR management | custom role (documents.items.manage without hr.employees.manage) | «الموظف» context is not offered; creating with an employee context answers 403 | `POST /api/v1/documents` `GET /api/v1/documents/contexts` | planned | |
| DOC-121 | Department link needs department read | custom role (documents.items.manage without hr.departments.read) | «القسم» context is not offered | `GET /api/v1/documents/contexts` | planned | |
| DOC-122 | HR switched off | hr_manager | Employee and department contexts disappear; existing links stay readable only by their grants | `GET /api/v1/documents/contexts` | planned | |
| DOC-123 | Employee documents stay restricted | hr_manager | Making an employee-linked document `company` is refused; linking an employee to a `company` document is refused (`Restrict document access before assigning an employee.`) | `PUT /api/v1/documents/<id>/access` `PATCH /api/v1/documents/<id>` | planned | |
| DOC-124 | Linking does not grant reading | hr_manager, staff1 | The employee sees the document under «مستنداتي الوظيفية» only after being added as reader (help «ربط المستند بالموظف لا يمنحه صلاحية القراءة تلقائيًا…») | `PUT /api/v1/documents/<id>/access` `GET /api/v1/documents/employee/me/<id>` | planned | |
| DOC-125 | Link to an employee or department of another company | hr_manager | Refused: `Employee context is not available.` / `department context is not available` | `POST /api/v1/documents` | planned | |
| DOC-126 | Context payload with extra keys | hr_manager | 422 field `context` | `PATCH /api/v1/documents/<id>` | planned | |
| DOC-127 | Department with documents cannot be deleted | hr_manager | Department delete answers 422 `department_in_use`; no document names or counts are revealed | | planned | `models/hr_department.py`; the department routes are in hr.md |
| DOC-128 | Context link in the document details | hr_manager | Department links to `/hr/departments/<id>`, employee to `/hr/employees/<id>`, own employee to `/account/profile`; no link when the viewer cannot read the target | `page /documents/[id]` | planned | |
| DOC-129 | Employee list filtered | hr_manager | `context_kind=hr.employee&context_id=<id>` lists that employee's documents | `GET /api/v1/documents` | planned | |
| DOC-130 | Employee-me list refusals | custom role (documents.items.read without hr.employees.read) | 403; archived list needs `documents.items.archive`; HR or documents switched off answers 403 `feature_not_included` | `GET /api/v1/documents/employee/me` | planned | |
| DOC-131 | Employee-me with no employee record | custom role (employee without HR record) | Empty list | `GET /api/v1/documents/employee/me` | planned | UI shows «حسابك غير مرتبط بسجل موظف» |
| DOC-132 | Employee-me detail of another employee's document | staff1 | 404 `document not found` | `GET /api/v1/documents/employee/me/<id>` | planned | |
| DOC-133 | Employee-me filters | staff1 | `q`, `visibility`, `expiring_within`, `expired`, paging work as in the main list | `GET /api/v1/documents/employee/me` | planned | |
| DOC-11 | Document with an expiry date | hr_manager | Appears in the HR expiring report (HR-53) | `PATCH /api/v1/documents/<id>` | planned | |

## Employee self-service pages

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| DOC-134 | Open «مستنداتي الوظيفية» | staff1 | `/account/documents` lists documents linked to the user's employee record and readable by them; paging 25 by `offset` | `page /documents/self` | planned | |
| DOC-135 | Empty | staff1 | «لا توجد مستندات وظيفية متاحة» with the HR contact hint | `page /documents/self` | planned | |
| DOC-136 | Account without an employee record | custom role (employee without HR record) | «حسابك غير مرتبط بسجل موظف» | `page /documents/self` | planned | |
| DOC-137 | User without the needed capabilities | custom role (no hr.employees.read) | Forbidden state | `page /documents/self` | planned | |
| DOC-138 | Open one personal document | staff1 | `/account/documents/<id>`: title, number, body, read-only files with download links, expiry and tags; no edit, archive, lock or upload; back «العودة إلى مستنداتي الوظيفية» | `page /documents/self/[id]` | planned | |
| DOC-139 | Personal document that is archived | staff1 | Alert «المؤرشفة» if visible | `page /documents/self/[id]` | planned | |
| DOC-140 | Invalid or foreign personal document id | staff1 | Not found state | `page /documents/self/[id]` | planned | |
| DOC-141 | Download a personal document file | staff1 | Download works through the main download route | `GET /api/v1/documents/<id>/files/<id>/download` | planned | |
