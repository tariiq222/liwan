# SaaS image preflight — G1 investigation, 2026-09-23

**Status: G1 SYNTAX PASS. G1 EXECUTION and G2 now VERIFIED for the probed bare-`sha256` form — see §12 (executed 2026-09-23). NOT gate acceptance.**

> **Update (2026-09-23, §12):** the execution half of G1 and the G2 running-identity question were
> executed against a disposable probe project using an already-local image. Both passed with no
> pull and an unchanged image store. §6's "UNPROVEN" verdicts below record the state *before* that
> probe and are retained for history. Production/gate acceptance, and the same verification for
> `nasq-odoo`/`nasq-web`, remain outstanding.

This is an independent, read-only preflight for gate **G1** of the frozen P2 design
(`docs/verification/2026-09-23-saas-p2-design-review.md`). It establishes what the existing local
images are and whether Compose accepts an exact image-identity reference, and nothing more.

It does **not** prove that any stack runs, that any container resolves a pinned reference, that an
image is usable at runtime, or that a target is ready. It authorizes no provisioning, no managed
adapter implementation, and no operation on any customer, business or P1 resource.

## 1. Constraints honoured

- **No** container, service, `up`, `create`, `run`, `pull`, `tag` or `build` action was performed.
  Only `version`, `info`, `image ls`, `image inspect`, `ps` (list), `network inspect` and
  `compose -f - config` validation were used.
- No container or image **`Config.Env`** was read or printed; `.Config.Env` was deliberately
  excluded from every inspection. No secret material was accessed or recorded.
- No operation was performed on P1 (control plane) or on any business fixture.
- No test suite was run or re-run.
- **No image was retagged or rebuilt**, and no image provenance is claimed (§4).
- The Docker daemon was already healthy, so no stop/restart condition arose (§2).

## 2. Environment at observation

| Fact | Value |
| --- | --- |
| Docker client / server | `29.8.0` / `29.8.0` |
| Storage driver / architecture / OS | `overlayfs` / `aarch64` / Docker Desktop |
| Docker Compose | `v5.5.1` |
| Containers present / running | `114` / `24` |
| Images present | `97` |

Twenty-four containers were running at observation time; **none** of them uses a `nasq-*` image
(§5), and none was inspected, started, stopped or otherwise touched.

## 3. Image inventory (observed identities)

| Repository:tag | Image Id (`sha256:`) | Arch / Os | Created | Size |
| --- | --- | --- | --- | --- |
| `nasq-odoo:dev` | `dd88994ce82211900d7de57385dac84c2a41d98b661da8a8a5d5af39316de85a` | arm64 / linux | 2026-09-19T19:25:53Z | 4,328,307,752 |
| `nasq-odoo:ci` | `9653fb3741d69b2216e5f2afb9d4234f93505cf31188e0faf4b79dc88b190d6e` | arm64 / linux | 2026-09-21T21:03:50Z | 4,328,862,479 |
| `nasq-web:dev` | `e02411c47ad571fb9fe9b6dd68dfba9859da0032a3ea8c0115c6beb0df498b50` | arm64 / linux | 2026-09-19T18:22:42Z | 267,861,604 |
| `postgres:16` | `e17e86066e5ef83e0952a9347f5c792b7ece00972e2aa787a6986f471b3dd3d5` | arm64 / linux | 2026-08-13T19:16:24Z | 657,276,046 |
| `caddy:2` | `df7f1c2fb114453b951de51a98efc010db1655a92c2e86be6706714e2417a78d` | arm64 / linux | 2026-06-22T20:12:24Z | 84,564,824 |
| `caddy:2-alpine` | `5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648` | arm64 / linux | 2026-06-22T20:12:24Z | 84,564,824 |
| `caddy:2.10.2-alpine` | `4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d` | arm64 / linux | 2026-02-11T18:28:13Z | 79,777,677 |

RepoTags for each image is exactly its own reference. All images are **arm64**, matching the
aarch64 host, so no emulation layer is involved.

### Self-declared labels (recorded as labels, **not** provenance)

| Image | `sa.nasq.odoo-commit` | `sa.nasq.revision` |
| --- | --- | --- |
| `nasq-odoo:dev` | `34eed49d88f0f4357e1f54fe82cb0ad280939572` | `ba33b452` |
| `nasq-odoo:ci` | `34eed49d88f0f4357e1f54fe82cb0ad280939572` | `927543f5c5c5` |
| `nasq-web:dev` | (no labels) | (no labels) |
| `postgres:16`, `caddy:*` | (no `sa.nasq.*` labels; upstream OCI labels only) | — |

These values are **self-declared build labels**. They are recorded because they are observable
metadata; they are **not** evidence of provenance, content, or which source tree produced the
image. The two Odoo images carry **different** revision labels (`ba33b452` vs `927543f5c5c5`) and
the `sa.nasq.odoo-commit` label matches the value in `deploy/odoo/ODOO_COMMIT`. The string
`927543f5` also appears as the prefix of a commit in the repository history, but that string
correspondence is **not** proof that the image was built from it. Neither revision equals the
current baseline `abde67b6`, so **both available Odoo images are older than current `main`** —
recorded as an observation, not a rebuild instruction.

### Config metadata (necessary, not sufficient, for usability)

| Image | User | Entrypoint | Cmd | Exposed | Volumes |
| --- | --- | --- | --- | --- | --- |
| `nasq-odoo:dev` | `odoo` | `["nasq-odoo"]` | unset | 8069, 8072 | `/var/lib/odoo` |
| `nasq-odoo:ci` | `odoo` | `["nasq-odoo"]` | unset | 8069, 8072 | `/var/lib/odoo` |
| `nasq-web:dev` | (unset) | `["docker-entrypoint.sh"]` | `["node",".output/server/index.mjs"]` | 3000 | — |
| `caddy:2` | (unset) | unset | `["caddy","run","--config","/etc/caddy/Caddyfile","--adapter","caddyfile"]` | 80, 443, 443/udp, 2019 | — |

This metadata is **structurally consistent** with `deploy/odoo/Dockerfile` (`USER odoo`,
`EXPOSE 8069 8072`, `VOLUME /var/lib/odoo`, `ENTRYPOINT ["nasq-odoo"]`) and
`apps/web/Dockerfile` (node runtime, `.output/server/index.mjs`, port 3000). Structural
consistency is **not** a usability or runtime claim.

## 4. RepoDigests are degenerate on this host — comparison caveat

For **every** inspected image — including pulled upstream images — `RepoDigests[0]` is
**byte-identical to `.Id`**:

- `nasq-odoo:dev` → `nasq-odoo@sha256:dd88994ce…` equals its Id `sha256:dd88994ce…`
- `nasq-web:dev` → `nasq-web@sha256:e02411c47a…` equals its Id
- `postgres:16` → `postgres@sha256:e17e86066e…` equals its Id
- `caddy:2` → `caddy@sha256:df7f1c2fb1…` equals its Id

Consequences, stated strictly from observation:

1. This local store reports the **image config content hash** in `RepoDigests`, so a
   `repo_digest` comparison here is **degenerate**: comparing it to `.Id` can only ever succeed
   trivially and proves nothing about a registry manifest.
2. No independent registry **manifest** digest was observed for any image. Whether a real manifest
   digest differs was **not verified** — that would require registry access, and pulling is
   excluded by this task's constraints.
3. The value P1 pins, `postgres:16@sha256:e17e86066e5ef83e0952a9347f5c792b7ece00972e2aa787a6986f471b3dd3d5`
   in `deploy/control-plane/compose.yml`, is **exactly this image's `.Id` and its local
   `RepoDigests[0]`**. It therefore resolves on this host. Whether the same reference is portable
   to a host whose `RepoDigests` holds real manifest digests is **unverified**, and must not be
   assumed.
4. This supports the frozen design's rule: for local images use `identity_kind: image_id`
   (`.Id`), and never compare a config hash against a manifest digest.

## 5. No `nasq-*` image is currently running

`docker ps --format '{{.Image}}'` shows 24 running containers from unrelated images
(`postgres:1x-alpine`, `redis:*`, `chatwoot/chatwoot:latest`, `temporalio/admin-tools:*`,
`minio/minio:*`, `pgvector/pgvector:pg16`, `node:20-alpine`, and two unnamed IDs). A filter for
`nasq` returns **nothing**. There was therefore **no running identity to observe**, and no
`nasq-*` container was inspected or touched.

## 6. G1 Compose syntax verification (stdin only, no `up`)

Each case was fed to Compose on stdin as `docker compose -f - config --quiet`; nothing was
created, run or pulled. Minimal synthetic body:

```yaml
name: g1probe
services:
  probe:
    image: <reference>
    pull_policy: <policy>
```

| Case | `image:` reference | `pull_policy` | Exit | Interpretation |
| --- | --- | --- | --- | --- |
| T1 | `sha256:dd88994ce…` (bare **full** config ID) | `never` | **0** | accepted |
| T2 | `sha256:dd88994ce822` (bare **short** config ID) | `never` | **0** | accepted |
| T3 | `nasq-odoo:dev` (mutable tag) | `never` | **0** | accepted (expected) |
| T4 | `nasq-odoo@sha256:dd88994ce…` (repo@config-digest) | `never` | **0** | accepted |
| T5 **control** | `nasq-odoo:dev` | `sometimes` (invalid) | **1** | validator **is** active — see below |
| T6 **control** | `nasq-odoo:definitely-absent-xyz` (nonexistent) | `never` | **0** | **no existence check** |

T5's exact error, which proves the `pull_policy` field is genuinely validated (so T1–T4's exits
are meaningful rather than an inert parser):

```text
validating -: services.probe.pull_policy 'sometimes' does not match pattern
'^(always|never|build|if_not_present|missing|refresh|daily|weekly|every_([0-9]+[wdhms])+)$'
```

T6 is the decisive control: Compose accepts an image reference for an image that **does not
exist**, with `pull_policy: never`. `config` therefore performs **schema validation only** and
never resolves or checks the image.

Resolved `config` output for T1 and T4 preserves the reference **verbatim** and emits
`pull_policy: never`:

```yaml
services:
  probe:
    image: sha256:dd88994ce82211900d7de57385dac84c2a41d98b661da8a8a5d5af39316de85a
    networks: {default: null}
    pull_policy: never
```

### G1 verdict split

- **G1-syntax: PASS.** Compose v5.5.1 accepts a bare `sha256:<config-id>` image reference
  (full **and** short form) combined with `pull_policy: never`, with the validator proven active
  by T5 and the reference preserved verbatim. No retag is needed for the reference to be
  expressible.
- **G1-execution: UNPROVEN.** Syntax acceptance is **not** execution. Because `config` also
  accepts a nonexistent image (T6), nothing here shows that the engine resolves a bare config ID
  to a local image at `up`, that `pull_policy: never` prevents a pull attempt in practice, or that
  the container actually starts from the intended identity. Proving that requires a real `up`
  plus G2 inspection — both excluded from this task.
- **G2 running identity: UNPROVEN** (no execution, and no `nasq-*` container currently runs).

## 7. Proxy gap (G3) — confirmed absent, not rebuilt

| Item | Observation |
| --- | --- |
| `nasq-caddy` image | **ABSENT** — `docker image ls` has no `nasq-caddy:*` (grep exit 1). |
| Caddy builder image | **ABSENT** — no `caddy:*-builder` present; only `caddy:2`, `caddy:2-alpine`, `caddy:2.10.2-alpine`. |
| `deploy/docker-compose.yml` proxy service | References `image: nasq-caddy:${NASQ_IMAGE_TAG}` **and** a `build:` section, so the edge image is expected to be built. |

`deploy/proxy/Dockerfile` does not merely overlay a config: it performs an `xcaddy` build,
`--with github.com/mholt/caddy-ratelimit@v0.2.0`, and asserts
`caddy list-modules | grep -q 'http.handlers.rate_limit'`. Its own comment states
"Official Caddy does not ship rate_limit" (`deploy/proxy/Dockerfile:2-3`). Building it would need
the absent `caddy:2.11.4-builder` image plus Go module downloads — **network access**, which this
task excludes.

> Note (2026-10-01, Stage A acceptance): the `v0.2.0` module pin quoted above does not exist; the Go module proxy lists only `v0.1.0` (commit 12435ecef5dbb1b137eb68002b85d775a9d5cdb2, 2024-08-28). `deploy/proxy/Dockerfile` now pins `v0.1.0`. The narrative above describes its original inspection-time state and is not rewritten.

**Unverified and flagged:** whether the locally available stock `caddy:2` (v2.11.4) can load and
serve `deploy/Caddyfile`, whose `handle @odoo` block uses `rate_limit` zones, cannot be settled
read-only (it requires `caddy validate` / `caddy list-modules` inside a container, i.e. a run).
This is an open G3 item, not an accepted state, and not an instruction to rebuild.

**G3 positive finding:** the in-tree edge config already supplies the same-origin routing the gate
requires — `deploy/Caddyfile:20-59` routes `/api/v1/*`, `/web/*` (which includes `/web/content`),
`/odoo/*`, `/report/*`, `*/static/*` and more to `odoo:8069`, and
**`handle /websocket* → reverse_proxy odoo:8072`** at `:57-59`, with everything else to
`web:3000` at `:60-71`. The earlier "websocket limitation" was specific to the Nuxt dev proxy; the
real per-tenant edge in the repository does handle `/websocket`, so no limitation needs to be
recorded for the edge design itself. What is missing is the **image** to run it.

## 8. IPv4 / IPv6 observations (G5)

| Check | Result |
| --- | --- |
| `getaddrinfo('localhost', AF_INET)` | `['127.0.0.1']` |
| `getaddrinfo('localhost', AF_INET6)` | `['::1']` |
| `docker network inspect bridge` | `EnableIPv6=false`, driver `bridge` |

Two concrete hazards for the frozen design's origin strategy:

1. `localhost` resolves to **both** `::1` and `127.0.0.1`. A client that prefers IPv6 will try
   `::1` first, so a per-tenant edge bound only to `127.0.0.1` (IPv4) may be unreachable via
   `http://localhost:<port>`. The `localhost`-vs-`127.0.0.1` distinct-origin split therefore
   **depends on which families the edge actually binds**, and must be verified per family.
2. The default Docker `bridge` network has **IPv6 disabled**, so container addressing is IPv4-only
   unless a distinct IPv6-enabled network is created.

Actual listener binding and edge routing per family were **not** tested (binding a listener is a
service action and is out of scope). **G5 remains unproven.**

## 9. What this preflight does and does not establish

**Established (observed):** image identities, architectures, creation times, sizes, tags,
RepoDigests and safe config metadata; that `nasq-caddy` and the Caddy builder image are absent;
that no `nasq-*` container is running; that Compose accepts a bare `sha256:<config-id>` reference
with `pull_policy: never` while performing no existence check; and the IPv6 resolution / bridge
facts above.

**Not established:** any image's provenance or trustworthiness; runtime usability of any image;
that a pinned reference resolves at `up`; the running container's identity; that the stock Caddy
image can run the repository Caddyfile; IPv6 listener and edge behaviour; and any readiness,
deployment, or production property.

**Open gates carried forward:** G1-execution, G2, G3 (edge image availability and Caddyfile
compatibility), G4 (browser two-tenant evidence), G5 (IPv4/IPv6). The frozen design remains a
**CONDITIONAL PASS** and is unchanged by this document.

## 10. Command log (exact, with exits)

| # | Command (abridged to the load-bearing parts) | Exit |
| --- | --- | --- |
| 1 | `docker version --format 'client=… server=…'` | 0 |
| 2 | `docker info --format 'server=… driver=… arch=… os=… containers=… running=… images=…'` | 0 |
| 3 | `docker image ls --format '{{.Repository}}:{{.Tag}}\t{{.ID}}\t{{.CreatedSince}}\t{{.Size}}'` \| `grep -iE 'nasq\|proxy\|caddy\|postgres\|<none>'` | 0 |
| 4 | `docker image inspect --format '… .Config.Labels …'` for the 4 target refs | 0 for the two Odoo images; **1** for `nasq-web:dev` and `postgres:16` (template error: no `Config.Labels` key) |
| 5 | `docker image inspect --format '… {{if index .Config "Labels"}}…'` for `nasq-web:dev`, `postgres:16`, `caddy:2`, `caddy:2-alpine`, `caddy:2.10.2-alpine` | 0 |
| 6 | `docker image ls --format '{{.Repository}}:{{.Tag}}'` \| `grep -i nasq-caddy` | **1** (absent → gap) |
| 7 | `docker ps --format '{{.Image}}'` \| `sort` \| `uniq -c`; then `grep -i nasq` | 0; grep **1** (none running) |
| 8 | `docker compose version` | 0 (v5.5.1) |
| 9 | `printf '…' \| docker compose -f - config --quiet` for T1–T6 | 0, 0, 0, 0, **1** (T5 invalid `pull_policy`), 0 (T6 nonexistent image) |
| 10 | `printf '…' \| docker compose -f - config` for T1 and T4 (resolved output) | 0, 0 |
| 11 | `docker image inspect <ref>` \| `python3 -c '…select Id/Arch/Os/Created/User/Entrypoint/Cmd/WorkingDir/ExposedPorts/Volumes…'` for 4 refs | 0 (`.Config.Env` never printed) |
| 12 | `docker image ls … \| grep -i caddy`; `python3 -c 'getaddrinfo …'`; `docker network inspect bridge --format '…'` | 0; 0; 0 |

No daemon fault occurred, so no stop condition was triggered. No image was pulled, tagged, built
or run, and no container was created or modified.

## 11. Non-claims

- **No provenance claim.** Image labels are self-declared metadata and are recorded as such.
- **No usability claim.** Structural config consistency is not a runtime result.
- **No retag, no rebuild, no pull.** None was performed or is proposed here.
- **No acceptance.** G1 is split into an accepted syntax half and an unproven execution half; the
  P2 design remains CONDITIONAL and frozen pending P1.

## 12. G1 execution and G2 running identity — executed probe (2026-09-23)

This section resolves the **execution half of §6** and the **G2** question by actually starting a
container from a bare `sha256:<config-id>` reference with `pull_policy: never`. It supersedes the
"UNPROVEN" verdicts in §6; those are retained above as the pre-probe record.

### 12.1 Method

Isolated and non-destructive: disposable Compose projects, an **already-local** image
(`postgres:16`), a distinct unused loopback port per case, `tmpfs` storage so **no volume** is
created, and immediate cleanup. `nasq-odoo`/`nasq-web` and all customer containers were avoided.
The frozen identity under test is the image **config id**
`sha256:e17e86066e5ef83e0952a9347f5c792b7ece00972e2aa787a6986f471b3dd3d5` (`postgres:16`).

### 12.2 Environment blocker encountered, recorded, then resolved

The first attempt (P2) failed **at network creation**, before reaching any container or image:

```text
failed to create network nasq-p2-g1g2-probe-p2_default:
  Error response from daemon: all predefined address pools have been fully subnetted
```

Diagnosis (read-only): `docker info --format '{{json .DefaultAddressPools}}'` → **`null`**; the host
has **32 networks** and the default auto-allocation space is exhausted — every
`172.17.0.0/16` … `172.31.0.0/16` plus 12 × `192.168.x.0/20`.

> **Operator constraint (recorded).** This host **cannot create a new Docker network using
> automatic address allocation**. Any new Compose project — including the real `compose-local`
> customer adapter, and the P1 control plane if it ever needs a fresh network — will fail to create
> its default network until unused networks are pruned or `default-address-pools` is configured in
> the daemon. Resolving it is destructive or host-level and was **not** attempted; **nothing was
> pruned** by this probe.

Resolution (captain-approved): an explicit per-case isolated subnet, verified free because no
network on the host uses any `10.x` address.

### 12.3 Cases

| Case | `image:` reference | Subnet | Loopback port | Expected |
| --- | --- | --- | --- | --- |
| **P1** primary | `sha256:e17e86066e5e…` (bare full **config id**) | `10.213.99.16/28` | `127.0.0.1:55999` | starts, no pull |
| **P2** positive control | `postgres:16` (tag) | `10.213.99.0/28` | `127.0.0.1:55998` | starts, no pull |
| **P3** negative control | `sha256:ffff…ffff` (**does not exist**) | `10.213.99.32/28` | `127.0.0.1:55997` | **fails** |

### 12.4 P1 primary — G1 execution

| Step | Command (abridged) | Exit | Result |
| --- | --- | --- | --- |
| syntax | `docker compose -p nasq-p2-g1g2-probe -f p1.yml config` | `0` | resolved `image: sha256:e17e86066e5e…` and `pull_policy: never` preserved verbatim |
| image store before | `docker image ls -q \| sort` | `0` | 97 images |
| **start** | `docker compose -p nasq-p2-g1g2-probe -f p1.yml up -d` | **`0`** | network created, container created, started |
| pull indicators | `grep -Eic 'pulling\|pull access\|manifest unknown\|not found\|denied'` on stdout+stderr | — | **0 matches in both streams** |
| image store after | `docker image ls -q \| sort` vs before | `0` | **byte-identical (97 images)** |
| tag identity | `docker image inspect postgres:16 --format '{{.Id}}'` | `0` | unchanged `sha256:e17e86066e5e…` |
| image events | `docker events --since <t0> --until <t1> --filter type=image` | `0` | **empty — no pull/load/tag** |
| functional | `compose exec -T db pg_isready -U probe` | `0` | `accepting connections` (ready after 1 s) |
| cleanup | `compose down --volumes --remove-orphans` | `0` | removed |

`up` stderr in full — note the absence of any pull line:

```text
 Network nasq-p2-g1g2-probe_default Creating
 Network nasq-p2-g1g2-probe_default Created
 Container nasq-p2-g1g2-probe-db-1 Creating
 Container nasq-p2-g1g2-probe-db-1 Created
 Container nasq-p2-g1g2-probe-db-1 Starting
 Container nasq-p2-g1g2-probe-db-1 Started
```

### 12.5 P1 primary — G2 running identity

Container `bf537a6ebfc3`:

```text
Image=sha256:e17e86066e5ef83e0952a9347f5c792b7ece00972e2aa787a6986f471b3dd3d5
ConfigImage=sha256:e17e86066e5ef83e0952a9347f5c792b7ece00972e2aa787a6986f471b3dd3d5
Running=true
Started=2026-09-23T12:39:04.121897299Z
```

`docker compose ps`:

```text
nasq-p2-g1g2-probe-db-1 running sha256:e17e86066e5ef83e0952a9347f5c792b7ece00972e2aa787a6986f471b3dd3d5
```

**`.Image` equals the frozen enrollment identity exactly**, and `.Config.Image` carries the same
frozen reference rather than a mutable tag.

### 12.6 P2 positive control (tag reference)

`config` exit `0`; `up` exit `0`. Container `e2c5dea20a0d` → `Image=sha256:e17e86066e5e…`
(the tag resolves to the identical local id), `ConfigImage=postgres:16`, `Running=true`; `down`
exit `0`. This proves the harness reports a normal success correctly.

*Recorded honestly:* the first `pg_isready` in P2 returned exit `2` (`no response`) because it ran
immediately after `up`; the bounded wait in P1 showed the database accepting connections after 1 s.
That was a timing artefact of the probe, not a container failure.

### 12.7 P3 negative control (non-existent id)

`config` exit `0` (schema-valid), then:

```text
up_exit=1
Container nasq-p2-g1g2-probe-p3-db-1 Creating
service:db:1 Error response from daemon:
  No such image: sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff
```

No container was created, the image store was unchanged, and **no image event or pull was
triggered** — the daemon reports the id as absent locally and does not silently substitute or pull
anything. This is what makes P1's success meaningful rather than vacuous.

### 12.8 Residue

Baseline `images=97 running=25 volumes=245 networks=32` → after cleanup
**`images=97 running=25 volumes=245 networks=32`**, with zero containers, networks or volumes
matching `nasq-p2-g1g2-probe`, and zero `10.213.99.x` networks remaining. The temp work directory
was removed.

### 12.9 Verdict

- **G1-syntax: PASS** (§6, unchanged).
- **G1-execution: PASS for the probed form.** Compose v5.5.1 resolved a bare
  `sha256:<config-id>` reference with `pull_policy: never` and started the container with **no pull
  attempted** — evidenced by the absence of pull output, zero image-level events, and a
  byte-identical image store.
- **G2: PASS for the probed form.** Container inspection reports `.Image` equal to the frozen
  enrollment identity while the container is genuinely running.
- Both controls behave as designed (P2 succeeds, P3 fails), so P1's result is not a harness artefact.

### 12.10 Non-claims and limits of this probe

- Verified **only** for `postgres:16` on this daemon (Engine `29.8.0`, Compose `v5.5.1`, arm64,
  overlayfs store). **Not** verified for `nasq-odoo`/`nasq-web`, and not for any production host.
- **No packet-level capture.** The claim is "no pull event, no pull output, image store unchanged,
  container runs" — not "zero network packets were attempted".
- The reference must be the **image config id** (`docker image inspect --format '{{.Id}}'`), never a
  registry manifest digest; the like-for-like rule in §4 stands.
- This probe did **not** exercise `repo_digest` identity, port-collision behaviour, or the managed
  adapter's own argv construction.
- **Not gate acceptance.** The frozen P2 design remains CONDITIONAL PASS; the network
  address-pool constraint in §12.2 is an open operational item for the acceptance slice.
