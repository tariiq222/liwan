# Service health in the vendor console

> Design. Status: the owner approved building it and took the decisions of section 5 on 2026-11-22. Built on the branch `claude/gallant-gauss-gxh9lh` (seven commits, section 7); not merged, not deployed, and the host timer is installed on no server.
> Paths are under `apps/control-plane/src/` unless noted. The study read code only; nothing was run.

## 1. What exists today

- **Context and overview.** `GET /v1/context` returns `enabled`, `capabilities` and `shared_onboarding_enabled`.
  `GET /v1/overview` (`vendor.read`) returns tenant and operation counts and `last_health_at`, the latest tenant
  health check (`http.ts`). Neither says whether a process is running.
- **Adapters.** A payment or mail adapter that cannot be built is one `console.error` at start-up, in the API
  (`http.ts`, payment only) and in the worker (`shared-worker-main.ts`, both). The Telegram channel is the same
  (`commercial/scheduler.ts`). Payment routes then fail closed and every mail job is skipped, with no trace.
- **Worker.** The shared worker is the host unit `liwan-shared-worker.service`, exactly one
  (`docs/operations/control-plane-deployment.md`). It writes no heartbeat.
- **Scheduler.** `createCommercialScheduler` is built in `shared-worker-main.ts` and its `tick()` is the maintenance
  step `commercial-scheduler`. It runs after each dispatch pass (`shared/job-runner.ts`), about once a second when
  idle, and not at all while a shared job (backup, restore, provision) is running.
- **Attention and alerts.** `commercial/attention.ts` lists failed or stuck rows. `commercial/vendor-alerts.ts` turns
  them into owner alerts, but `sendVendorAlerts` is itself a scheduler job: a dead worker sends nothing.
- **Console.** `apps/vendor-admin/app/pages/overview.vue` shows `VendorAttentionList` and `VendorStatusStrip`
  (counts with links) and the `last_health_at` line.

## 2. Behaviour

**Reporting.** One new table `service_heartbeats(component, beat_at, started_at, detail jsonb)`, one row per component:

| Component | Written by | When | `detail` |
| --- | --- | --- | --- |
| `shared_worker` | a timer in `shared-worker-main.ts`, independent of the job loop | every 30 s | none |
| `commercial_scheduler` | the end of `tick()` | at most every 30 s | ticks, last billing pass, jobs that failed in the last tick |
| `payment_adapter`, `mail_adapter`, `alert_channel` | worker start-up, then the worker timer | on start and on change | `available`, and the logged reason when not |
| `api_payment_adapter` | `createApp` start-up | on start | the same |

`beat_at` is written with the database's `now()` and every reader (console, attention, host alert) evaluates
`service_health_states(now())`: one clock, so a host with a wrong clock cannot hide a dead worker.
A heartbeat write that fails is logged and never stops a tick or the worker. Reasons pass through `logText`.

**Reading.** `GET /v1/overview` gains `health`: for each component `state` (`ok`, `stale`, `unavailable`,
`never_seen`), `since`, and `detail` for `vendor.operations.run` holders only. Staleness is computed at read time
from named constants:

- `shared_worker`: stale after 2 minutes without a beat.
- `commercial_scheduler`: stale after 5 minutes without a tick, unless a `shared_jobs` row is `running`; then after
  2 hours, the grace the deployment document gives a running operation.
- Adapters: `unavailable` as recorded. Their row is shown as unknown while `shared_worker` is stale.

**Console.** A "Services" section on `/overview` above the counts: one chip per component with a state word and
the time since the last beat (a new `VendorHealthStrip`, because the existing strip shows numbers). The
`last_health_at` line moves into it, labelled as the last workspace check.

**Attention and alert.** A stale or unavailable component is one attention item of kind `service_down`, rank 1,
named by the component, with no customer. It leaves the list when the component is `ok` again. An unavailable
adapter is alerted like a stale component. The alert is one message when a component turns stale or unavailable and
one when it recovers. It is sent by a host systemd timer that reads the table and sends a new `deploy/alerts.py`
event, so it works when the worker and the API are both down. It is the only sender: the scheduler's `sendVendorAlerts`
skips `service_down` (the item stays in the console list), so one episode gives one message.
A transition is recorded once at least one channel delivered it (`alerts.dispatch` reports it; the exit code of
`alerts.py` stays 1 for the release command); when none delivered it is retried each minute.
The timer reads the database through its own role `liwan_control_health`, which holds `EXECUTE` on `service_health_states`
and nothing else: the function is `SECURITY DEFINER` with a pinned `search_path` and revoked from `PUBLIC` (it reads
`shared_jobs`, whose payloads a table grant would expose), and the operator creates the role (bring-up A6.3).
The timer is itself watched: after 3 consecutive failed reads of the table (counted in its state file) it sends one
`service_down` for the component `health_monitor` (`unavailable`) and one `service_recovered` when it reads again; a single
transient failure sends nothing.

## 3. Safety rules

- Read only: no action in this feature starts, stops or restarts anything.
- No secret, host name, connection string or stack trace is stored in `detail`; only fixed codes and `logText` output.
- The health read never fails the overview: an unreadable table yields `health: null` and the page says so.
- One row per component, updated in place: the table does not grow. No history is kept.
- A component never seen (fresh install, dedicated mode without the shared worker) is `never_seen`, shown plainly
  and never alerted on. In shared mode (`LIWAN_TENANCY_MODE=shared`) the API registers `shared_worker` and
  `commercial_scheduler` at start (a row dated then, never replacing a beat), so a worker that never starts is stale
  after its threshold and alerted on; the mode alone decides, not a readable runtime config.

## 4. Not monitored

Odoo itself and tenant workspaces (the existing health check stays as it is), the edge and TLS, the database
(`/healthz` covers it), the AI service, the ordinary worker of dedicated mode, the reachability of the payment
provider or SMTP server (only whether the adapter was built), disk and backups (`deploy/alerts.py` covers them).

## 5. Decisions (owner, 2026-11-22)

| # | Question | Decision |
| --- | --- | --- |
| D1 | Who sends the alert when the worker is dead | A host systemd timer that reads the table and sends a `deploy/alerts.py` event. |
| D2 | Who sees it | `vendor.read` sees states; `vendor.operations.run` also sees reasons (recommended default, taken). |
| D3 | Thresholds | Fixed named constants with tests (recommended default, taken). |
| D4 | Adapter unavailable | Attention item and alert (recommended default, taken). |

## 6. Out of scope

History and uptime charts, a public status page, restart buttons, per-job health of the scheduler, probing the
payment provider or SMTP, paging or escalation, health of the dedicated-mode worker.

## 7. Tasks (one commit each)

1. The next free migration and `service-health.ts`: `beat`, `recordAvailability`, `readHealth` with the thresholds.
   Tests: each state, the running-job grace, `never_seen`, a write failure that does not throw.
2. Worker timer and adapter rows in `shared-worker-main.ts`; scheduler beat in `tick()`. Tests: a beat per tick at
   most every 30 s, failed job names in `detail`, the timer stops on the shutdown signal.
3. API: `api_payment_adapter` at start-up; `health` on `GET /v1/overview` and its contract schema. Tests: detail
   hidden without `vendor.operations.run`, `health: null` on a read failure.
4. Attention kind `service_down` in `commercial/attention.ts` and its contract. Tests: listed when stale, gone when
   `ok`, `never_seen` not listed.
5. The host alert: a script that reads the table and sends a new `deploy/alerts.py` event on turning stale and on
   recovery, a systemd timer unit next to `liwan-shared-worker.service`, and its install step in the bring-up
   checklist. Tests: one message per transition, none repeated; the new alert event.
6. Console: `VendorHealthStrip`, the section on `overview.vue`, the attention presentation, Arabic and English
   texts. Tests: each state, the unknown adapters under a stale worker, the null case.
7. Docs: `docs/operations/control-plane-deployment.md` (health section) and `saas-commercial-runbook.md`.
