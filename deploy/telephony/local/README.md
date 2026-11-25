Local acceptance run: copy `env.example` to `env` (mode 600). Proves the stack starts, endpoints 101/102/103 and the
trunk load, the dialplan loads, a call writes `<linkedid>.wav` and CEL rows, and the agent posts a signed event.
Trunk, coturn and real media stay unproven.

The base compose prepares its own volumes: the one-shot `volumes-init` service hands the recordings, CEL/log,
Asterisk-state and agent-queue volumes to uid/gid 10002 before Asterisk and the agent start, so there is no manual
`docker volume create`/`chown` step. Asterisk and the agent then run non-root with no capabilities, and the base
healthchecks apply (no override).
```sh
docker build -t liwan-pbx-agent:local apps/pbx-agent
python3 -B deploy/telephony/render.py --env deploy/telephony/local/env --out /tmp/tl-local --force
docker compose -f /tmp/tl-local/compose.yml -f deploy/telephony/compose.local.yml --env-file deploy/telephony/local/env up -d
curl http://127.0.0.1:8601/health
# The test page points at ws://localhost:8088/ws locally: the browser reaches the plain WebSocket listener on 8088,
# which the shared edge terminates as wss on the company host in a deployment. 8088 answers on 127.0.0.1 and ::1 alike:
# with the IPv4 loopback alone, Chrome on macOS resolves `localhost` to ::1 and the WebSocket closes with code 1006.
docker compose -f /tmp/tl-local/compose.yml -f deploy/telephony/compose.local.yml --env-file deploy/telephony/local/env down -v
```
