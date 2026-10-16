# Vendor administration separation — master plan

**Spec:** [`docs/superpowers/specs/2026-10-15-nasq-vendor-admin-separation-design.md`](../specs/2026-10-15-nasq-vendor-admin-separation-design.md)

The spec covers four subsystems. Each gets its own detailed plan, written when its inputs are
stable, so every plan argues from the code as it is when that phase starts.

| Phase | Plan | Branch | Depends on | Blocked until |
|---|---|---|---|---|
| 2 | [Control-plane identity and roles](2026-10-15-vendor-admin-p2-identity.md) | `codex/cp-vendor-identity` | nothing | done on `codex/cp-vendor-identity` (not merged, held for phase 3) |
| 1 | [Shared design layer `packages/ui`](2026-10-15-vendor-admin-p1-ui-layer.md) | `codex/web-ui-layer` | nothing | — (`codex/web-project-surfaces` merged 2026-10-15) |
| 3 | [`apps/vendor-admin` app, moved pages and removal from `apps/web`](2026-10-16-vendor-admin-p3-app.md) | `codex/cp-vendor-admin-app` | phase 1 merged; branched from `codex/cp-vendor-identity` so phases 2 and 3 merge together | — |
| 4 | Docs, `arch_layers.json` gate removal, sign-off (code removal moved into phase 3; to be written) | `codex/cp-vendor-admin-cleanup` | phase 3 merged | owner adds `Architecture-approved-by:` |

Phase 2 is planned first: it is the security-critical part, it has no UI, and nothing else depends
on its internals beyond the HTTP contract recorded in its plan.

## Contract phase 2 hands to phase 3

Phase 3's BFF relies on exactly this, and phase 2's tests pin it:

- Pre-session routes `POST /v1/admin/auth/*` are signed with `signServiceRequest({ ..., actor:
  'anonymous', anonymous: true })` from `@nasq/commercial-contracts/server`.
- Successful sign-in returns `{ session: "<accountId>.<token>", expires_at, idle_expires_at }`.
  The BFF stores the whole string in cookie `__Host-nasq_admin` and never parses the token.
- Every other `/v1/*` vendor request carries header `x-nasq-session: <cookie value>` and is signed
  with `actor` = the integer before the dot. The control plane rejects a mismatch with `401`.
- Step-up: a `403` body `{ code: 'step_up_required' }` means the BFF must run
  `POST /v1/admin/auth/step-up/options` then `/verify` and retry.
- Errors from `/v1/admin/auth/*` are `{ code: 'auth_failed' }` (401), `rate_limited` (429),
  `invalid` (422), `admin_unavailable` (503, admin settings absent) or `not_found` (404, non-POST);
  they never say whether an email exists.
- The BFF must overwrite `x-nasq-client-ip` with the real client address and never pass a browser
  value through; otherwise every client shares one `ip:` attempt scope.
- Before phase 3 exposes these routes publicly: a request from an already locked IP must not
  increment the account scope (reserve `ip:` first, stop at the first blocked scope).
- Open product decision for phase 3: a password+TOTP or recovery session can never step up, and
  no route adds a passkey from a signed-in session, so lost-device recovery is CLI-only today.

## Execution rules for every phase

- One worktree per phase under `.worktrees/`, created with `npm run wt -- new <area>-<slug>`,
  installed with `npm ci --ignore-scripts`, own ports and scratch databases.
- Control-plane DB tests use `CONTROL_TEST_DATABASE_URL` pointing at a fresh loopback
  `nasq_control_scratch_<suffix>` database. Never `nasq_control_dev`, never `odoo19`.
- Before review: merge current `main`, run the phase's focused checks, `npm test`,
  `python3 -B tools/git_policy.py --base main`, `python3 -B tools/arch_policy.py --base main`.
- Commit, merge and push only with the owner's authorization for that action.
