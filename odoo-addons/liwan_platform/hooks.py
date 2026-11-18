# Part of Odoo. See LICENSE file for full copyright and licensing details.
import logging

from .error_reporting import init_error_reporting
from .secret_mask import mask_access_tokens

LOGGERS = ('werkzeug',)


class AccessTokenLogFilter(logging.Filter):
    """Mask secret query values in a werkzeug request line before any handler writes it.

    werkzeug logs ``'"%s" %s %s'`` with the path as a formatted argument, so the record's message and its argument tuple
    are both masked; a record that already carries a formatted string is masked as it is.
    """

    def filter(self, record):
        if isinstance(record.msg, str):
            record.msg = mask_access_tokens(record.msg)
        if record.args:
            if isinstance(record.args, dict):
                record.args = {key: mask_access_tokens(value) if isinstance(value, str) else value for key, value in record.args.items()}
            else:
                record.args = tuple(mask_access_tokens(value) if isinstance(value, str) else value for value in record.args)
        return True


def post_load():
    """Install the masking filter once, when this addon is loaded, on every logger that writes a request line.

    Error reporting starts here too, and only when ``LIWAN_SENTRY_DSN`` is set.
    """
    for name in LOGGERS:
        logger = logging.getLogger(name)
        if not any(isinstance(existing, AccessTokenLogFilter) for existing in logger.filters):
            logger.addFilter(AccessTokenLogFilter())
    init_error_reporting()


def post_init_hook(env):
    env['liwan.tenant.profile']._liwan_ensure_root_company()._liwan_apply_accounting_baseline()
    env['liwan.entitlement.service']._liwan_recount_storage()
