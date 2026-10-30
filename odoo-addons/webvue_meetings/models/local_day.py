# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields

# WebVue's market default (the Saudi work-week calendar and the inbox use the same zone);
# only reached when neither the user nor the company partner names a timezone.
DEFAULT_TIMEZONE = 'Asia/Riyadh'


def local_datetime(user, company, value):
    """``value`` (naive UTC) in the user's timezone, else the company's, else ``DEFAULT_TIMEZONE``.

    Odoo's own ``context_timestamp`` falls back to UTC for a user without a ``tz``,
    which puts a 00:55 Riyadh meeting on the previous calendar day.
    """
    zone = user.tz or company.partner_id.tz or DEFAULT_TIMEZONE
    return fields.Datetime.context_timestamp(user.with_context(tz=zone), fields.Datetime.to_datetime(value))
