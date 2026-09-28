# Shared registry: offline publisher-lock recovery

## Scope and authorization

Operator procedure only; not an executable repair script or permission to modify
an environment. No repair was performed while writing this document. Obtain
separate approval for stopping services, changing lock files and recovering the
specific installation. Never use customer databases or `odoo19` for a drill.

The publisher uses one absolute NASQ_TENANT_REGISTRY_PATH on a shared local
filesystem. This protocol is not certified for distributed filesystems. All
publishers must use the same path and directory mount; replacing a separately
mounted file can otherwise leave readers on the old inode.

## When to stop

A surviving `<path>.publisher-lock` prevents every new mutation/recovery. PID,
owner UUID, file age and missing local process are diagnostic evidence only,
never sufficient permission to reclaim the lock. A paused writer or another
host can still be alive. Do not automate TTL/PID-based removal.

1. Put the installation into an approved maintenance window. Stop **all** registry
   publishers, including API instances, operator tools, recovery processes and
   supervisors that could restart them. If complete quiescence cannot be proved,
   stop the procedure and leave the lock intact.
2. Preserve the lock, snapshot, `.pending`, adjacent temporary files and relevant
   audit/log evidence in an access-controlled location. Record paths, timestamps,
   ownership and hashes. Do not expose routing identities or credentials in logs.
3. Keep `.pending` exactly as found. Never clear it manually, restore an older
   snapshot or copy a temporary file over the snapshot. A valid pending barrier
   makes subsequent reader lookups fail closed; already-authorized traffic is
   not cancelled. If maintenance requires zero traffic, gate readers separately.
4. Only after approved, verified quiescence may the stale lock be moved to a
   retained evidence name in the same directory. Make the directory metadata
   durable (directory fsync) before enabling the single recovery publisher.
   Do not remove `.pending`. Missing, symlinked, nonregular or inaccessible files
   require investigation, not a guessed cleanup sequence.
5. Enable exactly one recovery-capable publisher, with normal mutation callers
   still blocked. Use the existing authenticated `POST /v1/registry/recover`
   route with a reason and current `vendor.tenants.manage` authority. Use the
   established signed-request mechanism; do not invent an unsigned bypass or
   put signing keys on a shell command line.
6. Recovery must acquire the exclusive filesystem lock and PostgreSQL advisory
   session lock, audit the recovery request, read authoritative SQL state and
   publish it through the normal durable pending/temp/rename sequence. If SQL
   is unavailable or any step fails, retain evidence/barrier and remain in
   maintenance. Never infer success from HTTP request submission alone.
7. Confirm the response revision equals authoritative SQL revision and the
   published snapshot revision; inspect exact target identities/enabled states.
   Confirm `.pending` and the publisher lock disappear through normal completion.
   An empty revision-zero snapshot is a valid deny-all bootstrap result, not
   evidence that tenants were restored. Verify fresh reader requests deny
   disabled/unknown targets before resuming normal mutation callers and traffic.

## Evidence boundary

Local publisher tests cover live-owner exclusion, SIGKILL leftovers, pending
retention, rename races and subsequent recovery using real temporary files.
SQL authority is modeled in current tests. This document is a manual runbook,
not evidence of an executed offline repair, real SQL recovery or live Odoo
isolation. Physical adapter, restore authorization and phase-one acceptance
remain separate work.
