# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The link "ticket raised from conversation" moves from the conversation to the ticket (one open ticket at a time).

Runs before the models load: it creates the ticket's column, carries every existing link and drops the conversation's
old column, so the new field finds its data and no remnant stays behind.
"""
from odoo.tools.sql import column_exists, create_column

CONVERSATION = 'liwan_inbox_conversation'
OLD_COLUMN = 'helpdesk_ticket_id'


def migrate(cr, version):
    if not version or not column_exists(cr, CONVERSATION, OLD_COLUMN):
        return
    cr.execute(f"""
        SELECT ARRAY_AGG(id ORDER BY id) FROM {CONVERSATION}
         WHERE {OLD_COLUMN} IS NOT NULL GROUP BY {OLD_COLUMN} HAVING COUNT(*) > 1
    """)
    shared = cr.fetchall()
    if shared:
        raise ValueError(
            'conversations %s point at one ticket each; a ticket belongs to one conversation, so give every '
            'ticket one of them before upgrading liwan_helpdesk_inbox' % [ids for (ids,) in shared],
        )
    if not column_exists(cr, 'helpdesk_ticket', 'liwan_conversation_id'):
        create_column(cr, 'helpdesk_ticket', 'liwan_conversation_id', 'int4')
    cr.execute(f"""
        UPDATE helpdesk_ticket ticket SET liwan_conversation_id = conversation.id
          FROM {CONVERSATION} conversation
         WHERE conversation.{OLD_COLUMN} = ticket.id AND ticket.liwan_conversation_id IS NULL
    """)
    cr.execute(f'ALTER TABLE {CONVERSATION} DROP COLUMN {OLD_COLUMN}')
