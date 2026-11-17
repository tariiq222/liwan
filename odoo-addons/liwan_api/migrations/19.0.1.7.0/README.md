# 19.0.1.7.0

`end-forget_removed_addons.py` forgets the six bridges folded into their applications (`liwan_access_hr`,
`liwan_documents_hr`, `liwan_hr_operations`, `liwan_documents_pmo`, `liwan_inbox_payments`,
`liwan_appointments_payments`) through `forget_removed_addons` in `liwan_api/models/removed_addons.py`: the module rows
and their xml ids go, no record is deleted. The applications took over the xml ids in their own `pre` migrations.
A database already at 19.0.1.6.0 never ran the script when it sat in that version, hence the new one.
