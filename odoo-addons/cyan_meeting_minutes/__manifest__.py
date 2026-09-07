# Part of Odoo. See LICENSE file for full copyright and licensing details.
# Original author: Cyan. Version 19.0.1.3.1 is Nasq hardening of vendor 19.0.1.3.0.
# SPDX-License-Identifier: LGPL-3
{
    "name": "Cyan Meeting Minutes",
    "version": "19.0.1.3.1",
    "author": "Cyan",
    "category": "Productivity/Meetings",
    "summary": "Internal meeting minutes and resolution tracking",
    "license": "LGPL-3",
    "depends": ["base", "mail", "web", "calendar"],
    "data": [
        "security/meeting_security.xml",
        "security/ir.model.access.csv",
        "data/meeting_sequence.xml",
        "data/escalation_cron.xml",
        "views/meeting_views.xml",
        "views/resolution_views.xml",
        "views/calendar_event_views.xml",
        "views/menus.xml",
        "report/meeting_report_templates.xml",
        "report/meeting_report.xml",
    ],
    "application": True,
    "installable": True,
}
