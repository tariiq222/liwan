# webvue_integrations_sa

Shared service (rank 3) that stores the status of a company's live links to Saudi
services (ZATCA e-invoicing, banks). Status only: no credential, no network call.
Routes: `GET /api/v1/integrations/connections`, gated by `integrations.enabled` and
`integrations.read`.

## Seeding

`webvue.integration.connection` rows (one ZATCA link per company) are created by
`_webvue_ensure_default_connections`, which runs from module data on **install and on every
upgrade**, for the companies that exist at that moment. There is deliberately no
`res.company` create hook: it would need `sudo()` (rule R7). The provisioning flow must
therefore upgrade this addon after it creates a company. Until it does, the page shows its
empty state.

## Access

The record rule is `company_id in company_ids`; the controller additionally filters by the
current company. `integrations.manage` depends on `integrations.read`, so a role cannot hold
manage without read.
