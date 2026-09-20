# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import timedelta

from odoo import Command, api, fields, models
from odoo.exceptions import UserError
from odoo.tools import SQL


class DiscussChannel(models.Model):
    _inherit = 'discuss.channel'

    company_id = fields.Many2one(
        'res.company',
        index=True,
        ondelete='restrict',
        default=lambda self: self.env.company,
    )

    @api.model_create_multi
    def create(self, vals_list):
        company_id = self.env.company.id
        for vals in vals_list:
            vals.setdefault('company_id', company_id)
        return super().create(vals_list)

    @api.model
    def _get_or_create_chat(self, partners_to, pin=True):
        partners = (
            self.env['res.partner']
            .with_context(active_test=False)
            .search([('id', 'in', partners_to)])
        ) | self.env.user.partner_id
        if len(partners) > 2:
            raise UserError(self.env._(
                'A chat should not be created with more than 2 persons. Create a group instead.',
            ))
        self.flush_model()
        self.env['discuss.channel.member'].flush_model()
        self.env.cr.execute(SQL(
            """
            SELECT M.channel_id
            FROM discuss_channel C, discuss_channel_member M
            WHERE M.channel_id = C.id
                AND M.partner_id IN %(partner_ids)s
                AND C.channel_type LIKE 'chat'
                AND C.company_id = %(company_id)s
                AND NOT EXISTS (
                    SELECT 1
                    FROM discuss_channel_member M2
                    WHERE M2.channel_id = C.id
                        AND M2.partner_id NOT IN %(partner_ids)s
                )
            GROUP BY M.channel_id
            HAVING ARRAY_AGG(DISTINCT M.partner_id ORDER BY M.partner_id) = %(sorted_partner_ids)s
            LIMIT 1
            """,
            partner_ids=tuple(partners.ids),
            sorted_partner_ids=sorted(partners.ids),
            company_id=self.env.company.id,
        ))
        result = self.env.cr.dictfetchall()
        now = fields.Datetime.now()
        last_interest_dt = now - timedelta(seconds=1)
        if result:
            channel = self.browse(result[0].get('channel_id'))
            if pin:
                channel.self_member_id.write(
                    {'last_interest_dt': last_interest_dt, 'unpin_dt': False},
                )
            channel._broadcast(self.env.user.partner_id.ids)
            return channel
        channel = self.create({
            'channel_member_ids': [
                Command.create({
                    'last_interest_dt': last_interest_dt,
                    'partner_id': partner.id,
                    'unpin_dt': False if partner == self.env.user.partner_id else now,
                })
                for partner in partners
            ],
            'channel_type': 'chat',
            'last_interest_dt': last_interest_dt,
            'name': ', '.join(partners.mapped('name')),
            'company_id': self.env.company.id,
        })
        channel._broadcast(partners.ids)
        return channel
