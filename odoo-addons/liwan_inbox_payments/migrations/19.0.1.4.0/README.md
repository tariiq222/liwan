# Migration 19.0.1.4.0

The catalog editor no longer creates or edits products: a catalog item lists a product of the shared products service,
and `product.template.liwan_inbox_catalog` is removed together with its two access rows and two record rules.
`end-adopt-catalog-products.py` makes every product a catalog item names (archived items included) and every product
the marker flagged a service product through `liwan.products.service._liwan_adopt` (marked, company cleared, taxes
valid), keeps every item's `product_id`, and drops the marker column. It runs as an `end-` script so that the tax bridge
is loaded. Items of products whose taxes changed are queued for resync by the existing write override.

`pre-drop-catalog-product-rules.py` deletes the two record rules on `liwan_inbox_catalog` by external id before the
module loads. Odoo removes records that left the data only at the end of the upgrade (`ir.model.data._process_end`),
after the `post-` scripts and the at-install tests of the modules loaded in between; until then a catalog manager
writing or creating on `product.template` (the rules have no read permission) would evaluate a domain on a field that is gone from the registry.
