# nasq HR-1 implementation record

> UI authority update — 2026-09-07: [DESIGN.md](../../../DESIGN.md) supersedes this document's customer-UI appearance, component and navigation prescriptions wherever they conflict. Preserve historical implementation/verification evidence and still-valid API, permission, business and delivery contracts. This document is not a second theme source.

**Status:** Implemented and shipped in `v0.5.0-phase-hr` (commit
`c7a534c`). This file records the delivered scope and maps the original HR-1
tasks to their current paths. It is not an instruction to restart the work.

The exact pre-integration plan is preserved at
[`docs/archive/2026-09-04-nasq-hr-phase-1.md`](../../archive/2026-09-04-nasq-hr-phase-1.md).
HR-2 and HR-3 are separate pending scopes. Phase 3b owns its own specification,
plan, and handoff; do not edit those files from this plan.

## Delivered scope

HR-1 ships a company-wide employee directory at `/hr`, read-only employee
cards, customer-admin CRUD for stock departments, and department documents.
Documents have a required department, free-text title, HTML body, attachments,
title search, and department filtering. Employees can read documents from
every department in their company. Department managers receive no additional
write rights. Payroll, employee invites, account roles, and HR-2 employee
field assignment are outside this scope.

The PMO route `GET /api/v1/people?q=` remains unchanged. It returns user ids
for the task assignee picker. HR routes return employee ids; these identities
must remain distinct.

## Implementation mapping

### Odoo vertical slice

The addon `odoo-addons/nasq_hr` owns the full HR backend:

- `models/hr_document.py` defines `nasq.hr.document` with required
  `department_id`, company scope, HTML body, and attachment links.
- `security/ir.model.access.csv` and `security/hr_document_rules.xml` grant
  company-wide employee reads and customer-admin writes.
- `controllers/hr_departments.py`, `hr_employees.py`, and `hr_documents.py`
  expose the `/api/v1/hr/*` json2 routes, including attachment upload.
- `serializers/hr_department.py`, `hr_employee.py`, and `hr_document.py`
  whitelist wire fields and validate writes.
- `tests/test_hr_document_acl.py`, `test_hr_departments.py`,
  `test_hr_employees.py`, and `test_hr_documents.py` cover model access and
  API behavior. `tests/common.py` owns the HR fixture helpers.

The addon depends on `nasq_api`, `hr`, and `mail`; `nasq_api` does not import
HR. Controllers run as the logged-in user and contain no `sudo()` path.

### Contract slice

`packages/contracts/src/hr/index.ts` defines strict schemas for departments,
employees, document attachments, documents, and `{items,total}` list
responses. `packages/contracts/src/index.ts` re-exports the HR barrel. The
employee schema keeps `id` as the employee id and `user_id` as a nullable
separate field; it does not reuse `PersonRefSchema`.

### Web slice

`apps/web/app/pages/hr.vue` is the shell. It composes:

- `DirectoryTable.vue` for search, department filtering, and employee rows;
- `EmployeeCard.vue` for the read-only employee sheet;
- `DeptPanel.vue` for customer-admin department maintenance;
- `DocumentList.vue`, `DocumentReader.vue`, and `DocumentEditor.vue` for
  department documents;
- `useHrDepartments.ts`, `useHrEmployees.ts`, and `useHrDocuments.ts` for
  API access and vue-query cache replacement.

Arabic and English copy lives in `apps/web/i18n/locales/ar/hr.json` and
`en/hr.json`. HR E2E and live contract cases live in
`apps/web/e2e/hr-directory.spec.ts`, `hr-documents.spec.ts`, and
`contracts-hr.spec.ts`. HR has no company-wide document dump as its only view:
documents appear after a department is selected, with title search as an
additional filter.

## Acceptance record

The implementation is accepted when a fresh orchestrator run confirms:

- employees can read the company-wide directory and documents, while only
  customer admins can write departments/documents;
- department documents require `department_id`, preserve attachment metadata,
  and reject tags, personnel-file fields, reparenting, bad ids, and empty
  titles;
- `/api/v1/people` still validates as the user-id picker and does not collapse
  employee ids into user ids;
- the HR page remains `/hr`, the card is read-only, and HR UI copy is RTL/i18n
  safe;
- focused Odoo, contract, web, and E2E checks pass for the integrated checkout.

This documentation update does not claim that those fresh integration checks,
runtime cleanup, deployment, DNS, or release approval are complete.
