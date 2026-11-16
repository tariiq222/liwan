# 19.0.1.3.0

The customer settings gain `auto_link_single_match`, a stored boolean with a default (`false`), so every tenant keeps
its current behavior (staff confirm every first link of a conversation) and no data changes. Odoo's update creates the
column itself. It applies only to contacts that arrive after a tenant turns it on.
