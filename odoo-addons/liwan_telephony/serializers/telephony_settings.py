# Part of Odoo. See LICENSE file for full copyright and licensing details.


def dump_settings(settings):
    return {
        'recordingPolicy': settings.recording_policy,
        'recordingAnnouncement': settings.recording_announcement,
        'retentionDays': settings.retention_days,
        'defaultLine': {'id': settings.default_line_id.id, 'name': settings.default_line_id.name}
        if settings.default_line_id else None,
        'ivrEnabled': settings.ivr_enabled,
        'businessHoursEnabled': settings.business_hours_enabled,
        'outboundInternational': settings.outbound_international,
    }
