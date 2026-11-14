# liwan_inbox_payments

Bridge (rank 5, `auto_install` on `liwan_inbox` and `liwan_payments`) between the Customer Messages and the shared
payments service. Feature `inbox.catalog`; capabilities `inbox.catalog.manage` (catalog, items, channel cart and
catalog button) and `inbox.orders.manage` (edit a cart, create the order, send the pay link, cancel).

- One `liwan.inbox.catalog` per WhatsApp business account: the tenant makes the catalog in Commerce Manager and
  pastes its id; LiwanOS checks it is a `commerce` catalog and optionally connects it to the account. The channel's
  system-user token is reused and needs `catalog_management` plus the catalog as an asset.
- `liwan.inbox.catalog.item` lists a `product.product`. Name, price and image stay on the product. A cron (every ten
  minutes, also triggered by saves) pushes pending items with `items_batch` (CREATE, UPDATE, DELETE), follows the
  batch, and reads Meta's review status. An unchanged payload (hash) is never resent. The price is the total the
  customer pays: the company's stock tax mode decides whether the typed price carries the tax or has it added, and an
  establishment that is not registered for VAT charges none. The registration is one decision for the establishment,
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
- Known gap (plan decision D24, fixed in PR 2): the item API, read in a session of a branch only, prices a tax that its
  root owns without it (that session cannot read the tax), while the sync prices it with it. The sync's price is the
  one Meta shows.
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
  from what was pushed, and a removal (unlist or delete) is sent after the batch. A catalog manager changes only
  products made by the catalog editor (record rules on `product.template` and `product.product`).
- Without the `inbox.catalog` feature nothing is sent, synced or ingested as an order; carts stay stored messages.
