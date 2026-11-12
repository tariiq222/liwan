# 19.0.1.20.0

`partner_id` of `liwan.inbox.contact` moves from `liwan_inbox_payments` to `liwan_inbox`, on the same column. The
`pre-` script gives the field's `ir_model_data` row and the `ir_model_constraint` row of its foreign key to
`liwan_inbox`, so the bridge's update does not delete the field and uninstalling the bridge never drops the column.
The `post-` script adopts the partners already linked to contacts as customers through
`liwan.customers.service._liwan_adopt` and logs how many were adopted and skipped.
