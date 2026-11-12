# liwan_customers

Shared service (rank 3) that owns the commercial party: the customer or vendor on `res.partner`. It is the only
writer of a party's identity (`name`, `phone`, `email`, `is_company`, `parent_id`, `active`, `company_id`) and names
no application.

- `liwan_party` marks a party, its contacts included. A user's or a company's partner is never one.
- `liwan.customers.service` normalises phones to E.164, finds candidates by phone, resolves the customer of an
  action (409 `conflict` with the candidates until the caller names one or asks for a new one), and creates, edits,
  archives and restores a party as the caller under its own marker in the `res.partner` write guard.
- `group_customers_party_writer` holds read, write and create on `res.partner`, never unlink. The `res.partner`
  overrides limit what this group alone grants: a caller whose create or write right comes only from it writes
  parties only and creates them only through the service. A right the caller has from another group is untouched.
  `customers.manage` implies it; an application that creates a customer inside its own action implies it from its
  own capability group.
- `liwan.customers.settings` is the tenant's policy: customer sharing (`establishment`, `branch`) and the phone
  country. Only a holder of `customers.settings.manage` in the root company reads or changes it.
- Routes under `/api/v1/customers` are opened by the feature keys that applications register in
  `_liwan_customers_feature_keys`. An application registers the capabilities that may pick a customer in
  `_liwan_customers_pick_capabilities`.

## Known limit of this version

The service writes no address. When a contact with an address or commercial values (VAT, registry) is created
under a party or moved to one, stock `res.partner._fields_sync` writes them up to the parent as the caller; for a
protected actor (a system administrator) the `liwan_core` write guard refuses that parent write, because no
marker covers address fields yet.
