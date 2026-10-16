# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Translate the pure validator's stable reasons at its Odoo boundary."""


def maintenance_time_message(env, error):
    messages = {
        'invalid_timezone': env._('A valid IANA timezone is required.'),
        'invalid_local_time': env._('Use a valid local date and time without an offset.'),
        'invalid_dst_time': env._('This local time is missing or ambiguous because of daylight saving time.'),
        'invalid_duration': env._('Window duration must be between 1 and 1440 minutes.'),
        'past_window': env._('Choose a future maintenance window.'),
        'insufficient_window': env._('The maintenance window is shorter than the measured estimate.'),
        'deadline_exceeded': env._('The maintenance window must finish before the release deadline.'),
    }
    return messages.get(str(error), messages['invalid_local_time'])
