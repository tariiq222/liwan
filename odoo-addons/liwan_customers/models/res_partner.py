# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import AccessError, ValidationError

from odoo.addons.liwan_core.models.protected_write import is_marked_write
from odoo.addons.liwan_core.models.res_partner import PARTNER_CREATE_MARKER

# liwan.customers.service marks the parties it writes; the fields it may write through the marker.
PARTY_MARKER = 'liwan_customers.party_partner_ids'
PARTY_WRITE_FIELDS = frozenset({'name', 'phone', 'email', 'is_company', 'parent_id', 'active', 'liwan_party'})
# A party's identity: only the service writes it. company_id decides who shares the party, and phone_sanitized is what
# the candidate search matches, so neither is written around the service either.
PARTY_IDENTITY_FIELDS = PARTY_WRITE_FIELDS | {'company_id', 'phone_sanitized'}
# liwan.customers.service marks the caller's uid while it creates a party: nobody else creates one.
PARTY_CREATE_MARKER = 'liwan_customers.party_create'
PARTY_WRITER_GROUP = 'liwan_customers.group_customers_party_writer'


def _refuse(operation, vals):
    """The stable machine-readable refusal of a party write or create outside liwan.customers.service."""
    msg = 'use_liwan_customers_service:res_partner_%s:%s' % (operation, ','.join(sorted(vals)))
    raise AccessError(msg)


class ResPartner(models.Model):
    _inherit = 'res.partner'

    # A commercial party (customer or vendor) created or adopted through liwan.customers.service, its contacts
    # included. Accounts and companies are never parties.
    liwan_party = fields.Boolean(index=True, copy=False)

    # The candidate search reads phone_sanitized: stock gives it no plain index.
    _liwan_phone_sanitized_index = models.Index('(phone_sanitized) WHERE phone_sanitized IS NOT NULL')

    @api.model
    def _liwan_marked_write_fields(self):
        return {**super()._liwan_marked_write_fields(), PARTY_MARKER: PARTY_WRITE_FIELDS}

    @api.model_create_multi
    def create(self, vals_list):
        if not self.env.is_superuser():
            markers = self.env.cr.precommit.data
            through_service = self.env.uid in markers.get(PARTY_CREATE_MARKER, set())
            if any(vals.get('liwan_party') for vals in vals_list) and not through_service:
                _refuse('create', {'liwan_party'})
            # core's protected account create grants the one contact of a new account through check_access.
            account_contact = self.env.uid in markers.get(PARTNER_CREATE_MARKER, set())
            if not (through_service or account_contact) and self._liwan_party_writer_only('create'):
                _refuse('create', set().union(*vals_list))
        return super().create(vals_list)

    def write(self, vals):
        if not self.env.is_superuser():
            if (
                PARTY_IDENTITY_FIELDS.intersection(vals)
                and not is_marked_write(self, PARTY_MARKER, PARTY_IDENTITY_FIELDS, vals)
                and ('liwan_party' in vals or any(self.mapped('liwan_party')))
            ):
                _refuse('write', vals)
            if not all(self.mapped('liwan_party')) and self._liwan_party_writer_only('write'):
                _refuse('write', vals)
        return super().write(vals)

    @api.model
    def _liwan_party_writer_only(self, operation):
        """Whether the caller may ``operation`` on res.partner only through the party writer group.

        Stock ``ir.model.access._get_access_groups`` gives the groups whose ACL rows grant the operation; the caller's
        groups (implied ones included) less the party writer are matched against them, read fresh on every call.
        """
        writer = self.env.ref(PARTY_WRITER_GROUP, raise_if_not_found=False)
        groups = set(self.env.user._get_group_ids())
        if not writer or writer.id not in groups:
            return False
        granting = self.env['ir.model.access']._get_access_groups(self._name, operation)
        return not granting.matches(groups - {writer.id})

    @api.constrains('liwan_party')
    def _check_party_is_not_an_account(self):
        # Runs elevated (_validate_fields), so archived users and every company's partner are seen.
        parties = self.filtered('liwan_party')
        if not parties:
            return
        if (
            parties.with_context(active_test=False).user_ids
            or self.env['res.company'].with_context(active_test=False).search_count(
                [('partner_id', 'in', parties.ids)], limit=1,
            )
        ):
            msg = 'liwan_party_account: a user or a company contact cannot be a customer'
            raise ValidationError(msg)
