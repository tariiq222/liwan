# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

from .customers_settings import PROPERTIES_FIELD
from .res_partner import PRIVACY_MARKER, PRIVACY_WRITE_FIELDS
from odoo.addons.liwan_api.serializers.csv_export import (
    property_cells,
    property_headers,
)
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule
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
# Models that link to a partner and hold no customer data of their own: a user or a company contact is never a party,
# and the mail models (messages, followers, notifications, activities, tracking) are the chatter history that
# NOT_COVERED names. The privacy log and token rows hold ids, counts and the reason only, and the log is kept by law.
# An application model is on neither list unless its hook declares it.
# Every other entry holds a partner link and no data about the party, and none can name a party in LiwanOS:
# * discuss.channel.member, discuss.channel.rtc.session, res.users.settings.volumes: a chat membership, call session
#   or voice volume of a user, tied to that user's own partner; a party has no user and never joins a channel.
# * calendar.filters: one user's calendar view preference (a partner link and two flags), no content.
# * ir.actions.server: configuration written by an operator (a fixed recipient list); no LiwanOS surface creates one.
# Everything else that links to a partner and no hook covers stays OFF this list on purpose, so an erase of a customer
# who has such a record is refused (409 ``erase_incomplete``) until its owner writes a hook: hr.employee, hr.job,
# hr.version, hr.work.location, hr.contribution.register (HR data), calendar.event and calendar.attendee (meeting
# attendees), rating.rating (feedback text), product.supplierinfo (vendor price lists), sms.sms and snailmail.letter
# (a queued number or postal address), maintenance.equipment, project.project, project.task, project.collaborator and
# resource.booking (a customer's work and appointments), hr.applicant (a candidate).
NO_CUSTOMER_DATA = (
    'res.users', 'res.company', 'liwan.customers.privacy.request', 'liwan.customers.privacy.token',
    'discuss.channel.member', 'discuss.channel.rtc.session', 'res.users.settings.volumes', 'calendar.filters',
    'ir.actions.server',
)
NO_CUSTOMER_DATA_PREFIXES = ('mail.', 'bus.')
NOT_COVERED = ('chatter_history', 'free_text_notes', 'stored_documents', 'backups')


def refuse_incomplete(incomplete):
    """409 ``erase_incomplete``: the erase of a hook it cannot finish as the caller, before anything is written.

    ``incomplete`` is ``[{key, owner, reason}]``, the shape of the preview. A hook calls it before it calls ``super()``,
    so no other hook has written yet and the request leaves nothing changed.
    """
    code = 'erase_incomplete'
    raise LiwanAccessRule(
        code, 'the caller cannot reach every record to erase', status=409, details={'incomplete': incomplete},
    )


class LiwanCustomersPrivacyHooks(models.AbstractModel):
    """What each application holds about one person, declared without any application naming another (spec R3).

    An application extends the three hooks from its own addon and composes through ``super()``. Each receives the
    party and the child contacts under it as one recordset. A contribution never names a sensitive field of another
    application and is read, counted and cleared as the caller: a record the caller cannot reach is not touched.

    * ``_liwan_subject_coverage()``: ``{item key: (model, domain builder)}``. The builder takes the parties and answers
      the domain of the records of that model the item covers. The service compares, per item, the records that domain
      finds with elevated rights against those the caller sees, and sets ``complete`` itself: a hook never guesses
      completeness. A model that links to a partner and no item covers is ``unhandled`` once it holds a record.
    * ``_liwan_subject_export(partners)``: a list of sheets ``{key, title, header, rows}``.
    * ``_liwan_subject_erase_preview(partners)``: a list of ``{key, owner, action, count}``, one per covered key.
      ``action`` is ``erase`` (the data is cleared) or ``retain`` (the law keeps it: posted accounting documents keep
      their partner link, number and amounts).
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
    def _liwan_subject_coverage(self):
        """``{item key: (model, domain builder)}`` of what this hook covers; an application adds its own through
        ``super()``."""
        return {
            'customer': ('res.partner', lambda partners: [('id', 'in', partners.ids)]),
            'bank_accounts': ('res.partner.bank', lambda partners: [('partner_id', 'in', partners.ids)]),
            'attachments': ('ir.attachment', self._liwan_attachment_domain),
            'tags': ('res.partner.category', self._liwan_tag_domain),
        }

    @api.model
    def _liwan_tag_domain(self, partners):
        return [('partner_ids', 'in', partners.ids)]

    @api.model
    def _liwan_subject_tags(self, partners):
        """The tags (archived included) set on the parties, as the caller sees them."""
        return self.env['res.partner.category'].with_context(active_test=False).search(self._liwan_tag_domain(partners))

    @api.model
    def _liwan_attachment_domain(self, partners):
        return [
            ('res_model', '=', 'res.partner'), ('res_id', 'in', partners.ids),
            '|', ('res_field', '=', False), ('res_field', '!=', False),
        ]

    @api.model
    def _liwan_subject_attachments(self, partners):
        """The files attached to the parties themselves (avatar images included), as the caller sees them."""
        return self.env['ir.attachment'].with_context(active_test=False).search(self._liwan_attachment_domain(partners))

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
            {'key': 'tags', 'title': 'Tags', 'header': ['partner_id', 'tag'],
             'rows': [[party.id, tag.name] for party in partners for tag in party.with_context(active_test=False).category_id]},
        ]

    @api.model
    def _liwan_subject_erase_preview(self, partners):
        banks = self.env['res.partner.bank'].with_context(active_test=False).search_count(
            [('partner_id', 'in', partners.ids)],
        )
        return [
            {'key': 'customer', 'owner': 'liwan_customers', 'action': ACTION_ERASE, 'count': len(partners)},
            {'key': 'bank_accounts', 'owner': 'liwan_customers', 'action': ACTION_ERASE, 'count': banks},
            {
                'key': 'attachments', 'owner': 'liwan_customers', 'action': ACTION_ERASE,
                'count': len(self._liwan_subject_attachments(partners)),
            },
            {'key': 'tags', 'owner': 'liwan_customers', 'action': ACTION_ERASE, 'count': len(self._liwan_subject_tags(partners))},
        ]

    @api.model
    def _liwan_subject_erase(self, partners):
        """Anonymise the parties and archive and clear their bank accounts; the parties keep ``liwan_party``."""
        service = self.env['liwan.customers.service']
        # The files of the customer record go through the ORM, so the storage accounting follows.
        tag_count = len(self._liwan_subject_tags(partners))
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
        return {'customer': len(partners), 'bank_accounts': len(banks), 'attachments': attachment_count, 'tags': tag_count}
