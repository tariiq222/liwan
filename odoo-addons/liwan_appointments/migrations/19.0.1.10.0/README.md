# 19.0.1.10.0

The bridge `liwan_appointments_payments` is folded into this application: the online payment of a booking type, the
online order that holds a booking of a paying type, and the payment routes now live here, and the application depends on
`liwan_payments` and `sale_resource_booking`. The bridge owned no data record (no data or security file), so no xml id is
handed over; `liwan_api` forgets the module (`forget_removed_addons`).

`end-adopt-booking-products.py` adopts the products that sell booking types (`liwan.products.service._liwan_adopt`),
the step the bridge ran in its own 19.0.1.1.0. A database still at the bridge's earlier version has not run it, so it
is carried here; it is idempotent and a no-op where every product is already adopted. It is an `end-` script so that
the tax bridge `liwan_products_account`, which extends `_liwan_adopt` to normalise the taxes, is loaded first. Every
booking type keeps its product link.

The products of branch booking types become shared: adoption clears their company, so a branch manager manages them
from the root company (D23) under the `establishment` sharing, not from the branch.

A custom role (one that is not the built-in appointments manager) loses pricing and linking of a booking type's
product until it is given `products.read`, `products.manage` and `products.prices.manage`: the payment route creates,
prices and links the product through `liwan.products.service` as the caller, so the appointments capability alone
does not do it.
