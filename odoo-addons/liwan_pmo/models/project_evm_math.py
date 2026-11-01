# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Earned value maths, as of one day. Pure functions: no ORM, no clock, no I/O.

A baseline line holds a share of the budget (``share``, the shares of a baseline add up to 1), its planned
start and end, and the task's percent complete now. With BAC the baseline budget and AC the actual cost:

* the planned fraction of a line at ``today`` grows linearly from its start to its end (0 before, 1 from the
  end on); a line with an end but no start is a step at its end; a line with no end is undated and takes part
  in neither PV nor EV, because its schedule cannot be judged;
* PV = BAC x sum(share x planned fraction), EV = BAC x sum(share x percent complete / 100);
* SV = EV - PV, CV = EV - AC, SPI = EV / PV, CPI = EV / AC, EAC = BAC / CPI, ETC = EAC - AC, VAC = BAC - EAC,
  TCPI = (BAC - EV) / (BAC - AC).

A ratio whose divisor is not positive is ``None`` ("not enough data"), never 0 or infinity. SPI is the ratio
of the two fractions, so it does not depend on BAC and still exists for a project without a budget; every
cost index is ``None`` when BAC is 0.
"""
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

INDEX_DECIMALS = 2
CURVE_STEP_DAYS = 7
CURVE_MAX_POINTS = 60


@dataclass(frozen=True)
class EvmLine:
    """One baseline line as the maths sees it: its share, its planned dates and its percent complete (0..100)."""
    share: float
    start: date | None
    end: date | None
    percent: int


def planned_fraction(start, end, today):
    """How much of a line is planned to be done at ``today`` (0..1); None when the line has no end date."""
    if end is None:
        return None
    if start is None or start >= end:
        return 1.0 if today >= end else 0.0
    if today <= start:
        return 0.0
    if today >= end:
        return 1.0
    return (today - start).days / (end - start).days


def _round(value, decimals):
    """Half-up rounding through the shortest repr, so 2.675 rounds to 2.68 and not to the binary float's 2.67."""
    quantum = Decimal(1).scaleb(-decimals)
    return float(Decimal(repr(value)).quantize(quantum, rounding=ROUND_HALF_UP))


def _ratio(numerator, divisor):
    return numerator / divisor if divisor > 0 else None


def _index(value):
    return None if value is None else _round(value, INDEX_DECIMALS)


def _money(value, decimals):
    return None if value is None else _round(value, decimals)


def planned_fractions(lines, today):
    """The planned fraction of the whole plan at ``today``: sum(share x fraction) over the dated lines."""
    total = 0.0
    for line in lines:
        fraction = planned_fraction(line.start, line.end, today)
        if fraction is not None:
            total += line.share * fraction
    return total


def earned_fraction(lines):
    """The earned fraction of the whole plan: sum(share x percent / 100) over the dated lines."""
    return sum(line.share * line.percent / 100 for line in lines if line.end is not None)


def planned_curve(lines, bac, decimals):
    """Weekly points ``{'date', 'pv'}`` from the first planned date to the last, at most CURVE_MAX_POINTS.

    A longer plan widens the step in whole weeks; the last point is always the final planned date. Empty
    when no line has an end date.
    """
    dated = [line for line in lines if line.end is not None]
    if not dated:
        return []
    first = min(line.start or line.end for line in dated)
    last = max(line.end for line in dated)
    span = (last - first).days
    step = CURVE_STEP_DAYS * max(1, -(-span // CURVE_STEP_DAYS // (CURVE_MAX_POINTS - 1)))
    days = list(range(0, span, step)) + [span]
    return [
        {'date': (first + timedelta(days=offset)).isoformat(), 'pv': _money(bac * planned_fractions(dated, first + timedelta(days=offset)), decimals)}
        for offset in days
    ]


def compute_evm(bac, actual, lines, today, decimals=2):
    """The earned value reading of a plan at ``today``; amounts are rounded to ``decimals``, indices to two decimals.

    ``bac`` is the baseline budget, ``actual`` the actual cost to date and ``lines`` the baseline lines.
    ``undated_count`` is the number of lines left out of PV and EV because they have no end date.
    """
    pv_fraction = planned_fractions(lines, today)
    ev_fraction = earned_fraction(lines)
    pv = _money(bac * pv_fraction, decimals)
    ev = _money(bac * ev_fraction, decimals)
    paid = _money(actual, decimals)
    result = {
        'bac': _money(bac, decimals), 'pv': pv, 'ev': ev, 'ac': paid,
        'sv': _money(ev - pv, decimals), 'spi': _index(_ratio(ev_fraction, pv_fraction)),
        'cv': None, 'cpi': None, 'eac': None, 'etc': None, 'vac': None, 'tcpi': None,
    }
    if bac > 0:
        raw_ev = bac * ev_fraction
        cpi = _ratio(raw_ev, actual)
        eac = bac / cpi if cpi else None
        result.update({
            'cv': _money(ev - paid, decimals), 'cpi': _index(cpi), 'eac': _money(eac, decimals),
            'etc': None if eac is None else _money(_money(eac, decimals) - paid, decimals),
            'vac': None if eac is None else _money(bac - _money(eac, decimals), decimals),
            'tcpi': _index(_ratio(bac - raw_ev, bac - actual)),
        })
    result['undated_count'] = sum(1 for line in lines if line.end is None)
    result['planned_curve'] = planned_curve(lines, bac, decimals)
    return result
