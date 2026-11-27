# The telephony package of one company

Asterisk 22 LTS, PostgreSQL 16 (`pbx-db` for PJSIP realtime), coturn and `pbx-agent` for **one company**, running
beside LiwanOS on the company's own host. Nothing in it is shared with another company: the PBX, its realtime database,
its configuration, its recordings volume and its secrets are this company's only (design D2). The shared edge route
(`/ws` and the signed recording path on the company host) and the shared coturn of the SaaS deployment are separate
parts and are **not** in this Compose file.

This package implements the per-company PBX runtime of `docs/superpowers/specs/2026-10-28-liwan-telephony-design.md`
(sections 2, 3, 4, 11.2, 11.3, 12.3). It answers real calls with dynamic PJSIP realtime endpoints and per-session
credentials, routes any existing PJSIP extension internally, supports SIP `REFER` blind transfers, dials out through the
company's provider, receives inbound calls on extension 101, and records conversations under their `linkedid`.

## Topology

```
provider trunk ── SIP/RTP ──▶ published RTP block (every mode) + SIP port (when public) ──┐
browser ── wss /ws (shared edge, separate part) ──▶ asterisk :8088 (ws transport)         ─┤
browser ── TURN (udp/tcp) ──▶ coturn ── RTP on the private network ──▶ asterisk           ├─▶ company volumes
asterisk ── res_config_pgsql ([general]) ──▶ pbx-db :5432 (PostgreSQL 16, internal)       ├─▶ recordings & pbx-db
pbx-agent ── SQL (PBX_DB_URL) ──▶ pbx-db :5432 (ps_auths, ps_aors, ps_endpoints)          ─┤
pbx-agent ── ARI events & health probes ──▶ asterisk :8088/ari                            ─┤
pbx-agent ── signed events ──▶ Odoo /api/v1/telephony/events                              ─┘
```

Two networks, both named for the company: `telephony_internal` (internal, no route off the host) carries ARI, `pbx-db`,
the browser leg and coturn's path to Asterisk; `telephony_uplink` carries the trunk, the event path to Odoo and the
relayed TURN traffic back to the browser. ARI, PostgreSQL (`pbx-db`), the HTTP server and the agent's health port are
never published (design 11.2); TURN is published only when this package is the TURN server (see "Ports").

Asterisk and `pbx-agent` run as uid/gid `10002` (the agent image's own user) with every capability dropped, so the
recordings volume is written by one process and read by the other without a shared-group arrangement. A one-shot
`volumes-init` job runs first: it owns the four Asterisk/agent volumes long enough to hand them to `10002:10002` and
exits 0. `pbx-db` runs as `postgres` on `telephony_internal` with a read-only root filesystem, all capabilities dropped,
`no-new-privileges`, and its own named volume `telephony_pbx_db`. Asterisk waits for `volumes-init` and a healthy
`pbx-db`; `pbx-agent` waits for `volumes-init`, a healthy `pbx-db` and a healthy Asterisk. The agent's environment matches
`apps/pbx-agent/src/pbx_agent/settings.py`: every variable comes from this env file or names this package's own
Asterisk objects (`from-trunk`, `trunk`, `transport-ws`, `from-extension`) and internal paths.

## PJSIP realtime (PostgreSQL 16) and per-session credentials

Asterisk runs a hybrid PJSIP configuration backed by `pbx-db` (`postgres:16`, pinned by digest, database
`telephony_pbx`):

1. **`pbx-agent` SQL writes & `asterisk/sorcery.conf`**: `pbx-agent` connects directly to `pbx-db` via `PBX_DB_URL`
   and writes `ps_auths`, `ps_aors` and `ps_endpoints` in one atomic SQL transaction. `asterisk/sorcery.conf` lists
   `realtime` **first** and `config,pjsip.conf,criteria=type=...` **second** for `endpoint`, `auth` and `aor`, so
   Asterisk reads browser extensions live from PostgreSQL via `res_config_pgsql` while static objects (`[trunk]`, plain
   SIP extension `103` and transports) still load from `asterisk/pjsip.conf`. ARI (`/ari`) handles call lifecycle events
   and health probes rather than PJSIP object writes.
2. **`asterisk/extconfig.conf`** maps `ps_endpoints`, `ps_auths` and `ps_aors` to `pgsql,telephony_pbx,<table>`, and
   **`asterisk/res_pgsql.conf`** uses Asterisk 22's canonical `[general]` section (`hostname=pbx-db`, `port=5432`,
   `dbname=telephony_pbx`, `user=telephony_pbx`, `password=...`, `appname=asterisk`) to connect over
   `telephony_internal` using `LIWAN_TELEPHONY_PBX_DB_PASSWORD`.
3. **`postgres/01-schema.sql`** creates `ps_aors`, `ps_auths` and `ps_endpoints` on first database initialization (with
   `VARCHAR(8)` yes/no columns and `ps_endpoints.auth VARCHAR(200)` for comma-separated overlap auth IDs during session
   rotation). **`postgres/02-seed.sql`** inserts idempotent (`ON CONFLICT (id) DO NOTHING`) seed rows for the browser
   test extensions `101` and `102` (`webrtc='yes'`, `allow_transfer='yes'`, `from_domain='<host>'`).
4. **Dynamic dialplan and SIP REFER transfers (`asterisk/extensions.conf`)**: `[from-extension]` routes any existing
   PJSIP extension (`DEVICE_STATE(PJSIP/${EXTEN}) != INVALID`) to `[internal]` instead of a hardcoded list. Non-existent
   or offline `< 7`-digit numbers play `line-unavailable` and hang up so they never spill onto the external trunk, while
   `7+`-digit numbers and E.164 numbers (`_+X.`, at least 7 digits after `+`) route to `[outbound]`. `[from-extension]`,
   `[internal]` and `[outbound]` enforce fail-closed guards (`FILTER(0-9,${EXTEN})` for `_X.` and
   `FILTER(0-9,${EXTEN:1})` for `_+X.`, rejecting any non-digit or expression error before `Dial`). `[inbound-call]`,
   `[internal]` and `[dial-outbound]` all set `Set(__TRANSFER_CONTEXT=from-extension)` so SIP `REFER` blind transfers
   resolve inside `[from-extension]`.
5. **Per-session browser credentials**: `compose.yml` forwards `PBX_DB_URL`, `PBX_PUBLIC_WS_URL`, `PBX_STUN_URL`,
   `PBX_TURN_URL`, `PBX_TURN_SECRET`, `PBX_SESSION_SECONDS`, `PBX_SESSION_OVERLAP_SECONDS`, `PBX_PJSIP_TRANSPORT`
   (`transport-ws`) and `PBX_PJSIP_CONTEXT` (`from-extension`) to `pbx-agent`, which mints temporary TURN REST HMAC
   credentials and rotates per-session PJSIP passwords in `pbx-db` with an overlap window (design 4.1).
6. **Package moves (12.2)**: the `telephony_pbx_db` volume holds one row per extension (a few hundred rows at most) and
   is the database object exported/imported during a company move.

## Ports

Every published port binds `LIWAN_TELEPHONY_STATIC_ADDRESS` and nothing else. The table is the whole public surface:

| Host port | Protocol | What | Public when |
| --- | --- | --- | --- |
| `LIWAN_TELEPHONY_SIP_PORT` → 5060 | UDP and TCP | the company's SIP signalling (trunk and mode-b devices) | `LIWAN_TELEPHONY_TRUNK_AUTH=ip`, or `LIWAN_TELEPHONY_MODE_B_DEVICES=true` |
| `RTP_START`–`RTP_END` → the same range | UDP | the company's fixed RTP block, for the provider's and devices' media | every mode |
| `LIWAN_TELEPHONY_TURN_PORT` → 3478 | UDP and TCP | TURN listener for the browser leg | `LIWAN_TELEPHONY_TURN_PUBLISHED=true` only |
| `TURN_MIN_PORT`–`TURN_MAX_PORT` | UDP | TURN relay block, one-to-one with coturn's `min-port`/`max-port` | `LIWAN_TELEPHONY_TURN_PUBLISHED=true` only |

Never published: 5060 inside the container, 5432 (`pbx-db`), 8088 (`/ws` and `/ari`), 8601 (`pbx-agent` `/health`), and
3478 inside. The browser reaches `/ws` as `wss://<company host>/ws` through the shared edge, not through this Compose
file.

The credentials mode (design 12.3): the RTP block is public, so the provider has an address to send media to, and the
transport advertises `LIWAN_TELEPHONY_STATIC_ADDRESS` in the SDP and the Contact in every mode. The SIP port stays
closed in this mode, so an inbound INVITE can only arrive over the registration's own flow; a provider that always
dials the Contact's address needs IP authentication with a dedicated address, or mode-b devices. Which behaviour the
provider has is one of the phase-1 line tests of section 13.

## Render and start

The env file is the only input. Copy `env.example` to a root-only file on the host (mode 0600, outside the checkout),
fill it in, then:

```sh
python3 -B deploy/telephony/render.py --env /etc/liwan/telephony/<company>.env --out /var/lib/liwan-telephony
docker compose --project-directory /var/lib/liwan-telephony --env-file /etc/liwan/telephony/<company>.env up -d
```

The renderer validates every fact before writing anything (company tag, addresses, ports, ranges, secrets, the
comment characters) and refuses a non-empty target directory unless `--force` is given. The rendered directory is
0700 and the files inside are 0644: the container's non-root Asterisk process has to read its configuration, and the
directory is the boundary that keeps the ARI, extension and trunk passwords from other host users. The command prints
file names only, never a value. Re-render with `--force` after changing the env file, then `docker compose up -d`
again.

The first start runs `volumes-init` before anything else: it prepares the recordings, CEL/log, Asterisk-state and
agent-queue volumes for uid/gid `10002` with only `CHOWN` and `DAC_OVERRIDE`, then exits. Asterisk and the agent then
start non-root with no capabilities; Asterisk's control socket lives on a tmpfs the same uid owns, which is why its
healthcheck (the CLI run as that user) can pass and `pbx-agent` can wait for `service_healthy`.

Useful checks:

```sh
docker compose --project-directory /var/lib/liwan-telephony --env-file <env> ps
docker compose --project-directory /var/lib/liwan-telephony --env-file <env> exec asterisk asterisk -rx 'pjsip show endpoints'
docker compose --project-directory /var/lib/liwan-telephony --env-file <env> exec asterisk asterisk -rx 'pjsip show registrations'
docker compose --project-directory /var/lib/liwan-telephony --env-file <env> exec asterisk asterisk -rx 'core show channels'
```

The repository checks are `python3 -B -m unittest discover -s deploy/telephony/tests -p 'test_*.py' -v` and
`ruff check deploy/telephony`.

## Operator runbook checklist

Collect these before the first start. Anything missing below is a hard stop for the test it feeds.

1. **Server.** Linux with Docker Engine and Compose v2, 2 vCPU and 4 GB for one test company. Capacity is not promised
   before the load test of section 14; two or three companies per node are a test density, not a capacity promise (D2).
2. **Static address.** A public static IPv4 bound to the host: `LIWAN_TELEPHONY_STATIC_ADDRESS`. Give it to the provider
   only in the IP-authentication mode, and allocate it with the company so it can move with the package (12.4).
3. **Domain and DNS zone.** The company host (`LIWAN_TELEPHONY_HOST_NAME`) already resolves for LiwanOS and already
   carries the edge certificate; the shared edge forwards `/ws` on it (separate part). The SIP name
   (`LIWAN_TELEPHONY_SIP_DNS_NAME`) is for mode-b devices only, resolves to this package's host or its dedicated
   address with a 60 second TTL, and is created, moved and deleted by the DNS part (12.3). This package writes no DNS.
4. **Provider details.** Server address and port; authentication (an IP allowlist, or a username and password);
   the exact outbound number format it accepts and whether a prefix is needed (`LIWAN_TELEPHONY_TRUNK_DIAL_PREFIX`);
   the codecs it accepts (`LIWAN_TELEPHONY_TRUNK_CODECS`); how many concurrent calls the line allows; and whether its
   trunk is reachable only over a private path (then the site needs mode b with a gateway or a VPN; this package alone
   cannot reach it).
5. **Secrets.** Generate the ARI password (`openssl rand -hex 24`), the `pbx-db` password (`LIWAN_TELEPHONY_PBX_DB_PASSWORD`,
   no whitespace, `;`, `#` or `'`), the three test extension passwords and the TURN REST secret (at least 32 characters);
   derive the events and reverse keys on the shared side from `LIWAN_TELEPHONY_KEY` and write only those two here (12.6).
   No required secret has a default; an empty one stops the render.
6. **CEL rotation.** Install the rendered `logrotate/telephony-cel` as `/etc/logrotate.d/liwan-telephony-<company>` and
   check `logrotate -d` on it (Docker's data root may not be `/var/lib/docker`). Without it the CSV grows without a cap;
   reconciliation still works, the file just keeps growing.

### Test with Linphone

Linphone registers as `sip:103@<static address>:<SIP_PORT>` over UDP, with the 103 password from the env file. 103 is
the plain SIP test extension for exactly this: 101 and 102 are WebRTC endpoints (`webrtc=yes`: ICE, DTLS-SRTP,
rtcp-mux) and default Linphone does not offer them, so its audio would not negotiate there. Linphone also needs the SIP
port and RTP block published, which is why the acceptance env sets `MODE_B_DEVICES=true`.

1. Register 101 in the test page and 103 in Linphone, then call 103 from 101 (and 101 from 103): both answer and the
   audio is two-way, which proves the WebRTC leg, the plain SIP leg and the recording in one call.
2. Call out to a real Saudi number: the provider answers, the caller id is `LIWAN_TELEPHONY_TRUNK_CALLER_ID`, and the
   conversation ends with the line. Check the recording: `.../telephony_recordings/monitor/<linkedid>.wav` appears on
   the volume, named by the call's `linkedid`. The trunk also sets `from_user`, which some providers show instead of the
   caller id: compare what the called phone displays and record which one the provider honours (one of the section 13
   line checks).
3. Call the trunk's own DID from a mobile: the call rings 101 (keep the test page registered), and the recording
   appears; in phase 1 every user part the provider sends rings 101 (`s`, a DID, an E.164 number, or anything else
   addressed to the contact). In the credentials mode the provider reaches the package only if it delivers the INVITE
   over the registration flow; a provider that always dials the public SIP port needs IP authentication or mode-b
   devices.
4. On a phone behind 4G (NAT), configure Linphone's TURN with the temporary TURN REST credentials and confirm both
   audio directions; this is the TURN check of section 13.

### Test with the test page

`test-page/index.html` is a test tool, not product UI. Serve it (`python3 -m http.server` in the source directory) and
open it over `https://`, or over `http://localhost`, or the browser refuses the microphone. Fill in
`wss://<company host>/ws`, an extension and its password, then register, dial and hang up.

### What cannot be tested without the missing pieces

- **Without a provider line:** no real outbound or inbound call, no caller id and no trunk codec check. A browser-to-
  browser call (101 → 102) still proves the WebSocket transport, ICE, DTLS and the recording.
- **Without the edge route and DNS:** the page cannot open `wss://<company host>/ws`; only a temporary TLS terminator in
  front of `asterisk:8088` on a local host can stand in for it, and that is not this package.
- **Without a public address and `TURN_PUBLISHED=true`:** no 4G/NAT media test.
- **Without `MODE_B_DEVICES=true` or IP authentication:** no Linphone or device registration from outside, and no
  guaranteed provider inbound (the SIP port is closed in the credentials mode; see "Ports"); the browser leg and the
  provider's outbound media path work through coturn and the published RTP block.

## Reconciliation and the CEL file

Asterisk writes one CSV of Channel Event Logging rows, and `pbx-agent` tails it to recover a call leg the live ARI
stream lost (design 4.6). This package wires the whole path; nothing about it is left for the operator to invent.

- **What is written.** `asterisk/cel_custom.conf` defines one output file, `/var/log/asterisk/cel-custom.csv`. In
  Asterisk's CEL custom backend the section name *is* the output file, so the section is that absolute path (the
  package cannot name it `[cel_custom]` and still write there). `asterisk/cel.conf` enables CEL, tracks `Dial`, logs
  the lifecycle events (`CHAN_START`, `ANSWER`, `HANGUP`, `CHAN_END`, the bridge events and `LINKEDID_END`), and sets
  `dateformat=%Y-%m-%d %H:%M:%S`, the only format the agent parses. Asterisk formats `eventtime` from local time;
  `TZ=UTC` on the Asterisk container makes that UTC. (`usegmtime` is the CDR/RADIUS spelling of that switch; Asterisk
  22.11.0's `cel.conf [general]` accepts only `enable`, `dateformat`, `apps` and `events`, and an unknown option stops
  the whole file from loading, so the time zone, not that option, is the guarantee. The template records this.)
  The module is loaded by the image's `autoload=yes` (`cel_custom.so` and the `res_cdrel_custom.so` it depends on), so
  the package needs no `modules.conf` of its own.
- **The row.** One newline-terminated record per event, 19 comma-separated values in the order
  `apps/pbx-agent/src/pbx_agent/cel.py` expects: `eventtype, eventtime, cidname, cidnum, cidani, cidrdnis, ciddnid,
  exten, context, channame, appname, appdata, amaflags, accountcode, uniqueid, linkedid, userfield, peeraccount,
  sequence`. Asterisk 22.11.0 names the caller-id values `name`, `num`, `ani`, `rdnis` and `dnid`, and exposes no CEL
  `sequence`, so the last column is the literal `0`; the agent reads the position, never that value. Every field is
  quoted (`quoting_method = all`, Asterisk's name for quoting every field), so a comma or a newline inside a value (an appdata, a caller name) stays inside
  its column; the agent unquotes each field before it reads it.
- **What the agent does with it.** It stores a byte offset (`cel_offset`) in its queue together with the identity of
  the file it came from (device, inode, and a digest of the first bytes). It reads only what was appended and
  re-enqueues each completed leg (one with a `HANGUP` or `CHAN_END`) that the live stream never delivered, in the same
  envelope, idempotent on `uniqueid`. An absent file is not an error: nothing is read, and a file that appears later is
  read from its first byte. When the identity changes — a rotation, a truncation, a rewrite — reading starts again at
  zero. A queue with no stored state adopts the file as it stands, because history from before the agent existed is
  never replayed: that would mint new event ids for calls Odoo may already hold. The offset never moves past the first
  row of a leg that has not ended, so a call spanning two passes is rebuilt whole.
- **Where the file lives.** The `telephony_logs` volume is mounted at `/var/log/asterisk` in both Asterisk and
  `pbx-agent`, under one uid: `volumes-init` hands the directory to `10002:10002` before either starts, and Asterisk
  creates the CSV `0644`. No other file is logged there (`logger.conf` writes only to stdout), so the volume holds the
  CEL CSV alone.
- **Size and rotation.** CEL has no built-in limit, so the package ships a logrotate policy
  (`logrotate/telephony-cel`, rendered for the company): daily, `maxsize 50M`, seven copies, `copytruncate`. Install it
  as `/etc/logrotate.d/liwan-telephony-<company>` on the package host; the path is Docker's default volume root
  (`/var/lib/docker/volumes/<company>-telephony-logs/_data/cel-custom.csv`), so adjust it only if the host's data root
  differs. A truncation can drop the rows written between the copy and the truncation from reconciliation; they were
  already delivered on the live stream, which is the primary path.
- **What is still unverified without a real call.** The column order and the configured field names are asserted at
  render time against Asterisk 22.11.0's field registry, and the agent's parser is exercised by its own tests, but no
  row from a real call has been read yet: the phase-1 call (section 13) is what proves that a lost event is recovered.
  The quoted row and the parser that unquotes it are the pair to watch in that call, together with the adoption rule
  above: a fresh queue deliberately does not resend rows written before it started.

## The shared edge route

The browser opens `wss://<company host>/ws` on the same host liwan is served from, so the telephony routes are not a
site of their own: `deploy/stack/Caddyfile` imports the generated snippet **inside** the tenant site and above the
guard. A second site naming that host would shadow the tenant site and take liwan down on it.

`deploy/telephony/edge/render_edge.py` turns the control plane's snapshot into that snippet:

```sh
python3 -B deploy/telephony/edge/render_edge.py --snapshot <telephony-registry.json> --out <telephony.caddy>
```

- **The snapshot.** `telephony-registry.json` is published atomically by the control plane and holds
  `{"companies": {"<host>": {"asterisk": "host:port", "agent": "host:port"}}}`. A `.pending` marker beside it means a
  publication is in progress and is refused; the file's identity is compared before and after the read, so a
  replacement under the read is never bound. An invalid snapshot is refused before anything is written, so a refused
  run leaves the last good snippet in place. The output is deterministic: hosts in sorted order, no timestamp.
- **The two forwarded paths, and only those.** `/ws` goes to that company's Asterisk (carrying the real client address,
  because Asterisk keys failed SIP registrations by impersonation and address together) and `GET /pbx/recordings/<token>`
  goes to its `pbx-agent`. The token is one path segment. Nothing else is forwarded: `/ari`, any other method on the
  recording path, and every other spelling of the two prefixes are answered 404 by the shared Caddyfile, which also
  gives a company host absent from the snapshot the same 404. The edge's private headers never cross to a PBX host.

## Not in this package yet

- IVR, queues, the recording announcement prompt, outbound destination policy and the concurrent-call limits of 11.3.
  They are absent on purpose, not stubbed.
- The shared edge route's mount and publication: `deploy/telephony/edge/render_edge.py` renders the snippet and the
  shared Caddyfile imports it, but the step that mounts the generated file into the proxy container belongs to the
  stack, not this package. The shared coturn's per-company accounting (D2) is also still open.
- TURN over TLS (5349), trunk TLS (5061) and the AMI fallback for events ARI does not deliver (section 13).
- Recording encryption: the volume holds plain WAV files. The agent already serves the signed route
  (`GET /pbx/recordings/<token>`); publishing it on the company host is the separate edge part.
- Retention deletion (design 4.4): the render validates `LIWAN_TELEPHONY_RECORDING_RETENTION_DAYS`, and no component
  reader or deletion exists yet; that step is phase 4.

## Files

| Path | What |
| --- | --- |
| `compose.yml` | the five services (`volumes-init`, `pbx-db`, `asterisk`, `coturn`, `pbx-agent`), the company networks and the five company volumes (recordings, queue, CEL log, Asterisk state, `pbx-db`) |
| `render.py` | renders every template from one env file, validates, SQL-escapes seed literals, refuses a non-empty target, prints names only |
| `env.example` | every variable with a safe placeholder and a one-line comment; the only input |
| `asterisk/pjsip.conf.template` | static transports (udp, tcp, ws), plain SIP `103` (with `allow_transfer=yes`) and the trunk |
| `asterisk/sorcery.conf.template` | PJSIP realtime-first, `pjsip.conf`-second routing for `endpoint`, `auth` and `aor` |
| `asterisk/extconfig.conf.template` | maps `ps_endpoints`, `ps_auths` and `ps_aors` to `pgsql,telephony_pbx,<table>` |
| `asterisk/res_pgsql.conf.template` | PostgreSQL connection (`[general]`) to `pbx-db:5432` (`telephony_pbx`) |
| `asterisk/extensions.conf.template` | dynamic internal routing via `DEVICE_STATE`, outbound filter guard, SIP REFER transfer context, MixMonitor by `linkedid`, unavailable message |
| `asterisk/{http,ari,rtp,logger}.conf.template` | `/ws` and ARI on 8088 inside, the ARI user, the RTP block, the log channel |
| `asterisk/cel.conf.template`, `asterisk/cel_custom.conf.template` | CEL on, the lifecycle events, the CSV path and the agent's 19 columns |
| `postgres/01-schema.sql` | `ps_aors`, `ps_auths` and `ps_endpoints` tables for Asterisk PJSIP realtime |
| `postgres/02-seed.sql.template` | idempotent seed rows for WebRTC test extensions `101` and `102` |
| `coturn/turnserver.conf.template` | TURN REST secret and realm, listener and relay range, native quotas |
| `logrotate/telephony-cel.template` | the size cap and rotation of the CEL CSV (installed on the host) |
| `test-page/index.html` | the JsSIP test tool, pinned CDN version with SRI |
| `tests/test_render.py` | the render results, the refusals, SQL escaping, Compose env forwarding and the no-secret-in-output rule |

## Secrets and safety

No secret is in this directory: `env.example` holds placeholders, and a rendered file with a real value sits in a 0700
directory outside the checkout (the files inside are 0644 so the non-root containers can read them).
`LIWAN_TELEPHONY_KEY` never exists on a PBX host; only the two derived keys do. ARI, AMI and `pbx-db` are on the
private network only, and no management or database port is published. The recordings, queue, CEL log, Asterisk-state
and `pbx-db` volumes are named for the company and are the only writable state.
