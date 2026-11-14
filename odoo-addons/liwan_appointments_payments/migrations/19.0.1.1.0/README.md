# Migration 19.0.1.1.0

`end-adopt-booking-products.py` adopts the products that sell booking types (`liwan.products.service._liwan_adopt`).
It is an `end-` script so that the tax bridge `liwan_products_account`, which extends `_liwan_adopt` to normalise the
taxes, is loaded first. Every booking type keeps its product link and the script is idempotent.

The products of branch booking types become shared: adoption clears their company, so a branch manager manages them
from the root company (D23) under the `establishment` sharing, not from the branch.

A custom role (one that is not the built-in appointments manager) loses pricing and linking of a booking type's
product until it is given `products.read`, `products.manage` and `products.prices.manage`: the payment route now
creates, prices and links the product through `liwan.products.service` as the caller, so the appointments capability
alone no longer does it.
