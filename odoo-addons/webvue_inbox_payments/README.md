# webvue_inbox_payments

Bridge (rank 5, `auto_install` on `webvue_inbox` and `webvue_payments`) between the Customer Inbox and the shared
payments service. Feature `inbox.catalog`; capabilities `inbox.catalog.manage` (catalog, items, channel cart and
catalog button) and `inbox.orders.manage` (edit a cart, create the order, send the pay link, cancel).

- One `webvue.inbox.catalog` per WhatsApp business account: the tenant makes the catalog in Commerce Manager and
  pastes its id; WebVue checks it is a `commerce` catalog and optionally connects it to the account. The channel's
  system-user token is reused and needs `catalog_management` plus the catalog as an asset.
- `webvue.inbox.catalog.item` lists a `product.product`. Name, price and image stay on the product. A cron (every ten
  minutes, also triggered by saves) pushes pending items with `items_batch` (CREATE, UPDATE, DELETE), follows the
  batch, and reads Meta's review status. An unchanged payload (hash) is never resent. Prices include VAT by default.
- The public route `/api/v1/public/inbox/catalog/images/<item id>/<token>` serves the image Meta fetches.
- A customer's cart (an `order` message) becomes a `webvue.inbox.order`. Checkout creates the online order through
  `webvue.payments.service` at Odoo's prices and sends the pay link (a link button inside the 24-hour window, an
  approved template with one `<origin>/pay/order/{{1}}` button after it). The order number is kept on the inbox order
  because agents hold no right on sale orders. Payment and cancellation reach the conversation through the
  `_action_confirm` and `_action_cancel` overrides of `sale.order`.
- The paid notice (`paid_notice_enabled`, `paid_notice_text` on the channel) is sent only inside the window.
