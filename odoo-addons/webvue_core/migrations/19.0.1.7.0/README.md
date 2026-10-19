# Company profile capabilities

Adds the `settings.company.read` and `settings.company.manage` permissions and their capability groups. No stored schema changes: the built-in role grants are repaired by `_webvue_repair_builtin_role_grants` on every upgrade, so `system_admin` and `vendor_support` receive them.
