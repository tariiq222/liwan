# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import SUPERUSER_ID, api

CHUNK = 500


def first_by_conversation(Message, conversations, domain):
    """{conversation id: (earliest date, author id)} of the messages matching `domain`, grouped in the database."""
    groups = Message._read_group(
        [('conversation_id', 'in', conversations.ids), *domain], ['conversation_id', 'author_id'], ['date:min'],
    )
    first = {}
    for conversation, author, date in groups:
        if conversation.id not in first or date < first[conversation.id][0]:
            first[conversation.id] = (date, author.id)
    return first


def cycle_values(conversation, opened, replies):
    reply = replies.get(conversation.id)
    answered = reply and reply[0] >= opened
    ended = conversation.state in ('resolved', 'closed')
    return {
        'company_id': conversation.company_id.id, 'conversation_id': conversation.id, 'channel_id': conversation.channel_id.id,
        'department_id': conversation.department_id.id, 'opened_at': opened,
        'first_response_at': reply[0] if answered else False, 'responder_id': reply[1] if answered else False,
        'ended_at': conversation.last_message_at if ended else False, 'end_reason': conversation.state if ended else False,
        'resolver_id': conversation.assignee_id.id if ended else False,
        'csat_score': conversation.csat_score if ended else False, 'csat_at': conversation.csat_at if ended else False,
    }


def migrate(cr, version):
    """Conversations that exist before the cycles do get one cycle each (an approximation of their history), then the report days are built.

    Conversations are read in chunks and their messages only aggregated, never loaded. Running it twice changes nothing:
    a conversation with a cycle is skipped. The days rebuilt are the ones the retained conversations still back.
    """
    if not version:
        return
    env = api.Environment(cr, SUPERUSER_ID, {})
    Cycle, Message, Conversation = env['liwan.inbox.conversation.cycle'], env['liwan.inbox.message'], env['liwan.inbox.conversation']
    done = {conversation.id for conversation, in Cycle._read_group([], ['conversation_id'])}
    pending = sorted(set(Conversation.search([]).ids) - done)
    for start in range(0, len(pending), CHUNK):
        conversations = Conversation.browse(pending[start:start + CHUNK])
        opened = {cid: found[0] for cid, found in first_by_conversation(Message, conversations, [('direction', '=', 'in')]).items()}
        replies = first_by_conversation(
            Message, conversations, [('direction', '=', 'out'), ('author_id', '!=', False), ('automated', '=', False)],
        )
        Cycle.create([cycle_values(c, opened[c.id], replies) for c in conversations if c.id in opened])
        env.invalidate_all()
    Build = env['liwan.inbox.report.build']
    for company in env['res.company'].search([]):
        settings = env['liwan.inbox.settings']._get_for_company(company)
        today = Build._liwan_today(company)
        Build._liwan_rebuild(company, Build._liwan_backed_start(settings, today), today)
        settings.reports_built_timezone = settings.hours_timezone
