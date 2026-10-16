# Meeting permission upgrade review

Decision: APPROVE for the bounded migration, conditional on the coordinator's fresh isolated migration test and clone-rehearsal gates. No critical or important defect found in the actual three-file diff against c573032.

Reviewed source: /Users/tariq/code/nasq/.worktrees/runtime-meeting-upgrade, changes to webvue_core/models/access_service.py, webvue_core/data/access_migration_post.xml and webvue_core/tests/test_access_migration.py. Also inspected current seed XML, manifest load order, role mutation and user group synchronization implementation, permission definitions, and repository instructions.

The migration map matches the current approved seeds: employee gets meetings.read; system_admin and vendor_support get meetings.read/create/manage; PMO and HR manager roles receive no new meeting grant. The hook resolves exact module-owned XMLIDs and verifies built-in/protected targets. It links only missing permissions, preserves existing relations, leaves custom roles outside the target set, and avoids writes on a repeat run. Its private method name and explicit superuser check provide the required RPC/authorization boundary without a client-controlled context bypass.

The XML hook runs after permission definitions and role seeds, before the existing legacy-admin post step and final user synchronization. Existing role.write intentionally invokes capability-group synchronization and policy/version invalidation; this is consistent with making restored grants effective. The hook does not directly create/delete assignments or change login activation fields.

Tests inspected: test_builtin_meeting_upgrade_is_additive_and_idempotent and test_builtin_meeting_upgrade_requires_superuser. They recreate the absent meeting permissions on all five built-in roles, verify the approved delta and unchanged other permission links, preserve custom-role keys/version, assert a repeat does not bump built-in role versions, and deny an ordinary caller.

Validation boundary: this reviewer ran no tests or database operations and made no product/Git/runtime changes. The coordinator owns fresh isolated TestWebVueAccessMigration execution and actual old-database rehearsal. Assigned-user/account preservation is not directly asserted by the two added tests; compare assignments, active/login state, and intended resulting capability groups in the clone rehearsal before updating the authorized canonical database. This is a bounded review observation, not an identified implementation defect or a production-success claim.
