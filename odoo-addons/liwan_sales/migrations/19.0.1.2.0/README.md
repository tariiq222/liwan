# 19.0.1.2.0

The bridge `liwan_sales_payments` is folded into this application: the online payment of a quotation (the choice "pay to
confirm" and its tenant default, the customer's pay state, the confirmation by payment and the refund route
`POST /api/v1/sales/orders/{id}/refunds`) now lives here, and the application depends on `liwan_payments`.

The bridge owned no data record (no data, security or migration file), so no xml id is handed over. Its columns
(`liwan_sales_settings.payment_to_confirm` and `prepayment_percent`) and the stock fields it read (`require_payment`,
`prepayment_percent` of `sale.order`) keep their names, types and values, and so do the route paths, the feature and
capability keys and the wire shapes: nothing is migrated. Odoo reflects the two settings fields and the percentage
constraint under this module on the first upgrade; `liwan_api` forgets the removed module (`forget_removed_addons`).
