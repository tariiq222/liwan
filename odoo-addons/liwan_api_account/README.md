# liwan_api_account

The establishment's one tax choice (plan D22, rank-5 bridge of `liwan_api` and stock `account`).

Stock `res.company.account_price_include` (`tax_included` / `tax_excluded`) is the stored fact. A tax follows the
value of the company that **owns** it, and the establishment has one value, so this addon declares the field a
stock **root-delegated field** (`_get_company_root_delegated_field_names`): Odoo base copies the root's value to its
active branches on a root `write`, a new branch starts from its parent, and `_check_root_delegated_fields` refuses a
branch whose value differs from its root's. A branch reactivated from the archive takes its parent's value again in
this addon's `res.company.write`. The route answers `409 tax_mode_locked` when stock would refuse the change (any
journal item in the establishment).

- `GET /api/v1/admin/company/tax` (`settings.company.read`): `registered`, `price_mode` (`included` | `added`),
  `choice` (`none` when unregistered), `locked`, `can_change` and `is_root_session`. The price mode is the session
  company's own row; the registration is `res.company._liwan_vat_registered()` (the derived
  `liwan_establishment_vat_registered`); the lock is `root_id._existing_accounting()`, whose `child_of` search reads
  no field of the root. A branch session therefore reads the establishment's values with `can_change: false` and
  `is_root_session: false`, and cannot change them.
- `PATCH` (the same route, `settings.company.vat.manage` in the root, root session only): `registered` and/or
  `price_mode`. The mode is written on the root alone, through the core guard's `_liwan_marked_write_fields` marker
  (`liwan_api_account.price_mode_company_ids`); base's own elevated propagation reaches the active branches. VAT
  registration goes through `res.company._liwan_write_company_profile`, so the VAT number check and the access audit
  still apply. Values equal to the current ones write nothing.
- A new root starts at `tax_included` (the owner's default) and a new branch takes its root's value; the install
  hook writes the same default on every establishment without a journal item.
- Every purchase tax without a `price_include_override` gets `tax_excluded` ("tax added"), at install and after a
  chart is loaded for a company (`account.chart.template._post_load_data`). Sale taxes keep following the company,
  and a tax that already carries an override (the Saudi chart's customs VAT) is never touched.
- `company_tax.enabled` is a derived session key (derived, never registered), like `customers.enabled`: `/me`
  reports it while this addon is installed.

## No elevated call in this addon

Both operations run in the caller's own environment. The read uses the session company's own row plus the
derived registration and the root's journal-item lock, neither of which reads a root field; the write is the
root company's own row, which the root session is allowed to write, and the branches are updated by Odoo base's
root-delegated propagation rather than by LiwanOS code. `tools/arch_documented_sudo.json` therefore carries no
case for this addon.
