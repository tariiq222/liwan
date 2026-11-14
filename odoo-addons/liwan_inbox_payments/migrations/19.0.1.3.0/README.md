# Migration 19.0.1.3.0

- `liwan.inbox.catalog.prices_include_tax` is removed: a catalog item now shows the total the customer pays, under the
  establishment's one stock tax mode (`res.company.account_price_include`). The stored values have no successor, so no
  data moves; `post-drop-prices-include-tax.py` drops the column Odoo leaves behind when a field goes. The serializer no
  longer returns the key, and a create or patch carrying it is refused like any other unknown field.
- `liwan.inbox.catalog.item.establishment_id` is a new stored field (the root company of the catalog's company); Odoo
  fills it for the existing items when the module updates.
- `post-resend-synced-prices.py` marks every listed, active, synced item pending and asks its catalog to sync once: a
  branch row stored its own VAT registration before (default false), so a branch catalog of a registered establishment was
  priced untaxed, and the removed per-catalog option changed the other prices. The push compares hashes, so an item whose
  price is unchanged settles without a request to Meta.
