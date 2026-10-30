# Neutral scope kinds

Removes the stored `liwan.access.permission.project_contextual` flag: the application that owns a context kind registers its contextual permissions and roles through `liwan.access.service._liwan_scope_kinds()`, so the foundation stores no kind. No migration script: Odoo removes the field's `ir.model.fields` record and drops its column at the end of the upgrade, and no other data changes.
