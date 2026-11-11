# Part of Odoo. See LICENSE file for full copyright and licensing details.
import logging

_logger = logging.getLogger(__name__)

# A cron run stops this many seconds before its deadline, so the item it is running has time to finish and commit.
CRON_MARGIN_SECONDS = 5


def attempt(env, work):
    """Run `work()` in its own savepoint; the exception it raised (its writes undone), or None on success."""
    try:
        with env.cr.savepoint():
            work()
    except Exception as error:  # noqa: BLE001 - any failure of one item must not block the rest of the batch
        return error
    return None


def _report_failure(env, record, error, record_failure):
    """Run the failure report in its own savepoint: a failing report must not stop the rest of the batch."""
    report_error = attempt(env, lambda: record_failure(record, error))
    if report_error:
        _logger.warning('%s %s failure report failed: %s', record._name, record.id, type(report_error).__name__)


def process_each(records, work, record_failure, prepare=None):
    """Run `work(record)` for each record of a cron batch, committing after every one.

    The commit keeps an earlier success (a message already sent) when a later item fails, and keeps
    a failure counter when the item's own work rolls back. Any exception becomes `record_failure(record, error)`
    after the item's savepoint is undone, so one bad item never blocks the queue. Only the exception type
    and the record id are logged: provider responses and secrets stay out of the log.

    `prepare(record)` runs in its own savepoint before the item's savepoint and its write is committed at once, so a
    durable marker of the attempt survives the rollback of a failed item; it must write that marker only. A record
    whose preparation fails (it is gone) is reported through `record_failure` and skipped, never sent.

    The run stops when the cron's remaining time is shorter than `CRON_MARGIN_SECONDS`, leaving the rest of
    the batch to the next run. Outside a cron the remaining time is infinite, so every record is processed.
    Returns True when the batch was drained, False when the time budget ended first.
    """
    cron = records.env['ir.cron']
    remaining_time = cron._commit_progress(remaining=len(records))
    for record in records:
        if remaining_time < CRON_MARGIN_SECONDS:
            return False
        if prepare:
            error = attempt(records.env, lambda record=record: prepare(record))
            if error:
                # The marker could not be written (the record is gone): nothing is sent for it.
                _logger.warning('%s %s could not be prepared: %s', record._name, record.id, type(error).__name__)
                _report_failure(records.env, record, error, record_failure)
                remaining_time = cron._commit_progress(1)
                continue
            remaining_time = cron._commit_progress(0)
        error = attempt(records.env, lambda record=record: work(record))
        if error:
            _logger.warning('%s %s failed: %s', record._name, record.id, type(error).__name__)
            _report_failure(records.env, record, error, record_failure)
        remaining_time = cron._commit_progress(1)
    return True
