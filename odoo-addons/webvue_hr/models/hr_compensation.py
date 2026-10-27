# Part of Odoo. See LICENSE file for full copyright and licensing details.
import re
from decimal import Decimal

from odoo import api, fields, models
from odoo.exceptions import ValidationError

SAUDI_IBAN = re.compile(r'SA\d{22}')
# How the customer classifies its relationship with the person paid. The customer decides it, not
# WebVue: the label never changes a calculation and never blocks a run, approval or payment; the UI
# only warns about its GOSI, WPS and end-of-service effects (owner decision 2026-10-27, B12).
RELATIONSHIP_TYPES = [
    ('employee', 'Employee'),
    ('independent_contractor', 'Independent contractor'),
    ('consultant', 'Consultant'),
    ('other_cooperation', 'Other cooperation arrangement'),
]


def normalize_iban(value):
    """The compact upper-case Saudi IBAN, or an empty string; ValueError when it is not one.

    Checked by shape (SA, 24 characters, digits) and the ISO 13616 mod-97 check. ``stdnum``
    cannot be used here: Odoo's import hook breaks its data file loading.
    """
    compact = re.sub(r'\s+', '', value or '').upper()
    if not compact:
        return ''
    rearranged = compact[4:] + compact[:4]
    digits = ''.join(str(int(char, 36)) for char in rearranged) if SAUDI_IBAN.fullmatch(compact) else ''
    if not digits or int(digits) % 97 != 1:
        msg = 'iban must be a valid Saudi IBAN'
        raise ValueError(msg)
    return compact


class WebVueHrCompensation(models.Model):
    """The payroll-only pay terms of one employee.

    Wages, IBAN and GOSI data live here and nowhere else: the employee record, the people
    picker and every general serializer never read this model, and only the payroll
    capabilities open it. Nationality and national ID stay on the stock employee version.
    """

    _name = 'webvue.hr.compensation'
    _description = 'WebVue HR compensation'
    _webvue_scope = 'company'

    employee_id = fields.Many2one(
        'hr.employee', required=True, ondelete='cascade', index=True,
    )
    company_id = fields.Many2one(
        related='employee_id.company_id', store=True, index=True,
    )
    currency_id = fields.Many2one(related='company_id.currency_id')
    basic_wage = fields.Monetary(required=True)
    housing_allowance = fields.Monetary()
    transport_allowance = fields.Monetary()
    other_allowance = fields.Monetary()
    iban = fields.Char()
    bank_id = fields.Many2one('res.bank')
    gosi_number = fields.Char()
    gosi_registration_date = fields.Date()
    relationship_type = fields.Selection(RELATIONSHIP_TYPES, required=True, default='employee')

    _employee_unique = models.Constraint(
        'UNIQUE(employee_id)', 'an employee has one compensation record',
    )
    _amounts_valid = models.Constraint(
        'CHECK(basic_wage > 0 AND housing_allowance >= 0 AND transport_allowance >= 0 AND other_allowance >= 0)',
        'basic wage must be positive and allowances must not be negative',
    )

    @api.constrains('iban')
    def _check_iban(self):
        for record in self:
            try:
                compact = normalize_iban(record.iban)
            except ValueError as error:
                raise ValidationError(self.env._('The IBAN must be a valid Saudi IBAN.')) from error
            if compact != (record.iban or ''):
                raise ValidationError(self.env._('The IBAN must be stored compact and upper-case.'))

    def _webvue_fixed_wage(self):
        """Basic wage plus every allowance: the wage of the end-of-service award and the day rate."""
        self.ensure_one()
        return (
            self._webvue_gosi_base()
            + Decimal(str(self.transport_allowance))
            + Decimal(str(self.other_allowance))
        )

    def _webvue_gosi_base(self):
        """Basic wage plus housing allowance: the base the GOSI contribution is taken on."""
        self.ensure_one()
        return Decimal(str(self.basic_wage)) + Decimal(str(self.housing_allowance))
