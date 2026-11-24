# Storage orphan check tables

Version 19.0.1.16.0 adds the `liwan_storage_orphan_check` and `liwan_storage_orphan_object` tables and their
daily cron record. Both start empty on an existing database: the check is a report, so there is nothing to carry
forward, and the first cron run writes the first row. No data migration is needed.
