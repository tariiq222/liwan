# liwan_inbox_payments

Bridge (rank 5, `auto_install` on `liwan_inbox` and `liwan_payments`) between the Customer Messages and the shared
payments service. Feature `inbox.catalog`; capabilities `inbox.catalog.manage` (catalog, items, channel cart and
catalog button) and `inbox.orders.manage` (edit a cart, create the order, send the pay link, cancel).

- One `liwan.inbox.catalog` per WhatsApp business account: the tenant makes the catalog in Commerce Manager and
  pastes its id; LiwanOS checks it is a `commerce` catalog and optionally connects it to the account. The channel's
  system-user token is reused and needs `catalog_management` plus the catalog as an asset.
- `liwan.inbox.catalog.item` lists the one variant of a service product of `liwan.products.service`: an item is created
  from a product id of `/api/v1/products/pick` (404 for a non-service, archived or invisible product, 422 for one with
  several variants or no usable image). The catalog creates and edits no product; the manager role holds
  `products.manage` and `products.prices.manage` through `liwan_inbox`. Name, price and image stay on the product. A cron (every ten
  minutes, also triggered by saves) pushes pending items with `items_batch` (CREATE, UPDATE, DELETE), follows the
  batch, and reads Meta's review status. An unchanged payload (hash) is never resent. The price is the
  `amount_total` of the products service's price function for one unit in the catalog's company (`price`; `unit_price`
  is the price as typed): the company's stock tax mode decides whether the typed price carries the tax or has it added,
  and an establishment that is not registered for VAT charges none. `inbox.catalog.manage` is a
  registered pick capability and `inbox.conversations.read` a registered price capability, because every screen showing
  an item's price reads it through that function as the viewer; a reader prices an item and cannot browse or pick
  products. The registration is one decision for the establishment,
  stored on its root company; a catalog owned by a branch follows it through
  `res.company.liwan_establishment_vat_registered`.
- A change of the registration (`liwan_vat_registered`, written on a root) or of the price mode
  (`account_price_include`) marks the synced, listed items of the whole establishment pending and asks their catalogs to
  sync: `res.company.write` compares the old and new values of the companies it writes and calls
  `liwan.inbox.catalog.item._liwan_establishment_price_changed`, one SQL update keyed by the item's stored
  `establishment_id` (the root of its catalog's company), so branch-owned catalogs follow a root change and no company
  record the writer cannot read is touched. The push still compares payload hashes: an item whose price did not change
  is not sent. Upgrading to 19.0.1.3.0 marks every synced item once (`migrations/19.0.1.3.0`), because the way a price is
  computed changed.
- The public route `/api/v1/public/inbox/catalog/images/<item id>/<token>` serves the image Meta fetches.
- A customer's cart (an `order` message) becomes a `liwan.inbox.order`. Checkout creates the online order through
  `liwan.payments.service` at Odoo's prices and sends the pay link (a link button inside the 24-hour window, an
  approved template with one `<origin>/pay/order/{{1}}` button after it). The order number is kept on the inbox order
  because agents hold no right on sale orders. Payment and cancellation reach the conversation through the
  `_action_confirm` and `_action_cancel` overrides of `sale.order`.
- The order is placed for the contact's customer (`partner_id` on `liwan.inbox.contact`, owned by `liwan_inbox`). An
  unlinked contact is resolved by `liwan.customers.service` as the agent: with no customer of the same phone one is
  created from the contact's name and phone and linked; with candidates the checkout answers 409 `conflict` with
  `details.candidates` (id, name, last four digits) until the body names `customer_id` or sets `create_new`. The
  orders capability group implies `liwan_customers.group_customers_party_writer` and is registered as a pick
  capability; no other partner right is granted.
- The paid notice (`paid_notice_enabled`, `paid_notice_text` on the channel) is sent only inside the window.
- Deleting a catalog is refused while any of its items is at Meta (or being sent or removed): unlist or delete the items
  and let the sync remove them first, so no item is left behind at Meta.
- An item changed while its batch is open keeps its state; once the batch settles it is resent if its data differs
  from what was pushed, and a removal (unlist or delete) is sent after the batch.
- Without the `inbox.catalog` feature nothing is sent, synced or ingested as an order; carts stay stored messages.
