# Document migration and recovery contract

Status: implemented and exercised only on synthetic scratch databases. No tenant
inventory, commercial-policy change, production upgrade or release is authorized.
Candidate worktree: `docs-oca-dms`; source baseline
`dc39a8eb734da4557d341fbe24b2fc63d773fbb1`.

## Identity and ownership

The receiving business model is `webvue.document` in `webvue_documents` (rank 4).
The optional department link belongs to `webvue_documents_hr` (rank 5). HR can be
installed without Documents, and Documents without HR. OCA DMS is pinned and
unmodified; see [provenance](PROVENANCE.md).

Adoption runs before the receiving registry initializes: the old business table
and model metadata are renamed in place. `ir.model` identity, document IDs, body,
expiry, department and business XML IDs survive. Native attachment reparenting uses
the operator ORM; attachment IDs, checksums, storage names and bytes survive. DMS
files refer to those same attachments. No content copy or second quota claim is
made. Each adopted document receives its own canonical directory.

Legacy documents become `company` visible, preserving their prior company-wide
read scope for capable users. New documents are `restricted`, with an editor grant
for the creator. The two old HR document capability records are renamed in place
to `documents.items.read` and `documents.items.manage`, retaining custom-role and
assignment identities. They do not imply archive, access-management or library
management. HR manager's bridge mapping grants only read/manage. System
administration alone grants no document business access.

## Preflight and deployment ordering

`tools/documents_acceptance/preflight.py` calls the exact product preflight through
a read-only connection, and deliberately accepts only `webvue_scratch_*` names.
It is a rehearsal tool, not authorization to inspect a tenant. A separately
approved operator run must inventory the actual tenant before release.

Structural issues stop adoption: unexpected or ambiguous DMS/model ownership,
conflicting source/target tables or metadata, shared attachments, invalid parents,
company mismatch, missing departments, duplicate file names, URL attachments,
invalid path-like names and unattached legacy records. The inventory distinguishes
these `issues` from commercial `requirements`.

A signed existing policy cannot contain an unregistered feature in the old
registry. Therefore a tenant requiring a signed entitlement transition follows:

1. Put the tenant in maintenance, quiesce writers and jobs, and capture a paired
   database dump plus filestore snapshot with checksums and the previous image.
2. Resolve all structural preflight issues. Prepare the authorized compiled
   commercial revision, including the Documents entitlement at approved terms,
   through the existing trusted policy workflow. Do not fabricate a digest or
   modify commercial authority in an addon migration.
3. Install `webvue_documents`, upgrade `webvue_hr`, and let the declared bridge
   install. Install schema while the new feature remains closed. Either addon
   ordering is supported by the migration; keep maintenance throughout.
4. After registration, apply the approved compiled commercial policy through the
   existing trusted operator path. The migration never rewrites its revision or
   digest. With actual operator UID 1, run
   `odoo.addons.webvue_documents.hooks.complete_legacy_adoption(env)` and require
   `True`. A pending marker or a false Documents entitlement blocks cutover.
5. Verify document/file identity and byte hashes, narrow role mappings, both
   company boundaries, feature state and private download paths with real
   customer identities, then explicitly release maintenance.

For unsigned legacy local policy with HR enabled, the existing entitlement is
carried once into `documents.enabled`. Fresh installations remain closed. A
persistent completion marker prevents a later explicit disable from being
silently undone. A pending marker is retained while HR registration or a signed
commercial transition is incomplete. The helper never treats customer elevation
or `base.group_system` as operator authority.

## Failure, resume and rollback

Odoo commits after individual addon upgrades. A failure late in the module graph
can leave HR metadata adoption committed while the receiving addon remains
incomplete. A single transaction rollback for the entire upgrade is not promised.

Keep maintenance on after any failure. Preserve logs and inspect the durable
pending/completed marker; retry the same pinned candidate after resolving the
failure. Adoption and post-install file linking are idempotent. Do not boot the
old application image against an adopted schema. A rollback restores the paired
pre-upgrade database and filestore into the intended target, verifies hashes and
identity, and starts the matching prior image before accepting traffic.

`migration_fixture.py` freezes candidate addon source, exercises actual baseline
and receiving registries in two DMS/HR installation orders, and records before
and after snapshots. It rejects six invalid inventories and injects failures at
metadata rename, attachment reparenting and completed file linking. It then
retries the actual upgrade and repeats it to prove recovery and idempotence.
Both SaaS and non-SaaS fixtures passed. `restore_drill.py` verifies hashed fixture
manifests, restores only into fresh scratch databases, and compares the complete
snapshot using the matching old/new registry. The four-stage non-SaaS drill
passed with identical document, attachment, role and byte identity; the matching
four-stage SaaS before/after restore passed too.

Evidence directories (local, synthetic):

- `/tmp/webvue-docs-recovery`: SaaS two-order upgrade, failures and resume.
- `/tmp/webvue-docs-nonsaas`: non-SaaS two-order upgrade, failures and resume,
  paired before/after database and filestore backups.
- `/tmp/webvue-docs-restore4`: four non-SaaS before/after restore comparisons.
- `/tmp/webvue-docs-restore-accepted`: four SaaS before/after restore comparisons.

The runners remove only their own fresh databases and temporary runtimes. Evidence
and checksummed synthetic backups remain for review. Real inventory, backup and
release acceptance remain separate future operator actions.
