# Isolated business-continuity fixture

This is a **native acceptance fixture**, not a second control-plane adapter or customer-provisioning path. It starts only a dedicated PostgreSQL 16 container, then uses the read-only Odoo source checkout with this Nasq worktree's addons and a private scratch-only config/data/log tree. It does not communicate with the management API, control-plane PostgreSQL, or worker. It does not prove Package 2 managed provisioning.

## Safety and ownership

- Exact dedicated Postgres project: `nasq-saas-outage-fixture`; container `nasq-saas-outage-fixture-postgres`; local bind `127.0.0.1:55439`; persistent volume `outage_pg`.
- Scratch DB: `nasq_scratch_p1outage`; Odoo loopback `127.0.0.1:18179`; Nuxt loopback `127.0.0.1:13109`.
- Recheck all ports immediately before starting. Never connect this fixture to PG 5432, control-plane PG 55432, management API 14179, or customer A/B ports. Do not use shared `/Users/tariq/code/odoo/odoo.conf`, Odoo data directories, or logs.
- Use only the cached `postgres@sha256:16bc17c64a573ef34162af9298258d1aec548232985b33ed7b1eac33ba35c229` image with `--pull never`; lifecycle verifies container image ID. No source image pulls. Keep synthetic credentials and the randomly generated Odoo database-manager master password only in the ignored mode-0600 `state/secrets.env` file and process environment; the rendered Odoo config is also mode 0600. The helper preserves an existing master password and migrates older private fixture state on `start`; never print these values.
- `stop` stops only the exact owned Odoo/Nuxt PIDs recorded by this fixture and the named Postgres service. It preserves database volume and evidence. Do not use `down -v`, `dropdb`, or remove state.
- No method in this fixture stops/inspects/mutates CP services. The future outage proof is a separate authorized window after runtime handoff; this fixture's baseline stage leaves CP untouched.

## Commands

Run `./deploy/control-plane-outage/outage-fixture status|prepare|start|probe|stop`. `prepare` creates (and refuses to overwrite) private local config, data/log/evidence dirs, and random synthetic credentials in ignored `state/`. It creates the isolated Compose PG service only after explicit operator execution. It uses an explicit fresh database and will refuse if that database already exists. Odoo modules: `nasq_core,nasq_platform,nasq_api,nasq_pmo,nasq_hr,nasq_chat`. New profile remains the selected explicit `non_saas` local-policy mode; support access default remains unchanged. The bootstrap creates one synthetic company-scoped administrator with `hr_manager` and `pmo_manager` grants via `nasq.access.service`; password is not logged.

The probe performs authenticated API reads (`/api/v1/projects`, `/api/v1/hr/employees`) and permitted writes (unique project, task, HR department and employee) through Nuxt's same-origin BFF and records sanitized result summaries. It does not clean up records. Do not run the full Playwright suite.

## Runtime assumptions

Use `/opt/homebrew/opt/node@22/bin/node` and its matching npm 10.9.7 (`PATH` prefix `/opt/homebrew/opt/node@22/bin`) and `/Users/tariq/code/odoo/.venv/bin/python` (3.12.13). `prepare` refuses incorrect Node/Python major versions. Install independent web dependencies in this worktree with `npm ci --ignore-scripts`; run Nuxt `postinstall` here to create its independent generated state. Odoo runs from `/Users/tariq/code/odoo` using stock addon roots plus this worktree's `odoo-addons` explicitly; no upstream source/config changes.

This fixture's local baseline can establish authenticated customer-session/API continuity independently from management services. It does not establish production readiness, domain/TLS, backup/restore, RPO/RTO, or managed customer creation. A real outage-window test must first obtain explicit handoff/authorization; it must stop only the separately owned management processes identified by that handoff.
