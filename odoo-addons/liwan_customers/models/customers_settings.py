# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models

from odoo.addons.liwan_api.serializers.properties import OPTION_TYPES
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule

SHARING_MODES = ('establishment', 'branch')
PARTY_KINDS = ('individuals', 'companies', 'both')
# The ``properties`` field of ``res.partner``: the tenant's customer fields live in its one definition.
PROPERTIES_FIELD = 'properties'


class LiwanCustomersSettings(models.Model):
    """The tenant's customer policy: whether a customer is shared by every branch, how a phone is read, which kinds of
    customer new records may be, and the customer fields (the definition kept by stock, written through here).

    One record per tenant database, changed only by a holder of ``customers.settings.manage`` in the root company.
    ``revision`` refuses a write based on a stale read.
    """
    _name = 'liwan.customers.settings'
    _description = 'LiwanOS customers settings'
    # Every branch reads the same policy.
    _liwan_scope = 'tenant'

    # establishment: a new customer has no company and every branch finds it; branch: it belongs to the company the
    # session works in.
    sharing = fields.Selection([(mode, mode) for mode in SHARING_MODES], required=True, default='establishment')
    # The country a number without a prefix is read in; unset means the root company's country.
    phone_country_id = fields.Many2one('res.country', ondelete='restrict')
    # The kinds of top-level customer the directory creates: it decides the forms of new customers, never an existing one.
    party_kinds = fields.Selection([(kind, kind) for kind in PARTY_KINDS], required=True, default='both')
    revision = fields.Integer(required=True, default=1)

    _revision_positive = models.Constraint('CHECK(revision > 0)', 'the revision is a positive number')

    @api.model
    def _liwan_current(self):
        """The tenant's settings record, installed with the defaults by ``data/customers_settings.xml``."""
        return self.env.ref('liwan_customers.customers_settings')

    def _liwan_apply(self, values, revision, definition=None, confirm_removal=False):
        """Write ``values`` read at ``revision``, and the customer fields ``definition`` when given.

        409 ``conflict`` on a stale read; 409 ``sharing_transfer_required`` when the sharing changes while any customer
        exists (archived ones and contacts counted); 409 ``custom_field_values_exist`` when ``definition`` drops fields
        that still have values, or drops options that customers still hold from a field that stays, unless
        ``confirm_removal`` (then the stored values and option keys go). A refusal changes nothing.
        """
        self.ensure_one()
        if self.revision != revision:
            code = 'conflict'
            raise LiwanAccessRule(code, 'the customer settings changed since they were read', status=409)
        if values.get('sharing', self.sharing) != self.sharing and self._liwan_party_exists():
            code = 'sharing_transfer_required'
            raise LiwanAccessRule(
                code, 'customers exist: changing the sharing needs a transfer',
                field='sharing', status=409,
            )
        if definition is not None:
            field_holders, option_holders = self._liwan_value_holders(
                self._liwan_removed_fields(definition), self._liwan_removed_options(definition),
            )
            if (field_holders or option_holders) and not confirm_removal:
                self._liwan_refuse_removal(field_holders, option_holders)
            self.env['res.partner']._liwan_set_party_properties_definition(definition)
            self._liwan_clear_values(self._liwan_every_party().browse().union(
                *(parties for _label, parties in field_holders.values()),
                *(parties for _field, _option, parties in option_holders.values()),
            ))
        self.write({**values, 'revision': revision + 1})

    @api.model
    def _liwan_removed_fields(self, definition):
        """The fields of the current customer definition that ``definition`` leaves out, as ``{key: label}``."""
        kept = {item['name'] for item in definition}
        return {
            item['name']: item['string']
            for item in self.env['res.partner']._liwan_party_properties_definition() if item['name'] not in kept
        }

    @api.model
    def _liwan_removed_options(self, definition):
        """The options that ``definition`` drops from the selection and tags fields it keeps, as
        ``{field key: (field label, {option key: option label})}`` (only the fields that lose one)."""
        kept = {item['name']: _options(item) for item in definition}
        removed = {}
        for item in self.env['res.partner']._liwan_party_properties_definition():
            if item['name'] in kept:
                lost = {key: label for key, label in _options(item).items() if key not in kept[item['name']]}
                if lost:
                    removed[item['name']] = (item['string'], lost)
        return removed

    @api.model
    def _liwan_refuse_removal(self, field_holders, option_holders):
        """409 ``custom_field_values_exist``: each removed field, and each removed option, with the number of parties
        that still hold it."""
        code = 'custom_field_values_exist'
        raise LiwanAccessRule(
            code, 'customers hold values of the fields or options to remove', status=409,
            details={
                'fields': [
                    {'key': key, 'label': label, 'count': len(parties)}
                    for key, (label, parties) in field_holders.items()
                ],
                'options': [
                    {
                        'field_key': field_key, 'field_label': field_label, 'key': key, 'label': label,
                        'count': len(parties),
                    }
                    for (field_key, key), (field_label, label, parties) in option_holders.items()
                ],
            },
        )

    @api.model
    def _liwan_value_holders(self, removed_fields, removed_options):
        """``(field_holders, option_holders)`` of a definition change, from one read of every party.

        ``field_holders`` is ``{key: (label, parties)}`` of the removed fields (``{key: label}``) that some party still
        holds a value of. ``option_holders`` is ``{(field key, option key): (field label, option label, parties)}`` of
        the removed options (``{field key: (field label, {option key: option label})}``) that some party holds, in a
        field that stays. Archived parties and every company count, so the confirmation shows what the removal
        destroys; a party counts once for each option, however many of the removed options it holds.
        """
        every_party = self._liwan_every_party()
        if not removed_fields and not removed_options:
            return {}, {}
        field_holders = {key: every_party.browse() for key in removed_fields}
        option_holders = {
            (field_key, key): every_party.browse()
            for field_key, (_label, options) in removed_options.items() for key in options
        }
        # The engine's comparison with false also drops a stored 0 and the whole-field comparison is not searchable,
        # so every party is read and the loop below decides from the values.
        parties = every_party.search([('liwan_party', '=', True)])
        for row in parties.read([PROPERTIES_FIELD]):
            party = parties.browse(row['id'])
            for item in row[PROPERTIES_FIELD]:
                key, value = item['name'], item.get('value')
                if key in removed_fields and not _is_empty(value):
                    field_holders[key] |= party
                elif key in removed_options:
                    for option in _held_options(value, removed_options[key][1]):
                        option_holders[key, option] |= party
        return (
            {key: (removed_fields[key], found) for key, found in field_holders.items() if found},
            {
                (field_key, key): (removed_options[field_key][0], removed_options[field_key][1][key], found)
                for (field_key, key), found in option_holders.items() if found
            },
        )

    @api.model
    def _liwan_clear_values(self, parties):
        """Rewrite the values of ``parties`` so that what the new definition no longer reads is gone from them: the
        values of a removed field and the key of a removed option. Stock leaves both in the stored column, where they
        would outlive what they belonged to. Runs after the new definition is installed, so the engine's read format
        carries only what stays."""
        parties.invalidate_recordset([PROPERTIES_FIELD])
        for party, row in zip(parties, parties.read([PROPERTIES_FIELD]), strict=True):
            party.write({PROPERTIES_FIELD: {item['name']: item.get('value') for item in row[PROPERTIES_FIELD]}})

    @api.model
    def _liwan_party_exists(self):
        """Whether the tenant holds any party, archived ones and contacts included (a boolean only). The sharing
        transfer replaces this refusal."""
        return bool(self._liwan_every_party().search_count([('liwan_party', '=', True)], limit=1))

    @api.model
    def _liwan_every_party(self):
        """``res.partner`` over every company, archived records included, for the two reads that must not depend on
        what the caller sees: whether any party exists, and which parties hold a value of a field or of an option being
        removed, and how many hold each.

        Elevated: the company fence hides the parties of branches the root settings manager holds no grant in.
        """
        return self.env['res.partner'].sudo().with_context(active_test=False)


def _is_empty(value):
    """Whether an engine value of the read format is unset: nothing, false, an empty text or an empty list."""
    return value is None or value is False or value in ('', [])


def _options(item):
    """The ``{option key: option label}`` of an engine definition item; empty for a type without options."""
    return {option[0]: option[1] for option in item.get(item['type']) or ()} if item['type'] in OPTION_TYPES else {}


def _held_options(value, options):
    """The keys among ``options`` that an engine value names: the key of a selection, or some keys of a tags value."""
    if _is_empty(value):
        return set()
    return set(options).intersection(value if isinstance(value, list) else [value])
