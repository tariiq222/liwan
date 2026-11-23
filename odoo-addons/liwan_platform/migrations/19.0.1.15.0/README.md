# Object storage engines installed

Version 19.0.1.15.0 adds the pinned OCA `fs_attachment_s3` module to `liwan_platform`'s `depends`, which pulls
`fs_attachment` and `fs_storage`, and the stock `base_sparse_field` module through `fs_storage`. Odoo installs them
during the upgrade and they bring their own schema: the `fs_storage`, `fs.file.gc` and `fs_test_connection` tables;
the `storage_id` column on `ir_model` and `ir_model_fields`; and on `ir_attachment` the stored `fs_filename` column
plus the computed `fs_storage_id`, `fs_url` and `fs_storage_code` columns (the computed columns are added by
`fs_attachment`'s `pre_init_hook`).

No LiwanOS data migration is needed. The new schema belongs to the OCA modules and the pin provides their current
version, so no upgrade script runs. With no `fs.storage` record configured, attachments keep the default filestore:
the modules change nothing about where existing files are stored or read until a storage record is created.
