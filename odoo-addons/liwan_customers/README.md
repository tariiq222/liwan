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
  own capability group. There is no group rule on `res.partner`: a group rule would narrow every other holder's
  rights too, because Odoo joins group rules with OR across a user's groups. The "right only from this group"
  check reads stock's group expression, which absorbs a group into one that implies it: a group that implies the
  party writer must not hold its own `res.partner` write row, or its holders are limited to parties too. No group
  does today.
- Stock renames the holder of a partner's bank accounts, as the caller, when it renames the partner. So
  `customers.manage` holds write (no create, no unlink, no group rule) on `res.partner.bank`, and the
  `res.partner.bank` override limits a caller whose bank right comes only from it to that rename: `acc_holder_name` of
  a party's accounts while the service renames the party. A bank right from another group (Finance) is untouched.
  The row is on the capability group, not on the party writer, because Finance's group implies the party writer and
  stock's group expression would then absorb Finance's own row.
- `_liwan_adopt` turns a consumer's existing partners into parties in its migration. A family is decided at its root:
  it is skipped when any member is a user's partner, a company's partner or an employee work contact (the stored
  `employee` flag of `res.partner`), or when the root's parent is no party. A phone is normalised in the partner's
  country, else the tenant's; one that does not validate is cleared and kept at the top of the internal note.
- A parent party is shared with at least everyone its contact is shared with: its company is unset or the contact's.
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
