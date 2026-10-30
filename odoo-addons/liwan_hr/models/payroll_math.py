# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Pure payroll arithmetic: no ORM, no database, only dates and ``Decimal`` amounts.

The GOSI rates themselves are data (``liwan.hr.gosi.rate``); this module only chooses the
nationality class and applies the rates it is given.
"""
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import NamedTuple

from dateutil.relativedelta import relativedelta

GCC_CODES = frozenset({'AE', 'BH', 'KW', 'OM', 'QA'})
# The date the Saudi social insurance reform took effect: a law date, not a rate.
SAUDI_REFORM_DATE = date(2024, 7, 3)
CENTS = Decimal('0.01')
# A break of this many days or more between two contracts ends the continuous service (as in stock hr).
SERVICE_GAP_DAYS = 4
OPEN_ENDED = date(2100, 1, 1)
# How the contract ended: the Saudi Labor Law articles 84 to 87 decide the award from it.
EOS_CASES = ('termination', 'contract_expiry', 'resignation', 'force_majeure', 'marriage_childbirth', 'no_award')
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


def branch_wage(base, row, ratio):
    """The wage one branch is taken on: the cap bounds the full monthly base, then the ratio prorates."""
    return contributory_wage(base, row.wage_min, row.wage_max) * ratio


def gosi_amounts(base, rates, ratio):
    """Per branch ``(employee, employer)`` on the capped, prorated wage of that branch."""
    amounts = {}
    for branch, row in rates.items():
        wage = branch_wage(base, row, ratio)
        amounts[branch] = (
            money(wage * row.employee_rate / 100),
            money(wage * row.employer_rate / 100),
        )
    return amounts


def reported_gosi_wage(base, rates, ratio):
    """The contributory wage a GOSI statement reports: that of the annuities branch, else the first branch present.

    Non-Saudis pay no annuities, so their statement line shows the wage of the branch they do pay.
    """
    for branch in ('annuities', 'saned', 'hazards'):
        if branch in rates:
            return money(branch_wage(base, rates[branch], ratio))
    return money(0)


def paid_days(month_start, month_end, contract_start, contract_end, departure_date, divisor):
    """Paid days of one pay month: a whole month is always the divisor, a part month counts calendar days."""
    start = max(month_start, contract_start)
    end = min(day for day in (month_end, contract_end, departure_date) if day)
    if end < start:
        return 0
    if start == month_start and end == month_end:
        return divisor
    return min((end - start).days + 1, divisor)


def overlap_days(leave_from, leave_to, window_start, window_end, half_day=False):
    """Calendar days of a leave inside a window, inclusive; a half-day leave counts one half."""
    start = max(leave_from, window_start)
    end = min(leave_to, window_end)
    if end < start:
        return Decimal(0)
    if half_day:
        return Decimal('0.5')
    return Decimal((end - start).days + 1)


def day_amount(monthly, days, divisor):
    return money(monthly / divisor * days)


def service_years(start, end):
    """Years of service from ``start`` to ``end`` inclusive: whole anniversaries plus the remaining days over 365."""
    after = end + timedelta(days=1)
    full = relativedelta(after, start).years
    anniversary = start + relativedelta(years=full)
    return Decimal(full) + Decimal((after - anniversary).days) / Decimal(365)


def eos_award(wage, years, case):
    """The end-of-service award: half a month's wage per year for five years, a month's wage per year after."""
    full = wage * (Decimal('0.5') * min(years, 5) + max(years - 5, 0))
    if case == 'no_award':
        return money(0)
    if case != 'resignation':
        return money(full)  # Articles 84 and 87
    if years < 2:
        return money(0)  # Article 85
    factor = Decimal(1) / 3 if years <= 5 else Decimal(2) / 3 if years < 10 else Decimal(1)
    return money(full * factor)


def continuous_service_start(periods):
    """Start of the service that runs unbroken up to the latest of ``periods`` (``(start, end or None)`` pairs).

    Walks back from the latest period while the gap to the one before it is under ``SERVICE_GAP_DAYS``;
    a period without an end counts as open, like the stock ``no_gap`` rule.
    """
    ordered = sorted(set(periods), key=lambda period: (period[0], period[1] or OPEN_ENDED), reverse=True)
    if not ordered:
        return None
    current = ordered[0][0]
    for start, end in ordered[1:]:
        if (current - (end or OPEN_ENDED)).days >= SERVICE_GAP_DAYS:
            break
        current = start
    return current
