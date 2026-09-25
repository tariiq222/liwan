# SaaS P2 managed-runtime design review — 2026-09-23

**Verdict: CONDITIONAL PASS — design only, NOT full acceptance, NOT implementation.**

Status: **FROZEN pending P1 implementation/report.** No further speculative framework is to be
added to this design. This document records a single-adapter contract and the open gates that
must be discharged before implementation. It authorizes no mutation, provisioning, deployment,
cutover, or customer-resource operation.

Source basis: `docs/superpowers/specs/2026-09-23-saas-runtime-contracts.md` and
`docs/operations/saas-runtime.md` (Package 0 drafts, in the runtime-contracts worktree),
`docs/superpowers/plans/2026-09-23-company-operations-and-vendor-roadmap.md` (canonical
untracked user plan, preserved), plus read-only inspection of `tools/nasq_cli/`,
`apps/control-plane/src/`, and `deploy/`. No services were started, no database, image, port or
Docker command was exercised, and no test was run while producing this document.

---

## 1. Single adapter

The customer adapter is **`compose-local` only**. There is no second adapter and no
executor-abstraction framework. The P1 native host control plane (native loopback API/worker,
dedicated Compose control-plane PostgreSQL) is unchanged by this design and does not alter the
choice: the **control plane** stays native; the **customer** adapter is Compose.

## 2. Immutable enrollment descriptor

Enrollment is an **immutable descriptor**: write-once per `(target_id, descriptor_revision)`,
content-digested, operator-owned. Any field change requires a **new revision plus audit**, never
an in-place edit; a revision whose content does not match its recorded digest is refused.

It contains immutable facts only: `adapter{kind,version}` = `compose-local`/1, `environment_id`,
`commercial_mode`, `resource_refs`, `secret_refs` (handles only), `release_ref`, the frozen image
identity, `allowed_operations`, `descriptor_revision`, enrollment time, content digest.

It contains **no lifecycle state**.

## 3. Lifecycle is derived, never bound

Lifecycle is observed and derived, so it cannot perturb a bound payload digest:

| observed lifecycle | derived from |
| --- | --- |
| `reserved` | descriptor exists; **no** successful `tenant.create` receipt |
| `provisioned` | a durable `tenant.create` receipt with status `ok` |
| `quarantined` | an unresolved (`mutating` / `needs_intervention`) receipt, or observation conflict |
| `disabled` | an audited out-of-band grant fact (not a descriptor byte) |

Because the descriptor is immutable, `payload_digest` binds
`fields + descriptor content bytes + classification bytes + fingerprint` and stays **stable across
a replay**. If lifecycle were inside those bytes, `reserved → provisioned` would change the digest
and turn a legitimate replay into `JournalConflict`.

## 4. Ordering and refusal semantics

**Phase A — cheap structural authorization.** Pure, no journal, no effects: descriptor content
digest and revision, adapter kind, `target_id` shape, `operation ∈ allowed_operations`, target
enrolled, actor/target grant, inventory revision currency. Refusal here yields exit 2/3 with **no
journal row and no quarantine**.

**Phase B — bound-receipt consultation, no external effect.** Reuses the existing
`journal.execute` replay branch (`tools/nasq_cli/journal.py:187-198`): the same
`(request_id, operation, digest, fingerprint)` returns the stored receipt and **`action()` is never
invoked**, so a replay of a completed create is never re-rejected by collision checks against its
own already-existing project, volumes, networks or database. Different content under the same
request id raises `JournalConflict` → exit 4 with the row untouched. Honest caveat: when the bound
row is `mutating`, that branch transitions it to `needs_intervention`
(`journal.py:135-147`) — a journal-only state change with no external effect.

**Phase C — new requests only, inside `action()`.** Lifecycle precondition (`tenant.create` ⇒
`reserved`; `tenant.entitle` ⇒ `provisioned`), then collision/ownership preflight, then execution.
Collision checks live here precisely so they cannot reject a replay.

**A no-effect refusal must not quarantine.** `journal.execute` accepts only the returned statuses
`ok | conflict | needs_intervention` (`journal.py:220`) and converts **any exception** into
`needs_intervention` (`journal.py:222-225`); `operator._execute` maps `conflict → exit 4` and
`needs_intervention → exit 6` (`tools/nasq_cli/operator.py:486-493`). Therefore a preflight refusal
**returns `status: 'conflict'`** — it never raises and never returns `error`, which would trip
`_invalid_outcome` and quarantine the target. Only a genuinely uncertain outcome (an effect may
have occurred) returns `needs_intervention`/raises, and **only then** does the target become
`quarantined`.

**Interrupted create keeps quarantine and deletes nothing.** Resources (project, volumes,
networks, database) are preserved for reconciliation. There is no destructive cleanup and no
rollback-by-delete.

## 5. Image identity — exact identity, no retag, no provenance claim

`identity_kind` is **mandatory and exclusive**: exactly one of `image_id` or `repo_digest`, never
both. Comparison is like-for-like: an image **config content hash** (`.Id`) is never compared to a
registry **manifest digest** (`RepoDigests`). Local images without RepoDigests take `image_id`;
`repo_digest` is refused at enrollment when the image has no RepoDigest.

Execution uses the **exact frozen identity**, not a mutable tag. **No retag step is part of this
design.** The mechanism that pins Compose to the exact local image identity is an **open gate**
(§6, G1) and must not be assumed to work.

**No provenance claim.** The provenance, trustworthiness, freshness and usability of the currently
available local images are **unverified and not asserted** here. They must be verified separately;
this document does not claim where they came from or that they are fit for acceptance.

## 6. Open gates — all must be discharged before this design is accepted

| Gate | Requirement | Why it is open |
| --- | --- | --- |
| **G1** | Confirm the exact Compose syntax that binds a service to the frozen image identity together with `pull_policy: never`. | It is **unverified** whether Compose accepts a bare `sha256:<config_id>` image reference. This must be tested, not assumed. **Retagging is excluded**, so the accepted form must pin identity directly. |
| **G2** | Verify the **actual running identity**: inspect the running container's image ID and confirm it equals the frozen enrollment identity. | Declaring an intended image is not evidence that the running container is that image. |
| **G3** | Provide a **real per-tenant edge** serving `web`, `/api/v1`, `/web/content` and `/websocket` on one same-origin port per tenant. | Required, not optional. **The earlier websocket limitation is removed**: a direct-to-Odoo websocket or a dev-proxy that cannot upgrade websockets does not satisfy same-origin and is not an accepted limitation. |
| **G4** | **Browser two-tenant evidence** on the real edge. | Port-only separation does not isolate browser cookies; evidence must come from the per-tenant origins in §7. |
| **G5** | **IPv4/IPv6** behaviour verified for the listener binding, origin hostnames and edge routing. | The candidate origin/host strategy in §7 is stated for IPv4 loopback only until IPv6 is tested. |

## 7. Origins, sessions and two-tenant acceptance

Cookies are scoped by **host, not port**, so `127.0.0.1:13100` and `127.0.0.1:13101` share a cookie
jar; port separation alone is **not** session isolation.

- **Distinct origins, no hosts/DNS modification:** `http://localhost:<webA>` and
  `http://127.0.0.1:<webB>` are distinct cookie scopes and both resolve without any hosts-file or
  DNS change. Editing `/etc/hosts` is out of scope.
- **Distinct server-side session stores:** `Root.session_store` is rooted at
  `odoo.tools.config.session_dir` (`/Users/tariq/code/odoo/odoo/http.py:2773-2775`, filesystem
  store at `:995-1004`), so a per-tenant `data_dir` yields a per-tenant session store. The
  per-target `data_dir` uniqueness rule (`tools/nasq_cli/operator.py:166-176`) is therefore an
  **isolation control**, not a convenience.
- **Two-tenant evidence is part of P2 acceptance**, not deferred: provision two tenants through
  the adapter, then prove on the provisioned pair — login for both; each creates and reads back an
  isolated business record; each uploads and retrieves a distinct attachment with correct linkage;
  isolation negatives; and the readiness rule of §8.
- **Isolation negatives are ID-coincidence-safe.** Record IDs start at 1 in both fresh databases,
  so tests must assert **distinct bytes/identity and cross-session refusal**: a unique random token
  per record, distinct attachment bytes with recorded content hashes, tenant A's session presented
  to tenant B's origin must be refused, and an A-side retrieval of B's data must not return B's
  bytes (compare hashes). Tests must never assert that a foreign ID is absent.

## 8. Readiness — no ready from `ok` plus `false`

`deployment_ready: true` is produced **only** when every **applicable** readiness dimension is a
fresh `pass` under an approved definition.

- An `ok` operation status is **not** readiness. In particular, the current create path returns
  `status: ok` while reporting `deployment_ready: false`
  (`tools/nasq_cli/operator.py:685-690`), and the existing exemption in
  `apps/control-plane/src/db.ts:29-38` treats exactly that shape as *not* an unresolved mutation.
  That exemption must **not** be repurposed as a readiness signal: `ok + deployment_ready:false`
  never yields ready, and it never yields `active`.
- Each dimension carries an explicit **`applicability`** decision (`applicable` |
  `not_applicable`) separate from its result (`pass | fail | skip`). `not_applicable` requires a
  declared predicate **and** a recorded reason, both auditable. **`skip` still never counts.**
- On the loopback selection, domain/routing and TLS are `not_applicable` with the recorded reason
  "no domain-routed environment in the loopback acceptance selection; applies only to a
  domain-routed deployment". The applicability set and reasons are part of the evidence revision,
  so a loopback pass can never be read as an implicit domain/TLS pass.

## 9. Forward requirements — future P2 provisioning and P4 identities

These are requirements on the future implementation, recorded now and **not** performed here:

- Odoo application/provisioning access **must use a non-superuser app role**, not a superuser
  account.
- **P4 (backup/restore) requires separate maintenance and capture identities**, distinct from the
  provisioning/app identity and from each other.
- **No production role changes** are authorized by this design. No role, grant or credential is
  created, altered or rotated here.

## 10. Preserved invariants and ownership

- The full **16-key v2 inventory entry is untouched**, and the v3 managed descriptor remains a
  **separate document** under its own variable, because `operator.py:164` is an exact-set check
  that would reject additional keys.
- `tools/nasq_cli/operator.py`, `tools/nasq_cli/journal.py`, `tools/nasq_cli/cli.py` and
  `tools/nasq_cli/adapters.py` are reused with **zero changes** (journal unchanged is intended).
- The only shared-file edits anticipated are one module-dispatch decision in
  `apps/control-plane/src/worker.ts` plus its mirroring admission at `http.ts:118` and
  `worker.ts:202`, sequenced through the **single supervising writer**.
- **No new managed capability** is added; the existing grant model plus `operations_enabled`,
  `allowed_operations` and revision checks already express who/what/which/when.
- Control-plane resources (`55432`, `14179`, `nasq-saas-control-local*`) and
  `80/443/3000/5432/8069/8072` remain excluded.
- No secret broker, hosting provider, TLS mechanism, or RPO/RTO value is invented.

## 11. Freeze

**Frozen pending P1 implementation/report.** This is a **CONDITIONAL PASS** on the design, not full
acceptance and not authorization to implement. No further speculative framework is to be added;
the next step is P1's implementation report, after which gates G1–G5 (§6) and the forward
requirements (§9) are discharged or explicitly recorded as blockers.

## 12. Verification note

This review was produced read-only. No source file was edited, no test was added or run, no
service, image, container, database or port was exercised, and `docs/superpowers/plans/2026-09-23-company-operations-and-vendor-roadmap.md`
in the canonical checkout was left untouched.
