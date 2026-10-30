# Part of Odoo. See LICENSE file for full copyright and licensing details.


def migrate(cr, version):
    """Template messages sent before `template_id` existed point at their synchronised template by channel, name and language."""
    if not version:
        return
    cr.execute(
        """
        UPDATE liwan_inbox_message message
           SET template_id = template.id
          FROM liwan_inbox_conversation conversation, liwan_inbox_template template
         WHERE message.template_id IS NULL
           AND message.template_name IS NOT NULL
           AND conversation.id = message.conversation_id
           AND template.channel_id = conversation.channel_id
           AND template.name = message.template_name
           AND template.language = message.template_language
        """,
    )
