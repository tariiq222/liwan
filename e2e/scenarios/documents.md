# Documents

Pages: `/documents` (`new`, `[documentId]`, `edit`, `access`), `/documents/self` (served at
`/account/documents`), `/hr/departments/[id]/documents`. Owners: `liwan_documents`,
`liwan_documents_hr`. Personas and status values: [README](README.md).

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
| DOC-14 | Employee tries to create a document | staff1 | `/documents/new` forbidden; POST answers 403 `forbidden` | `page /documents/new` `POST /api/v1/documents` `cap documents.items.manage` | automated | `e2e/tests/access-matrix.e2e.ts`: page refusal |
| DOC-21 | Vendor support login | custom role (vendor support) | Outside an active support session every call is refused; during one, only the allowed operations work | `GET /api/v1/documents` | planned | round 3 final: needs the control plane and a vendor support session; none on this stack; round 2: needs the control plane and a vendor support session; See SaaS scenarios |

## Document list page

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| DOC-30 | Context filter | hr_manager | Kind select (القسم / الموظف) then a record select; list narrows to documents linked to that record; reader without `manage` does not see the selects | `page /documents` `GET /api/v1/documents/contexts` `GET /api/v1/documents/contexts/<id>/options` | fail | #198; URL context filter narrows the list, but the kind select shows English «Department» / «Employee» (see findings) |
| DOC-34 | Create button keeps list state | hr_manager | «مستند جديد» opens `/documents/new` carrying the current context; cancel returns to the same list | `page /documents/new` | fail | #188; «مستند جديد» opens /documents/new?returnTo=… keeping filters, but cancel, X and Escape show the unsaved-changes dialog on an untouched form |

## Creating and editing documents

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| DOC-53 | Contexts list | staff1 | Only available kinds, labelled «القسم» and «الموظف» for HR holders; empty for an employee without HR rights | `GET /api/v1/documents/contexts` | fail | #198; API labels are English (Department, Employee) and the UI shows them raw; staff1 gets the department kind only (he holds hr.departments.read) |
| DOC-54 | Library not initialised | hr_manager | 403 `library_unavailable`, `document library requires operator initialization` | `POST /api/v1/documents` | planned | round 3 final: a company created from the Odoo shell still gets its document library automatically (create 201), so the uninitialised state cannot be produced; round 2: library exists for every company here (the Dammam manager created a document with 201); a company without a library needs an operator step; Operator step; test only on a company without a library |
| DOC-61 | Edit page for an unknown or non-numeric id | hr_manager | Not found state | `page /documents/[id]/edit` | fail | #190; /documents/999999/edit shows not-found, but /documents/abc/edit renders only the heading with an empty page |

## Document page and files

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| DOC-75 | Upload a file with a name that already exists | hr_manager | Verify the outcome (reject or rename); expected to be refused with a clear error rather than overwrite | `POST /api/v1/documents/<id>/files` | decision | 2026-10-28: duplicate active name rejected 422 A file with the same name already exists in this directory.; UI shows a generic «تعذّر الحفظ لأن بعض البيانات غير صحيحة.»; same name allowed when the old file is archived; #161; Not decided in code; the DMS layer may reject a duplicate name |

## Archive and restore a document

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| DOC-102 | Archive an already archived document through the API | hr_manager | Doubtful: accepted again and the revision grows; the UI offers only the valid action | `POST /api/v1/documents/<id>/archive` | decision | 2026-10-28 confirmed: a second archive of an archived document answers 200 and revision grows; #161; `models/document.py:_liwan_set_active` does not compare with the current state |

## Visibility and grants

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## Employee and department links (liwan_documents_hr)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## Employee self-service pages

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
