# liwan_integrations_sa

Shared service (rank 3) that stores the status of a company's live links to Saudi
services (ZATCA e-invoicing, banks). Status only: no credential, no network call.
Routes: `GET /api/v1/integrations/connections`, gated by `integrations.enabled` and
`integrations.read`.

## Seeding

`liwan.integration.connection` rows (one ZATCA link per company) are created by
`_liwan_ensure_default_connections`, which runs from module data on **install and on every
upgrade**, for the companies that exist at that moment, and by the `res.company` create hook
(`models/res_company.py`) for a company created afterwards — a second company or a branch —
so its page shows the links at once rather than after the next upgrade.

That hook elevates once (`_liwan_provisioning_env`), the same shape as `liwan_pmo`'s
per-company seeds: core `res.company.create` admits only a Settings administrator, who need
not hold `integrations.manage`. The case is documented in `tools/arch_documented_sudo.json`
and writes nothing but the company, kind and provider of its own default rows.

## Access

The record rule is `company_id in company_ids`; the controller additionally filters by the
current company. `integrations.manage` depends on `integrations.read`, so a role cannot hold
manage without read.

## Writing a connection state

`liwan.integration.connection._liwan_set_connection_state(company, kind, provider, state, message)` updates
the link of a company (creating it when missing) and stamps `last_checked`. It adds no `sudo()`: the caller's
environment must be allowed to write the model. `liwan_finance` calls it after a ZATCA onboarding, from its own
elevated service; the message is a short status text, never a credential or a raw provider response.
