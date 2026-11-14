# Part of Odoo. See LICENSE file for full copyright and licensing details.
import datetime

from odoo import api, fields, models
from odoo.exceptions import AccessError, LockError

from .privacy_hooks import (
    ACTION_UNHANDLED,
    CORE_OWNER,
    ERASED_NAME,
    NO_CUSTOMER_DATA,
    NO_CUSTOMER_DATA_PREFIXES,
)
from .privacy_request import KIND_ERASE, KIND_EXPORT
from .privacy_token import token_hash
from odoo.addons.liwan_api.serializers.xlsx_export import Sheet, xlsx_bytes
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule

HOOKS = 'liwan.customers.privacy.hooks'
TOKEN_TTL = datetime.timedelta(minutes=10)
SHEET_KEYS = frozenset({'key', 'title', 'header', 'rows'})
NOT_INCLUDED_SHEET = 'Not included'
HOOK_ITEM_KEYS = frozenset({'key', 'owner', 'action', 'count'})


def _refuse_token(message):
    """422 ``invalid_token``: the preview must be taken again."""
    code = 'invalid_token'
    raise LiwanAccessRule(code, message, field='token', status=422)


class LiwanCustomersPrivacyService(models.AbstractModel):
    """Privacy requests about one customer: the preview and the anonymising erase, and the subject export.

    The caller's capability is checked by the route (``customers.erase``, ``customers.privacy.export``: the built-in
    system administrator only); the customer is read through ``liwan.customers.service``, so a customer the caller
    cannot see is a 404 here exactly as on the directory routes. Everything runs as the caller.
    """
    _name = 'liwan.customers.privacy.service'
    _description = 'LiwanOS customers privacy service'
    _liwan_scope = 'global'

    @api.model
    def _liwan_subject(self, customer_id):
        """The customer (archived included) the caller can see and the parties it covers: it and its child contacts."""
        customer = self.env['liwan.customers.service']._liwan_customer(customer_id, include_archived=True)
        return customer, self.env[HOOKS]._liwan_subject_partners(customer)

    @api.model
    def _liwan_is_erased(self, customer):
        return customer.name == ERASED_NAME % customer.id

    # ---- erase ----

    @api.model
    def _liwan_erase_preview(self, customer_id):
        """The preview as a dict: ``items``, ``incomplete`` (``[{key, owner, reason}]``), ``empty_models``,
        ``not_covered`` (keys), ``erased``, ``reach`` (``{shared, covers_all}``) and the ``token`` the erase needs."""
        customer, partners = self._liwan_subject(customer_id)
        plan = self._liwan_plan(customer, partners)
        return {
            'items': plan['items'], 'incomplete': plan['incomplete'], 'empty_models': plan['empty'],
            'not_covered': self.env[HOOKS]._liwan_subject_not_covered(), 'erased': self._liwan_is_erased(customer),
            'reach': plan['reach'], 'token': self._liwan_token(customer),
        }

    @api.model
    def _liwan_plan(self, customer, partners):
        """What the hooks report, judged once against the real reach of the caller.

        * Each hook item is ``complete`` only when the records its declared domain finds are all visible to the caller:
          the count with elevated rights equals the count the caller sees (a missing ACL, a record rule, the company
          fence and a visibility policy all show up as a difference).
        * An application model that links to a partner and no item covers is ``unhandled`` when it holds any record that
          references the party, whoever can see it (its ``count`` is what the caller sees), and ``empty`` (listed by model) when it holds none.
        * A party shared across the tenant (no company) can be referenced from any company, so the caller's session must
          cover the root and every branch of the tenant; a party of one company needs that company. Otherwise every item
          of an application is incomplete (``session_does_not_cover_every_company``).
        """
        coverage = self.env[HOOKS]._liwan_subject_coverage()
        hook_items = self._liwan_unique(self.env[HOOKS]._liwan_subject_erase_preview(partners), 'preview item')
        items = []
        for item in hook_items:
            if set(item) != HOOK_ITEM_KEYS:
                self._liwan_hook_error(item.get('key'), 'an item has the keys %s' % sorted(HOOK_ITEM_KEYS))
            if item['key'] not in coverage:
                self._liwan_hook_error(item['key'], 'an item has no declared coverage')
            model, builder = coverage[item['key']]
            domain = builder(partners)
            complete = self._liwan_visible_count(model, domain) == self._liwan_elevated_count(model, domain)
            items.append({**item, 'complete': complete})
        unhandled, empty = self._liwan_uncovered(partners, {model for model, _builder in coverage.values()})
        items = self._liwan_unique([*items, *unhandled], 'preview item')
        covers_all = self._liwan_covers_all(customer)
        incomplete = []
        for item in items:
            if item['action'] == ACTION_UNHANDLED:
                reason = 'application_has_no_hook'
            elif not covers_all and item['owner'] != CORE_OWNER:
                item = {**item, 'complete': False}
                reason = 'session_does_not_cover_every_company'
            elif not item['complete']:
                reason = 'caller_cannot_reach_all_records'
            else:
                continue
            incomplete.append({'key': item['key'], 'owner': item['owner'], 'reason': reason})
        return {
            'items': items, 'incomplete': incomplete, 'empty': empty,
            'reach': {'shared': not customer.company_id, 'covers_all': covers_all},
        }

    @api.model
    def _liwan_covers_all(self, customer):
        """Whether the caller's allowed companies hold every company that can have records about the party: its own, or
        for a shared party the tenant root and every active branch (``liwan.entitlement.service._liwan_branches``)."""
        if customer.company_id:
            required = customer.company_id
        else:
            service = self.env['liwan.entitlement.service']
            required = service._liwan_profile().root_company_id | service._liwan_branches().company_id
        return required <= self.env.companies

    @api.model
    def _liwan_visible_count(self, model_name, domain):
        """How many records of ``model_name`` the domain finds as the caller: a missing ACL means none are visible."""
        try:
            return self.env[model_name].with_context(active_test=False).search_count(domain)
        except AccessError:
            return 0

    @api.model
    def _liwan_elevated_count(self, model_name, domain):
        """How many records of ``model_name`` the domain finds whatever the caller may see. It only ever decides a
        boolean (``complete`` and whether an uncovered model holds a record): the number itself never reaches the
        preview, the export or the log, so a record the caller cannot reach is neither counted nor disclosed to them."""
        return self.env[model_name].sudo().with_context(active_test=False).search_count(domain)

    @api.model
    def _liwan_uncovered(self, partners, covered):
        """``(items, empty)``: the models that link to a partner, are in no hook's coverage and are not on the no-data
        list, split by whether they hold a record about the party (counted with elevated rights)."""
        items, empty = [], []
        for name in sorted(self.env.registry):
            model = self.env[name]
            if name in covered or name in NO_CUSTOMER_DATA or name.startswith(NO_CUSTOMER_DATA_PREFIXES):
                continue
            if model._abstract or model._transient or not model._auto:
                continue
            links = [
                field.name for field in model._fields.values()
                if field.store and field.type in ('many2one', 'many2many') and field.comodel_name == 'res.partner'
            ]
            if not links:
                continue
            domain = ['|'] * (len(links) - 1) + [(link, 'in', partners.ids) for link in links]
            if self._liwan_elevated_count(name, domain):
                items.append({
                    'key': name, 'owner': getattr(type(model), '_original_module', None) or '', 'action': ACTION_UNHANDLED,
                    'count': self._liwan_visible_count(name, domain), 'complete': False,
                })
            else:
                empty.append(name)
        return items, empty

    @api.model
    def _liwan_erase(self, customer_id, token, confirmation, reason):
        """Anonymise the customer, its child contacts and what every application holds about them, in this transaction.

        Needs the token of a preview of this customer taken by this caller in this company, not older than ten minutes
        and with the customer unchanged since; the token is deleted by its use, so it works once. ``confirmation`` is the customer's name as the
        caller sees it. An already erased customer is a no-op: ``(None, {})``, nothing is recorded.
        """
        customer, partners = self._liwan_subject(customer_id)
        self._liwan_lock(customer)
        self._liwan_consume_token(customer, token)
        if confirmation != customer.name:
            code = 'invalid'
            raise LiwanAccessRule(code, 'the confirmation is not the name of the customer', field='confirmation', status=422)
        if self._liwan_is_erased(customer):
            return None, {}
        incomplete = self._liwan_plan(customer, partners)['incomplete']
        if incomplete:
            # An erase never reports success while data it knows about is left: nothing is written or logged.
            code = 'erase_incomplete'
            raise LiwanAccessRule(
                code, 'the caller cannot reach every record to erase', status=409, details={'incomplete': incomplete},
            )
        counts = self.env[HOOKS]._liwan_subject_erase(partners)
        return self._liwan_log(customer, KIND_ERASE, reason, counts), counts

    # ---- export ----

    @api.model
    def _liwan_export(self, customer_id, reason):
        """``(content, filename, request)``: one .xlsx with a sheet per contributing application, and the logged request."""
        customer, partners = self._liwan_subject(customer_id)
        sheets = self._liwan_unique(self.env[HOOKS]._liwan_subject_export(partners), 'export sheet')
        for sheet in sheets:
            if set(sheet) != SHEET_KEYS:
                self._liwan_hook_error(sheet.get('key'), 'an export sheet has the keys %s' % sorted(SHEET_KEYS))
        counts = {sheet['key']: len(sheet['rows']) for sheet in sheets}
        files = [Sheet(sheet['title'], sheet['header'], sheet['rows']) for sheet in sheets]
        plan = self._liwan_plan(customer, partners)
        not_included = [[item['key'], item['owner'], item['reason']] for item in plan['incomplete']]
        if not_included:
            # What could not be included is listed first, so the file never looks complete when it is not.
            files.insert(0, Sheet(NOT_INCLUDED_SHEET, ['key', 'owner', 'reason'], not_included))
            counts['incomplete'] = [item['key'] for item in plan['incomplete']]
        content = xlsx_bytes(files, right_to_left=True)
        request = self._liwan_log(customer, KIND_EXPORT, reason, counts)
        return content, f'customer-{customer.id}-{fields.Date.context_today(customer)}.xlsx', request

    # ---- token, lock, log ----

    @api.model
    def _liwan_token(self, customer):
        return self.env['liwan.customers.privacy.token']._liwan_issue(customer, TOKEN_TTL)

    @api.model
    def _liwan_consume_token(self, customer, token):
        """Delete the token of a preview of ``customer`` by this caller in this company, or 422 ``invalid_token``.

        The row is the caller's own (a record rule), so another caller's token is simply not found.
        """
        row = self.env['liwan.customers.privacy.token'].search([('token_hash', '=', token_hash(token))], limit=1)
        if not row:
            _refuse_token('the token is not valid: preview the erase again')
        if row.expires < fields.Datetime.now():
            _refuse_token('the token has expired: preview the erase again')
        if (row.partner_id, row.company_id, row.written) != (
            customer.id, self.env.company, fields.Datetime.to_string(customer.write_date),
        ):
            _refuse_token('the token is for another customer or state: preview the erase again')
        row.unlink()

    @api.model
    def _liwan_lock(self, customer):
        """Hold the customer's row, so two erases with one token cannot both pass the token's state check."""
        try:
            customer.lock_for_update()
        except LockError:
            code = 'conflict'
            raise LiwanAccessRule(code, 'another request on this customer is running', status=409) from None
        customer.invalidate_recordset(['write_date'])

    @api.model
    def _liwan_log(self, customer, kind, reason, counts):
        # The log belongs to the company the party belongs to, and for a shared party to the tenant root.
        company = customer.company_id or self.env['liwan.entitlement.service']._liwan_profile().root_company_id
        return self.env['liwan.customers.privacy.request'].create({
            'partner_id': customer.id, 'kind': kind, 'reason': reason, 'counts': counts, 'company_id': company.id,
        })

    @api.model
    def _liwan_unique(self, entries, label):
        keys = [entry['key'] for entry in entries]
        if len(set(keys)) != len(keys):
            self._liwan_hook_error(next(key for key in keys if keys.count(key) > 1), f'duplicate {label}')
        return entries

    @api.model
    def _liwan_hook_error(self, key, message):
        msg = f'liwan_customers: privacy hook {key!r}: {message}'
        raise ValueError(msg)
