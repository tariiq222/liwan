# Part of Odoo. See LICENSE file for full copyright and licensing details.


def post_init_hook(env):
    """A new database limits ``From`` to the platform domain before any tenant domain exists."""
    env['liwan.mail.domain']._liwan_write_from_filter()
