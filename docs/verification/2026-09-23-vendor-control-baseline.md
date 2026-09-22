# Vendor control implementation baseline — 2026-09-23

Canonical `/Users/tariq/code/nasq`, main `abc2400e`; one canonical worktree before this task.
Existing uncommitted CP2 catalog/CLI and CI change were copied, not removed or committed,
into `/Users/tariq/.codex/worktrees/nasq-vendor-control/nasq`, branch `codex/vendor-control`.
No fetch, merge, push, existing database mutation, or deployment performed.

Fresh checks in canonical:
- `python3 -B -m unittest discover -s tools -p 'test_nasq_cli*.py'`: 39 passed.
- `python3 -B -m unittest discover -s tools -p 'test_catalog_check.py'`: 45 passed.
- `python3 -B -m unittest discover -s tools -p 'test_commercial_config.py'`: 7 passed.
These are unit checks, not a real provision/upgrade/restore or full CP1 proof.

Source review confirms CP1 mode/source SQL and ORM pairing, non_saas cutoff rejection,
and `/me` self_service_available=false. CP3/CP4 application does not exist.
CP2 entry `python -m nasq_cli` is deliberately parser-only; operational adapter entry
is `python -m nasq_cli.adapters`. Its entitle supports classification only, not features.
Backup/restore/upgrade and durable receipts/locks are not wired.

Review findings requiring fixes:
- expected policy revision is read outside the mutation transaction; shell does not recheck under row lock.
- argparse numeric errors and child exceptions can echo raw operator input/connection details.
- inventory relies on ambient PostgreSQL connection and lacks stable target fingerprint.
- provision.sh uses shared staging paths; cannot safely call concurrently for multiple targets.
- backup candidate remains UNVERIFIED; restore test cannot retrospectively establish capture consistency.

User steering at baseline: considering a single company workspace with PMO/CRM/HR and vendor administration.
Subsequently approved: internal non-SaaS company workspace with vendor administration in the same shell;
see [implementation evidence](2026-09-23-vendor-workspace.md).
This affects CP3/CP4 UI and identity. CP2 local operation foundation is independent and proceeds.
CRM is not currently implemented as a Nasq pillar. Existing PMO/HR/chat/meetings must remain intact.
