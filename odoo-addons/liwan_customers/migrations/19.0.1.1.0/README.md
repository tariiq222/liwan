# 19.0.1.1.0

The customer settings gain `party_kinds`, a stored field with a default (`both`), so every tenant keeps its current
behavior and no data changes. Odoo's update creates the column itself. The new capability, its group, the two ACL
rows and the rule on the customer fields definition are data records the update loads; the capability repair hook
links the built-in roles. No customer value changes: custom field values start empty.
