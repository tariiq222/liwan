# Object storage engines installed

Version 19.0.1.15.0 adds the pinned OCA `fs_attachment_s3` module to `liwan_platform`'s `depends`, which pulls
`fs_attachment` and `fs_storage`. Odoo installs the three modules during the upgrade and they bring their own schema:
the `fs_storage` table and `fs.file.gc`, and the computed `fs_storage_id`, `fs_url` and `fs_storage_code` columns on
`ir_attachment` (added by `fs_attachment`'s `pre_init_hook`).

No LiwanOS data migration is needed. The new schema belongs to the OCA modules and the pin provides their current
version, so no upgrade script runs. With no `fs.storage` record configured, attachments keep the default filestore:
the modules change nothing about where existing files are stored or read until a storage record is created.
