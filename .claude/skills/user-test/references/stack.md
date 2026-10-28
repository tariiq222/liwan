# Shared scratch stack for long runs

Build or reuse the database once: `E2E_STACK=odoo npm run e2e:odoo -- e2e/tests/smoke.e2e.ts`
(creates `webvue_scratch_e2e`, installs every release module and runs `tools/e2e_seed.py`; the
smoke test itself may fail without a model, that does not matter). Re-seed after seed changes with
`E2E_ODOO_SEED=1`.

Then keep one stack up for all agents, from the worktree root:

```bash
export WEBVUE_COMMERCIAL_CONFIG=.e2e/odoo/classification.json PYTHONDONTWRITEBYTECODE=1
nohup /Users/tariq/code/odoo/.venv/bin/python /Users/tariq/code/odoo/odoo-bin \
  -c .e2e/odoo/odoo.conf -d webvue_scratch_e2e > .e2e/logs/shared-odoo.log 2>&1 &
cd apps/web && nohup env NODE_OPTIONS=--max-old-space-size=8192 \
  NUXT_ODOO_URL=http://127.0.0.1:43369 NUXT_ODOO_DB=webvue_scratch_e2e \
  NUXT_PUBLIC_WS_URL=ws://127.0.0.1:43369/websocket \
  npx nuxt dev --port 43300 > ../../.e2e/logs/shared-nuxt.log 2>&1 &
```

Ready when `http://localhost:43300/login` answers 200. Stop with
`pkill -f "odoo-bin -c .e2e/odoo/odoo.conf"` and `pkill -f "nuxt dev --port 43300"`.

Odoo shell (cron runner, tenant state, data fixtures):

```bash
WEBVUE_COMMERCIAL_CONFIG=.e2e/odoo/classification.json /Users/tariq/code/odoo/.venv/bin/python \
  /Users/tariq/code/odoo/odoo-bin shell -c .e2e/odoo/odoo.conf -d webvue_scratch_e2e --no-http < <script>
```

Tenant state (exclusive phase only): `E2E_TENANT_STATE='{"off":["finance.enabled"]}'` with
`tools/e2e_tenant_state.py`; `E2E_TENANT_STATE='{}'` restores the baseline saved in
`.e2e/tenant_baseline.json`.

non_saas rows: never convert the shared DB. Copy it (`createdb -T webvue_scratch_e2e
webvue_scratch_ns`), switch the copy's tenant profile to `non_saas`, serve it on other free ports
(Odoo `--http-port`, Nuxt `--port`) from a temporary copy of `apps/web`, then drop the copy and
the folder.

SaaS rows need the local control plane (`deploy/control-plane/init-local.sh`, `run-local.sh`,
Node 22, Docker Postgres on 55432) and the vendor console production build with the local
developer sign-in (`apps/vendor-admin/README.md`). Real tenant provisioning is not available
locally; record those rows as planned with that reason.
