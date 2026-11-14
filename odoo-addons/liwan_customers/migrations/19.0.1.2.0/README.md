# 19.0.1.2.0

New models `liwan.customers.privacy.request` (the log of privacy requests) and `liwan.customers.privacy.token` (the single-use erase token), created by Odoo's update with its ACL rows, a company record rule and the two privacy capabilities with their groups. No existing table or value changes. The
capability repair hook links `customers.erase` and `customers.privacy.export` to the built-in system administrator
role; they are not available to custom roles.
