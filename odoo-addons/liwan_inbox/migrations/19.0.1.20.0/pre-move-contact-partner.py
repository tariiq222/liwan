# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""``partner_id`` of ``liwan.inbox.contact`` moves from liwan_inbox_payments to liwan_inbox."""

FIELD_XMLID = 'field_liwan_inbox_contact__partner_id'
FOREIGN_KEY = 'liwan_inbox_contact_partner_id_fkey'
SOURCE = 'liwan_inbox_payments'
TARGET = 'liwan_inbox'


def migrate(cr, version):
    """Give the field's external id and the reflection of its foreign key to liwan_inbox.

    Left with the bridge, the bridge's update would find the field missing from its own definitions, and uninstalling
    the bridge would drop the column and its key. A row liwan_inbox already holds wins over the bridge's.
    """
    if not version:
        return
    names = {'source': SOURCE, 'target': TARGET, 'xmlid': FIELD_XMLID, 'key': FOREIGN_KEY}
    cr.execute("""
        DELETE FROM ir_model_data source
         WHERE source.module = %(source)s AND source.model = 'ir.model.fields' AND source.name = %(xmlid)s
           AND EXISTS (SELECT 1 FROM ir_model_data target WHERE target.module = %(target)s AND target.name = source.name)
    """, names)
    cr.execute("""
        UPDATE ir_model_data SET module = %(target)s
         WHERE module = %(source)s AND model = 'ir.model.fields' AND name = %(xmlid)s
    """, names)
    cr.execute("""
        DELETE FROM ir_model_constraint source
         WHERE source.name = %(key)s AND source.type = 'f'
           AND source.module = (SELECT id FROM ir_module_module WHERE name = %(source)s)
           AND EXISTS (
               SELECT 1 FROM ir_model_constraint target
                WHERE target.name = source.name AND target.module = (SELECT id FROM ir_module_module WHERE name = %(target)s)
           )
    """, names)
    cr.execute("""
        UPDATE ir_model_constraint SET module = (SELECT id FROM ir_module_module WHERE name = %(target)s)
         WHERE name = %(key)s AND type = 'f' AND module = (SELECT id FROM ir_module_module WHERE name = %(source)s)
    """, names)
