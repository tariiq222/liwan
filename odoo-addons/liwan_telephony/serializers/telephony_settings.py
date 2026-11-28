# Part of Odoo. See LICENSE file for full copyright and licensing details.


def dump_telephony_settings(settings):
    """The one wire shape of the company's telephony settings: the three choices and nothing else."""
    return {
        'recordingPolicy': settings.recording_policy,
        'recordingAnnouncement': settings.recording_announcement,
        'recordingRetentionDays': settings.recording_retention_days,
    }
