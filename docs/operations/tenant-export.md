# Tenant data export: operator note

The export is built by the Odoo cron `Build the tenant data export` (every 2 minutes) and cleaned by the cron
`Expire tenant data exports` (hourly). Nothing here needs the control plane.

- **Where it writes:** `<filestore>/tenant_exports/<job id>-<random>/`, a plain directory tree, never an attachment. It
  does not count against the tenant's storage quota. The zip is streamed from this tree when the administrator downloads it.
- **Disk:** before a build starts it needs free space for every stored file of the tenant plus half the database size plus
  1 GiB. Below that the job fails with `insufficient_disk` and the requester gets a bell notice. Size the filestore volume for
  one finished export plus one running build. Only the latest finished export is kept; it is deleted 7 days after it finished.
- **Time limits:** each cron run does steps of at most 20,000 rows or 100 records' files, commits after every step and stops
  about 60 seconds in (or when `ir.cron` reports under 25 seconds left). The next run continues from the committed progress,
  so the default `limit_time_real_cron` is enough and no limit has to be raised. A step that raises is retried on the next
  run, three times, then the job fails with `build_failed` (the cron itself does not fail, so Odoo never deactivates it).
- **Rate limit:** one request per tenant per 24 hours; a failed build does not use the allowance.
- **Support:** a stuck job shows `steps_done` / `steps_total` in `GET /api/v1/admin/tenant-export`. A job older than 3 days
  fails with `timeout`. Leftover directories that no job refers to are removed by the expiry cron.
