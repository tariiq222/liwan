# 19.0.1.10.0

19.0.1.9.0 → 19.0.1.10.0: the payroll audit trail.

New tables `liwan_hr_audit_event` (one immutable row per audited payroll write: company, action, record) and
`liwan_hr_audit_change` (one row per field of an event: name, and old and new text for non-secret policy fields
only), created by the ORM on update. Both start empty: nothing is moved or rewritten, so there is no data to carry.

The `hr.payroll.audit.read` permission and its capability group are new XML data. The data-file
`_liwan_repair_builtin_role_grants` function idempotently links the permission to the noupdate built-in
`payroll_manager` role on upgrade; no HR role, HR capability or stock group receives it.
