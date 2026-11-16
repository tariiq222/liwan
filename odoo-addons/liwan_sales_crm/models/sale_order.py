# Part of Odoo. See LICENSE file for full copyright and licensing details.
import logging

import psycopg2

from odoo import fields, models
from odoo.exceptions import MissingError, UserError

from .sales_settings import FEATURE as CRM_FEATURE
from odoo.addons.liwan_crm.models.visibility import READ_CAPABILITY

_logger = logging.getLogger(__name__)
QUIET = {'mail_auto_subscribe_no_notify': True}
# What the CRM side can refuse for a reason of its own (validation, constraint, access, a missing record or stage). Anything
# else is a programming error and is not caught.
EXPECTED_FAILURES = (UserError, MissingError, psycopg2.Error)
CLOSED_NOTE = 'Order %s was confirmed, but this opportunity is %s, so it was not won.'
LEFT_NOTE = 'Order %s is no longer confirmed. The opportunity stays won, and its amount is now %s.'
LEFT_ALL_NOTE = 'Order %s is no longer confirmed and no confirmed order remains. The opportunity stays won, and its amount is now 0.'
NOT_WON_NOTE = 'The opportunity was not updated for this order, and the order is unaffected: %s'


class SaleOrder(models.Model):
    _inherit = 'sale.order'

    # The opportunity a staff quotation was made from, set once by the bridge's create route. Deleting the opportunity
    # leaves the order. Stock `sale_crm` installs beside Sales and CRM with its own `opportunity_id`, which nothing here ever sets, so its
    # confirm hook finds no opportunity and does nothing; its revenue update would otherwise double ours.
    liwan_lead_id = fields.Many2one(
        'crm.lead', string='Opportunity', ondelete='set null', index='btree_not_null', copy=False, readonly=True,
    )

    def _liwan_readable_lead(self, user):
        """The opportunity of this order when ``user`` reads it in CRM now (CRM is in the plan, they hold
        ``crm.leads.read`` in the working company and the visibility setting shows it to them), else no record."""
        self.ensure_one()
        Lead = self.env['crm.lead']
        visibility = self.env['liwan.crm.visibility']
        if not (
            self.liwan_lead_id and self.env['liwan.entitlement.service']._liwan_feature_read(CRM_FEATURE)
            and READ_CAPABILITY in visibility._liwan_keys(user, self.env.company)
        ):
            return Lead
        return Lead.with_context(active_test=False).search(
            [('id', '=', self.liwan_lead_id.id), *visibility._liwan_domain(user)], limit=1,
        )

    def _liwan_staff_extras(self, user):
        extras = super()._liwan_staff_extras(user)
        lead = self._liwan_readable_lead(user)
        opportunity = {
            'id': lead.id, 'contact_name': lead.contact_name or '', 'status': lead.won_status, 'active': lead.active,
        } if lead else None
        return {**extras, 'opportunity': opportunity}

    def write(self, vals):
        """Follow the opportunity of every order whose confirmed state this write changes.

        Every way an order enters or leaves ``sale`` ends in a write of ``state`` (Sales' staff confirm and cancel, the
        customer's acceptance and decline, a payment's confirmation, the unpaid-order expiry, a reopen), so the one hook sees
        them all, whichever method stock or another application called.
        """
        if 'state' not in vals:
            return super().write(vals)
        linked = self.filtered('liwan_lead_id')
        before = {order.id: order.state == 'sale' for order in linked}
        result = super().write(vals)
        for lead in linked.liwan_lead_id:
            changed = linked.filtered(lambda order, lead=lead: order.liwan_lead_id == lead and (order.state == 'sale') != before[order.id])
            if changed:
                changed._liwan_follow_opportunity()
        return result

    def _liwan_closing_lead(self):
        """The opportunity of this order in an elevated environment authored by the system user, or no record.

        The confirmer is a member of Sales staff, the customer by their access token or a payment callback, and none of them
        holds a write on an opportunity (the linker was checked when the link was made). The win, its tracking and its notes
        belong to the system, never to the public user's partner.
        """
        self.ensure_one()
        return self.liwan_lead_id.sudo().with_user(self.env.ref('base.user_root')).with_context(**QUIET).with_company(self.company_id)

    def _liwan_won_amount(self, lead):
        """What ``lead`` is won for: its confirmed orders summed in the company's currency, untaxed or taxed as the
        tenant chose. ``lead`` is in the elevated environment, which reads every order."""
        basis = lead.env['liwan.sales.settings']._liwan_current().opportunity_win_amount
        total = 0.0
        for order in lead.env['sale.order'].search([('liwan_lead_id', '=', lead.id), ('state', '=', 'sale')]):
            amount = order.amount_total if basis == 'total' else order.amount_untaxed
            total += order.currency_id._convert(
                amount, lead.company_currency, lead.company_id, order.date_order or fields.Date.context_today(self),
            )
        return lead.company_currency.round(total)

    def _liwan_follow_opportunity(self):
        """``self`` is orders of one opportunity whose confirmed state just changed: keep the opportunity's amount in step.

        Only while the tenant lets an order win and CRM can be written. The CRM side runs in a savepoint: when it refuses for
        a reason of its own the order is unaffected and says so in its chatter.
        """
        lead = self[0]._liwan_closing_lead()
        env = lead.env
        if env['liwan.sales.settings']._liwan_current().opportunity_win != 'order_confirmed' or not env['liwan.entitlement.service']._liwan_feature_write(CRM_FEATURE):
            return
        orders = env['sale.order'].browse(self.ids)
        try:
            with self.env.cr.savepoint():
                orders._liwan_apply_to_opportunity(lead)
        except EXPECTED_FAILURES as error:
            _logger.warning('opportunity %s not updated for orders %s: %s', lead.id, orders.mapped('name'), error)
            orders.message_post(body=NOT_WON_NOTE % str(error)[:300], subtype_xmlid='mail.mt_note')

    def _liwan_apply_to_opportunity(self, lead):
        """Win ``lead`` when an order of ``self`` entered the confirmed state, and give a won one the sum of its confirmed
        orders: a second order adds, an order that left (cancelled, declined, expired) drops out, and when none remains the
        amount is 0. The opportunity stays won: a person decides what it means. A lost or archived one stays as it is."""
        amount = self._liwan_won_amount(lead)
        entered = self.filtered(lambda order: order.state == 'sale')
        if entered:
            if not lead._liwan_win_with_amount(amount):
                # A lost opportunity is archived too, so the lost state is the one named.
                lead.message_post(
                    body=CLOSED_NOTE % (', '.join(entered.mapped('name')), 'lost' if lead.won_status == 'lost' else 'archived'),
                    subtype_xmlid='mail.mt_note',
                )
        elif lead.won_status == 'won':
            lead._liwan_win_with_amount(amount)
            names = ', '.join(self.mapped('name'))
            body = LEFT_NOTE % (names, amount) if amount else LEFT_ALL_NOTE % names
            lead.message_post(body=body, subtype_xmlid='mail.mt_note')
