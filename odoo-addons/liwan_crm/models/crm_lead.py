# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.tools import email_normalize

from odoo.addons.liwan_api.controllers.common import ApiError

NAME_MAX = 200
EMAIL_MAX = 254
# The engine field holding an opportunity's company-defined custom values
# (liwan_api.serializers.properties translates it to the `properties` wire shape).
PROPERTIES_FIELD = 'lead_properties'


class CrmLead(models.Model):
    _inherit = 'crm.lead'

    # Tracked per the spec: stage, agent, contact name, phone, email and lost reason are tracked by
    # stock crm; source, package, final price and discount are tracked here.
    source_id = fields.Many2one(tracking=True)
    liwan_package_id = fields.Many2one(
        'product.template', string='Package', index='btree_not_null', ondelete='restrict', tracking=True,
    )
    liwan_list_price = fields.Monetary(string='Package price', currency_field='company_currency')
    liwan_discount_percent = fields.Float(string='Discount (%)', tracking=True)
    liwan_final_price = fields.Monetary(string='Final price', currency_field='company_currency', tracking=True)
    # One source of truth: the expected revenue is the final price.
    expected_revenue = fields.Monetary(compute='_compute_expected_revenue', store=True, readonly=True)
    liwan_attempt_count = fields.Integer(string='Calls in this cycle', default=0, copy=False)
    liwan_next_call_at = fields.Datetime(string='Next call', index='btree_not_null', copy=False)
    liwan_cycle = fields.Integer(string='Recycle count', default=0, copy=False)
    liwan_recycle_at = fields.Datetime(string='Recycle on', index='btree_not_null', copy=False)
    liwan_needs_manager = fields.Boolean(string='Needs a manager decision', index=True, copy=False)
    liwan_import_batch_id = fields.Many2one(
        'liwan.crm.import.batch', string='Import batch', index='btree_not_null', ondelete='set null', copy=False,
    )
    # The custom fields the company defines for every opportunity of that company (Odoo's native
    # properties engine). The definition is a company record, so the fields are shared by the company
    # and not by a team; the engine reads the definition elevated, so an agent needs no extra ACL.
    lead_properties = fields.Properties(
        'Properties', definition='company_id.liwan_lead_properties_definition', copy=True,
    )

    # One phone per company: the existence check answers early; this index decides under concurrency.
    _liwan_phone_company_unique = models.UniqueIndex(
        '(company_id, phone_sanitized) WHERE phone_sanitized IS NOT NULL',
        'duplicate phone',
    )
    _liwan_discount_range = models.Constraint(
        'CHECK(liwan_discount_percent BETWEEN 0 AND 100)', 'the discount is between 0 and 100 percent',
    )
    _liwan_list_price_positive = models.Constraint(
        'CHECK(liwan_list_price >= 0)', 'the package price cannot be negative',
    )
    _liwan_final_price_positive = models.Constraint(
        'CHECK(liwan_final_price >= 0)', 'the final price cannot be negative',
    )

    @api.depends('liwan_final_price')
    def _compute_expected_revenue(self):
        for lead in self:
            lead.expected_revenue = lead.liwan_final_price

    @api.model
    def _liwan_is_duplicate_phone(self, error):
        """Whether a UniqueViolation ``error`` comes from the one-phone-per-company index."""
        return error.diag.constraint_name == type(self)._liwan_phone_company_unique.full_name(self)

    @api.model
    def _liwan_find_duplicate(self, phone_e164, company):
        """Whether any opportunity of ``company`` (open, won, lost or archived) has this phone.

        The answer is a boolean only: no record, id or agent leaves this method, because the
        matching opportunity may be hidden from the caller by the visibility policy.
        """
        return self.sudo().with_context(active_test=False).search_count(
            [('company_id', '=', company.id), ('phone_sanitized', '=', phone_e164)], limit=1,
        ) > 0

    def _inverse_email_from(self):
        """Stock copies a lead's edited email onto its partner. A customer's identity is written only by
        liwan.customers.service, never by a lead edit: the customer is left as it is. Replaces
        ``crm.lead._inverse_email_from``, the inverse of ``email_from`` (documented override, R9).

        Only this direction is cut. Stock still computes ``contact_name``, ``email_from`` and ``phone`` of a lead with a
        partner from that partner, so linking a lead to a customer sets them from the customer, and a later edit of the
        customer's email or phone rewrites them on the linked leads (its name does not: the contact name keeps the value
        copied at the link). Pinned in tests/test_crm_customer_link.py."""

    def _inverse_phone(self):
        """As ``_inverse_email_from``, for the phone: replaces ``crm.lead._inverse_phone``, the inverse of ``phone``.
        Without it a lead edit rewrites the phone of the customer it is linked to."""

    def _liwan_linked_customer(self):
        """The linked partner when it is an active party the caller sees, else no partner."""
        self.ensure_one()
        return self.env['liwan.customers.service']._liwan_visible_parties(self.partner_id)

    def _liwan_customer_values(self):
        """The identity of a new customer made from this lead: its contact name, phone and a valid email."""
        values = {'name': self.contact_name or self.name}
        if self.phone:
            values['phone'] = self.phone
        if self.email_from and email_normalize(self.email_from):
            values['email'] = self.email_from
        return values

    def _liwan_link_customer(self, customer_id=None, create_new=False):
        """Link this lead to a customer, through liwan.customers.service as the caller; return it.

        A lead linked to an active party the caller sees keeps it: naming another is 409 ``already_linked``. A lead
        linked to a customer the caller cannot see (another branch's) is 409 ``already_linked`` whatever is asked, and
        nothing about that customer is revealed; a link to an archived customer is dead and is replaced. Otherwise
        ``customer_id`` names an existing customer, ``create_new`` asks for a new one, and without either a customer is
        made from the lead's data unless customers with its phone exist, which answers 409 ``conflict`` with them. The
        service never merges on its own.
        """
        self.ensure_one()
        linked = self._liwan_linked_customer()
        if self.env['liwan.customers.service']._liwan_is_hidden(self.partner_id):
            raise ApiError(409, 'already_linked', 'the opportunity is already linked to a customer')
        if linked:
            if create_new or customer_id not in (None, linked.id):
                raise ApiError(409, 'already_linked', 'the opportunity is already linked to a customer')
            return linked
        values = None if customer_id is not None else self._liwan_customer_values()
        self.partner_id = self.env['liwan.customers.service']._liwan_resolve(
            customer_id=customer_id, values=values, create_new=create_new,
        )
        return self.partner_id
