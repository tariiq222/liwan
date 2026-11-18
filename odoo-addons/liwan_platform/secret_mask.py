# Part of Odoo. See LICENSE file for full copyright and licensing details.
import re

# The requester's booking link, the payer's pay link and every other public tokenised route carry a secret in the request
# line, and werkzeug writes the whole line to its log at info level. A container log, a monitoring tool or a copy of them
# is shared between tenants, so these values must never reach it (#543). The filter is a platform duty, installed for every
# database whether or not the application that owns a route is installed.
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


def mask_access_tokens(text):
    """``text`` with every secret query value and path token replaced by ``***``, so the route stays readable."""
    return SECRET_PATH.sub(PATH_MASK, SECRET_QUERY.sub(QUERY_MASK, text))
