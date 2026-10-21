# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Pure payroll arithmetic: no ORM, no database, only dates and ``Decimal`` amounts.

The GOSI rates themselves are data (``webvue.hr.gosi.rate``); this module only chooses the
nationality class and applies the rates it is given.
"""
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from typing import NamedTuple

GCC_CODES = frozenset({'AE', 'BH', 'KW', 'OM', 'QA'})
# The date the Saudi social insurance reform took effect: a law date, not a rate.
SAUDI_REFORM_DATE = date(2024, 7, 3)
CENTS = Decimal('0.01')
NATIONALITY_MISSING = 'nationality_missing'
GOSI_REGISTRATION_MISSING = 'gosi_registration_missing'


class PayrollMathError(Exception):
    """A payroll input that cannot be computed on; ``code`` is the API error code."""

    def __init__(self, code):
        super().__init__(code)
        self.code = code


class GosiRate(NamedTuple):
    """One branch of one nationality class on one day, in percent."""

    employee_rate: Decimal
    employer_rate: Decimal
    wage_min: Decimal
    wage_max: Decimal


def nationality_class(country_code, registration_date):
    """The GOSI class of an employee: Saudis split on their GOSI registration date."""
    if not country_code:
        raise PayrollMathError(NATIONALITY_MISSING)
    if country_code == 'SA':
        if not registration_date:
            raise PayrollMathError(GOSI_REGISTRATION_MISSING)
        return 'saudi_before_2024' if registration_date < SAUDI_REFORM_DATE else 'saudi_from_2024'
    return 'gcc' if country_code in GCC_CODES else 'non_saudi'


def contributory_wage(base, wage_min, wage_max):
    return min(max(base, wage_min), wage_max)


def money(value):
    return Decimal(value).quantize(CENTS, rounding=ROUND_HALF_UP)


def gosi_amounts(base, rates, ratio):
    """Per branch ``(employee, employer)``; the cap bounds the full monthly base, then the ratio prorates."""
    amounts = {}
    for branch, row in rates.items():
        wage = contributory_wage(base, row.wage_min, row.wage_max) * ratio
        amounts[branch] = (
            money(wage * row.employee_rate / 100),
            money(wage * row.employer_rate / 100),
        )
    return amounts
