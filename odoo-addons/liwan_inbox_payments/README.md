# liwan_inbox_payments

Bridge (rank 5, `auto_install` on `liwan_inbox` and `liwan_payments`) between the Customer Inbox and the shared
payments service. Feature `inbox.catalog`; capabilities `inbox.catalog.manage` (catalog, items, channel cart and
catalog button) and `inbox.orders.manage` (edit a cart, create the order, send the pay link, cancel).

- One `liwan.inbox.catalog` per WhatsApp business account: the tenant makes the catalog in Commerce Manager and
  pastes its id; LiwanOS checks it is a `commerce` catalog and optionally connects it to the account. The channel's
  system-user token is reused and needs `catalog_management` plus the catalog as an asset.
- `liwan.inbox.catalog.item` lists a `product.product`. Name, price and image stay on the product. A cron (every ten
  minutes, also triggered by saves) pushes pending items with `items_batch` (CREATE, UPDATE, DELETE), follows the
  batch, and reads Meta's review status. An unchanged payload (hash) is never resent. Prices include VAT by default.
- The public route `/api/v1/public/inbox/catalog/images/<item id>/<token>` serves the image Meta fetches.
- A customer's cart (an `order` message) becomes a `liwan.inbox.order`. Checkout creates the online order through
  `liwan.payments.service` at Odoo's prices and sends the pay link (a link button inside the 24-hour window, an
  approved template with one `<origin>/pay/order/{{1}}` button after it). The order number is kept on the inbox order
  because agents hold no right on sale orders. Payment and cancellation reach the conversation through the
  `_action_confirm` and `_action_cancel` overrides of `sale.order`.
- The paid notice (`paid_notice_enabled`, `paid_notice_text` on the channel) is sent only inside the window.
- Deleting a catalog is refused while any of its items is at Meta (or being sent or removed): unlist or delete the items
  and let the sync remove them first, so no item is left behind at Meta.
- An item changed while its batch is open keeps its state; once the batch settles it is resent if its data differs
  from what was pushed, and a removal (unlist or delete) is sent after the batch. A catalog manager changes only
  products made by the catalog editor (record rules on `product.template` and `product.product`).
- Without the `inbox.catalog` feature nothing is sent, synced or ingested as an order; carts stay stored messages.
