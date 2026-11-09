# Part of Odoo. See LICENSE file for full copyright and licensing details.
import logging
import re

# The requester's booking link, the payer's pay link and every other public tokenised route carry a secret in the request
# line, and werkzeug writes the whole line to its log at info level. A container log, a monitoring tool or a copy of them
# is shared between tenants, so these values must never reach it (#543).
#
# A query parameter is a secret when its name ends with one of these suffixes, whatever namespace or gateway it belongs
# to: `access_token` on `/book/...` and `/pay/...`, the `hub.verify_token` handshake, and a gateway's `hmac`.
SECRET_QUERY = re.compile(
    r'(?i)(?<=[?&;])([a-z0-9_.\-]*(?:token|signature|hmac|secret|password)|api_?key|key)=([^&\s"\']+)',
)
# A token that is a path segment: the public catalog image route names the item and then its own token.
SECRET_PATH = re.compile(r'(?i)(/api/v1/public/inbox/catalog/images/\d+/)([^/\s"\']+)')
QUERY_MASK = r'\1=***'
PATH_MASK = r'\1***'
LOGGERS = ('werkzeug',)


def mask_access_tokens(text):
    """``text`` with every secret query value and path token replaced by ``***``, so the route stays readable."""
    return SECRET_PATH.sub(PATH_MASK, SECRET_QUERY.sub(QUERY_MASK, text))


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
    """Install the masking filter once, when this addon is loaded, on every logger that writes a request line."""
    for name in LOGGERS:
        logger = logging.getLogger(name)
        if not any(isinstance(existing, AccessTokenLogFilter) for existing in logger.filters):
            logger.addFilter(AccessTokenLogFilter())
