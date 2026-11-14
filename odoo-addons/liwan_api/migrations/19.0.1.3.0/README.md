# 19.0.1.3.0

New models `liwan.tenant.export` (one run of the tenant data export) and `liwan.tenant.export.log` (its log), created by
Odoo's update with their ACL rows, the `tenant.export` capability with its group, and two crons (build and expiry). No existing table or value
changes. The capability repair hook links `tenant.export` to the built-in system administrator role; it is not available
to custom roles.
