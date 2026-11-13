# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

from .customers_settings import PROPERTIES_FIELD
from .res_partner import PRIVACY_MARKER, PRIVACY_WRITE_FIELDS
from odoo.addons.liwan_api.serializers.csv_export import (
    property_cells,
    property_headers,
)
from odoo.addons.liwan_core.models.protected_write import marked

# The identity values of a party are written through the service under its marker, the personal fields of
# PRIVACY_WRITE_FIELDS under the privacy marker.
ERASED_NAME = 'Erased customer %d'
ERASED_ACCOUNT = 'erased-%d'
ACTION_ERASE = 'erase'
ACTION_RETAIN = 'retain'
# What an erase cannot change, as keys the screen translates: message and tracking history, free text typed into other
# records, documents already stored (PDF, e-invoice), and backups until their retention ends.
ACTION_UNHANDLED = 'unhandled'
CORE_OWNER = 'liwan_customers'
# Models the core contribution handles itself: the partners, their bank accounts and their attached files.
CORE_MODELS = ('res.partner', 'res.partner.bank', 'ir.attachment')
# Models that link to a partner and hold no customer data of their own: a user or a company contact is never a party,
# and the mail models (messages, followers, notifications, activities, tracking) are the chatter history that
# NOT_COVERED names. An application model is on neither list unless its hook declares it.
NO_CUSTOMER_DATA = ('res.users', 'res.company')
NO_CUSTOMER_DATA_PREFIXES = ('mail.', 'bus.')
NOT_COVERED = ('chatter_history', 'free_text_notes', 'stored_documents', 'backups')


class LiwanCustomersPrivacyHooks(models.AbstractModel):
    """What each application holds about one person, declared without any application naming another (spec R3).

    An application extends the three hooks from its own addon and composes through ``super()``. Each receives the
    party and the child contacts under it as one recordset. A contribution never names a sensitive field of another
    application and is read, counted and cleared as the caller: a record the caller cannot reach is not touched.

    * ``_liwan_subject_export(partners)``: a list of sheets ``{key, title, header, rows}``.
    * ``_liwan_subject_erase_preview(partners)``: a list of ``{key, owner, action, count, complete}``. ``action`` is
      ``erase`` (the data is cleared) or ``retain`` (the law keeps it: posted accounting documents keep their partner
      link, number and amounts). ``complete`` is false when the caller cannot reach every record of the kind.
    * ``_liwan_subject_erase(partners)``: clear what the preview said and answer ``{key: count}``.
    """
    _name = 'liwan.customers.privacy.hooks'
    _description = 'LiwanOS customer privacy hooks'
    _liwan_scope = 'global'

    @api.model
    def _liwan_subject_partners(self, partner):
        """``partner`` and the child contacts under it (archived included) that are parties."""
        family = self.env['res.partner'].with_context(active_test=False).search(
            [('id', 'child_of', partner.id), ('liwan_party', '=', True)],
        )
        return family | partner

    @api.model
    def _liwan_subject_models(self):
        """The model names this hook covers; an application adds its own through ``super()``. A model that links to a
        partner and is covered by no hook shows up in the preview as ``unhandled``."""
        return list(CORE_MODELS)

    @api.model
    def _liwan_subject_attachments(self, partners):
        """The files attached to the parties themselves (avatar images included), as the caller sees them."""
        return self.env['ir.attachment'].with_context(active_test=False).search([
            ('res_model', '=', 'res.partner'), ('res_id', 'in', partners.ids),
            '|', ('res_field', '=', False), ('res_field', '!=', False),
        ])

    @api.model
    def _liwan_subject_not_covered(self):
        """The keys of what an erase leaves unchanged; an application adds its own through ``super()``."""
        return list(NOT_COVERED)

    @api.model
    def _liwan_subject_export(self, partners):
        definition = self.env['res.partner']._liwan_party_properties_definition()
        customers = [
            [
                party.id, party.name, party.phone or None, party.email or None, party.is_company,
                party.parent_id.id or None, party.active, party.street, party.street2, party.city, party.zip,
                party.state_id.name, party.country_id.name, party.vat, party.company_registry, party.website,
                party.function, (party.comment and party.comment.striptags()) or None, party.create_date,
                *property_cells(party, PROPERTIES_FIELD, definition),
            ]
            for party in partners
        ]
        banks = [
            [bank.partner_id.id, bank.bank_id.name or None, bank.acc_number, bank.acc_holder_name or None, bank.active]
            for bank in self.env['res.partner.bank'].with_context(active_test=False).search(
                [('partner_id', 'in', partners.ids)],
            )
        ]
        return [
            {
                'key': 'customer', 'title': 'Customer',
                'header': [
                    'id', 'name', 'phone', 'email', 'is_company', 'parent_id', 'active', 'street', 'street2', 'city',
                    'zip', 'state', 'country', 'vat', 'company_registry', 'website', 'function', 'notes', 'created',
                    *property_headers(definition),
                ],
                'rows': customers,
            },
            {'key': 'bank_accounts', 'title': 'Bank accounts',
             'header': ['partner_id', 'bank', 'account', 'holder', 'active'], 'rows': banks},
        ]

    @api.model
    def _liwan_subject_erase_preview(self, partners):
        banks = self.env['res.partner.bank'].with_context(active_test=False).search_count(
            [('partner_id', 'in', partners.ids)],
        )
        return [
            {'key': 'customer', 'owner': 'liwan_customers', 'action': ACTION_ERASE, 'count': len(partners), 'complete': True},
            {'key': 'bank_accounts', 'owner': 'liwan_customers', 'action': ACTION_ERASE, 'count': banks, 'complete': True},
            {
                'key': 'attachments', 'owner': 'liwan_customers', 'action': ACTION_ERASE,
                'count': len(self._liwan_subject_attachments(partners)), 'complete': True,
            },
        ]

    @api.model
    def _liwan_subject_erase(self, partners):
        """Anonymise the parties and archive and clear their bank accounts; the parties keep ``liwan_party``."""
        service = self.env['liwan.customers.service']
        # The files of the customer record go through the ORM, so the storage accounting follows.
        attachments = self._liwan_subject_attachments(partners)
        attachment_count = len(attachments)
        attachments.unlink()
        banks = self.env['res.partner.bank'].with_context(active_test=False).search([('partner_id', 'in', partners.ids)])
        for bank in banks:
            bank.with_context(tracking_disable=True).write({'active': False, 'acc_number': ERASED_ACCOUNT % bank.id, 'acc_holder_name': False})
        for party in partners:
            service._liwan_write(party.with_context(tracking_disable=True), {
                'name': ERASED_NAME % party.id, 'phone': False, 'email': False, 'active': False,
                PROPERTIES_FIELD: False,
            })
            with marked(self.env, {PRIVACY_MARKER: party.ids}):
                party.with_context(tracking_disable=True).write({name: False for name in sorted(PRIVACY_WRITE_FIELDS) if name in party._fields})
        return {'customer': len(partners), 'bank_accounts': len(banks), 'attachments': attachment_count}
