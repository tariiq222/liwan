# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Run the scheduled jobs of the e2e scratch database once, on demand.

The scratch stack starts Odoo with ``max_cron_threads = 0``, so reminders,
overdue digests and auto tier validation never run by themselves. Scenarios
that depend on them trigger the jobs explicitly:

    E2E_CRONS=webvue_meetings.ir_cron_webvue_meeting_reminders \\
        odoo-bin shell -c <scratch conf> -d webvue_scratch_e2e --no-http < tools/e2e_cron.py

``E2E_CRONS`` is a comma-separated list of cron XML ids; without it every job in
CRONS runs. Each job runs as it would from the scheduler (``method_direct_trigger``).
"""
import os

DB_GUARD = 'webvue_scratch_e2e'
CRONS = (
    'webvue_pmo.ir_cron_webvue_deadline_notifications',
    'webvue_meetings.ir_cron_webvue_meeting_reminders',
    'base_tier_validation.ir_cron_auto_tier_validation',
)

if env.cr.dbname != DB_GUARD:  # noqa: F821
    raise SystemExit(f'e2e_cron refuses database {env.cr.dbname!r}; only {DB_GUARD} is allowed')  # noqa: F821

selected = [xmlid.strip() for xmlid in os.environ.get('E2E_CRONS', '').split(',') if xmlid.strip()] or list(CRONS)
for xmlid in selected:
    env.ref(xmlid).method_direct_trigger()  # noqa: F821
    env.cr.commit()  # noqa: F821
    print('e2e cron ran:', xmlid)  # noqa: T201
