# 19.0.1.28.0

New partial index on `liwan.inbox.message` (`create_date` where `direction = 'out'` and `external IS NOT TRUE`) that serves
the monthly outbound quota count. Odoo creates it on update; no data changes.
