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
- `liwan.customers.settings` is the tenant's policy: customer sharing (`establishment`, `branch`), the phone
  country, the party kinds and the custom fields. `GET /api/v1/customers/settings` is read by a holder of
  `customers.read` or `customers.settings.manage` in the working company, because the forms need the party kinds
  and the field definition; `can_manage` says whether a write would pass. A write needs
  `customers.settings.manage` in the working company and in the root company: a branch manager reads and cannot change.
- `party_kinds` (`individuals`, `companies`, `both`; default `both`) decides what a new top-level customer may be.
  `POST /api/v1/customers` refuses a top-level customer whose `is_company` disagrees with `422 invalid` on
  `is_company` with `details.reason = party_kind_not_allowed`. A contact under a company parent is accepted in every
  mode. Customers an application creates inside its own action, and every edit, are not checked: the setting decides
  the forms of new customers and has no effect on existing data.
- Custom fields are stock `res.partner.properties`: one definition per database in `properties.base.definition`,
  written through `PATCH /api/v1/customers/settings` (`fields`, the whole definition in display order; a field left
  out is removed) and parsed by `liwan_api/serializers/properties.py`. Values are `properties` on the customer wire
  shape, accepted on create and edit (null clears one), written by the service under its marker like the identity,
  and filtered on the list and the export with `property.<key>=<value>`. Only parties carry values through the routes.
  Removing a field that still has a value on any party, or an option of a selection or tags field that stays and that
  any party holds (archived ones and every company counted), answers `409 custom_field_values_exist` and changes
  nothing. Its `details` are `{fields: [{key, label, count}], options: [{field_key, field_label, key, label, count}]}`
  (`count` is the number of parties, each counted once per field or option); the same write with
  `confirm_field_removal: true` then goes through and clears the values and the option keys through the ORM, because
  stock leaves them in the stored column. An option nobody holds is removed without a question.
  `confirm_field_removal` without `fields` is a 422.
- D5, the definition without `sudo()`: stock writes the definition for `base.group_system` only. This addon adds an ACL
  row (read for internal users, read and write for `group_cap_customers_settings_manage`, no create or unlink) and one
  record rule on `base.group_user` limited to the `res.partner.properties` row, so the settings manager writes the
  definition as the caller and no other model's definition is readable or writable through those rows. The route
  checks the capability in the working and the root company. The one `sudo()` of the addon counts and clears values
  that the company fence hides from the root manager (`_liwan_every_party`).
- `GET /api/v1/customers/settings/countries` lists the countries (`{id, code, name}`, by name in the session's
  language, no paging) the phone country can be set to; it needs `customers.settings.manage` in the working company.
- The list and the export also filter on `is_company=true|false` (anything else is `422 invalid`), so a form can search
  company customers to pick a parent.
- `customers.enabled` is a derived key, not an entitlement: `liwan.entitlement.service` of this addon adds it to
  `_liwan_readable_features` when one key of `_liwan_customers_feature_keys()` is readable, and to
  `_liwan_writable_features` when one is writable, so `/me` tells the web client whether the routes are open and
  whether the tenant is read-only. It is in no registry, plan or catalog; the route gate is unchanged. A test that
  asserts the exact contents of those lists sees it whenever `liwan_customers` is installed.
- `customers.export` (sensitive, depends on `customers.read`) opens `GET /api/v1/customers/export`: a CSV of the
  parties the caller can see with the list filters (`q`, `archived`, `property.<key>`), the identity columns and one
  column per custom field, with the formula-safe cells of `liwan_api/serializers/csv_export.py`. A result of more than
  `EXPORT_MAX_ROWS` (50 000, the one limit of every row export) is refused with `422 export_too_large` and
  `details: {rows, max_rows}`; it is counted before any row is loaded, and narrowing the filters brings it under.
- Routes under `/api/v1/customers` are opened by the feature keys that applications register in
  `_liwan_customers_feature_keys`. An application registers the capabilities that may pick a customer in
  `_liwan_customers_pick_capabilities`.

## Known limit of this version

The service writes no address. When a contact with an address or commercial values (VAT, registry) is created
under a party or moved to one, stock `res.partner._fields_sync` writes them up to the parent as the caller; for a
protected actor (a system administrator) the `liwan_core` write guard refuses that parent write, because no
marker covers address fields yet.
