# Tenant object storage design

Status: owner direction approved on 2026-11-08, replacing the shared filestore root. The design is not implemented in any branch. The only evidence is a throwaway spike dated 2026-11-08 (local and live OCI), described in section 5. There are no live tenants.

The hosting contract ([liwan-shared-saas-and-sovereign-deployment.md](liwan-shared-saas-and-sovereign-deployment.md)) owns the requirements, and [saas-hosting-direction-status.md](../../project-closure/saas-hosting-direction-status.md) owns implementation status. This file records the chosen design, the reasons and the work that remains. It does not change either of them. Three claims are kept apart throughout: what the owner approved (section 2), what a spike showed (section 5), and what is built (nothing yet).

## 1. Problem

The hosting contract lists a known limit (R-01 in section 10): one `data_dir` (`/var/lib/odoo`) and one volume serve every tenant, and attachments are separated only by the folder name `filestore/<db>`. On 2026-11-08 the owner rejected accepting that limit. The requirement is one storage service with a real per-customer boundary on top of it.

Two code facts constrain the answer:

- `data_dir` is a single setting for the whole Odoo process (`odoo/tools/config.py`), and the shared process serves every tenant database (`dbfilter = ^%h$` in `deploy/shared/odoo.conf`). A different `data_dir` per tenant is not possible inside one process.
- The backup and restore code in `tools/shared_saas_lifecycle/odoo_backup.py` refuses any symlink in or above `filestore/<db>`. A symlink or per-tenant mount that points `filestore/<db>` elsewhere is therefore blocked unless those guards change.

## 2. Decision

Use one in-Kingdom object storage service, OCI Object Storage, with these parts:

- Primary region `me-jeddah-1`, replica region `me-riyadh-1`.
- One bucket per tenant and one bucket-scoped credential per tenant. An IAM policy limits the credential to its own bucket with `target.bucket.name`.
- Odoo reaches the bucket through the OCA `fs_attachment` and `fs_attachment_s3` addons (19.0 branch of OCA/storage), configured by one `fs.storage` record in each tenant database.
- Bucket names are opaque (random, no customer name, no subdomain). ListBuckets shows every bucket name in the compartment to every key in it, so a readable name would leak the customer list.

Quota enforcement, backup and deletion follow in sections 6 and 7.

## 3. Why this option

| Option | Isolation | Cost and effort | Verdict |
| --- | --- | --- | --- |
| A. XFS project quota on each `filestore/<db>` | Size cap per tenant only. One Odoo process still reads every tenant's folder | Low | Fallback only |
| B. Separate mount per tenant | Same as A. Backup guards reject symlinks, and a new tenant needs a container restart | High | Rejected |
| C. Object storage, one bucket and one bucket-scoped key per tenant | The storage service refuses cross-tenant access. Per-tenant delete. Scales without host changes | Medium. Backup and restore must be redesigned | Chosen |
| D. One Odoo process per tenant | Full | Highest. Contradicts the shared application services model | Only as managed dedicated hosting |

The limit that applies to every option: read isolation inside one shared Odoo process is logical. A compromised process can read every tenant database and therefore every tenant's credential. Full isolation is the managed dedicated model. What option C adds over A is that a storage-level mistake, a debug shell on the wrong database or a faulty module using the wrong path no longer exposes another tenant's files by path, and that one tenant's full storage cannot stop writes or backups for the others.

## 4. Provider choice and residency

The owner requirement is that hosting and customer files stay inside Saudi Arabia. The tenancy at Oracle Cloud already exists in Jeddah, which is the main reason OCI is chosen. Research dated 2026-11-08; "unconfirmed" means the point was not confirmed from an official page.

| Provider | S3-compatible object storage | Registration | Notes |
| --- | --- | --- | --- |
| Oracle OCI, Jeddah `me-jeddah-1` and Riyadh `me-riyadh-1` | Yes (S3 compatibility API) | CST Class C (Oracle announcement) | Chosen. About 0.096 SAR per GB-month after 10 GB free, 50k requests a month free, 10 TB a month egress free |
| Google Cloud Dammam `me-central2` | Availability of Cloud Storage in the region unconfirmed | CST Class C (Google page) | KSA purchase only through CNTXT. Price unconfirmed |
| Alibaba Cloud through SCCC, Riyadh | OSS endpoint exists (partner region) | Unconfirmed | Price unconfirmed |
| Huawei Cloud Riyadh | OBS availability unconfirmed | Class C (Huawei announcement) | Region live since 2023-09 |
| Sahara Net | Lists "S3-compatible object storage" | CST registration RC21-9, ISO 27001 and 27017. Class unconfirmed | Price not published, sales contact only |
| stc / center3, Mobily, Zain, Wafai | No confirmed S3 object storage product | Unconfirmed | |
| AWS Saudi region | Not launched (target December 2026) | | |
| Azure Saudi Arabia East | Launch announced for November 2026, not confirmed live | | Blob storage is not S3 |

Regulation, from official sources. The mapping of these rules onto LiwanOS classes is unconfirmed.

- PDPL transfer regulation (SDAIA): foreign providers with an in-Kingdom region are not banned. Any access from outside the Kingdom (support, an AI provider, email) is a transfer that needs standard contractual clauses or binding corporate rules and a risk assessment. https://sdaia.gov.sa/Documents/RegulationonPersonalDataEN.pdf
- NCA CCC-2:2024: applies to government entities and critical national infrastructure operators. It requires tenant data separation and a separate community cloud for those tenants, with four data levels. https://nca.gov.sa/en/regulatory-documents/controls-list/ccc/
- CST cloud provider registration, Classes A, B and C. B and C need a Tier 3 facility. Vendor pages say Class C is needed above "confidential" government data; this is not confirmed in the official text. https://www.cst.gov.sa/en/business/services/Cloud-Computing-Registration
- Whether a SaaS vendor that runs its own storage must register with CST is unconfirmed. The question goes to CST (19966), see section 9.

OCI facts the design relies on (Oracle documentation):

- An IAM policy can restrict a group to one bucket with `where target.bucket.name = '<bucket>'`, granting read on buckets and manage on objects. https://docs.oracle.com/en-us/iaas/Content/Identity/Reference/objectstoragepolicyreference.htm
- There is no per-bucket size quota. Quotas apply per compartment (`storage-bytes`).
- A bucket can use a customer-managed Vault key. Use the default (virtual) vault. A Private Vault costs about 14 SAR an hour and is not used. https://docs.oracle.com/en-us/iaas/Content/Object/Tasks/encryption.htm
- Cross-region replication works per bucket (Jeddah to Riyadh). Deletes replicate. https://docs.oracle.com/en-us/iaas/Content/Object/Tasks/usingreplication.htm

## 5. Spike evidence

This section records a throwaway spike run on 2026-11-08. It is evidence that the approach works with the versions below. It is not an implementation and no repository code was changed.

Versions: OCA/storage 19.0 at commit `0c8cec3d` with `fs_storage` 19.0.1.1.3, `fs_attachment` 19.0.1.1.4 and `fs_attachment_s3` 19.0.1.2.1, all marked Beta. Python: fsspec and s3fs 2026.9.0, boto3 and botocore 1.43.117, python-slugify, and `packaging` (Odoo 19 needs it to parse the manifests' version specifiers).

| Check | Result |
| --- | --- |
| Local SeaweedFS, two databases, two keys | Each database wrote and read only its own bucket. Cross-tenant reads, path tricks and a forged `store_fname` failed. A database dump held only its own key |
| OCI put and get of 200 KB, multipart upload of 12 MB (boto3) | Passed |
| OCI: tenant A key on tenant B bucket | Refused with `NoSuchBucket`, so the bucket's existence is hidden |
| OCI: ListBuckets with the tenant A key | Lists both bucket names, no contents. Hence the opaque names in section 2 |
| Odoo with `fs_attachment` on OCI | Passed. Attachments byte-exact, `force_storage()` moved filestore files, a second storage pointed at bucket B failed its connection test |
| New secret key | About 7 minutes before it became usable, with intermittent "secret key could not be found" during that window |

Required `fs.storage` options for OCI (found by trial):

- `client_kwargs.region_name = "us-east-1"`. With `me-jeddah-1` the request signature failed through s3fs. The endpoint is still the tenancy's Jeddah S3-compatibility endpoint.
- `config_kwargs`: `s3.addressing_style = "path"`, and `request_checksum_calculation` and `response_checksum_validation` both set to `"when_required"`.
- `s3_additional_kwargs.ChecksumAlgorithm = "SHA256"`. Without it `DeleteObjects` fails, because OCI rejects botocore's default CRC32. That breaks rename, delete, garbage collection and `force_storage`.

Not tested in the spike: concurrent uploads from several workers, large tenants, restore from a bucket copy, replication to Riyadh, Monitoring alarms, and the key-propagation retry logic. Nothing here was run against the Odoo versions or addons that production will use beyond the pins above.

## 6. Quota and upgrades

OCI has no per-bucket quota, and a compartment quota would cap all tenants together, so it cannot be the tenant limit. The limit stays where it is today: `storage.limit_mb` in the tenant entitlements, enforced by `liwan_platform`. `ir.attachment` create and write call `_liwan_claim_storage`, which raises a 403 `feature_not_included` with `limit_key: storage.limit_mb` when the sum would exceed the limit. Usage is `SUM(file_size)` of binary rows in `ir_attachment` (`_liwan_count_storage_bytes`).

Because that count reads the database row and not the filesystem, it should keep working when file contents live in a bucket. This is an inference from the code; the spike did not exercise the quota path, so a test with `fs_attachment` active is required before it is treated as fact.

OCI Monitoring alarms on compartment and per-bucket usage are a second line of defence for the platform: they catch drift between the entitlement count and real bucket size, such as orphan objects. They are not the customer-facing limit.

Storage upgrades are manual, with warnings when usage rises past 80% and past 95% of the limit, in SaaS mode only (owner decision 2026-11-08). That decision is implemented in PR 437, which was not merged when this file was written. This design neither depends on nor changes it.

## 7. Backup, restore and deletion

Today's backup and restore code assumes the filestore is a directory. `tools/shared_saas_lifecycle/odoo_backup.py` packs `/var/lib/odoo/filestore/<db>` into `filestore.tar`, fails with `filestore_missing` when the directory is absent, rejects symlinks, verifies each referenced file by SHA-1 and size, and restores into a path that must not exist. The manifest format is `odoo-pg-filestore-v1` with a `filestoreSha256`. All of this must be redesigned for objects held in a bucket. The redesign is not specified here beyond the rules below.

- A tenant backup is a database dump and a copy of the tenant's bucket taken together. A dump without the matching objects, or the reverse, is not a valid backup.
- Cross-region replication to Riyadh is not a backup. It mirrors deletes, so an accidental or malicious delete reaches the replica.
- The bucket copy goes to a separate platform-owned backup location with its own retention. The retention period is not decided in this design (proposal only). It should follow the existing database backup retention so a restore always finds both halves.
- Restore recreates objects into a bucket the tenant's credential can reach, then points the restored database's `fs.storage` record at it. The restore acceptance check must compare object counts and checksums against the manifest, as the filestore check does today for files.
- Tenant deletion removes, after the retention rules allow it: the bucket (emptied first), the credential, the IAM user, the group and the policy. Deletion of the database and deletion of the bucket are recorded together so neither is left behind.
- An orphan object left by a failed transaction is cleaned by the daily `fs.file.gc` autovacuum. S3 writes do not roll back with the database transaction.

## 8. Implementation outline

Not done. This is the planned shape of the work, to be split into tasks with owned files when it is scheduled.

1. Provisioning. The tenant lifecycle creates the bucket, the IAM user and group, the bucket policy and the secret key through the OCI API, then writes the `fs.storage` record in the tenant database. The new key needs about 7 minutes to work, so provisioning retries with a bounded wait and reports a clear state while it waits. Tenant activation does not complete until a write and read through the credential succeed.
2. Secret handling. The credential is stored only in that tenant database's `fs.storage` options, in clear, which the spike accepted only because each key reaches its own bucket. No process-wide environment variable may hold a storage secret, since that would give every tenant the same reach. The key must never reach logs, API responses, the control plane or backups of other tenants. Rotation is a provisioning operation that creates a new key, waits for it, updates the record and removes the old key.
3. Odoo modules. Pin the OCA addons to a reviewed commit and these versions, vendor or fetch them as the other external addons are, and cover them in CI (install, attachment round trip, `force_storage`, delete). The OCA addons are AGPL-3 licensed; the licence position of shipping them is checked with the owner before packaging (see the update policy in [UPDATE_POLICY.md](../../UPDATE_POLICY.md)). Add the Python dependencies, including `packaging`, to the image.
4. Defaults. Small images (under 50 KB), JavaScript and CSS stay in `db_datas` by default and so remain in the database. That is acceptable and counted by the same quota query.
5. Maintenance. Schedule the daily `fs.file.gc`. Track OCA issue #660 (a long single-transaction migration racing the GC); it is irrelevant before live tenants.
6. Backup and restore. Redesign `odoo_backup.py` and the manifest format per section 7, with acceptance checks for a database and bucket restored together.
7. Fallback. If OCI cannot be used (for example a CST registration finding), fall back to option A: an XFS project quota on each `filestore/<db>`, with the weaker read isolation stated in section 3. Option A needs the host file system to support project quotas; that was not checked.
8. Architecture rules. The change lands in the layers that own it (`liwan_platform` for the entitlement count, the lifecycle tooling for provisioning and backup). It adds no condition on a customer name (R6) and is reviewed against R7 if any `sudo()` is needed. The control plane stays out of the product runtime (R5).

## 9. Open items

- CST registration: ask CST (19966) whether a SaaS vendor running its own object storage must register, and in which class.
- Riyadh replication cost has not been priced. Replication is optional until a retention and recovery target is set.
- The OCI trial ends on 2026-11-19. The account must be upgraded before any production use of this design.
- Retention period for bucket copies (section 7) needs an owner decision.
- Spike resources are still in the OCI tenancy and should be deleted now that the decision is recorded: the `liwanos-spike` compartment, its two test buckets, the test IAM user, group and policy, and the secret key. A local key file for the spike also exists on the developer machine. All of it falls within the free 10 GB.
