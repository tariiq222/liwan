# 19.0.1.17.0 — VAT registration belongs to the establishment

`res.company.liwan_vat_registered` is now the root company's one decision per establishment. The new stored computed
field `res.company.liwan_establishment_vat_registered` carries that answer on every company of the establishment
(`parent_id.liwan_establishment_vat_registered`, else the company's own `liwan_vat_registered`), so a branch session
answers the establishment's value from its own record, without reading the root that the base
`res_company_rule_employee` forbids it. Odoo computes stored fields in superuser mode, so no LiwanOS `sudo()` is added.

`post-establishment-vat.py` clears every branch row that stored its own registration (through the ORM, one
transaction, idempotent) and raises — naming the branch and its root — when a branch was registered under an
unregistered root, because only the operator can choose the establishment's answer.

The VAT number (`vat`) is **not** kept equal to the root's in this version. Stock's `res.company.vat` is a non-stored
field of the company's partner, and Odoo creates that partner before it copies root-delegated company values, so the
stock delegation mechanism cannot copy it to a new branch; keeping it equal needs its own writer. It is still open in
plan D25 and reported, not done here.
