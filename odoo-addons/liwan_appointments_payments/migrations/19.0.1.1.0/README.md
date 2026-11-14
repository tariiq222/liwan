# Migration 19.0.1.1.0

`end-adopt-booking-products.py` adopts the products that sell booking types (`liwan.products.service._liwan_adopt`).
It is an `end-` script so that the tax bridge `liwan_products_account`, which extends `_liwan_adopt` to normalise the
taxes, is loaded first. Every booking type keeps its product link and the script is idempotent.
