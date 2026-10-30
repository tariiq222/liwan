# Part of Odoo. See LICENSE file for full copyright and licensing details.
import json

from odoo.addons.liwan_inbox.models.template import CATEGORY_NAMES, META_STATUS

# Templates were stored with Meta's upper-case words in free-text columns; they are now selections.
# The structure (header, examples, buttons) is filled by the next synchronisation with Meta.
UNKNOWN_CATEGORY = 'utility'
UNKNOWN_STATUS = 'disabled'


def migrate(cr, version):
    if not version:
        return
    cr.execute(
        "UPDATE liwan_inbox_template SET category = CASE WHEN lower(category) = ANY(%s) THEN lower(category) ELSE %s END",
        [sorted(CATEGORY_NAMES), UNKNOWN_CATEGORY],
    )
    cr.execute(
        "UPDATE liwan_inbox_template SET status = COALESCE(%s::jsonb ->> upper(status), %s)",
        [json.dumps(META_STATUS), UNKNOWN_STATUS],
    )
    cr.execute("ALTER TABLE liwan_inbox_template DROP COLUMN IF EXISTS param_count")
