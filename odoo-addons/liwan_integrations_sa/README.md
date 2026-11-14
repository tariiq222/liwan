# liwan_integrations_sa

Shared service (rank 3, depends on `liwan_api` only) that owns provider connections: which provider accounts a
company has connected, their encrypted secrets, token refresh, test and state, and which application uses which
account. No application is imported; applications register through `liwan.integration.registry`.

## Model

- `liwan.integration.registry` (abstract): providers and uses, composed through `super()`.
  `meta` (auth `keys`) and `tiktok` (auth `oauth`) are defined here. An application or bridge adds an
  `external` provider (its owner derives the status in `_liwan_external_status`, no row is stored) and its uses
  (`_liwan_use_definitions`), and extends `_liwan_connection_uses` so a connection that a use holds cannot be deleted.
- `liwan.integration.connection`: one row per connected account of a company, unique on
  `(company_id, provider, external_id)`.
- `liwan.integration.secret`: one `secret_box` ciphertext per name (purpose `liwan_integrations`). Only
  `integrations.manage` has an ACL row. A consuming addon grants its own capability groups read access with its own
  ACL rows, and write access too when it refreshes an oauth token. The secret names are readable through
  `connection.secret_names`; a value is never serialized, except the answer of the rotate route, once.

## Python API for applications

```python
Connection._liwan_for_use(use_key)         # connections of the current company to the use's provider, not disabled
connection._liwan_access(use_key)          # {'external_id', 'app_id', **secrets}; checks use, feature, scopes, state
connection._liwan_test()                   # provider probe; writes state, status_message, last_checked
connection._liwan_secret(name)             # one decrypted secret
```

An oauth connection refreshes its access token inside `_liwan_access` under a blocking row lock (`SELECT ... FOR UPDATE`; a concurrent caller waits and reads the stored token); a
refresh refused by the provider marks the connection `error` and raises `ReconnectRequired` (a `UserError`).
The refresh token never leaves the service.

## Routes

`/api/v1/integrations/` `providers`, `connections` (list, read, create, patch, delete), `connections/<id>/test`,
`connections/<id>/secrets/<name>/rotate`, `oauth/<provider>/start` and `oauth/<provider>/callback`. Reads need
`integrations.read`, writes `integrations.manage`, all behind `integrations.enabled`.

Provider network calls live in `providers/` as pure functions; tests patch them and never reach the network.
TikTok keys are operator configuration: `LIWAN_TIKTOK_CLIENT_KEY`, `LIWAN_TIKTOK_CLIENT_SECRET`,
`LIWAN_TIKTOK_REDIRECT_URI`.

## Upgrade

`migrations/19.0.1.1.0/pre-connection-shape.py` deletes the old status-only rows and drops the `kind` column.
