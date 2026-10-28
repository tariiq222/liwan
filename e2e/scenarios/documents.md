# Documents

Pages: `/documents` (`new`, `[documentId]`, `edit`, `access`), `/documents/self`,
`/hr/departments/[id]/documents`. Owners: `webvue_documents`, `webvue_documents_hr`.
Personas and status values: [README](README.md).

| ID | Scenario | Persona | Expected | Status | Test / notes |
| --- | --- | --- | --- | --- | --- |
| DOC-01 | Create a document and upload a file | hr_manager | Saved; default visibility `restricted`, creator is editor | planned | |
| DOC-02 | Edit, lock and unlock a file | hr_manager | Locked file cannot be replaced | planned | |
| DOC-03 | Archive and restore a document and a file | hr_manager | Archived hidden from readers, back on restore | planned | |
| DOC-04 | Visibility `company`: every employee reads it | staff1 | Visible, read-only | planned | |
| DOC-05 | Restricted document with a reader grant | staff1 | Reads; cannot edit | planned | |
| DOC-06 | Restricted document with no grant | staff2 | Not listed; direct link 404 | planned | |
| DOC-07 | Editor grant to a user without `documents.items.manage` as the only editor | hr_manager | Refused (one active editor with manage needed) | planned | |
| DOC-08 | Two editors save the same revision | hr_manager, it_admin | Second save refused as stale | planned | |
| DOC-09 | Link a document to an employee and to a department | hr_manager | Listed on the employee and the department | planned | |
| DOC-10 | Employee self-service documents | staff1 | Own employee documents only | planned | |
| DOC-11 | Document with an expiry date | hr_manager | Appears in the HR expiring report (HR-53) | planned | |
