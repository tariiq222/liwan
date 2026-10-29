# Part of Odoo. See LICENSE file for full copyright and licensing details.


def migrate(cr, version):
    """Templates stored before the structure existed have no header, examples or buttons: unsupported until the next sync."""
    if not version:
        return
    cr.execute('UPDATE webvue_inbox_template SET supported = false')
