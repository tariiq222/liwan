# Local release operator tools

These tools produce configuration, inspect source and operate explicitly selected local scratch resources. They do not fetch images, deploy, change DNS or approve a release. Run from the selected repository checkout with Python 3. All document/source paths must be absolute, canonical and free of symlink aliases. Documents reject duplicate JSON keys and are limited to 1 MiB. CLI errors expose an error class without raw subprocess output or credentials.

Online changes require explicit compatibility review. Schema, XML/data, security, hooks and unresolved dependencies remain conservative maintenance cases. A schema upgrade can require downtime for the affected tenant; this system does not promise universal zero downtime. Shared service or infrastructure changes may require a wider window.

## Inspect and render

Prepare `installed.json` as an array of exact installed module names from a trusted read-only Odoo ORM observation. An available-addon catalog is not an installed inventory. Base and target trees must include every relevant pinned stock and WebVue dependency manifest. Record source commits and normalized installed versions in the immutable release manifest; images require `@sha256:` identities.

```sh
python3 -B -m deploy.releases.cli classify \
  --base /srv/webvue/source/base --target /srv/webvue/source/target \
  --manifest /etc/webvue/releases/release.json \
  --installed-modules /etc/webvue/releases/installed.json

python3 -B -m deploy.releases.cli render \
  --manifest /etc/webvue/releases/release.json \
  --operator-config /etc/webvue/releases/green-operator.json \
  > /srv/webvue/candidates/green.compose.json
```

`classify` exits 0 for an eligible decision, 1 for a blocked decision or refused input, and 2 for missing CLI arguments. Its printed mode is the reviewed input mode. Forward dependencies are always traversed; reverse expansion uses installed modules plus explicit upgrade/install targets. Extra installed versions in `moduleVersions` are allowed. Unknown deployment/tool changes still block; bootstrap is a separate offline procedure.

`render` prints Compose JSON accepted by Docker Compose, without creating release state, starting services or granting database rights. The destination directory must already exist. The JSON includes operator file references, never their contents. Validate the candidate without starting it:

```sh
docker compose --project-name webvue-green \
  --env-file /etc/webvue/releases/green.env \
  --file /srv/webvue/candidates/green.compose.json config --quiet
```

Example `green-operator.json` (replace config digests with actual SHA256 values):

```json
{
  "poolId": "green", "tenancyMode": "shared",
  "upstreams": {"odoo": "http://green-odoo:8069", "web": "http://green-web:3000", "ws": "http://green-odoo:8072"},
  "allowedUpstreams": ["http://green-odoo:8069", "http://green-web:3000", "http://green-odoo:8072", "http://guard:8080"],
  "guardUrl": "http://guard:8080",
  "sessionStore": "webvue_sessions", "filestore": "webvue_filestore", "assetsStore": "webvue_assets",
  "httpConfig": "/etc/webvue/releases/green-http.conf", "cronConfig": "/etc/webvue/releases/green-cron.conf",
  "httpConfigDigest": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "cronConfigDigest": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "runtimeDbUser": "green_runtime", "runtimeUid": 1000,
  "cronDatabases": ["webvue_scratch_tenant_a"], "runtimeSecret": "/etc/webvue/releases/green.env",
  "guardWebNetwork": "webvue_guard_web", "guardOdooNetwork": "webvue_guard_odoo", "databaseNetwork": "webvue_database",
  "releaseRoutesDir": "/var/lib/webvue/releases/routes"
}
```

The external networks/volumes and operator-owned files must already exist. HTTP runs `--max-cron-threads=0`. Each database gets its own `release-cron` profile service with `--no-http --max-cron-threads=1 --database=<exact-name>`; rendering does not start cron. Config hashes and `db_user` must match their runtime role. Session and filestore references are common persistent stores. No database service or published DB port is generated. AI requires an explicit per-pool configuration or stable reviewed endpoint; see `compose.render_pool` for its exact `ai` fields.

For a dedicated pool use `"tenancyMode":"dedicated"`, an exact `"database":"webvue_scratch_tenant_a"` and that one name in `cronDatabases`; set `guardUrl` to the fixed dedicated guard URL. The trusted BFF/edge release pin and credentials must be supplied by the operator configuration. Rendering alone does not establish that integration or runtime readiness.

## Offline bootstrap

Bootstrap is restricted to `webvue_scratch_*` databases. Take the edge offline and stop the selected tenant's cron before collecting evidence. Do not use bootstrap to attach an admitted live tenant. The CLI requires the explicit observations below; it cannot itself prove that an external edge is offline.

```sh
python3 -B -m deploy.releases.cli bootstrap \
  --state /var/lib/webvue/releases \
  --binding /etc/webvue/releases/bootstrap-binding.json \
  --route /etc/webvue/releases/bootstrap-route.json \
  --bootstrap-evidence /etc/webvue/releases/bootstrap-offline.json
```

`bootstrap-binding.json` uses `tenantId`, `database`, `filestore` (equal to database) and integer `registryRevision`. Dedicated guard binding is a separate local document using `identityRevision`, `host` and `commercialMode`; it must name the same identity. Example route:

```json
{"schemaVersion":1,"tenantId":"tenant_a","identityRevision":1,"routeRevision":1,"fence":1,"state":"serving","releaseId":"r20261016","poolId":"blue"}
```

The offline evidence has exactly these fields, matching the binding/route:

```json
{"schemaVersion":1,"tenantId":"tenant_a","database":"webvue_scratch_tenant_a","filestore":"webvue_scratch_tenant_a","identityRevision":1,"poolId":"blue","releaseId":"r20261016","fence":1,"edgeOffline":true,"cronStopped":true,"admittedWriters":0,"activeTransactions":0,"oldConnections":0,"reviewer":"operator","reference":"offline-check-1"}
```

Successful bootstrap creates `routes/leases` before publishing the initial route. Keep the root and lease directories accessible only to the operator/runtime identities. Populate trusted `routes/pools.json` with reviewed pool metadata before admitting edge traffic. A missing/malformed route, pool or maintenance barrier fails closed. Lease files have no TTL reclamation; investigate surviving operations rather than deleting live leases. These release leases are distinct from control-plane advisory locks and claim fences.

## Explicit local scratch restore

Restore always targets a new database and new canonical filestore directory. Never restore automatically after writes resume. First preserve the backup directory containing `receipt.json`, `database.dump` and `filestore.tar`.

```sh
python3 -B -m deploy.releases.cli restore \
  --backup /var/lib/webvue/backups/tenant-a-fence-2 \
  --binding /etc/webvue/releases/restore-target.json \
  --runtime /etc/webvue/releases/restore-local.json
```

Target binding example:

```json
{"tenantId":"tenant_a","database":"webvue_scratch_restore_a","filestore":"webvue_scratch_restore_a"}
```

`restore-local.json` example (use installed absolute executable paths):

```json
{
  "mode":"local", "restoreAllowed":true, "writesResumed":false,
  "createdb":"/opt/homebrew/bin/createdb", "pgRestore":"/opt/homebrew/bin/pg_restore",
  "targetFilestore":"/var/lib/webvue/scratch/filestore/webvue_scratch_restore_a",
  "recoverySource":{"tenantId":"tenant_a","database":"webvue_scratch_tenant_a","filestore":"webvue_scratch_tenant_a","fence":2},
  "pgEnv":{"PGHOST":"127.0.0.1","PGPORT":"5432","PGUSER":"scratch_bootstrap","PGPASSFILE":"/etc/webvue/releases/scratch.pgpass"},
  "timeoutSeconds":120
}
```

Hashes and safe archive entry types are checked before `createdb`; source binding/fence must exactly match the receipt. Existing databases fail `createdb`; existing filestore paths are rejected. No global service stop occurs. A command failure may leave a partial scratch target for investigation; no automatic deletion follows. Success returns `restoreVerified:false` until independent Odoo ORM and attachment/business acceptance is complete.

## Dedicated edge wiring

The shared guard image also contains `deploy/releases/dedicated_guard.mjs` and `start_dedicated.mjs`. Use the same pinned guard image with command `["node","deploy/releases/start_dedicated.mjs"]`; no registry/vendor connection is made during startup. Required local configuration:

- `WEBVUE_DEDICATED_BINDING_PATH=/run/webvue/binding.json`, a canonical read-only JSON file: `{"tenantId":"tenant_a","database":"webvue_scratch_tenant_a","filestore":"webvue_scratch_tenant_a","identityRevision":1,"host":"tenant.example.test","commercialMode":"non_saas"}`.
- `WEBVUE_RELEASE_ROUTES_DIR=/run/webvue/releases`, containing the same tenant route and trusted `pools.json` metadata.
- `WEBVUE_DEDICATED_PROXY_TOKEN_FILE=/run/secrets/dedicated-proxy-token`, a canonical regular file with mode 0400/0440/0600 and at least 32 token bytes; the BFF uses the same private token. Do not put the value in generated Compose output or browser headers.
- Optional `WEBVUE_RELEASE_ASSETS_DIR=/opt/webvue/release-assets`, an existing canonical read-only union store published through `assets.publish_assets`. Hashed chunks and explicit old Nuxt metadata remain available after cutover; missing retained assets return 404, while `/_nuxt/builds/latest.json` follows the selected web. Asset requests still require tenant lease admission and fail during maintenance.
- `WEBVUE_DEDICATED_TRUSTED_EDGE_IPS` set to the fixed Caddy socket peer IP. `WEBVUE_DEDICATED_PUBLIC_PROTO=https`. Keep guard port 8080 for the bundled liveness check.

Example additional operator-owned edge Compose fragment (replace the image digest, canonical paths and external network names with the reviewed configuration):

```yaml
services:
  dedicated-guard:
    image: webvue/guard@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
    user: "501" # replace with the unprivileged owner UID of the release authority files
    command: [node, deploy/releases/start_dedicated.mjs]
    environment:
      WEBVUE_DEDICATED_BINDING_PATH: /run/webvue/binding.json
      WEBVUE_RELEASE_ROUTES_DIR: /run/webvue/releases
      WEBVUE_DEDICATED_PROXY_TOKEN_FILE: /run/secrets/dedicated-proxy-token
      WEBVUE_DEDICATED_TRUSTED_EDGE_IPS: 10.251.0.2
      WEBVUE_DEDICATED_PUBLIC_PROTO: https
      WEBVUE_RELEASE_ASSETS_DIR: /opt/webvue/release-assets
    volumes:
      - /etc/webvue/releases/dedicated-binding.json:/run/webvue/binding.json:ro
      - /etc/webvue/releases/dedicated-proxy-token:/run/secrets/dedicated-proxy-token:ro
      - /var/lib/webvue/releases/routes:/run/webvue/releases:ro
      - /var/lib/webvue/releases/routes/leases:/run/webvue/releases/leases:rw
      - webvue_assets:/opt/webvue/release-assets:ro
    expose: ["8080"]
    networks: [dedicated_edge, webvue_guard_web, webvue_guard_odoo]
networks:
  dedicated_edge: {external: true}
  webvue_guard_web: {external: true}
  webvue_guard_odoo: {external: true}
volumes:
  webvue_assets: {external: true}
```

On that private edge network assign Caddy the configured fixed IP; only Caddy publishes customer ports. Set BFF `WEBVUE_RELEASE_TENANT_ID=tenant_a`, `WEBVUE_RELEASE_TENANT_HOST=tenant.example.test`, `WEBVUE_RELEASE_IDENTITY_REVISION=1` and `WEBVUE_DEDICATED_PROXY_TOKEN` through its private operator env file. Its `NUXT_ODOO_URL` must point to `http://dedicated-guard:8080`; the renderer requires and emits this configured guard URL for both hosting modes. Configure the BFF with the exact trusted local Host and private proxy token expected by the guard. Its selected release headers must match the lease snapshot. The guard refuses unknown Host, browser private pin headers, stale revision/token combinations and all business routes during maintenance. Dedicated clients retain raw Odoo session cookies; shared SaaS cookie envelopes are not used here.

Import `deploy/releases/Caddyfile.dedicated` **inside the exact dedicated site's route after its existing aggregate rate policy**, replacing all previous web/Odoo path-specific proxies. Its catch-all proxy sends HTTP and WebSocket paths through the guard, including `/api/v1` and `/websocket`, strips private client routing headers, and supplies trusted client Host/IP/proto. Do not leave an alternate direct Odoo/web route exposed. Caddy policy/network provisioning and live Docker image acceptance remain operator integration steps.

## Existing stateful commands

```sh
python3 -B -m deploy.releases.cli plan --state /var/lib/webvue/releases --request /etc/webvue/releases/request.json --manifest /etc/webvue/releases/release.json --runtime /etc/webvue/releases/runtime-local.json
python3 -B -m deploy.releases.cli apply --state /var/lib/webvue/releases --request /etc/webvue/releases/request.json --manifest /etc/webvue/releases/release.json --runtime /etc/webvue/releases/runtime-local.json
python3 -B -m deploy.releases.cli status --state /var/lib/webvue/releases --request /etc/webvue/releases/request.json
python3 -B -m deploy.releases.cli reconcile --state /var/lib/webvue/releases --request /etc/webvue/releases/request.json --manifest /etc/webvue/releases/release.json --runtime /etc/webvue/releases/runtime-local.json
python3 -B -m deploy.releases.cli schedule-once --state /var/lib/webvue/releases --manifest /etc/webvue/releases/release.json --runtime /etc/webvue/releases/runtime-local.json
```

These commands require the concrete local runtime adapter configuration in `runtime.LocalRuntime`, including real probes, source identities and fences; the pool-rendering document alone is insufficient. `ai-apply` similarly requires its explicit AI coordinator configuration and, for a changed state version, an exact reviewed migration adapter digest. Local unit checks establish command/data safeguards, not a production rollout or universal migration compatibility.

## Source classification and local acceptance

`LocalRuntime.prepare` refuses a missing `sourceGate`. Its `scope` is `product` for complete exported product trees, or `odoo` for an Odoo-only release. Supply canonical `baseRoot` and `targetRoot` containing the full WebVue addon trees and pinned stock dependency manifests. Bind `snapshot_digest` values as `compatibilityEvidence.baseSourceDigest` and `targetSourceDigest`. The runtime compares actual addon bytes and obtains the installed inventory through the serving generation’s stock ORM before classification. Unknown paths remain blocked. Target image provenance and a compatible schema remain independent readiness gates.

Each tenant needs an `attachmentProbe` with an existing caller-readable attachment download path (`/api/v1/<app>/<resource>/<id>/attachments/<id>/download`), a relative filestore path and its SHA256. Readiness reads the existing session, exact attachment bytes over target HTTP and disk, hashed JS, and both prerendered Arabic/English message dictionaries. Build i18n dictionaries before append-only asset publication; do not replace an existing release index to add missing bytes.

`tools.continuous_updates_acceptance.run` is an opt-in source-process lab, not a Docker deployment command. Its explicit JSON config requires mode local, loopback guard/PostgreSQL, ten scratch database bindings, dedicated source-process/PID/config/source hashes, a separate candidate DB role, existing sessions, and an `actorUserId` per tenant. It executes the same release engine while continuously reading and creating actual tasks, then reads back every acknowledged write. `jobsRequired:false` is confined to this HTTP lab; its report explicitly excludes Docker image and cron acceptance. Use new request IDs and preserve failure reports. The separate PostgreSQL driver tests infrastructure role fencing and artifact restoration.

A stopped old cron is proven only after PostgreSQL has drained its existing transactions and revoked old admission. Each customer has a separately declared singleton cron process; missing, duplicate or undeclared runtime containers fail preflight. A durable `retired_old` receipt lets explicit reconciliation retry job activation without replaying migration. Actual Docker topology, Caddy policy and production storage acceptance must still run before launch.

Run guard, BFF, per-database cron and the operator with the explicitly configured compatible filesystem UID (or reviewed equivalent group permissions). Release SQLite/projections are private owner files; changing only a container image USER does not grant access. The route root is read-only to runtimes and its pre-created leases subdirectory alone is writable. Verify actual container reads/writes before admission; do not make the authority world-writable.


## Online AI readiness and local Docker evidence

When the manifest, candidate configuration or routed pool includes AI, ordinary
`prepare` also verifies the serving and candidate AI processes before touching a
maintenance barrier. Configure `aiTokenFile` as a private canonical token file and
`pools.<id>.aiRuntime` with the same service shape as `ai_maintenance`: `id` equals
the process's stable `AI_GENERATION_ID`, `url` equals trusted `pools.json.aiUrl`,
`sharedStateId` equals its actual stored `state_id`, and `aiStateVersion` equals
the manifest and routed pool version. A matching version string alone is not
state identity. The candidate must still accept new work. One directly observed
process owns each generation id. Rendered pools derive stable generation ids from the immutable manifest digest and pool name, so a later release reusing the pool receives a new id;
restart retains the id, replacement uses a new id. A persisted drained id cannot
be reused for new admission.

`tools/continuous_updates_acceptance/docker_odoo.py` preserves a separate Docker
HTTP/cron experiment on an explicitly new restored scratch database. Its fixed
fixture names, UID and stock commit are deliberate local prerequisites, not a
production provisioning interface. Use `--observe-existing` to recheck its cron
proof without recreating resources. The image is a cached-base overlay with the
current addon/launcher hashes; it does not establish a complete fresh product
Dockerfile build. Reports distinguish Docker identity, session/attachment reads,
role fencing and singleton cron polling from business-job execution and complete
restore acceptance. Never publish its private output configurations or session
files. See the dated local verification report for actual commands and limits.

## Independent Nitro bundles

Prepare a completed build outside every running output directory. Record the exact source-input digest independently; this argument is an operator assertion, not image/build attestation.

```sh
python3 -B -m deploy.releases.cli bundle-prepare --source-output /srv/webvue/builds/candidate/.output --releases /srv/webvue/bundles --release-id release_20261019 --source-digest <64-hex-source-input-digest>
python3 -B -m deploy.releases.cli bundle-verify --bundle /srv/webvue/bundles/release_20261019 --source-digest <64-hex-source-input-digest>
```

Run the verified bundle's `server/index.mjs` with its matching backend configuration; never run a build in that bundle. Internal Nitro dependency links are materialized, external/cyclic links rejected. Existing release IDs cannot be replaced. Public hashed assets use the existing append-only asset store. Old browser sessions still require the guard's configured asset-store route; copying a bundle alone does not activate a blue/green route.

## Backup without a shared-service stop

`backup-current` uses the same durable tenant maintenance barrier and guard acknowledgement as releases, but a **writer window** (`LocalRuntime.fence_backup`, `capture_backup`, `backup.capture_window`) instead of the generation swap. The release engine path (`prepare`, `quiesce`, `capture`/`capture_into`/`capture_tenant`, `_recheck`, `migrate`, `verify`, `retire`, `fence_runtime`) is unchanged from `main`: it still grants the candidate role admission so candidate HTTP verification can connect before `retire`, and a maintenance release captures with the release recheck. For the window: for the whole dump and filestore archive it revokes `CONNECT` from every writer role the tenant declares (`tenants.<id>.roles`, current and candidate), waits out active transactions, retires idle writer sessions and never grants the candidate role admission. A candidate HTTP runtime therefore cannot write during the window while `fence_runtime` keeps its release-swap semantics for generation cutover.

The window refuses instead of promising isolation it cannot prove. Every declared role is validated (login, no membership, not the database owner, no `PUBLIC CONNECT`). All principals holding database `CONNECT` or schema write authority are enumerated, effectively: every role that is a member of one of them, directly or transitively (`pg_auth_members`), is reported too (`member_of:<role>`), because it inherits or can `SET ROLE` to that admission and those table privileges and an idle session of it survives the `CONNECT` revocation. Any principal outside the declared writers plus the explicit operator allowance (`backup.allowedPrincipals` and `postgres.adminUser`) fails the window with `unsupported_writer_principal`, and an enumeration error fails it with `writer_authority_unverifiable`. A privileged DBA/root or a host-side writer outside this model is not covered and is not claimed.

A new request id is refused with `backup_operation_pending` before any inspection or write while the tenant still has a maintenance marker (another backup or a release owns it) or a backup intent whose request is not `verified`/`reconciled`. Only the owning request id recovers that backup, from its own intent; a new id would otherwise record the fenced state as "previous" and leave the original unresolved. The idle-session retirement and the window recheck cover the same effective set: a session of any login that is a member of a declared writer is retired by the fence and refuses the recheck (`writer_reconnect_observed`).

A process killed after the intent was written but before the request reached `prepared` leaves the request `planned` with a durable intent and no effect: the stage becomes `prepared` before the maintenance marker, the guard ACK or any fence. New request ids stay refused (`backup_operation_pending`). The operator recovers it by re-running `backup-current` with the **same** `--request-id` (and the same binding and output): it takes a fresh read-only preflight and atomically replaces that never-acted-on intent, so a changed cron or grant state since the interrupted run does not raise `backup_intent_conflict`, then runs the backup normally. From `prepared` onward the intent is never replaced and a re-run only reconciles it.

Before the first effect the operation persists a private durable intent under `<state>/backup_intents/<tenant>/<request>.json`: the previous `CONNECT` grant of each declared writer and, for each owned cron, the inspected Docker `containerId` and its `running`/`stopped` state. It refuses to replace a different intent for the same request. The window stops, and the resume or reconciliation starts, only that recorded container id; every stop, start and reconciliation first re-inspects the cron and refuses a different id (`cron_container_replaced`), so a same-name replacement container is never started or trusted. A previous state without a valid container id refuses (`cron_identity_changed`). Success restores **only** the writers that previously held `CONNECT` and returns cron to the previous state — a cron the operator had stopped stays stopped.

The capture proof must carry the denied writer set, and a recheck re-reads durable admission and live sessions before the dump and after the archive. `backup.totalDeadlineSeconds` (default 600) is one absolute monotonic deadline per operation, fixed after the read-only preflight and **before** the first effect. It covers the window entry — the initial guard ACK, the lease drain, the backup-only admin connection and every catalog, `REVOKE`, drain and terminate statement of `fence_writers`, and the owned cron stop — then capture, the final artifact validation (`backup.validate_window`: both hashes and the archive member enumeration, block by block), an optional caller `finalize` step (not preempted, but checked after it), the resume and the final guard ACK, each getting only what is left; the drain and Docker waits are capped by the remainder. A backup guard ACK (initial, final and fail-closed recovery) is one plain HTTP exchange (`bounded_http.get_json`) whose connect, request write, status line, headers and body reads each set the socket timeout to what is left immediately before the operation; the body is read in bounded chunks up to 64 KiB with the deadline checked after each one, so a trickled or never-ending answer raises `backup_deadline_exceeded` at the budget and the socket is always closed. On the window, resume and reconciliation paths every Docker call — the inventory `ps`, each identity `inspect`/`image inspect`/`exec`, and each cron `stop`/`start` by recorded id — takes the time left at its own dispatch as its timeout, and none is dispatched once the budget is spent, so a slow inspection can never be followed by a stop or start. The release path keeps its fixed per-call bounds (10 s guard and inspections, 30 s cron stop). An overrun at any point fails closed — marker kept, writers fenced, `needs_intervention` — and is never reported as `verified`. Inside the capture it is checked during the walk, before and after the dump child (which gets only the remaining time), on every archived and hashed block, around every fsync and before the receipt is published. Each admin connection (fence, recheck, resume) gets the remaining time as `connect_timeout` and each statement the remaining time as `statement_timeout`, recomputed per statement, so sequential queries cannot each spend a fresh allowance; the release `fence_runtime` keeps its own unchanged timing. The receipt is written as `receipt.pending` and renamed only while the budget remains; an overrun leaves no `receipt.json`, preserves the partial artifacts and fails closed. A later reconciliation of the same request id is a separate, explicit operator run on a tenant that already failed closed, so it gets its own bounded budget (`backup.timeoutSeconds`, default 120), owned by the reconciliation and covering the restore, the barrier removal and the final guard ACK with the same per-connection and per-statement bounds; the remainder is checked before the marker is removed and after the ACK, and an overrun fails closed (marker kept, writers fenced, `needs_intervention`) instead of recording `reconciled`. The fail-closed re-fence after any failure runs on its own fresh budget of the same size, so an exhausted capture budget bounds that cleanup instead of skipping it. Each filestore name is archived as its own regular file (hard-linked attachments included), so the artifact passes `validate_backup` and restores identical bytes under every name.

On any failure, including a final guard acknowledgement that fails after the marker was already removed, the operation first recreates the durable maintenance marker, then enters the window again exactly like a capture (guard ACK, lease drain, writer fence, owned cron stop), and records `needs_intervention` with `backup_unverified` or, if any of those steps fails, `backup_fail_closed_unverified`; the marker stays in both cases. Re-running the same request id reconciles the previous state from the durable intent **without capturing again**, from `prepared`, `backed_up` or `needs_intervention` alike (a SIGKILL leaves the same intent as a handled failure); a reconciliation that fails re-applies the same fail-closed sequence; if the fence is no longer intact it stays closed (`backup_fence_lost`) and needs the operator. A topology without an owned cron (`jobsRequired: false`) records an empty cron state and restores it; a required or changed cron set still refuses (`cron_identity_changed`). It stops only the declared tenant cron; it never stops the shared HTTP service.

It still refuses an active drain, wrong binding, missing independent candidate role, wrong source image, running candidate cron or changed quiescence. `restoreVerified` stays `false`: hash-valid, artifact-bound capture is not a business restore, and live PostgreSQL/Docker consistency and business recovery remain separate unproven gates. The isolated infrastructure fixture (`tools/continuous_updates_acceptance/postgres_scratch.py`) and the release engine keep the `capture_tenant` contract; only the tenant `backup-current` path uses `capture_window` and requires the window evidence.

```sh
python3 -B -m deploy.releases.cli backup-current --state /var/lib/webvue/releases --binding /etc/webvue/tenant-binding.json --runtime /etc/webvue/backup-runtime.json --request-id backup_20261019 --output /var/lib/webvue/backups/tenant-a-20261019
```

The runtime uses the existing `LocalRuntime` schema, two separately bound pool roles and a backup `image` matching the currently serving pool. This is tenant maintenance, not zero downtime for the affected tenant. Measure actual interruption and other-tenant continuity.

For the shared control worker, the optional `releaseBackupConfig` field in its private `SharedRuntimeConfig` references an absolute, canonical JSON file with `stateDir` and `runtime` (the same release adapter configuration). The worker compares queued and registered tenant bindings and the physical PostgreSQL cluster identity, captures through this barrier, and emits the existing verified-backup manifest. The API cannot supply this file, a target, a proof or an image. Without it an enabled release-routed backup refuses rather than falling back to a global stop. Traditional non-release captures retain their explicit shared maintenance behavior.

Restore publication is requested through `POST /v1/shared/tenants/:tenant/restore-publications/:approval` with only `{reason}`. It requires a fresh stepped-up vendor session with operations and tenant-management capabilities; the worker rechecks current grants, tenant state, physical observation and commercial reconciliation before using the existing isolated restore publisher. `GET` on that URL and shared operation detail report queued/published/needs-intervention. A failed/uncertain publication is not automatically requeued.

The default Compose adapter currently supplies source-tenant subscription/usage observation only. It does **not** advertise `observeRestoreSubscription`. Commercial restores remain queued behind `commercial_reconciliation_pending` until an independently verified isolated-target observer and executor are provided; a source observer cannot substitute for them. Legacy tenants without an applied subscription do not require this commercial gate. PostgreSQL seam tests prove authority and queue behavior, not physical commercial restore acceptance. The inherited filesystem-publication/control-transaction recovery window also remains a release gate; this change does not establish crash-safe publication.
