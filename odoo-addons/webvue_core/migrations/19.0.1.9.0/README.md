# Branch access policy

The ORM creates `webvue.access.branch.rule` and the company selection
`webvue_branch_access_mode` with the default `delegated`. Existing role assignments
remain the sole explicit grants. No memberships or inheritance rows are created.
The access audit target selection adds `company`. No data transformation or stock
Odoo table SQL is needed.
