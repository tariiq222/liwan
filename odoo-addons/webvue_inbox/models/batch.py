# Part of Odoo. See LICENSE file for full copyright and licensing details.
import logging

_logger = logging.getLogger(__name__)


def process_each(records, work, record_failure):
    """Run `work(record)` for each record of a cron batch, committing after every one.

    The commit keeps an earlier success (a message already sent) when a later item fails, and keeps
    a failure counter when the item's own work rolls back. Any exception becomes `record_failure(record, error)`
    after the item's savepoint is undone, so one bad item never blocks the queue. Only the exception type
    and the record id are logged: provider responses and secrets stay out of the log.
    """
    cron = records.env['ir.cron']
    cron._commit_progress(remaining=len(records))
    for record in records:
        try:
            with records.env.cr.savepoint():
                work(record)
        except Exception as error:  # noqa: BLE001 - any failure of one item must not block the rest of the batch
            _logger.warning('%s %s failed: %s', record._name, record.id, type(error).__name__)
            record_failure(record, error)
        cron._commit_progress(1)
