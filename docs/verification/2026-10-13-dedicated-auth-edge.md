# Dedicated authentication edge — local verification

The three reported dedicated-deployment defects are repaired in `codex/deploy-auth-edge`, based on `f0d70282`. This is an uncommitted worktree change, not a merge, push, deployment, or institutional release acceptance.

## Behavior

- Caddy uses the socket peer (`remote_host`) and overwrites private IP/Host/Proto fields on its Nuxt hop, including after Connection header nomination.
- Dedicated Compose opts in to validating and forwarding these fields in login and TOTP. Stock Odoo ProxyFix receives all three X-Forwarded fields, so Nuxt's shared backend IP no longer combines different client peers' cooldown counters.
- One 20/minute auth zone precedes backend routing and includes Nuxt credentials, Odoo session authentication, and native MFA aliases. Session-info and health probes keep separate treatment.
- Direct local Nuxt without the opt-in retains its existing behavior. Shared routing and `proxy_mode=False` remain unchanged; shared Odoo's worker-local cooldown attribution is outside this dedicated repair.

## Fresh evidence

| Command | Result |
| --- | --- |
| `npm test` | exit 0: 743 tools, 194 contracts, 1360 web tests; policy/catalog/isolated-runner checks also passed |
| `python3 -B -m unittest discover -s deploy -p 'test_*.py'` | exit 0: 83 tests, including 3 new real-Caddy regressions |
| `node --experimental-strip-types --test deploy/shared/*.test.mjs` | exit 0: 29 tests |
| `npm run build` | exit 0; existing dependency annotations/BigInt target warnings remain |
| `npm exec --workspace apps/web nuxt prepare` then `npm -w apps/web run lint` | exit 0; independent generated state refreshed after build |
| `python3 -B tools/arch_policy.py --base main` | exit 0 |
| `python3 -B tools/git_policy.py --base main` | exit 0 |
| `git diff --check` | exit 0 |
| `python3 -B deploy/security/auth_edge_acceptance.py --output /tmp/nasq-auth-edge-live-20261013` | exit 0: seven live checks |

The handler wire tests failed before the fix (28 failures) and now pass (32 tests, including shared-mode preservation). All three edge regressions failed before the Caddy fix and now pass.

The live stack used the changed compiled web server, the worktree's read-only addons, stock Odoo19 with two HTTP workers, Postgres16, and Caddy2.11.4 with rate-limit module0.1.0. It exposed no host ports. Two container socket peers were recognized as distinct in Odoo despite spoofed XFF/private headers; after twelve failures from one, the other successfully logged in three times. Rotating spoofed IPs and changing credential URLs did not reset the aggregate twenty-request budget. Actual MFA returned pending, rejected an incorrect code, and accepted the correct code over trusted local TLS, with Secure session cookies.

Detailed safe runtime evidence: `/tmp/nasq-auth-edge-live-20261013/acceptance.json`. Private fixture configuration and synthetic secrets remain only in the private scratch directory; they are not included in this report. The owned stack was stopped; named scratch volumes remain. Existing local databases and services were not used.

## Delivery and limits

The edge configuration, new compiled web server, and Compose environment must be adopted together. Only Caddy may expose a port when the private-header opt-in is enabled. A separate upstream proxy needs a reviewed trust setup; clients behind one NAT still share an IP budget.

No full Odoo application suite, institution host/LAN/AMD64/load test, production adoption, or shared-mode client-identity redesign is claimed. No commit, merge, push, or deployment was performed. Independent read-only review found no actionable findings; its real-Caddy diagnostics additionally covered thirteen alternate credential URLs and duplicate case-varied private fields with Connection nomination. Live IPv6 socket `/64` behavior remains unverified. The reviewer report is `/tmp/nasq-auth-edge-independent-review.md`.

Policy `sol61-all-v1`: one inline coordinator and one read-only reviewer. Measurement began after initial diagnosis/bootstrap, so whole-task token attribution remains incomplete; no savings claim.

During the task, local `main` advanced to `7df64f57` with CI-only changes in `.woodpecker.yml`; the isolated repair remains on its original `f0d70282` base and has no overlapping changes. Latest-main integration is a separate authorized action.
