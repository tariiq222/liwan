# 19.0.1.8.0

A booking's requester is a customer (a party of `liwan_customers`) resolved through `liwan.customers.service`. The
`post-` script adopts the partners already attached to bookings through `_liwan_adopt` and logs how many were adopted
and skipped; a partner that is a user's or a company's partner stays as it is. The create-only ACL row on `res.partner`
is deleted with the module data update.
