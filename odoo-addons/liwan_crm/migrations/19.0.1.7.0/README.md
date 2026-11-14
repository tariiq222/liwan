# Migration 19.0.1.7.0

CRM packages are products of the shared products service, offered per company through `package_ids` of the CRM
settings. `end-packages-to-products.py` adopts every product the removed marker `liwan_crm_package` flagged and every
product an opportunity names (`liwan.products.service._liwan_adopt`), records each company's packages in its settings,
and drops the marker column. It is an `end-` script so that the tax bridge `liwan_products_account`, which extends
`_liwan_adopt` to normalise the taxes, is loaded first. The marker is read and dropped with SQL and the script runs
only while the column exists, so a rerun repeats idempotent steps and the column goes exactly once, last.
