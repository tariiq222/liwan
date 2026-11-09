A new field `liwan.crm.settings.view_log_retention_months` (required, 1 to 60, default 12) states how long the
opportunity view log keeps an opening; a new daily cron `liwan_crm.ir_cron_view_log_prune` deletes older rows.
The field needs no backfill (the column arrives filled with its default), so the post script only prunes the log
once, and a company that already enabled the log stops growing an unbounded table. The log is now written by the
explicit `POST /api/v1/crm/opportunities/<id>/seen` route, never by the detail GET.
