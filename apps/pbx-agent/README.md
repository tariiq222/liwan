# pbx-agent

The per-company telephony agent of LiwanOS (design: `docs/superpowers/specs/2026-10-28-liwan-telephony-design.md`).
One instance runs inside each company's telephony package. It is the only party that talks to Asterisk over ARI, the
only writer of Asterisk's realtime tables in `pbx-db` (the PJSIP ones and the dialplan's recording-policy row), the
only party that writes and deletes recordings, and the only sender of call events to Odoo.

It holds no Odoo code, imports nothing from Odoo and never opens an Odoo database. Its call and recording contract
with Odoo is four things: the signed `POST` to the events route (4.5), the signed recording link (4.4), the recording
policy Odoo pushes on save (4.4), and the retention deletions Odoo asks for (4.4). The agent does not derive the two
company keys; the shared side derives them (12.6) and they reach this host as values or as a secret file.

## What it does

- Listens to `ari/events?api_key=…&app=pbx-agent&subscribeAll=true` over WebSocket, reconnecting with backoff, and
  turns channel events into call events. ARI requires an application name even with `subscribeAll`; the agent
  registers none of its own.
- Stores every event in a local SQLite queue with an `event_id` assigned at enqueue, then posts each row to Odoo
  until it answers 2xx.
- Reads Asterisk CEL on an interval and re-enqueues a completed call leg the queue never saw, so a call whose
  events were lost before the queue still reaches Odoo.
- Serves one recording per signed link and refuses everything else with 404.
- Writes the company's recording policy row the dialplan reads on every call, and deletes the recordings Odoo no
  longer keeps.
- Answers `GET /health` for the operator's monitor.

## Endpoints

| Route | Method | Surface | Purpose |
|---|---|---|---|
| `/health` | GET | private | ARI reachability and stream state, line endpoint state, recordings free space, queue depth, delivery and worker liveness |
| `/pbx/recordings/<token>` | GET | public (edge) | Streams one recording as `audio/wav`; anything invalid answers 404 |
| `/registration` | POST | private (Odoo) | Mints a short-lived WebRTC SIP password with a unique auth slot, per-session TURN REST credentials, and overlap rotation |
| `/registration/{extension}` | DELETE | private (Odoo) | Revokes all active sessions for an extension and deletes its PJSIP `endpoint`, `aor`, and `auth` objects |
| `/extensions/{extension}` | PUT | private (Odoo) | Validates an extension when `active: true` (no password opened until `/registration`), or disables it when `active: false` |
| `/extensions/{extension}` | DELETE | private (Odoo) | Disables an extension and deletes its PJSIP `endpoint`, `aor`, and `auth` objects |
| `/recordings/link` | POST | private (Odoo) | Mints a short-lived signed recording URL with bounded clock tolerance |
| `/recording/config` | PUT | private (Odoo) | Writes the company's recording policy row (`always`/`off` plus the announcement flag) that the dialplan reads through Asterisk realtime; answers `{"applied": true}` |
| `/recordings/delete` | POST | private (Odoo) | Deletes the recordings of up to 500 calls by `linkedid`, skipping a call the stream still has a leg of, and answers `{"deleted": [...], "missing": [...]}` |

Caddy exposes only `/pbx/recordings/<token>` (GET) and the Asterisk WebSocket path to the internet; `/health` and the
seven Odoo routes are reachable only on the private network.

The health route answers 200 while the process serves, and its `status` field is `ok` or `degraded`. It is
`degraded` when ARI does not answer, when the event stream is not connected, when the recordings volume is below
`PBX_RECORDINGS_MIN_FREE_BYTES`, when the queue holds events and no delivery succeeded for
`DELIVERY_STALE_SECONDS` (900), or when a background worker stopped beating. Restarting the container would not fix
any of these, so the field is for the alert, and the HTTP status is for liveness.

The report also carries `delivery.last_success_at`, and one beat per background worker
(`workers.delivery`, `workers.reconcile`, `workers.sessions`) with the seconds since its last pass and whether that is stale. A pass
that raises is logged by exception class and the worker keeps its tick, so a broken event or a broken HTTP answer
cannot silently stop delivery. The delivery beat counts as stale only after `WORKER_STALE_SECONDS` (a full batch of
`BATCH_SIZE` attempts at `REQUEST_TIMEOUT_SECONDS` each, plus a minute), so a live worker sending a slow batch is
never reported as gone.

## The event Odoo receives

Every attempt posts the same stored bytes, so the `event_id` never changes:

```json
{
  "event_id": "b0b9d0a0-6f9e-4d8a-9c1f-0c3a9e0e1a2b",
  "database": "liwan_acme",
  "occurred_at": "2026-11-25T09:00:00.123000Z",
  "source": "ari",
  "reconciled": false,
  "call": {
    "linkedid": "1764049999.7",
    "uniqueid": "1764049999.7",
    "channel": "PJSIP/1001-00000007",
    "direction": "out",
    "caller_number": "1001",
    "connected_number": "+966500000000",
    "dialed_exten": "+966500000000",
    "state": "ringing",
    "started_at": "2026-11-25T09:00:00.123000Z",
    "answered_at": null,
    "ended_at": null
  }
}
```

- `linkedid` groups the channels of one call and is the call key; `uniqueid` is the channel.
- `state` is one of `ringing`, `answered`, `ended`, or `failed` for a leg CEL never closed (see reconciliation).
- A reconciled row is the same envelope with `source: "cel"`, `reconciled: true`, `state: "ended"` and the times
  CEL recorded.
- One event per recorded call carries `recording: "ready"` and nothing else uses the field: when a leg of the call
  has ended and `<linkedid>.wav` exists, the agent sends that leg's end event again with the field set and a new
  `occurred_at`. Nothing else in `call` differs, and the queue takes the announcement once per call.
- Headers: `X-Liwan-Telephony-Timestamp` (unix seconds, one per request) and `X-Liwan-Telephony-Signature` =
  `hex(HMAC-SHA256(events_key, "<timestamp>\n" + body))`. The body is the exact bytes sent, serialized with sorted
  keys, no spaces and UTF-8. Odoo refuses an old timestamp and an `event_id` it already processed.
- Key form: Odoo derives each key as 64 hex characters, and that text is the key's encoding, not its bytes. The HMAC
  key is the 32 raw bytes obtained with `bytes.fromhex`, never the 64 ASCII characters. `signing.py` carries the
  rule and `tests/test_signing.py` pins a shared vector (key text, payload, timestamp, signature hex, token) so the
  Odoo side can reproduce these bytes exactly.

## Reverse-direction authentication (Odoo -> pbx-agent)

Every private route Odoo calls — `/registration` (`POST` and `DELETE`), `/extensions/{extension}` (`PUT` and
`DELETE`), `/recordings/link`, `/recording/config` and `/recordings/delete` — is authenticated with HMAC-SHA256 using
the 32 raw bytes of `PBX_REVERSE_KEY`:

- `X-Liwan-Telephony-Timestamp`: Unix epoch seconds ASCII decimal (`^[0-9]{1,20}$`), within `±300` seconds of `now`.
- `X-Liwan-Telephony-Signature`: 64-character hex HMAC-SHA256 over
  `b"<timestamp>\n<METHOD>\n<path>\n" + raw_body`, verified with `hmac.compare_digest`.
- `X-Liwan-Telephony-Database`: the company database name; must match `PBX_DATABASE` (and any `database` field in a JSON body).

Missing/malformed headers, stale/future timestamps, or invalid signatures answer `401` with no detail. A valid
signature presenting another database answers `403`. Invalid extension numbers (not matching `^[0-9]{2,10}$`) and a
call id outside the recording-name rule answer `422`. A `pbx-db` write failure on `/recording/config` answers `502`
instead of claiming the policy reached the dialplan. `tests/test_signing.py` pins the shared reverse-signing vector so
Odoo reproduces the exact bytes.

## WebRTC sessions, password rotation with overlap, and TURN REST

Asterisk 22 digest authentication matches by `(realm, username)` and stops at the first matching `auth` object on an
endpoint. Each `POST /registration` therefore generates a unique 8-hex-character `slot`:

- `auth_id = "<ext>_<slot>"`, `auth_username = "<ext>-<slot>"`, and a fresh random `password`.
- Live sessions are persisted in the `sessions` table of `PBX_QUEUE_PATH` SQLite DB.
- Under a per-extension lock, rotating keeps at most the immediately preceding live `auth_id` with
  `overlap_until = min(prev.expires_at, now + PBX_SESSION_OVERLAP_SECONDS)` and drops any older auths.
- PJSIP realtime rows are written directly to `pbx-db` (`PBX_DB_URL`) inside **one atomic PostgreSQL transaction**:
  upserting `ps_auths` (`<ext>_<slot>`), `ps_aors` (`<ext>`), and `ps_endpoints` (`<ext>`, with
  `auth=<comma-joined active auth ids>` and the Asterisk 22 WebRTC attributes) and deleting any stale auth rows.
  Asterisk 22's `res_config_pgsql.so` reads `ps_auths`, `ps_aors`, and `ps_endpoints` live from `pbx-db`, whereas
  Asterisk 22's ARI dynamic config `INSERT INTO ps_endpoints` omits identifier quotes around `100rel` and fails in
  PostgreSQL. Making `pbx-agent` the sole transactional writer avoids that bug and eliminates partial-write rollbacks:
  if the transaction fails, PostgreSQL rolls back cleanly, SQLite is untouched, and `/registration` answers `502` with
  no password.
- A background reaper loop (`workers.sessions`) atomically updates `ps_endpoints.auth` and deletes expired/past-overlap
  `ps_auths` rows; when an extension has zero live sessions remaining, it deletes `ps_endpoints`, `ps_aors`, known
  `ps_auths`, and any orphan `<ext>_%` auth rows in one transaction so expired passwords are immediately rejected.
- `DELETE /registration/{ext}`, `DELETE /extensions/{ext}`, and `PUT /extensions/{ext}` with `active: false` revoke
  all active sessions and delete `ps_endpoints`, `ps_aors`, known `ps_auths`, and any orphan `<ext>_%` auth rows
  atomically and idempotently.
- When `PBX_TURN_URL` is configured, each session mints ephemeral coturn `use-auth-secret` REST credentials:
  `expiry = int(now) + max(PBX_SESSION_SECONDS * 2, 300)`, `username = "<expiry>:<ext>"`,
  `credential = base64(HMAC-SHA1(PBX_TURN_SECRET, username))`.

## The recording link Odoo mints

`token = base64url(json) + "." + hex(HMAC-SHA256(reverse_key, base64url(json)))`, where `json` is
`{"call": "<linkedid>", "host": "<company host>", "exp": <unix expiry>}` with sorted keys and no spaces. On
`POST /recordings/link`, `expires_at <= now` answers `410`, `expires_at > now + 60 + 300` answers `422`, and the minted
token's `exp` is capped at `min(expires_at, now + 60)`. The agent verifies the signature, the expiry, the host against
`PBX_PUBLIC_HOST` and the call id shape before it looks at the disk. The file is `<call id>.wav` directly inside
`PBX_RECORDINGS_DIR`; the resolved path must stay in that directory, so traversal, a symlink leaving the directory and
listing are all refused with 404.

## The recording policy, and deleting a recording

Two siblings of the link share its signature and its one-row contract with Odoo (design 4.4).

- **`PUT /recording/config`** (`{"database", "policy", "announce"}`) upserts the single `liwan_recording_config` row in
  `pbx-db` in one transaction. The dialplan reads that row through Asterisk realtime on every call, so the push *is*
  the policy: `always` records, `off` records nothing, and an unreadable row records nothing. The fixed `id = 1` keeps
  the table one row, so a repeat push updates rather than contradicts. A failed write answers `502`, and Odoo keeps
  the previous policy until the next save pushes the row again.
- **`POST /recordings/delete`** (`{"database", "linkedids"}`) unlinks `<linkedid>.wav` for each call, through the same
  name rule and containment check the signed link uses, so a traversal, a symlink out and a directory named like a
  recording delete nothing. It never deletes under a live call: a `linkedid` the event stream still has a leg of is
  left alone and appears in neither list, because its file is still being written and Odoo must keep serving it. Each
  other id is `deleted`, or `missing` when there is no file — which a repeat of the same request reports again instead
  of failing. A list over the cap (500) or a name outside the call-id rule answers `422`, and any other OS error
  propagates so Odoo retries instead of being told a kept file is gone.

## Configuration

Environment only, validated once at start; a missing or malformed value stops the boot with a one-line message that
names the variable and never its value.

| Variable | Required | Meaning |
|---|---|---|
| `PBX_ARI_URL` | yes | ARI base URL, for example `http://ari:8088/ari`; no credentials in the URL |
| `PBX_ARI_USERNAME` | yes | ARI user; never logged |
| `PBX_ARI_PASSWORD` | yes | ARI password; never logged |
| `PBX_DB_URL` | yes | PostgreSQL DSN for `pbx-db` (`postgresql://` or `postgres://`, no whitespace); never logged or included in errors/`repr()` |
| `PBX_DATABASE` | yes | the company database name, carried in every event |
| `PBX_EVENTS_KEY` | with `PBX_REVERSE_KEY` | the derived events key, 64 hex characters |
| `PBX_REVERSE_KEY` | with `PBX_EVENTS_KEY` | the derived reverse-direction key, 64 hex characters |
| `PBX_KEYS_FILE` | alternative | a secret file with `events=<key>` and `reverse=<key>` lines; cannot be combined with the two variables |
| `PBX_RECORDINGS_DIR` | yes | existing directory where MixMonitor writes `<linkedid>.wav`; the agent reads it for streaming, deletes from it on Odoo's retention request, and `/health` reports its free space |
| `PBX_RECORDINGS_MIN_FREE_BYTES` | no | free-space floor for the health report; default 536870912 (512 MiB) |
| `PBX_ODOO_EVENTS_URL` | yes | full URL of the Odoo events route, for example `http://odoo:8069/api/v1/telephony/events` |
| `PBX_LISTEN_HOST` | no | default `0.0.0.0` |
| `PBX_LISTEN_PORT` | no | default `8601` (the image healthcheck targets this port) |
| `PBX_QUEUE_PATH` | yes | absolute path of the SQLite queue file; its directory must exist |
| `PBX_RECONCILE_SECONDS` | no | CEL comparison interval, 30 to 86400; default 300 |
| `PBX_PUBLIC_HOST` | yes | the company host bound into recording tokens, for example `acme.example.com` |
| `PBX_CEL_PATH` | yes | absolute path of the Asterisk CEL CSV; the file may appear later |
| `PBX_INBOUND_CONTEXT` | no | the context that marks a call as incoming; default `from-trunk` |
| `PBX_LINE_ENDPOINT` | no | PJSIP endpoint reported as the line in `/health`; absent means the report has no line |
| `PBX_PUBLIC_WS_URL` | no | `ws://` or `wss://` WebSocket URL returned by `/registration`; defaults to `wss://<PBX_PUBLIC_HOST>/ws` |
| `PBX_SESSION_SECONDS` | no | SIP session lifetime in seconds, 30 to 120; default `120` |
| `PBX_SESSION_OVERLAP_SECONDS` | no | password rotation overlap window in seconds, 0 to 60 and `< PBX_SESSION_SECONDS`; default `30` |
| `PBX_STUN_URL` | no | optional STUN server URL (`stun:` or `stuns:`) offered in `ice_servers` |
| `PBX_TURN_URL` | no | optional TURN server URL (`turn:` or `turns:`); requires `PBX_TURN_SECRET` |
| `PBX_TURN_SECRET` | with `PBX_TURN_URL` | coturn `use-auth-secret` shared secret (`>= 32` chars, no whitespace); never logged |
| `PBX_PJSIP_TRANSPORT` | no | PJSIP WebSocket transport name written to browser endpoints; default `transport-ws` |
| `PBX_PJSIP_CONTEXT` | no | PJSIP dialplan context written to browser endpoints; default `from-extension` |

## The queue and how it stays bounded

`events` holds one row per event: the body, the attempt count, the next attempt time and the acknowledgement time.
`legs` holds the `uniqueid` of every call the live stream saw finish. `recordings` holds the `linkedid` of every call
whose recording was announced, so neither the stream nor a CEL replay announces one twice. `meta` holds the CEL byte
offset and the identity of the file it belongs to.

- A row leaves the queue only after a 2xx. Every other answer and every connection error is retried with a capped
  exponential backoff (2, 4, 8 … 300 seconds) and nothing is dropped.
- Acknowledged rows are deleted 24 hours after the acknowledgement, and legs and announced recordings 3 days after
  they were first seen (`queue.py`: `ACKED_RETENTION_SECONDS`, `LEG_RETENTION_SECONDS`); pruning runs hourly from the
  delivery worker. The file therefore stays proportional to a day of events plus three days of leg and recording keys,
  not to the agent's lifetime.
- SQLite runs in WAL mode with `synchronous=FULL`, so an acknowledged event survives a power loss.

## Reconciliation and the CEL file

The package writes Cel with `cel_custom.conf`, one CSV file, with this column order (Asterisk's own sample order):

```
eventtype,eventtime,cidname,cidnum,cidani,cidrdnis,ciddnid,exten,context,channame,appname,appdata,
amaflags,accountcode,uniqueid,linkedid,userfield,peeraccount,sequence
```

The agent tails that file by byte offset (`cel_offset` in the queue's `meta` table), so each pass reads only what
was appended. Rows are read with Python's `csv` reader, so a quoted field that contains a comma (`Dial` appdata such
as `"PJSIP/1001,30"`) is one field. A row that still does not carry the 19 columns is skipped and counted, and it
never holds the file: the rows after it are read on the same pass.

The package must quote every field (`quoting_method = all`), which wraps each field in double quotes so a comma inside
a value stays inside the field. Backslash quoting (`\,`) is not accepted, because the comma stays in the line. A row
written without quoting and broken by a comma is skipped; a leg whose hangup lands in such a row is completed by the
bound below.

- A leg counts as complete once a `HANGUP` or `CHAN_END` row exists.
- The offset never moves past the first row of a leg that has not ended. A call that spans two passes is therefore
  rebuilt from all of its rows, not from its tail, and the live stream marks a leg (in `legs`) only when the call
  ends, so a call whose end event was lost is still rebuilt once.
- A leg CEL never closes is sent as `failed` once it has been open for `MAX_OPEN_LEG_SECONDS` (6 hours), with the
  times CEL recorded for it, and it stops holding the offset. One unreadable row can therefore delay recovery but
  cannot pin the file forever.
- A leg that ended less than `LIVE_RACE_SETTLE_SECONDS` (60 seconds) ago waits one pass, so the live end event can
  mark it first and reconciliation cannot emit a second ended event with a different id.
- The offset is stored with a file identity: device, inode and a digest of the file's first line. A rotated or
  rewritten file is read from the start instead of from an offset that points into another file. The first line is
  what is hashed because it stays the same while the file grows.
- A queue with no stored state adopts the file as it stands and sends nothing from it. History from before this
  agent existed is not resent, because resending it would mint new event ids for calls Odoo may already hold. A file
  that did not exist yet, or existed empty, is read from byte 0 once it is written.
- A row a comma broke is skipped and never guessed at.

Because Asterisk writes `eventtime` without a zone, the agent reads it as UTC and the Asterisk container of the
package must run with `TZ=UTC`.

## Run locally

```sh
python3 -m venv .venv
.venv/bin/pip install --require-hashes -r requirements-dev.txt
.venv/bin/pip install --no-deps --no-build-isolation -e .

mkdir -p /tmp/pbx-agent/recordings

PBX_ARI_URL=http://127.0.0.1:8088/ari \
PBX_ARI_USERNAME=liwan PBX_ARI_PASSWORD=… \
PBX_DB_URL=postgresql://pbx:…@127.0.0.1:5432/telephony_pbx \
PBX_DATABASE=liwan_acme \
PBX_EVENTS_KEY=$(python3 -c 'import secrets; print(secrets.token_hex(32))') \
PBX_REVERSE_KEY=$(python3 -c 'import secrets; print(secrets.token_hex(32))') \
PBX_RECORDINGS_DIR=/tmp/pbx-agent/recordings \
PBX_ODOO_EVENTS_URL=http://127.0.0.1:8069/api/v1/telephony/events \
PBX_QUEUE_PATH=/tmp/pbx-agent/queue.sqlite3 \
PBX_PUBLIC_HOST=acme.localhost \
PBX_CEL_PATH=/tmp/pbx-agent/cel.csv \
.venv/bin/python -m pbx_agent
```

The HTTP access log is disabled on purpose: it would write the one-minute recording tokens to stdout. ARI connections ignore environment proxies, because ARI is reached only on the package's private
network.

## Container

`Dockerfile` mirrors `apps/ai-service`: a hashed lock installed into its own prefix, a non-root user (`uid 10002`),
`TZ=UTC`, and a `HEALTHCHECK` against `/health`. Two mounts are expected: a volume for the SQLite queue
(`/var/lib/pbx-agent`), which this container writes, and the company's recordings storage (`/recordings`), which
Asterisk writes and this container reads and deletes from. The recordings mount is the only volume that holds call
audio; Odoo never mounts it, and every deletion happens through the signed `/recordings/delete` request above.

Both `requirements.txt` (runtime image) and `requirements-dev.txt` (CI and local development, including `httpx` for
`TestClient` and `ruff`) are universal hashed locks targeting Python 3.12 (covering both Linux `python:3.12-slim` and
macOS wheels). Regenerate them from this folder after an approved dependency change:

```sh
C="uv pip compile --universal --python-version 3.12 --generate-hashes --no-header --quiet"
$C pyproject.toml -o requirements.txt
$C pyproject.toml --extra dev -o requirements-dev.txt
```

## Tests

From the lane root, with no Asterisk and no network and nothing installed:

```sh
python3 -B -m unittest discover -s apps/pbx-agent/tests -p 'test_*.py' -v
```

The tests cover the configuration gate, the event signature bytes and the shared vector, every recording-token case
(valid, expired, another host, another call, another key, malformed, non-ASCII), traversal and symlink attempts, the
recording config push (signature, another company's database, strict body, one row under a repeat push, a failed write
answering 502) and recording deletion (signature, strict and capped body, the file removed once and reported `missing`
afterwards, a live call left alone, a name outside the call-id rule refused, a missing file reported without an
error), queue idempotency and per-request timestamps, backoff, pruning, transport failures (timeout, broken HTTP
answer, refused connection), the ARI event URL, the ARI mapping, CEL parsing with quoted and unquoted comma rows, the
reconciliation pass including a call split across two passes, a call whose end event was lost, a leg that just
ended and a leg past the six-hour bound, and the health report.

## Verified, and not verified

Verified by the tests above, offline: configuration fail-closed behaviour, signature and token bytes, path safety,
queue and retry semantics, per-request timestamps, transport failures, CEL parsing and re-enqueue, the ARI event
URL, health payload and worker liveness.

The ARI client keeps only what the agent uses: the event stream, reachability, and one endpoint's state. PJSIP realtime
writes and the recording-policy row go directly to `pbx-db` through `pbx_db.py`, verified offline against a fake
transactional connection.

Not verified, and open until the phase-1 gate in the design (section 13): a real Asterisk. That includes which ARI
events the package's dialplan actually produces (the spec allows falling back to AMI for the missing ones), that the
event URL with `app=pbx-agent` is accepted, that the package writes comma-quoted CEL rows, the ARI health probe,
that a MixMonitor file is closed by the time its channel's end event reaches the agent (the recording-ready event is
sent on that ordering), streaming a real MixMonitor file, that `REALTIME()` returns the policy row the dialplan
expects, and the Odoo side of each contract, which `liwan_telephony` implements and which no real call has exercised
yet.

## Decisions (where the spec is silent)

1. **CEL as the reconciliation source.** The agent tails the `cel_custom` CSV instead of adding an AMI client or a
   second database connection. It is local, bounded by the byte offset, and mockable with a file. The package must
   use the column order above and `TZ=UTC`.
2. **One snapshot per missing channel.** Reconciliation groups CEL by `uniqueid` and enqueues one complete `ended`
   event for a leg the queue never stored. The live path records the leg only when the call ends, so a delivered
   call is never duplicated and a call whose end event was lost is still recovered whole.
3. **The event body is wider than the spec's fixed fields.** The spec fixes `event_id`, `linkedid` and `uniqueid`
   only. The envelope carries the raw channel numbers and dialed extension and leaves E164 normalization and contact
   matching to Odoo, which owns them.
4. **Direction comes from the dialplan context.** ARI does not say in/out. A channel whose context is
   `PBX_INBOUND_CONTEXT` is `in`, everything else is `out`; telling an internal extension-to-extension call apart is
   left to Odoo, which knows both numbers.
5. **`PBX_PUBLIC_HOST` exists.** The recording token is bound to the company host (4.4), so verification needs the
   expected host from configuration.
6. **Per-session auth slots with direct atomic `pbx-db` writes.** Asterisk 22's `res_config_pgsql.so` reads
   `ps_auths`, `ps_aors`, and `ps_endpoints` live from `pbx-db`, whereas its ARI dynamic config push
   (`INSERT INTO ps_endpoints`) omits identifier quotes around `100rel` and fails in PostgreSQL. `pbx-agent` is
   therefore the sole transactional writer of those three tables via `PostgresPbxStore`: every session issue, overlap
   narrowing, and revocation commits in one PostgreSQL transaction; on failure SQLite is untouched and `/registration`
   answers `502` with no password.
7. **The token is a base64url JSON payload plus a hex signature.** The expiry is minted by Odoo (one minute) and only
   checked here.
8. **Health always answers 200.** The report carries `ok` or `degraded`, so the container healthcheck tests the
   process while the operator's monitor reads the detail. A disconnected event stream, a queue that Odoo has not
   taken, or a worker that stopped beating all degrade the report.
9. **No byte-range handling of our own.** `FileResponse` serves a range only inside the file; no range outside it and
   no listing is possible.
10. **The CEL offset is tied to a file identity and to unfinished calls.** See the reconciliation section: a rotated
    file is read from the start, an unfinished call keeps the offset at its first row until it is sent as failed
    after six hours, a call that just ended waits one minute for its live event, and a queue with no state adopts
    the file instead of replaying history with new event ids.
11. **ARI ignores environment proxies.** The event WebSocket is opened with `proxy=None`, so an `HTTP_PROXY` in the
    container can never route the ARI connection off the package's private network.
12. **The Python floor is 3.9.** The lane's verification command runs the workspace `python3` (3.9); the image runs
    3.12. The application or a future test that imports FastAPI needs 3.12, and the pure modules the unittest suite
    touches stay within 3.9 syntax.
