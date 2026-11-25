# The telephony package of one company

Asterisk 22 LTS, coturn and `pbx-agent` for **one company**, running beside LiwanOS on the company's own host. Nothing
in it is shared with another company: the PBX, its configuration, its recordings volume and its secrets are this
company's only (design D2). The shared edge route (`/ws` and the signed recording path on the company host) and the
shared coturn of the SaaS deployment are separate parts and are **not** in this Compose file.

This package is part of phase 1 of `docs/superpowers/specs/2026-10-28-liwan-telephony-design.md` (sections 2, 3, 4,
11.2, 11.3, 12.3). It answers a real call: a browser or a softphone registers, dials out through the company's provider,
receives an inbound call on extension 101, and the conversation is recorded under its `linkedid`.

## Topology

```
provider trunk ── SIP/RTP ──▶ published RTP block (every mode) + SIP port (when public) ──┐
browser ── wss /ws (shared edge, separate part) ──▶ asterisk :8088 (ws transport) ─┤
browser ── TURN (udp/tcp) ──▶ coturn ── RTP on the private network ──▶ asterisk     ├─▶ company volumes
pbx-agent ── ARI websocket ──▶ asterisk :8088/ari                                 ─┤   recordings
pbx-agent ── signed events ──▶ Odoo /api/v1/telephony/events                       ─┘
```

Two networks, both named for the company: `telephony_internal` (internal, no route off the host) carries ARI, the
browser leg and coturn's path to Asterisk; `telephony_uplink` carries the trunk, the event path to Odoo and the
relayed TURN traffic back to the browser. ARI, the HTTP server and the agent's health port are never published
(design 11.2); TURN is published only when this package is the TURN server (see "Ports").

Asterisk adopts uid/gid `10002`, the agent image's own user, so the recordings volume is written by one process and
served and pruned by the other without a shared-group arrangement. The agent's contract is exactly the variable set of
`apps/pbx-agent/src/pbx_agent/settings.py`: every name is passed, and the values come from this env file or name this
package's own Asterisk objects (`transport-ws`, `from-extension`, `from-trunk`, `trunk`) and internal paths.

## Static configuration first (the phase-1 choice)

Asterisk runs from **rendered static files** (`asterisk/*.conf`), not from PJSIP realtime in a database. The reason is
scoped to phase 1: the one thing realtime is needed for is an endpoint created and a password rotated per session
(design 4.1), and that writer is `pbx-agent`'s session path, which does not exist yet. Until it does, a static file per
company is smaller, reviewable in the diff and testable without a database; the series gate (a real call, section 13)
does not need a row written at run time.

The next step, in order, when the agent's session path lands:

1. Add a small `postgres:16` service (pinned by digest, own volume, `telephony_pbx` database) to this Compose file.
2. Move the endpoint, auth, aor, `endpoint_id_ip` and registration objects from `asterisk/pjsip.conf` into the
   `ps_endpoints`, `ps_auths`, `ps_aors`, `ps_endpoint_id_ips` and `ps_registrations` tables, and map them with
   `sorcery.conf` + `extconfig.conf`. The transports, HTTP server, ARI and logger sections stay static files.
3. Make `pbx-agent` the only writer: create and disable endpoints, rotate the session password and keep the previous
   one valid for a short overlap (4.1). The ARI credentials stay in `ari.conf`; the line passwords live in the PBX
   database and never in Odoo (section 7).
4. The database is the object a package move imports (12.2 `import`), and it is small: a row per extension plus a row
   per line, so a few hundred rows per company at most.

## Ports

Every published port binds `LIWAN_TELEPHONY_STATIC_ADDRESS` and nothing else. The table is the whole public surface:

| Host port | Protocol | What | Public when |
| --- | --- | --- | --- |
| `LIWAN_TELEPHONY_SIP_PORT` → 5060 | UDP and TCP | the company's SIP signalling (trunk and mode-b devices) | `LIWAN_TELEPHONY_TRUNK_AUTH=ip`, or `LIWAN_TELEPHONY_MODE_B_DEVICES=true` |
| `RTP_START`–`RTP_END` → the same range | UDP | the company's fixed RTP block, for the provider's and devices' media | every mode |
| `LIWAN_TELEPHONY_TURN_PORT` → 3478 | UDP and TCP | TURN listener for the browser leg | `LIWAN_TELEPHONY_TURN_PUBLISHED=true` only |
| `TURN_MIN_PORT`–`TURN_MAX_PORT` | UDP | TURN relay block, one-to-one with coturn's `min-port`/`max-port` | `LIWAN_TELEPHONY_TURN_PUBLISHED=true` only |

Never published: 5060 inside the container, 8088 (`/ws` and `/ari`), 8601 (`pbx-agent` `/health`), and 3478 inside.
The browser reaches `/ws` as `wss://<company host>/ws` through the shared edge, not through this Compose file.

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
comment characters) and refuses a non-empty target directory unless `--force` is given. The rendered files are mode
0600 in a 0700 directory because they hold the ARI, extension and trunk passwords, and the command prints file names
only, never a value. Re-render with `--force` after changing the env file, then `docker compose up -d` again.

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
5. **Secrets.** Generate the ARI password (`openssl rand -hex 24`), the three extension passwords and the TURN REST
   secret (at least 32 characters); derive the events and reverse keys on the shared side from `LIWAN_TELEPHONY_KEY` and
   write only those two here (12.6). No value has a default; an empty one stops the render.
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
- **Where the file lives.** The `telephony_logs` volume is mounted read-write at `/var/log/asterisk` in both Asterisk
  and `pbx-agent`, under one uid: the Asterisk entrypoint hands the directory to `10002:10002` (the agent's user) on
  first start, the image's mode is `0755`, and Asterisk creates the CSV `0644`. No other file is logged there
  (`logger.conf` writes only to stdout), so the volume holds the CEL CSV alone.
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

## Not in this package yet

- PJSIP realtime and the session endpoint/password (the static-first decision above).
- IVR, queues, the recording announcement prompt, outbound destination policy and the concurrent-call limits of 11.3.
  They are absent on purpose, not stubbed.
- The shared edge route (`/ws`, `/pbx/recordings/<token>`) and the shared coturn's per-company accounting (D2).
- TURN over TLS (5349), trunk TLS (5061) and the AMI fallback for events ARI does not deliver (section 13).
- Recording encryption: the volume holds plain WAV files. The agent already serves the signed route
  (`GET /pbx/recordings/<token>`); publishing it on the company host is the separate edge part.
- Retention deletion (design 4.4): the render validates `LIWAN_TELEPHONY_RECORDING_RETENTION_DAYS`, and no component
  reader or deletion exists yet; that step is phase 4.

## Files

| Path | What |
| --- | --- |
| `compose.yml` | the three services, the company networks and the three company volumes (recordings, queue, CEL log) |
| `render.py` | renders every template from one env file, validates, refuses a non-empty target, prints names only |
| `env.example` | every variable with a safe placeholder and a one-line comment; the only input |
| `asterisk/pjsip.conf.template` | transports (udp, tcp, ws), the WebRTC template with 101/102, the plain SIP 103, the trunk |
| `asterisk/extensions.conf.template` | test extensions, inbound to 101, outbound, MixMonitor by `linkedid`, unavailable message |
| `asterisk/{http,ari,rtp,logger}.conf.template` | `/ws` and ARI on 8088 inside, the ARI user, the RTP block, the log channel |
| `asterisk/cel.conf.template`, `asterisk/cel_custom.conf.template` | CEL on, the lifecycle events, the CSV path and the agent's 19 columns |
| `coturn/turnserver.conf.template` | TURN REST secret and realm, listener and relay range, native quotas |
| `logrotate/telephony-cel.template` | the size cap and rotation of the CEL CSV (installed on the host) |
| `test-page/index.html` | the JsSIP test tool, pinned CDN version with SRI |
| `tests/test_render.py` | the render results, the refusals and the no-secret-in-output rule |

## Secrets and safety

No secret is in this directory: `env.example` holds placeholders, and a rendered file with a real value is mode 0600
outside the checkout. `LIWAN_TELEPHONY_KEY` never exists on a PBX host; only the two derived keys do. ARI and AMI are on
the private network only, and no management port is published. The recordings, queue and CEL log volumes are named for the company
and are the only writable state.
