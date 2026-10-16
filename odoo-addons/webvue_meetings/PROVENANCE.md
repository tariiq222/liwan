# Provenance

The meeting engine inside `webvue_meetings` (the models `webvue.meeting.minute` and
`webvue.meeting.resolution`, the minutes report, the sequence and
`i18n/ar.po`) began as the vendored addon `cyan_meeting_minutes`. WebVue absorbed that
addon into `webvue_meetings` and deleted the separate addon. WebVue renamed the models and
folded its own extensions into the single model definitions.

- Upstream: https://github.com/rezachidotnet/meeting_minutes-odoo
- Pin: `3a549ffe5ce6a92daa318810bce5e199f7c5c24b`
- Upstream version: `19.0.1.3.0` (author Cyan, license LGPL-3)
- Last version of the separate addon: `19.0.1.3.1`, WebVue privacy/lock/calendar hardening of the vendor module
- `webvue_meetings` is LGPL-3 like the upstream module. The manifest lists Cyan next to the WebVue author, and the moved Python files keep the Cyan notice. Upstream shipped no LICENSE file, only the manifest identifier `LGPL-3`; that is the declared identifier, not a legal opinion or guarantee.
- WebVue did not author the original module. The serializers, controllers, series, workspace, history, notifications, `secretary_id`, record rules, write guards, tests, Arabic translations and this file are WebVue changes.
- Upstream's backend views, menus and groups were dropped: customers use the WebVue web app, never the Odoo backend. Access is the `meetings.*` capabilities. Its Odoo activities per resolution, the overdue escalation cron and the completion date were dropped for the same reason; the overdue reminder is the `meeting_resolution_overdue` bell notification.
- `project.task` is not linked here. The bridge `webvue_meetings_pmo` links projects and tasks through `webvue_pmo`.

Sudo exceptions (READ only):

- `group_cap_meetings_manage.sudo().user_ids` to list company managers for follower allow-lists.
- Calendar link existence `Meeting.sudo().search` then `with_env(user)` before any write.

Participant comments use stock `_mail_post_access = 'read'`. There is no `message_post` sudo.

The absorbed engine is a fresh-database baseline (`migrations/19.0.1.2.0/README.md`): a database that ran `cyan_meeting_minutes` is not upgraded in place.
