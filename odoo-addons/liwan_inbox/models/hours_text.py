# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The Arabic sentence that tells a customer when the company answers, built from the weekly working-hours ranges."""

ALWAYS_OPEN = 'نستقبل رسائلكم في أي وقت'
# Sunday first (the Saudi week); the stored weekday has Monday as 0.
WEEK_ORDER = (6, 0, 1, 2, 3, 4, 5)
DAY_NAMES = {6: 'الأحد', 0: 'الاثنين', 1: 'الثلاثاء', 2: 'الأربعاء', 3: 'الخميس', 4: 'الجمعة', 5: 'السبت'}


def _clock(minutes):
    return f'{minutes // 60}:{minutes % 60:02d}'


def _days_text(run):
    names = [DAY_NAMES[weekday] for weekday in run]
    if len(names) == 1:
        return names[0]
    if len(names) == 2:
        return f'{names[0]} و{names[1]}'
    return f'من {names[0]} إلى {names[-1]}'


def hours_sentence(ranges):
    """The sentence for `ranges`, (weekday, start minute, end minute) triples with Monday as 0.

    Consecutive days with the same ranges are grouped, days without ranges are left out, and no ranges at all means the
    company is always open.
    """
    by_day = {}
    for weekday, start, end in ranges:
        by_day.setdefault(weekday, []).append((start, end))
    if not by_day:
        return ALWAYS_OPEN
    runs = []
    for weekday in WEEK_ORDER:
        if weekday not in by_day:
            continue
        slots = tuple(sorted(set(by_day[weekday])))
        previous = runs[-1] if runs else None
        if previous and previous['slots'] == slots and previous['days'][-1] == WEEK_ORDER[WEEK_ORDER.index(weekday) - 1]:
            previous['days'].append(weekday)
        else:
            runs.append({'days': [weekday], 'slots': slots})
    return '؛ '.join(
        f'{_days_text(run["days"])}، ' + ' و'.join(f'من {_clock(start)} إلى {_clock(end)}' for start, end in run['slots'])
        for run in runs
    )
