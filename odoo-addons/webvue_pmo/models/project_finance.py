# Part of Odoo. See LICENSE file for full copyright and licensing details.
import math
from datetime import date as date_type
from decimal import ROUND_HALF_UP, Decimal

from odoo import api, fields, models
from odoo.exceptions import AccessError, MissingError, ValidationError

IMMUTABLE_FIELDS = {'project_id', 'kind', 'company_id', 'currency_id', 'webvue_revision'}
MUTABLE_FIELDS = {'title', 'amount', 'expense_date', 'reference', 'notes', 'budget_entry_id'}
CREATE_WRITABLE = {'project_id', 'kind'} | MUTABLE_FIELDS
MAX_AMOUNT = 1e12
TITLE_MAX_LEN = 200
REFERENCE_MAX_LEN = 200
NOTES_MAX_LEN = 10000


class WebVueFinanceStaleWrite(Exception):
    """Write token no longer matches the locked row."""


class WebVueFinanceEntryLinked(Exception):
    """A budget entry still has expenses linked to it outside the current batch."""

    def __init__(self, message, count):
        super().__init__(message)
        self.webvue_count = count


def _currency_decimals(currency):
    return currency.decimal_places if currency else 2


def _currency_quantum(currency):
    return Decimal(1).scaleb(-_currency_decimals(currency))


def _to_decimal(value):
    """Exact Decimal from a float/int amount, via its shortest round-trip repr.

    `str(value)` (not `Decimal(value)`) is deliberate: it recovers the decimal
    literal the value was created from (e.g. `0.1` -> ``'0.1'``) instead of the
    binary float's exact-but-noisy value, so a currency-precision comparison
    never trips on float representation noise for values that are otherwise
    exact (avoids the 0.1 + 0.2 != 0.3 class of bug in sums/comparisons).
    """
    return Decimal(str(value))


def _check_no_protected_defaults(env):
    """Reject `default_*` context keys on finance create/write.

    Odoo's base `create()` resolves any `default_<field>` context key for a
    field missing from vals *after* our own vals-only checks below would
    otherwise have run - a caller could inject e.g. `default_webvue_revision` or
    `default_budget_entry_id` (pointing at a foreign-project budget) for a
    field our validation never saw, since it never appeared in vals. There is
    no legitimate reason for a finance entry create/write to rely on context
    defaults (the API always builds vals explicitly), so the simplest correct
    fix is to reject the whole class outright rather than special-case a
    resolution/merge per field. Superuser bootstrap/install paths are exempt,
    matching the rest of webvue_pmo's bootstrap-vs-business-API split.
    """
    if env.is_superuser():
        return
    leaked = sorted(key for key in env.context if key.startswith('default_'))
    if leaked:
        raise ValidationError(env._("default_%s cannot be set for finance entries.") % leaked[0][8:])


def _validate_amount(amount, currency, env):
    if amount is None or isinstance(amount, bool) or not isinstance(amount, int | float):
        raise ValidationError(env._("Amount must be a finite number."))
    if not math.isfinite(amount):
        raise ValidationError(env._("Amount must be a finite number."))
    if amount < 0 or amount > MAX_AMOUNT:
        raise ValidationError(env._("Amount must be between 0 and 1e12."))
    as_decimal = _to_decimal(amount)
    if as_decimal != as_decimal.quantize(_currency_quantum(currency), rounding=ROUND_HALF_UP):
        raise ValidationError(env._("Amount has more precision than the currency allows."))
    return amount


def _validate_date_value(value, env):
    """Coerce a create/write `expense_date` vals entry, rejecting malformed strings.

    Direct ORM callers (not the API, which already uses
    `serializers/dates.py::parse_date`) can pass a raw string straight to
    `write()`/`create()`. Odoo's own `fields.Date` conversion uses
    `datetime.strptime`, which raises a bare `ValueError` for a fake or
    truncated date (e.g. ``'2030-02-30'`` or ``'2030-01'``) instead of a clean
    `ValidationError` - coerce and validate here so both entry points reject
    the same way.
    """
    if value in (None, False):
        return False
    if isinstance(value, date_type):
        return value
    if not isinstance(value, str):
        raise ValidationError(env._("expense_date must be a valid YYYY-MM-DD date."))
    try:
        return fields.Date.to_date(value)
    except ValueError:
        raise ValidationError(env._("expense_date must be a valid YYYY-MM-DD date.")) from None


def _validate_title(value, env):
    if not isinstance(value, str) or not value.strip():
        raise ValidationError(env._("Title must not be empty."))
    stripped = value.strip()
    if len(stripped) > TITLE_MAX_LEN:
        raise ValidationError(env._("Title must be at most %s characters.") % TITLE_MAX_LEN)
    return stripped


def _validate_text_field(value, max_len, label, env):
    if value in (None, False):
        return ''
    if not isinstance(value, str):
        raise ValidationError(env._("%s must be a string.") % label)
    if len(value) > max_len:
        raise ValidationError(env._("%(label)s must be at most %(max)s characters.") % {'label': label, 'max': max_len})
    return value


class WebVueProjectFinanceEntry(models.Model):
    _name = 'webvue.project.finance.entry'
    _description = 'WebVue Project Finance Entry'
    _webvue_scope = 'company'
    _order = 'id desc'
    _rec_name = 'title'

    project_id = fields.Many2one('project.project', required=True, ondelete='cascade', index=True)
    company_id = fields.Many2one(
        'res.company', related='project_id.company_id', store=True, readonly=True, index=True,
    )
    currency_id = fields.Many2one(
        'res.currency', related='project_id.currency_id', store=True, readonly=True,
    )
    kind = fields.Selection([('budget', 'Budget'), ('expense', 'Expense')], required=True, index=True)
    title = fields.Char(required=True)
    # Numeric storage keeps validated cents intact even if currency.rounding is 0.05.
    amount = fields.Float(digits=False, required=True, default=0.0)
    expense_date = fields.Date()
    reference = fields.Char(default='')
    notes = fields.Text(default='')
    budget_entry_id = fields.Many2one(
        'webvue.project.finance.entry', ondelete='restrict', index=True,
        domain="[('kind', '=', 'budget'), ('project_id', '=', project_id)]",
    )
    webvue_revision = fields.Integer(default=1, required=True, copy=False)

    _webvue_amount_bounds = models.Constraint(
        'CHECK(amount >= 0 AND amount <= 1000000000000 AND amount = amount)',
        'Amount must be a finite number between 0 and 1e12.',
    )
    _webvue_expense_amount_positive = models.Constraint(
        "CHECK(kind != 'expense' OR amount > 0)",
        'Expense amount must be positive.',
    )
    _webvue_expense_date_required = models.Constraint(
        "CHECK(kind != 'expense' OR expense_date IS NOT NULL)",
        'Expense entries require an expense date.',
    )
    _webvue_budget_no_date_or_link = models.Constraint(
        "CHECK(kind != 'budget' OR (expense_date IS NULL AND budget_entry_id IS NULL))",
        'Budget entries cannot have an expense date or a linked budget.',
    )
    _webvue_title_length = models.Constraint(
        "CHECK(length(btrim(title)) > 0 AND length(title) <= 200)",
        'Title must be a non-blank string up to 200 characters.',
    )
    _webvue_reference_length = models.Constraint(
        'CHECK(reference IS NULL OR length(reference) <= 200)',
        'Reference must be at most 200 characters.',
    )
    _webvue_notes_length = models.Constraint(
        'CHECK(notes IS NULL OR length(notes) <= 10000)',
        'Notes must be at most 10000 characters.',
    )

    # --- project floor: active + strictly current-company + live visible ---
    def _webvue_check_project_for_finance(self, project, manage=False):
        """The finance-specific project floor.

        `project.project._webvue_check_visible_current` (not ours to change)
        allows a company-less project (`company_id` falsy) to pass, and does
        not check `active` at all. Finance is explicitly out of scope for
        legacy company-less projects, and only ever meaningful for an active
        project, so this adds both checks on top of the capability + ir.rule
        floor `_webvue_check_visible_current` already provides.
        """
        if not project or not project.exists():
            raise ValidationError(self.env._("project_id must reference an existing project."))
        if not project.active or project.company_id != self.env.company:
            raise AccessError(self.env._("The project is outside the active current company."))
        project._webvue_check_visible_current()
        if manage:
            project._webvue_check_manage()
        return project

    def _webvue_visible_project_query(self):
        """A live, caller-owned subquery of the caller's visible projects.

        Deliberately built from an explicit domain (`active = True`,
        `company_id in <pinned companies>`) rather than trusting whatever
        `active_test`/company context the *caller* happens to have set on
        `self` - a caller doing `Entry.with_context(active_test=False).search(...)`
        must not leak archived-project entries just because that context also
        propagates to this nested project lookup. `project.project._search`
        (not `.search()`) is called directly so this composes into a domain
        leaf as a Query/subquery instead of a materialized id list, and still
        goes through project.project's own capability + ir.rule floor
        (including the followers-only privacy rule) exactly as a normal
        project read would - including *raising* `AccessError` when the
        caller lacks `pmo.projects.read`, matching `project.project.search()`'s
        own behaviour and `search()`'s existing raising contract on this
        model. `_check_access` (a non-raising contract) checks the capability
        itself before ever calling this, so it never hits that raise.
        """
        return self.env['project.project'].with_context(active_test=True)._search([
            ('active', '=', True), ('company_id', 'in', self.env.companies.ids),
        ])

    @api.model
    def _search(
        self, domain, offset=0, limit=None, order=None, *,
        active_test=True, bypass_access=False,
    ):
        if not bypass_access and not self.env.su:
            self.env['webvue.access.service']._webvue_require_capability('pmo.projects.read')
            domain = [*domain, ('project_id', 'in', self._webvue_visible_project_query())]
        return super()._search(
            domain, offset=offset, limit=limit, order=order,
            active_test=active_test, bypass_access=bypass_access,
        )

    def _check_access(self, operation):
        """The actual Odoo 19 access-control hook.

        `check_access()` (raising) and `has_access()`/`_filtered_access()`
        (non-raising, used internally by `read()`/`fetch()`/prefetch/cache
        population/`name_search`) both delegate to this method; overriding
        only the public `check_access()` (as project.project does) leaves
        those internal paths unrestricted by our project-visibility floor.
        Contract: return falsy when `self` fully passes, otherwise
        `(denied_recordset, error_factory)` - never raise directly, so
        `has_access()` can degrade to a boolean/filtered result instead of
        blowing up.
        """
        denied = super()._check_access(operation)
        if denied or self.env.su:
            return denied
        # Non-raising contract: check the capability ourselves first (unlike
        # `_search`, which is allowed to raise) so a caller with no
        # `pmo.projects.read` capability at all degrades to "everything
        # denied" here instead of `_webvue_visible_project_query` raising.
        if not self.env['webvue.access.service']._webvue_has_capability(self.env.user, 'pmo.projects.read'):
            return self, lambda: AccessError(self.env._(
                "You do not have permission to read project finance.",
            ))
        if not any(self._ids):
            return None
        visible = self.browse(self._search([('id', 'in', self.ids)]))
        forbidden = self - visible
        if forbidden:
            return forbidden, lambda: AccessError(self.env._(
                "Finance entry requires pmo.projects.read and a readable active current-company project.",
            ))
        return None

    # --- kind/link consistency -------------------------------------------
    def _webvue_check_kind_consistency(self, kind, expense_date, budget_entry_id, amount, project):
        if kind == 'budget':
            if expense_date:
                raise ValidationError(self.env._("Budget entries cannot have an expense date."))
            if budget_entry_id:
                raise ValidationError(self.env._("Budget entries cannot link to another budget entry."))
        elif kind == 'expense':
            if not expense_date:
                raise ValidationError(self.env._("Expense entries require an expense date."))
            if amount is not None and amount <= 0:
                raise ValidationError(self.env._("Expense amount must be positive."))
            if budget_entry_id:
                if isinstance(budget_entry_id, bool) or not isinstance(budget_entry_id, int):
                    raise ValidationError(self.env._("budget_entry_id must be a positive integer or null."))
                budget = self.search([
                    ('id', '=', budget_entry_id), ('project_id', '=', project.id), ('kind', '=', 'budget'),
                ], limit=1)
                if not budget:
                    raise ValidationError(
                        self.env._("budget_entry_id must reference a budget entry in the same project."),
                    )
        else:
            raise ValidationError(self.env._("kind must be 'budget' or 'expense'."))

    @api.constrains('kind', 'expense_date', 'budget_entry_id', 'amount', 'project_id', 'title', 'reference', 'notes')
    def _check_webvue_finance_entry_state(self):
        """Final full-state guard, independent of which write path was used."""
        for entry in self:
            _validate_amount(entry.amount, entry.currency_id, self.env)
            _validate_title(entry.title, self.env)
            _validate_text_field(entry.reference, REFERENCE_MAX_LEN, 'reference', self.env)
            _validate_text_field(entry.notes, NOTES_MAX_LEN, 'notes', self.env)
            self._webvue_check_kind_consistency(
                entry.kind, entry.expense_date, entry.budget_entry_id.id, entry.amount, entry.project_id,
            )

    def _webvue_check_manual_actual(self, project):
        """Expenses are manual entries only while the project's actual cost is not external."""
        if self.env['webvue.project.actual.source']._webvue_is_external(project):
            raise ValidationError(self.env._("Expenses are recorded in the project's cost center, not here."))

    # --- create / write / unlink ------------------------------------------
    @staticmethod
    def _webvue_check_id_field(value, field, env):
        if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
            raise ValidationError(env._("%s must be a positive integer.") % field)
        return value

    @api.model_create_multi
    def create(self, vals_list):
        _check_no_protected_defaults(self.env)
        prepared = []
        for vals in vals_list:
            vals = dict(vals)
            unknown = set(vals) - CREATE_WRITABLE
            if unknown:
                raise AccessError(self.env._("Finance entry fields are not allowed."))
            project_id = self._webvue_check_id_field(vals.get('project_id'), 'project_id', self.env)
            project = self.env['project.project'].browse(project_id).exists()
            project = self._webvue_check_project_for_finance(project, manage=True)
            if vals.get('kind') == 'expense':
                self._webvue_check_manual_actual(project)
            if 'title' in vals:
                vals['title'] = _validate_title(vals['title'], self.env)
            if 'reference' in vals:
                vals['reference'] = _validate_text_field(vals['reference'], REFERENCE_MAX_LEN, 'reference', self.env)
            if 'notes' in vals:
                vals['notes'] = _validate_text_field(vals['notes'], NOTES_MAX_LEN, 'notes', self.env)
            if 'expense_date' in vals:
                vals['expense_date'] = _validate_date_value(vals['expense_date'], self.env)
            if 'budget_entry_id' in vals and vals['budget_entry_id'] not in (None, False):
                self._webvue_check_id_field(vals['budget_entry_id'], 'budget_entry_id', self.env)
            _validate_amount(vals.get('amount'), project.currency_id, self.env)
            self._webvue_check_kind_consistency(
                vals.get('kind'), vals.get('expense_date'), vals.get('budget_entry_id'),
                vals.get('amount'), project,
            )
            prepared.append(vals)
        return super().create(prepared)

    def write(self, vals):
        _check_no_protected_defaults(self.env)
        vals = dict(vals)
        if set(vals) & IMMUTABLE_FIELDS:
            raise AccessError(self.env._("Finance entry identity fields cannot be changed."))
        if 'title' in vals:
            vals['title'] = _validate_title(vals['title'], self.env)
        if 'reference' in vals:
            vals['reference'] = _validate_text_field(vals['reference'], REFERENCE_MAX_LEN, 'reference', self.env)
        if 'notes' in vals:
            vals['notes'] = _validate_text_field(vals['notes'], NOTES_MAX_LEN, 'notes', self.env)
        if 'expense_date' in vals:
            vals['expense_date'] = _validate_date_value(vals['expense_date'], self.env)
        if 'budget_entry_id' in vals and vals['budget_entry_id'] not in (None, False):
            self._webvue_check_id_field(vals['budget_entry_id'], 'budget_entry_id', self.env)
        for entry in self:
            project = self._webvue_check_project_for_finance(entry.project_id, manage=True)
            if entry.kind == 'expense':
                self._webvue_check_manual_actual(project)
            amount = vals.get('amount', entry.amount)
            if 'amount' in vals:
                _validate_amount(amount, entry.currency_id, self.env)
            expense_date = vals.get('expense_date', entry.expense_date)
            budget_entry_id = vals.get('budget_entry_id', entry.budget_entry_id.id)
            self._webvue_check_kind_consistency(entry.kind, expense_date, budget_entry_id, amount, project)
        result = super().write(vals)
        if set(vals) & MUTABLE_FIELDS and self.ids:
            self._webvue_bump_revision()
        return result

    def unlink(self):
        for entry in self:
            self._webvue_check_project_for_finance(entry.project_id, manage=True)
        budgets = self.filtered(lambda e: e.kind == 'budget')
        if budgets:
            blocking = self.search([
                ('budget_entry_id', 'in', budgets.ids), ('id', 'not in', self.ids),
            ])
            if blocking:
                raise WebVueFinanceEntryLinked(
                    self.env._("Budget entry has linked expenses."), len(blocking),
                )
        return super().unlink()

    # --- revision / locking ------------------------------------------------
    def _webvue_updated_at(self):
        self.ensure_one()
        return 'v%s' % (self.webvue_revision or 0)

    def _webvue_lock_for_write(self, expected):
        self.ensure_one()
        self.env.cr.execute(
            '''
                SELECT webvue_revision, project_id
                  FROM webvue_project_finance_entry
                 WHERE id = %s
                   FOR UPDATE
            ''',
            [self.id],
        )
        row = self.env.cr.fetchone()
        if not row:
            raise MissingError(self.env._("Finance entry does not exist."))
        self.invalidate_recordset()
        project = self.env['project.project'].browse(row[1])
        self._webvue_check_project_for_finance(project, manage=True)
        current = 'v%s' % (row[0] or 0)
        if expected != current:
            raise WebVueFinanceStaleWrite(self.env._("This entry was changed by someone else."))

    def _webvue_bump_revision(self):
        self.env.flush_all()
        self.env.cr.execute(
            'UPDATE webvue_project_finance_entry SET webvue_revision = COALESCE(webvue_revision, 0) + 1 WHERE id IN %s',
            [tuple(self.ids)],
        )
        self.invalidate_recordset(['webvue_revision'])
