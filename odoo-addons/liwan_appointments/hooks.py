# Part of Odoo. See LICENSE file for full copyright and licensing details.
import logging
import re

# The requester's booking link carries its access token in the query string, and werkzeug's request line is written to the
# `werkzeug` logger at info level with the whole path. A container log, a monitoring tool or a copy of them is shared
# between tenants, so the token must never reach it (#543). Every query value of a token parameter is masked here, under
# whatever name the public namespace uses.
SECRET_QUERY = re.compile(r'(?i)\b(access_token|token)=([^&\s"\']+)')
MASK = r'\1=***'
LOGGERS = ('werkzeug',)


def mask_access_tokens(text):
    """``text`` with every token query value replaced by ``***``, so the path and the rest of the line stay readable."""
    return SECRET_QUERY.sub(MASK, text)


class AccessTokenLogFilter(logging.Filter):
    """Mask token query values in a werkzeug request line before any handler writes it.

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
    """Install the masking filter once, when this addon is loaded, on every logger that writes a request line."""
    for name in LOGGERS:
        logger = logging.getLogger(name)
        if not any(isinstance(existing, AccessTokenLogFilter) for existing in logger.filters):
            logger.addFilter(AccessTokenLogFilter())
